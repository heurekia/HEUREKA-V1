// Client PISTE (api.piste.gouv.fr) — OAuth2 client_credentials + POST JSON.
// Sert d'accès à l'API Légifrance (DILA). Les credentials viennent du portail
// PISTE : un couple (client_id, client_secret) par environnement (sandbox/prod).
//
// Variables d'environnement attendues :
//   PISTE_CLIENT_ID
//   PISTE_CLIENT_SECRET
//   PISTE_API_BASE_URL   (défaut sandbox)
//   PISTE_OAUTH_URL      (défaut sandbox)
//
// La sandbox PISTE est quota-limitée — c'est `legalArticles.getOrFetch`
// qui garantit qu'on ne tape l'API qu'une seule fois par article (cache DB).

const DEFAULT_API  = "https://sandbox-api.piste.gouv.fr/dila/legifrance/lf-engine-app";
const DEFAULT_OAUTH = "https://sandbox-oauth.piste.gouv.fr/api/oauth/token";

const API_BASE  = process.env.PISTE_API_BASE_URL ?? DEFAULT_API;
const OAUTH_URL = process.env.PISTE_OAUTH_URL   ?? DEFAULT_OAUTH;

type TokenCache = { token: string; expiresAt: number };
let cachedToken: TokenCache | null = null;

async function getAccessToken(): Promise<string> {
  const clientId     = process.env.PISTE_CLIENT_ID;
  const clientSecret = process.env.PISTE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("PISTE_CLIENT_ID / PISTE_CLIENT_SECRET manquants en environnement");
  }

  // Renouvelle 30s avant expiration pour éviter une course avec un appel sortant.
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt - 30_000 > now) return cachedToken.token;

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
    scope: "openid",
  });

  const res = await fetch(OAUTH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`PISTE OAuth ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    token: data.access_token,
    expiresAt: now + data.expires_in * 1000,
  };
  return data.access_token;
}

export async function pistePost<T = unknown>(path: string, body: unknown): Promise<T> {
  const token = await getAccessToken();
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`PISTE ${path} ${res.status}: ${text.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

export const PISTE_API_BASE_URL = API_BASE;
