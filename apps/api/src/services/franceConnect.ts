import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

// ─────────────────────────────────────────────────────────────────────────────
// FranceConnect (OpenID Connect, Authorization Code Flow)
//
// Câblage du « bac à sable » FranceConnect (fournisseur de service, niveau
// eIDAS « low »). Les endpoints par défaut ci-dessous pointent vers
// l'environnement d'intégration FCP low :
//
//   issuer       https://fcp-low.sbx.dev-franceconnect.fr/api/v2
//   authorize    {issuer}/authorize
//   token        {issuer}/token
//   userinfo     {issuer}/userinfo   (réponse signée : application/jwt)
//   session/end  {issuer}/session/end
//
// Pour passer en production, il suffit de surcharger FC_ISSUER_URL et de
// fournir les identifiants (client_id / client_secret) du FS de production.
//
// Sécurité OIDC mise en œuvre (cf. verifyIdToken / fetchUserInfo) :
//   - signature JWS de l'id_token ET de la réponse userinfo vérifiée contre le
//     JWKS FranceConnect ({issuer}/jwks) ;
//   - `iss`, `aud` (== client_id) et `exp` de l'id_token contrôlés, plus le
//     `nonce` anti-rejeu.
// ─────────────────────────────────────────────────────────────────────────────

export interface FranceConnectConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  postLogoutRedirectUri: string;
  scopes: string;
}

const DEFAULT_ISSUER = "https://fcp-low.sbx.dev-franceconnect.fr/api/v2";
const DEFAULT_SCOPES = "openid given_name family_name email";

/**
 * Retourne la config FranceConnect si les 3 variables obligatoires sont
 * présentes, sinon `null` (FranceConnect désactivé). Aucun secret n'est codé
 * en dur : tout vient de l'environnement.
 */
export function getFranceConnectConfig(): FranceConnectConfig | null {
  const clientId = process.env.FC_CLIENT_ID;
  const clientSecret = process.env.FC_CLIENT_SECRET;
  const redirectUri = process.env.FC_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) return null;
  return {
    issuer: (process.env.FC_ISSUER_URL ?? DEFAULT_ISSUER).replace(/\/$/, ""),
    clientId,
    clientSecret,
    redirectUri,
    postLogoutRedirectUri: process.env.FC_POST_LOGOUT_REDIRECT_URI ?? "",
    scopes: process.env.FC_SCOPES ?? DEFAULT_SCOPES,
  };
}

export function isFranceConnectEnabled(): boolean {
  return getFranceConnectConfig() !== null;
}

export interface FranceConnectTokens {
  access_token: string;
  id_token: string;
  token_type: string;
  expires_in?: number;
}

// Identité renvoyée par /userinfo (claims du scope demandé).
export interface FranceConnectIdentity {
  sub: string;
  given_name?: string;
  family_name?: string;
  email?: string;
  preferred_username?: string;
  [claim: string]: unknown;
}

/** Construit l'URL d'autorisation (redirection navigateur vers FranceConnect). */
export function buildAuthorizeUrl(
  cfg: FranceConnectConfig,
  args: { state: string; nonce: string },
): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    scope: cfg.scopes,
    state: args.state,
    nonce: args.nonce,
    // Niveau de garantie eIDAS exigé. « eidas1 » = niveau faible, suffisant
    // pour le bac à sable FCP low.
    acr_values: "eidas1",
  });
  return `${cfg.issuer}/authorize?${params.toString()}`;
}

/** Échange le code d'autorisation contre les tokens (back-channel, TLS). */
export async function exchangeCodeForTokens(
  cfg: FranceConnectConfig,
  code: string,
): Promise<FranceConnectTokens> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: cfg.redirectUri,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
  });
  const res = await fetch(`${cfg.issuer}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`FranceConnect token endpoint ${res.status}: ${detail.slice(0, 300)}`);
  }
  return (await res.json()) as FranceConnectTokens;
}

// JWKS distant de l'issuer, mis en cache par issuer. jose gère en interne la
// récupération, le cache et la rotation des clés (cooldown HTTP sur /jwks).
const _jwksByIssuer = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
function getJwks(issuer: string): ReturnType<typeof createRemoteJWKSet> {
  let jwks = _jwksByIssuer.get(issuer);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${issuer}/jwks`));
    _jwksByIssuer.set(issuer, jwks);
  }
  return jwks;
}

// FranceConnect FCP « low » signe en ES256 ; on accepte aussi RS256 (prod /
// autres FS) et on fige la liste pour éviter toute confusion d'algorithme.
const FC_SIGNING_ALGS = ["ES256", "RS256"];

/**
 * Vérifie l'id_token FranceConnect : signature JWS via le JWKS de l'issuer,
 * `iss`, `aud` (== client_id) et `exp` (jwtVerify) + anti-rejeu `nonce`.
 * Lève une erreur si une quelconque vérification échoue.
 */
export async function verifyIdToken(
  cfg: FranceConnectConfig,
  idToken: string,
  expectedNonce: string,
): Promise<JWTPayload> {
  const { payload } = await jwtVerify(idToken, getJwks(cfg.issuer), {
    issuer: cfg.issuer,
    audience: cfg.clientId,
    algorithms: FC_SIGNING_ALGS,
    // Petite tolérance pour absorber un léger décalage d'horloge serveur/IdP.
    clockTolerance: 5,
  });
  if (typeof payload.nonce !== "string" || payload.nonce !== expectedNonce) {
    throw new Error("nonce de l'id_token FranceConnect invalide");
  }
  return payload;
}

/**
 * Récupère l'identité via /userinfo. FranceConnect v2 répond en
 * `application/jwt` (JWS signé) : on VÉRIFIE la signature contre le JWKS FC et
 * l'issuer avant de faire confiance aux claims (défense en profondeur en plus
 * du canal back-channel TLS).
 */
export async function fetchUserInfo(
  cfg: FranceConnectConfig,
  accessToken: string,
): Promise<FranceConnectIdentity> {
  const res = await fetch(`${cfg.issuer}/userinfo`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`FranceConnect userinfo endpoint ${res.status}: ${detail.slice(0, 300)}`);
  }
  const contentType = res.headers.get("content-type") ?? "";
  const raw = (await res.text()).trim();
  if (contentType.includes("application/jwt") || !raw.startsWith("{")) {
    const { payload } = await jwtVerify(raw, getJwks(cfg.issuer), {
      issuer: cfg.issuer,
      algorithms: FC_SIGNING_ALGS,
    });
    return payload as FranceConnectIdentity;
  }
  return JSON.parse(raw) as FranceConnectIdentity;
}

/**
 * URL de déconnexion FranceConnect (RP-initiated logout). `id_token_hint` est
 * requis par FranceConnect pour fermer la session côté IdP.
 */
export function buildLogoutUrl(
  cfg: FranceConnectConfig,
  args: { idTokenHint: string; state: string },
): string {
  const params = new URLSearchParams({
    id_token_hint: args.idTokenHint,
    state: args.state,
    post_logout_redirect_uri: cfg.postLogoutRedirectUri || cfg.redirectUri,
  });
  return `${cfg.issuer}/session/end?${params.toString()}`;
}
