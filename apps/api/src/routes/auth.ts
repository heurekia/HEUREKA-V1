import { Router } from "express";
import bcrypt from "bcryptjs";
import { rateLimit, ipKeyGenerator } from "express-rate-limit";
import { z } from "zod";
import { db } from "../db.js";
import { users, dossiers, dossier_messages, dossier_pieces_jointes, notifications, password_tokens, ai_usage_events, audit_logs } from "@heureka-v1/db";
import { eq, and, gt, isNull, inArray } from "drizzle-orm";
import { generateToken, requireAuth, bumpTokenVersion, invalidateTokenVersionCache, type AuthRequest } from "../middlewares/auth.js";
import { sendPasswordResetEmail, sendVerificationEmail } from "../services/mailer.js";
import { logAudit } from "../services/audit.js";
import { getStorageProvider } from "../services/storage.js";
import crypto from "crypto";

export const authRouter = Router();

// Hash bcrypt fictif (cost 10) utilisé pour le compare timing-safe quand
// l'email n'existe pas. Généré une fois et figé pour ne pas payer le coût
// du hashing à chaque requête.
const TIMING_SAFE_DUMMY_HASH = "$2a$10$CwTycUXWue0Thq9StjUM0uJ8.9V1cM0gmK2BqkPe4QGOI1mO3R8fy";

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: "Trop de tentatives de connexion. Réessayez dans 15 minutes." },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    // Rate-limit per IP (résolue par Express via `trust proxy`) ou par
    // (IP, email) si l'email est fourni. NE PAS lire x-forwarded-for à la main :
    // ça contourne `trust proxy` et permet la rotation triviale du header par
    // un attaquant. ipKeyGenerator normalise l'IPv6 au préfixe /56 — sans ça
    // un client IPv6 peut rotater son adresse dans son propre /64 pour
    // contourner la limite (cf. ERR_ERL_KEY_GEN_IPV6).
    const email = typeof req.body?.email === "string" ? req.body.email.toLowerCase() : null;
    const ip = ipKeyGenerator(req.ip ?? "unknown");
    return email ? `login:${ip}:${email}` : `login:${ip}`;
  },
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: { error: "Trop de créations de compte. Réessayez dans 1 heure." },
  standardHeaders: true,
  legacyHeaders: false,
});

const IS_PROD = process.env.NODE_ENV === "production";

export const COOKIE_CLEAR_OPTIONS = {
  path: "/",
  ...(IS_PROD ? { domain: ".heurekia.com" } : {}),
};

export const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: IS_PROD,
  sameSite: "lax" as const,
  // Domaine partagé par les sous-domaines www/app/admin en production. Le
  // cloisonnement des sessions est assuré par le NOM du cookie (cf. cookieNameFor),
  // pas par le domaine.
  ...(IS_PROD ? { domain: ".heurekia.com" } : {}),
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  path: "/",
};

// Distinct cookie names per portal so sessions of different portals can coexist
// in the same browser WITHOUT bleeding into each other :
//   - citoyen  sur www.heurekia.com   → token_www
//   - mairie   sur app.heurekia.com   → token_app
//   - super-admin sur admin.heurekia.com → token_admin (session isolée)
// Primary signal: `req.hostname` (Host header, always present). Origin/Referer
// are not always sent — e.g. browser does NOT send Origin on same-origin GETs.
// NB : "admin.heurekia.com" ne contient PAS "app.heurekia.com" comme sous-chaîne,
// donc l'ordre des tests ne crée pas de collision.
export function cookieNameFor(req: AuthRequest): "token_admin" | "token_app" | "token_www" {
  const host = (req.hostname ?? "").toLowerCase();
  const origin = ((req.headers.origin as string | undefined) ?? (req.headers.referer as string | undefined) ?? "").toLowerCase();
  if (host.includes("admin.heurekia.com") || origin.includes("admin.heurekia.com")) return "token_admin";
  const isApp = host.includes("app.heurekia.com") || origin.includes("app.heurekia.com");
  return isApp ? "token_app" : "token_www";
}

function writeAudit(userId: string | null, email: string, action: string, req: AuthRequest) {
  return logAudit(req, action, { userId, email });
}

// Politique de mot de passe unique pour TOUS les points d'entrée (inscription,
// activation, réinitialisation, changement). Mêmes règles que la checklist
// affichée côté front (ActiverCompte.tsx) : 12 caractères + majuscule +
// minuscule + chiffre + caractère spécial. Centralisée ici pour éviter toute
// divergence entre les routes.
const PASSWORD_MIN_LENGTH = 12;
export function passwordPolicyErrors(p: string): string[] {
  const errs: string[] = [];
  if (p.length < PASSWORD_MIN_LENGTH) errs.push(`au moins ${PASSWORD_MIN_LENGTH} caractères`);
  if (!/[A-Z]/.test(p)) errs.push("une lettre majuscule");
  if (!/[a-z]/.test(p)) errs.push("une lettre minuscule");
  if (!/[0-9]/.test(p)) errs.push("un chiffre");
  if (!/[^A-Za-z0-9]/.test(p)) errs.push("un caractère spécial");
  return errs;
}
const PASSWORD_POLICY_MESSAGE =
  "Le mot de passe doit contenir au moins 12 caractères, une majuscule, une minuscule, un chiffre et un caractère spécial.";
const strongPassword = z.string().refine((p) => passwordPolicyErrors(p).length === 0, {
  message: PASSWORD_POLICY_MESSAGE,
});

// Construit l'URL du portail d'origine de la requête (www pour les citoyens,
// app pour les pros) à partir de l'Origin/Referer, afin que les liens email
// renvoient vers le bon sous-domaine. NE PAS faire confiance aveuglément à un
// header arbitraire : on n'accepte que les origines explicitement autorisées
// (mêmes que la whitelist CORS), sinon on laisse le mailer retomber sur sa
// valeur par défaut.
const VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 h
function originBaseUrl(req: AuthRequest): string | undefined {
  const raw = (req.headers.origin as string | undefined) ?? undefined;
  if (!raw) return undefined;
  const allowed = (process.env.FRONTEND_URLS ?? process.env.FRONTEND_URL ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return allowed.includes(raw) ? raw : undefined;
}

async function issueVerificationToken(userId: string): Promise<string> {
  const token = crypto.randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + VERIFICATION_TOKEN_TTL_MS);
  await db.insert(password_tokens).values({ user_id: userId, token, type: "verification", expires_at: expires });
  return token;
}

const registerSchema = z.object({
  email: z.string().email(),
  password: strongPassword,
  prenom: z.string().min(1),
  nom: z.string().min(1),
  commune: z.string().optional(),
  telephone: z.string().optional(),
});

authRouter.post("/register", registerLimiter, async (req: AuthRequest, res) => {
  try {
    const data = registerSchema.parse(req.body);
    const existing = await db.select().from(users).where(eq(users.email, data.email)).limit(1);
    if (existing.length > 0) {
      return res.status(409).json({ error: "Cet email est déjà utilisé" });
    }
    const password_hash = await bcrypt.hash(data.password, 10);
    const rows = await db
      .insert(users)
      .values({
        email: data.email,
        password_hash,
        prenom: data.prenom,
        nom: data.nom,
        role: "citoyen" as const,
        commune: data.commune,
        telephone: data.telephone,
        // Email non vérifié : pas de session tant que l'adresse n'est pas
        // confirmée. Empêche la création de comptes en masse avec des emails
        // jetables/inexistants.
        email_verified_at: null,
      })
      .returning();
    const user = rows[0]!;
    // On NE connecte PAS l'utilisateur ici. Il doit d'abord confirmer son email.
    const verifToken = await issueVerificationToken(user.id);
    await sendVerificationEmail({ to: user.email, prenom: user.prenom, token: verifToken, baseUrl: originBaseUrl(req) })
      .catch((err) => console.error("[mailer] verification:", err));
    await writeAudit(user.id, user.email, "register", req);
    res.status(201).json({ pendingVerification: true, email: user.email });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: "Données invalides", details: err.errors });
    }
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

authRouter.post("/login", loginLimiter, async (req: AuthRequest, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: "Email et mot de passe requis" });
    }
    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    // Empêche l'énumération d'utilisateurs par timing : on consomme toujours
    // un bcrypt.compare, sur le hash réel si l'utilisateur existe, sur un hash
    // factice sinon. Coût quasi identique → pas de signal exploitable côté
    // client pour distinguer "email inconnu" de "mot de passe incorrect".
    const hash = user?.password_hash ?? TIMING_SAFE_DUMMY_HASH;
    const valid = await bcrypt.compare(password, hash);
    if (!user || !valid) {
      await writeAudit(null, email, "login_failed", req);
      return res.status(401).json({ error: "Email ou mot de passe incorrect" });
    }
    // Email non confirmé → on bloque la session. Le code `email_not_verified`
    // permet au front de proposer le renvoi du lien de vérification.
    if (!user.email_verified_at) {
      await writeAudit(user.id, user.email, "login_unverified", req);
      return res.status(403).json({
        error: "Veuillez confirmer votre adresse email avant de vous connecter. Consultez votre boîte de réception.",
        code: "email_not_verified",
      });
    }
    const token = generateToken({ id: user.id, email: user.email, role: user.role, commune: user.commune ?? undefined, commune_insee: user.commune_insee ?? undefined, token_version: user.token_version });
    res.cookie(cookieNameFor(req), token, COOKIE_OPTIONS);
    res.clearCookie("token", COOKIE_CLEAR_OPTIONS);
    await writeAudit(user.id, user.email, "login", req);
    res.json({
      user: { id: user.id, email: user.email, prenom: user.prenom, nom: user.nom, role: user.role, commune: user.commune, commune_insee: user.commune_insee, onboarding_completed: !!user.onboarding_completed_at },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

authRouter.post("/logout", requireAuth, async (req: AuthRequest, res) => {
  await writeAudit(req.user!.id, req.user!.email, "logout", req);
  res.clearCookie(cookieNameFor(req), COOKIE_CLEAR_OPTIONS);
  res.clearCookie("token", COOKIE_CLEAR_OPTIONS);
  res.json({ ok: true });
});

authRouter.get("/me/export", requireAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const [[user], userDossiers, messages, pieces, notifs, userAuditLogs] = await Promise.all([
      db.select().from(users).where(eq(users.id, userId)).limit(1),
      db.select().from(dossiers).where(eq(dossiers.user_id, userId)),
      db.select().from(dossier_messages).where(eq(dossier_messages.from_user_id, userId)),
      db.select().from(dossier_pieces_jointes).where(eq(dossier_pieces_jointes.user_id, userId)),
      db.select().from(notifications).where(eq(notifications.user_id, userId)),
      db.select().from(audit_logs).where(eq(audit_logs.user_id, userId)),
    ]);
    if (!user) return res.status(404).json({ error: "Utilisateur non trouvé" });

    // Événements IA imputables au pétitionnaire : tous les appels LLM
    // effectués au titre de ses dossiers. Permet au citoyen de constater
    // précisément quels fichiers ont été soumis à l'IA (file_hash) et à
    // quel coût (cost_eur). Droit d'accès RGPD art. 15.
    const dossierIds = userDossiers.map((d) => d.id);
    const aiEvents = dossierIds.length > 0
      ? await db.select().from(ai_usage_events).where(inArray(ai_usage_events.dossier_id, dossierIds))
      : [];

    const payload = {
      export_date: new Date().toISOString(),
      export_note: "Export complet de vos données conformément au droit d'accès RGPD (art. 15) et au droit à la portabilité (art. 20). Contactez le DPD pour toute question.",
      profil: {
        id: user.id,
        email: user.email,
        prenom: user.prenom,
        nom: user.nom,
        role: user.role,
        commune: user.commune,
        telephone: user.telephone,
        created_at: user.created_at,
      },
      // RGPD : exposition explicite du consentement à l'analyse IA + son
      // horodatage, pour chaque dossier. Le citoyen voit s'il a accepté ou
      // refusé l'analyse automatisée.
      dossiers: userDossiers.map((d) => ({
        ...d,
        ai_consent_explicite: d.ai_consent,
        ai_consent_date: d.ai_consent_at,
      })),
      messages,
      documents: pieces.map((p) => ({
        ...p,
        ia_analyse_effectuee: p.ai_processed,
      })),
      notifications: notifs,
      // RGPD : journal complet des appels IA effectués sur vos dossiers.
      // L'empreinte SHA-256 du fichier permet d'auditer précisément ce qui
      // a été soumis, sans dupliquer le contenu du fichier.
      evenements_ia: aiEvents.map((e) => ({
        date: e.created_at,
        dossier_id: e.dossier_id,
        finalite: e.purpose,
        modele: e.model,
        empreinte_fichier_sha256: e.file_hash,
        cout_eur: e.cost_eur,
        tokens_entree: e.input_tokens,
        tokens_sortie: e.output_tokens,
      })),
      // RGPD : journal d'audit lié à votre compte (connexions, modifications,
      // exports). Adresse IP partiellement conservée pour la sécurité.
      journal_audit: userAuditLogs.map((l) => ({
        date: l.created_at,
        action: l.action,
        ip: l.ip,
        user_agent: l.user_agent,
      })),
    };

    res.setHeader("Content-Disposition", `attachment; filename="mes-donnees-heureka-${new Date().toISOString().slice(0, 10)}.json"`);
    res.setHeader("Content-Type", "application/json");
    await writeAudit(userId, user.email, "data_export", req);
    res.json(payload);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

authRouter.delete("/me", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { password } = req.body;
    if (!password) return res.status(400).json({ error: "Mot de passe requis" });

    const [user] = await db.select().from(users).where(eq(users.id, req.user!.id)).limit(1);
    if (!user) return res.status(404).json({ error: "Utilisateur non trouvé" });

    // Comptes professionnels (mairie/instructeur/admin/service_externe) : la
    // suppression en libre-service échouerait sur des FK conservées pour raisons
    // légales/d'audit (dossiers instruits, décisions signées — ON DELETE RESTRICT)
    // et renvoyait jusqu'ici un 500 opaque. Ces comptes sont gérés par
    // l'administrateur ; la purge passe par le flux admin (réassignation des
    // références). On renvoie donc un message explicite plutôt qu'un échec brut.
    if (user.role !== "citoyen") {
      return res.status(409).json({
        error: "Les comptes professionnels sont gérés par votre administrateur. Pour la suppression de votre compte, contactez votre administrateur ou le délégué à la protection des données (DPD).",
      });
    }

    // Compte « 100 % FranceConnect » : aucun mot de passe local à vérifier.
    // La suppression par ce flux (qui exige le mot de passe) n'est pas
    // applicable — l'utilisateur devra passer par une procédure dédiée.
    if (!user.password_hash) {
      return res.status(400).json({ error: "Ce compte n'a pas de mot de passe (connexion FranceConnect)." });
    }
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: "Mot de passe incorrect" });

    // RGPD art. 17 (droit à l'effacement) : le simple DELETE en DB laisse les
    // fichiers physiques (PDF, plans, photos) sur disque/S3 → fuite de données.
    // On les supprime AVANT le DELETE en base via l'abstraction StorageProvider
    // qui gère indifféremment local et S3-compatible.
    const storage = getStorageProvider();
    const userPieces = await db
      .select({ url: dossier_pieces_jointes.url })
      .from(dossier_pieces_jointes)
      .where(eq(dossier_pieces_jointes.user_id, user.id));
    const keys = userPieces
      .map((p) => p.url)
      .filter((u): u is string => !!u)
      .map((u) => storage.keyFromUrl(u));
    const { deleted: filesDeleted, failed: filesFailed } = await storage.removeBulk(keys);
    if (filesFailed > 0) {
      console.warn(`[rgpd] suppression compte ${user.id} : ${filesFailed} fichiers en échec sur ${keys.length}`);
    }

    await writeAudit(user.id, user.email, "account_deleted", req);
    // La cascade DB supprime dossiers → pieces → messages → notifications.
    // audit_logs.user_id est ON DELETE SET NULL (préservé pour la sécurité).
    await db.delete(users).where(eq(users.id, user.id));
    invalidateTokenVersionCache(user.id);

    res.clearCookie(cookieNameFor(req), COOKIE_CLEAR_OPTIONS);
    res.clearCookie("token", COOKIE_CLEAR_OPTIONS);
    res.json({ ok: true, files_deleted: filesDeleted, files_failed: filesFailed });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

authRouter.patch("/me", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { prenom, nom, telephone } = req.body as { prenom?: string; nom?: string; telephone?: string };
    const update: Record<string, unknown> = { updated_at: new Date() };
    if (prenom?.trim()) update.prenom = prenom.trim();
    if (nom?.trim()) update.nom = nom.trim();
    if (telephone !== undefined) update.telephone = telephone?.trim() || null;
    const [updated] = await db.update(users).set(update).where(eq(users.id, req.user!.id)).returning();
    if (!updated) return res.status(404).json({ error: "Utilisateur non trouvé" });
    await writeAudit(req.user!.id, req.user!.email, "profile_update", req);
    res.json({ id: updated.id, email: updated.email, prenom: updated.prenom, nom: updated.nom, role: updated.role, commune: updated.commune, commune_insee: updated.commune_insee, telephone: updated.telephone, avatar_url: updated.avatar_url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

authRouter.patch("/me/password", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { current_password, new_password } = req.body as { current_password?: string; new_password?: string };
    if (!current_password || !new_password) return res.status(400).json({ error: "Mots de passe requis" });
    if (passwordPolicyErrors(new_password).length > 0) return res.status(400).json({ error: PASSWORD_POLICY_MESSAGE });
    const [user] = await db.select().from(users).where(eq(users.id, req.user!.id)).limit(1);
    if (!user) return res.status(404).json({ error: "Utilisateur non trouvé" });
    // Compte FranceConnect sans mot de passe local : on ne peut pas « changer »
    // un mot de passe inexistant via cette route.
    if (!user.password_hash) {
      return res.status(400).json({ error: "Ce compte utilise FranceConnect et n'a pas de mot de passe." });
    }
    const valid = await bcrypt.compare(current_password, user.password_hash);
    if (!valid) return res.status(401).json({ error: "Mot de passe actuel incorrect" });
    const password_hash = await bcrypt.hash(new_password, 10);
    await db.update(users).set({ password_hash, updated_at: new Date() }).where(eq(users.id, user.id));
    // Révocation : invalide TOUTES les sessions existantes, mais réémet le cookie
    // de CELLE-ci pour ne pas déconnecter l'utilisateur qui change son mot de passe.
    const newTv = await bumpTokenVersion(user.id);
    res.cookie(cookieNameFor(req), generateToken({ id: user.id, email: user.email, role: user.role, commune: user.commune ?? undefined, commune_insee: user.commune_insee ?? undefined, token_version: newTv }), COOKIE_OPTIONS);
    await writeAudit(user.id, user.email, "password_change", req);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

authRouter.get("/me", requireAuth, async (req: AuthRequest, res) => {
  try {
    const [user] = await db.select().from(users).where(eq(users.id, req.user!.id)).limit(1);
    if (!user) return res.status(404).json({ error: "Utilisateur non trouvé" });
    res.json({
      id: user.id,
      email: user.email,
      prenom: user.prenom,
      nom: user.nom,
      role: user.role,
      commune: user.commune,
      commune_insee: user.commune_insee,
      telephone: user.telephone,
      avatar_url: user.avatar_url,
      created_at: user.created_at,
      onboarding_completed: !!user.onboarding_completed_at,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST /auth/onboarding/complete — marque l'onboarding (pop-up de bienvenue)
// comme vu pour l'utilisateur courant. Idempotent : ne réécrit pas la date si
// déjà renseignée (on garde la 1re complétion).
authRouter.post("/onboarding/complete", requireAuth, async (req: AuthRequest, res) => {
  try {
    await db
      .update(users)
      .set({ onboarding_completed_at: new Date(), updated_at: new Date() })
      .where(and(eq(users.id, req.user!.id), isNull(users.onboarding_completed_at)));
    res.json({ ok: true });
  } catch (err) {
    console.error("[auth:onboarding:complete]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Mot de passe oublié ──────────────────────────────────────────────────────
authRouter.post("/forgot-password", rateLimit({ windowMs: 15 * 60 * 1000, max: 5, legacyHeaders: false }), async (req: AuthRequest, res) => {
  try {
    const { email } = req.body as { email?: string };
    if (!email) return res.status(400).json({ error: "Email requis" });

    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    // Always return 200 to avoid user enumeration
    if (!user) return res.json({ ok: true });

    const token = crypto.randomBytes(32).toString("hex");
    const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
    await db.insert(password_tokens).values({ user_id: user.id, token, type: "reset", expires_at: expires });
    await sendPasswordResetEmail({ to: user.email, prenom: user.prenom, token }).catch(err => console.error("[mailer] reset:", err));
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Vérification token (activation ou reset) ─────────────────────────────────
authRouter.get("/activate/:token", async (req, res) => {
  try {
    const { token } = req.params;
    const [row] = await db.select({ id: password_tokens.id, type: password_tokens.type, user_id: password_tokens.user_id, email: users.email, prenom: users.prenom })
      .from(password_tokens)
      .leftJoin(users, eq(password_tokens.user_id, users.id))
      .where(and(eq(password_tokens.token, token), isNull(password_tokens.used_at), gt(password_tokens.expires_at, new Date())))
      .limit(1);
    if (!row) return res.status(400).json({ error: "Lien invalide ou expiré" });
    res.json({ valid: true, email: row.email, prenom: row.prenom, type: row.type });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Définir le mot de passe via token ────────────────────────────────────────
authRouter.post("/activate", rateLimit({ windowMs: 15 * 60 * 1000, max: 10, legacyHeaders: false }), async (req: AuthRequest, res) => {
  try {
    const { token, password } = req.body as { token?: string; password?: string };
    if (!token || !password) return res.status(400).json({ error: "Token et mot de passe requis" });
    if (passwordPolicyErrors(password).length > 0) return res.status(400).json({ error: PASSWORD_POLICY_MESSAGE });

    // Cette route DÉFINIT un mot de passe : elle n'accepte que les tokens prévus
    // pour ça (invitation « activation » ou « reset »). Un token « verification »
    // (confirmation d'email, mot de passe déjà défini) ne doit PAS permettre de
    // réécrire le mot de passe — il passe par /verify-email.
    const [row] = await db.select().from(password_tokens)
      .where(and(
        eq(password_tokens.token, token),
        inArray(password_tokens.type, ["activation", "reset"]),
        isNull(password_tokens.used_at),
        gt(password_tokens.expires_at, new Date()),
      ))
      .limit(1);
    if (!row) return res.status(400).json({ error: "Lien invalide ou expiré" });

    const password_hash = await bcrypt.hash(password, 10);
    await Promise.all([
      // Cliquer sur le lien d'activation reçu par email prouve la possession de
      // l'adresse → on marque l'email comme vérifié en même temps.
      db.update(users).set({ password_hash, email_verified_at: new Date() }).where(eq(users.id, row.user_id)),
      db.update(password_tokens).set({ used_at: new Date() }).where(eq(password_tokens.id, row.id)),
    ]);

    const [user] = await db.select().from(users).where(eq(users.id, row.user_id)).limit(1);
    if (!user) return res.status(500).json({ error: "Erreur serveur" });

    // Nouveau mot de passe défini → invalide toute session antérieure.
    const newTv = await bumpTokenVersion(user.id);
    const jwtToken = generateToken({ id: user.id, email: user.email, role: user.role, commune: user.commune ?? undefined, commune_insee: user.commune_insee ?? undefined, token_version: newTv });
    res.cookie(cookieNameFor(req), jwtToken, COOKIE_OPTIONS);
    res.clearCookie("token", COOKIE_CLEAR_OPTIONS);
    await writeAudit(user.id, user.email, row.type === "activation" ? "account_activated" : "password_reset", req);
    res.json({ user: { id: user.id, email: user.email, prenom: user.prenom, nom: user.nom, role: user.role } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Vérification d'email après inscription publique ──────────────────────────
// Le mot de passe est déjà défini à l'inscription : ce token ne sert qu'à
// prouver la possession de l'adresse. On confirme l'email puis on ouvre la
// session directement (le citoyen est connecté).
authRouter.post("/verify-email", rateLimit({ windowMs: 15 * 60 * 1000, max: 10, legacyHeaders: false }), async (req: AuthRequest, res) => {
  try {
    const { token } = req.body as { token?: string };
    if (!token) return res.status(400).json({ error: "Token requis" });

    const [row] = await db.select().from(password_tokens)
      .where(and(
        eq(password_tokens.token, token),
        eq(password_tokens.type, "verification"),
        isNull(password_tokens.used_at),
        gt(password_tokens.expires_at, new Date()),
      ))
      .limit(1);
    if (!row) return res.status(400).json({ error: "Lien invalide ou expiré" });

    await Promise.all([
      db.update(users).set({ email_verified_at: new Date() }).where(eq(users.id, row.user_id)),
      db.update(password_tokens).set({ used_at: new Date() }).where(eq(password_tokens.id, row.id)),
    ]);

    const [user] = await db.select().from(users).where(eq(users.id, row.user_id)).limit(1);
    if (!user) return res.status(500).json({ error: "Erreur serveur" });

    const jwtToken = generateToken({ id: user.id, email: user.email, role: user.role, commune: user.commune ?? undefined, commune_insee: user.commune_insee ?? undefined, token_version: user.token_version });
    res.cookie(cookieNameFor(req), jwtToken, COOKIE_OPTIONS);
    res.clearCookie("token", COOKIE_CLEAR_OPTIONS);
    await writeAudit(user.id, user.email, "email_verified", req);
    res.json({ user: { id: user.id, email: user.email, prenom: user.prenom, nom: user.nom, role: user.role, commune: user.commune, commune_insee: user.commune_insee } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Renvoyer le lien de vérification ─────────────────────────────────────────
// Réponse toujours 200 pour ne pas révéler l'existence d'un compte (anti
// énumération). N'envoie un email que si le compte existe ET n'est pas vérifié.
authRouter.post("/resend-verification", rateLimit({ windowMs: 60 * 60 * 1000, max: 5, legacyHeaders: false }), async (req: AuthRequest, res) => {
  try {
    const { email } = req.body as { email?: string };
    if (!email) return res.status(400).json({ error: "Email requis" });

    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (user && !user.email_verified_at) {
      const verifToken = await issueVerificationToken(user.id);
      await sendVerificationEmail({ to: user.email, prenom: user.prenom, token: verifToken, baseUrl: originBaseUrl(req) })
        .catch((err) => console.error("[mailer] verification (resend):", err));
      await writeAudit(user.id, user.email, "verification_resent", req);
    }
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});
