import { Router } from "express";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import { rateLimit } from "express-rate-limit";
import { eq } from "drizzle-orm";
import { db } from "../db.js";
import { users } from "@heureka-v1/db";
import { generateToken, type AuthRequest } from "../middlewares/auth.js";
import { cookieNameFor, COOKIE_OPTIONS, COOKIE_CLEAR_OPTIONS } from "./auth.js";
import { logAudit } from "../services/audit.js";
import {
  getFranceConnectConfig,
  isFranceConnectEnabled,
  buildAuthorizeUrl,
  exchangeCodeForTokens,
  fetchUserInfo,
  verifyIdToken,
} from "../services/franceConnect.js";

export const franceConnectRouter = Router();

const IS_PROD = process.env.NODE_ENV === "production";
const JWT_SECRET = process.env.JWT_SECRET as string;

// Cookie de transaction (httpOnly, courte durée) portant `state`, `nonce` et la
// destination post-login. Signé en JWT : pas de stockage serveur, anti-CSRF via
// le `state` et anti-rejeu de l'id_token via le `nonce`.
const TX_COOKIE = "fc_tx";
const TX_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: IS_PROD,
  sameSite: "lax" as const,
  path: "/",
  maxAge: 10 * 60 * 1000, // 10 minutes — durée de vie du flux d'autorisation
};

const fcLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, legacyHeaders: false });

// Destination interne sûre après login : doit commencer par "/" et pas "//"
// (sinon redirection ouverte vers un domaine externe). Aligné avec
// sanitizeNextParam côté web.
function safeNext(next: unknown): string | null {
  if (typeof next !== "string" || !next.startsWith("/") || next.startsWith("//")) return null;
  return next;
}

function frontendBaseUrl(): string {
  const raw = process.env.FRONTEND_URL ?? process.env.FRONTEND_URLS ?? "http://localhost:5173";
  return raw.split(",")[0]!.trim().replace(/\/$/, "");
}

// ── État de configuration (le front masque le bouton si désactivé) ───────────
franceConnectRouter.get("/status", (_req, res) => {
  res.json({ enabled: isFranceConnectEnabled() });
});

// ── Étape 1 : redirection vers FranceConnect ─────────────────────────────────
franceConnectRouter.get("/login", fcLimiter, (req, res) => {
  const cfg = getFranceConnectConfig();
  if (!cfg) return res.status(503).json({ error: "FranceConnect n'est pas configuré sur ce serveur." });

  const state = crypto.randomBytes(16).toString("hex");
  const nonce = crypto.randomBytes(16).toString("hex");
  const next = safeNext(req.query.next);

  const tx = jwt.sign({ state, nonce, next }, JWT_SECRET, { expiresIn: "10m" });
  res.cookie(TX_COOKIE, tx, TX_COOKIE_OPTIONS);
  res.redirect(buildAuthorizeUrl(cfg, { state, nonce }));
});

// ── Étape 2 : retour de FranceConnect (échange code → identité → session) ────
franceConnectRouter.get("/callback", fcLimiter, async (req: AuthRequest, res) => {
  const cfg = getFranceConnectConfig();
  const front = frontendBaseUrl();
  const fail = (msg: string) => res.redirect(`${front}/login?fc_error=${encodeURIComponent(msg)}`);

  if (!cfg) return fail("FranceConnect n'est pas configuré.");

  try {
    const { code, state, error, error_description } = req.query;
    if (error) return fail(typeof error_description === "string" ? error_description : String(error));

    const txRaw = req.cookies?.[TX_COOKIE] as string | undefined;
    res.clearCookie(TX_COOKIE, { path: "/" });
    if (!txRaw || typeof code !== "string" || typeof state !== "string") {
      return fail("Requête FranceConnect invalide.");
    }

    let tx: { state: string; nonce: string; next: string | null };
    try {
      tx = jwt.verify(txRaw, JWT_SECRET) as typeof tx;
    } catch {
      return fail("Session FranceConnect expirée, merci de réessayer.");
    }
    // Anti-CSRF : le state reçu doit correspondre à celui posé à l'étape 1.
    if (tx.state !== state) return fail("Paramètre « state » invalide.");

    const tokens = await exchangeCodeForTokens(cfg, code);

    // Vérification complète de l'id_token : signature JWS (JWKS de l'issuer),
    // `iss`, `aud` (== client_id), `exp` + anti-rejeu `nonce`.
    try {
      await verifyIdToken(cfg, tokens.id_token, tx.nonce);
    } catch (e) {
      console.error("[franceconnect] id_token:", e);
      return fail("Jeton FranceConnect invalide.");
    }

    const identity = await fetchUserInfo(cfg, tokens.access_token);
    if (!identity?.sub) return fail("Identité FranceConnect incomplète.");

    const user = await findOrCreateUser(identity);
    if ("error" in user) return fail(user.error);

    const token = generateToken({
      id: user.id,
      email: user.email,
      role: user.role,
      commune: user.commune ?? undefined,
      commune_insee: user.commune_insee ?? undefined,
    });
    res.cookie(cookieNameFor(req), token, COOKIE_OPTIONS);
    res.clearCookie("token", COOKIE_CLEAR_OPTIONS);
    await logAudit(req, "login_franceconnect", { userId: user.id, email: user.email });

    const next = safeNext(tx.next) ?? "/citoyen";
    res.redirect(`${front}${next}`);
  } catch (err) {
    console.error("[franceconnect] callback:", err);
    return fail("Une erreur est survenue avec FranceConnect.");
  }
});

type ResolvedUser = typeof users.$inferSelect;

/**
 * Résout le compte local correspondant à l'identité FranceConnect :
 *   1. par `fc_sub` (lien déjà établi) ;
 *   2. sinon par email vérifié → on rattache `fc_sub` au compte existant ;
 *   3. sinon création d'un compte citoyen sans mot de passe.
 *
 * Sécurité : on ne rattache/connecte QUE des comptes de rôle « citoyen ».
 * FranceConnect est une identité de particulier ; un compte mairie/instructeur
 * ne doit jamais pouvoir être pris via FranceConnect.
 *
 * ⚠️ Le rattachement par email (étape 2) suppose que l'email FranceConnect est
 *    vérifié (il l'est) ; côté HEUREKA les comptes email/mot de passe ne sont
 *    pas tous vérifiés. TODO[prod] : exiger une vérification d'email à
 *    l'inscription locale pour fermer tout risque de collision d'email.
 */
async function findOrCreateUser(
  identity: { sub: string; given_name?: string; family_name?: string; email?: string },
): Promise<ResolvedUser | { error: string }> {
  // 1. Lien existant par fc_sub
  const [bySub] = await db.select().from(users).where(eq(users.fc_sub, identity.sub)).limit(1);
  if (bySub) {
    if (bySub.role !== "citoyen") return { error: "Ce compte ne peut pas être utilisé avec FranceConnect." };
    return bySub;
  }

  const email = identity.email?.toLowerCase() ?? null;

  // 2. Rattachement par email
  if (email) {
    const [byEmail] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (byEmail) {
      if (byEmail.role !== "citoyen") return { error: "Ce compte ne peut pas être utilisé avec FranceConnect." };
      const [linked] = await db
        .update(users)
        .set({
          fc_sub: identity.sub,
          // FranceConnect atteste l'adresse email : on confirme la vérification
          // si le compte local ne l'était pas encore.
          email_verified_at: byEmail.email_verified_at ?? new Date(),
          updated_at: new Date(),
        })
        .where(eq(users.id, byEmail.id))
        .returning();
      return linked!;
    }
  }

  // 3. Création d'un compte citoyen 100 % FranceConnect (sans mot de passe).
  // Email de repli si FranceConnect n'a pas fourni le scope email.
  const safeEmail = email ?? `${identity.sub}@franceconnect.local`;
  const [created] = await db
    .insert(users)
    .values({
      email: safeEmail,
      password_hash: null,
      fc_sub: identity.sub,
      prenom: identity.given_name ?? "",
      nom: identity.family_name ?? "",
      role: "citoyen" as const,
      // L'identité provient de FranceConnect : l'email est vérifié d'office, le
      // compte n'a donc pas à passer par la vérification d'email locale.
      email_verified_at: new Date(),
    })
    .returning();
  return created!;
}
