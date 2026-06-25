/**
 * Rate-limiters pour les routes COÛTEUSES (upload + OCR/analyse de pièces,
 * inférence LLM interactive, analyses réglementaires/parcellaires).
 *
 * Pourquoi : ces endpoints combinent du CPU bloquant sur l'event-loop mono-thread
 * (base64 de gros buffers, rendu PDF, géométrie) ET des appels Mistral facturés.
 * Sans garde-fou, un seul compte authentifié — ou un bug front qui boucle — peut
 * saturer le serveur pour tous les utilisateurs et faire exploser la facture IA.
 * Les routes d'auth ont déjà leurs propres limiters ; on couvre ici le reste.
 *
 * Clé : utilisateur authentifié (`req.user.id`) si présent — toutes ces routes
 * sont derrière `requireAuth`, monté au niveau du routeur — sinon repli sur l'IP
 * normalisée (résolue via `trust proxy`, IPv6 ramené à un préfixe par
 * `ipKeyGenerator`). On limite donc par UTILISATEUR, pas par IP partagée (une
 * mairie entière peut sortir derrière une seule IP NAT).
 *
 * Store : en mémoire (par process), cohérent avec l'architecture mono-instance
 * actuelle. Le passage en multi-instances imposera un store partagé (Redis) —
 * cf. plan de durcissement, palier scaling horizontal.
 */
import { rateLimit, ipKeyGenerator } from "express-rate-limit";
import type { Request } from "express";

function userOrIpKey(prefix: string) {
  return (req: Request): string => {
    const uid = (req as Request & { user?: { id?: string } }).user?.id;
    if (uid) return `${prefix}:u:${uid}`;
    return `${prefix}:ip:${ipKeyGenerator(req.ip ?? "unknown")}`;
  };
}

function makeLimiter(opts: { prefix: string; windowMs: number; max: number; message: string }) {
  return rateLimit({
    windowMs: opts.windowMs,
    max: opts.max,
    message: { error: opts.message },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: userOrIpKey(opts.prefix),
  });
}

/**
 * Upload + extraction/OCR de pièces : CPU bloquant (base64, rendu PDF) + LLM
 * vision. Plafond généreux pour ne pas gêner le dépôt légitime d'un bordereau
 * complet (≈ une vingtaine de pièces), mais qui coupe les boucles/abus.
 */
export const uploadLimiter = makeLimiter({
  prefix: "upload",
  windowMs: Number(process.env.RL_UPLOAD_WINDOW_MS ?? 5 * 60_000),
  max: Number(process.env.RL_UPLOAD_MAX ?? 60),
  message: "Trop d'envois de pièces en peu de temps. Patientez quelques minutes.",
});

/** Inférence LLM interactive (assistant, structuration d'article/zone). */
export const llmLimiter = makeLimiter({
  prefix: "llm",
  windowMs: Number(process.env.RL_LLM_WINDOW_MS ?? 5 * 60_000),
  max: Number(process.env.RL_LLM_MAX ?? 40),
  message: "Trop de requêtes d'assistance IA en peu de temps. Patientez quelques minutes.",
});

/** Analyses réglementaires / parcellaires : nombreux appels externes + géométrie. */
export const analyzeLimiter = makeLimiter({
  prefix: "analyze",
  windowMs: Number(process.env.RL_ANALYZE_WINDOW_MS ?? 5 * 60_000),
  max: Number(process.env.RL_ANALYZE_MAX ?? 60),
  message: "Trop d'analyses lancées en peu de temps. Patientez quelques minutes.",
});
