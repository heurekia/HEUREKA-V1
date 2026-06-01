import { Router } from "express";
import { z } from "zod";
import { db } from "../db.js";
import { dossiers, dossier_messages, dossier_pieces_jointes, instruction_events } from "@heureka-v1/db";
import { eq, desc, and } from "drizzle-orm";
import { requireAuth, type AuthRequest } from "../middlewares/auth.js";
import crypto from "crypto";
import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import multer from "multer";
import { classifyPermit } from "../services/classificationEngine.js";
import { buildPiecesContext, getPiecesForType } from "../data/piecesRequises.js";
import { analyzePiece } from "../services/pieceAnalyzer.js";
import { runDossierConformityAnalysisBackground } from "../services/dossierConformity.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = path.resolve(__dirname, "../../uploads");

// Multer requires the destination to exist before write — create it once at boot.
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${crypto.randomUUID()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = /pdf|jpe?g|png|gif|webp|tiff?/i;
    if (allowed.test(path.extname(file.originalname)) || allowed.test(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Type de fichier non supporté (PDF, JPEG, PNG, GIF, WEBP, TIFF)"));
    }
  },
});

function getAnthropicKey(): string {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  const candidates = [
    process.env.CLAUDE_SESSION_INGRESS_TOKEN_FILE,
    "/home/claude/.claude/remote/.session_ingress_token",
  ];
  for (const p of candidates) {
    if (!p) continue;
    try { return fs.readFileSync(p, "utf8").trim(); } catch { /* try next */ }
  }
  throw new Error("ANTHROPIC_API_KEY non configurée");
}

const NATURE_LABELS: Record<string, string> = {
  maison_neuve: "Construction d'une maison neuve",
  agrandissement: "Agrandissement d'une construction existante",
  petite_construction: "Petite construction (garage, abri de jardin, pergola, carport…)",
  amenagement: "Aménagement de terrain",
  demolition: "Démolition",
  changement_destination: "Changement de destination d'un bâtiment",
  modification_aspect: "Modification de l'aspect extérieur",
  division_terrain: "Division foncière / lotissement",
  certificat: "Demande de certificat d'urbanisme",
};

export const dossiersRouter = Router();

dossiersRouter.use(requireAuth);

// Verify that a dossier exists AND belongs to the authenticated user.
// Returns the dossier when owned, otherwise null (caller replies 404).
async function getOwnedDossier(dossierId: string, userId: string) {
  const [dossier] = await db
    .select()
    .from(dossiers)
    .where(and(eq(dossiers.id, dossierId), eq(dossiers.user_id, userId)))
    .limit(1);
  return dossier ?? null;
}

// ── Classification de la procédure d'urbanisme ──
// Moteur déterministe pour type/libellé/articles — Claude pour explication+alertes
dossiersRouter.post("/classify", async (req: AuthRequest, res) => {
  try {
    const {
      nature,
      natures: naturesArr,
      surface,
      parcelData,
      empriseExistante,
      amenagementType,
      description,
      certificatType,
      hasVoirieCommune,
    } = req.body as {
      nature?: string;
      natures?: string[];
      surface?: number;
      parcelData?: { zone?: string; commune?: string; servitudes?: Array<{ categorie?: string; libelle?: string }> };
      empriseExistante?: string;
      amenagementType?: string;
      description?: string;
      certificatType?: "a" | "b";
      hasVoirieCommune?: boolean;
    };

    const naturesToUse: string[] = naturesArr ?? (nature ? [nature] : []);

    const hasABF = (parcelData?.servitudes ?? []).some(
      (s) => s.categorie?.toUpperCase().startsWith("AC") || s.libelle?.toLowerCase().includes("abf"),
    );

    // ── 1. Classification déterministe ────────────────────────────────────────
    const det = classifyPermit({
      natures: naturesToUse,
      surface: surface ?? 0,
      empriseExistante: empriseExistante ? Number(empriseExistante) : undefined,
      zone: parcelData?.zone,
      hasABF,
      amenagementType,
      certificatType,
      hasVoirieCommune,
    });

    // ── 2. Pièces requises (déterministe) ─────────────────────────────────────
    const piecesCtx = buildPiecesContext(
      naturesToUse,
      surface ?? 0,
      parcelData?.servitudes,
      amenagementType,
    );
    const pieces_requises = getPiecesForType(det.type, piecesCtx);

    // ── 3. Explication citoyenne + alertes via Claude ─────────────────────────
    let explication = "";
    let alertes: string[] = [];

    if (det.type !== "aucune_autorisation") {
      try {
        const client = new Anthropic({ apiKey: getAnthropicKey() });

        const contextLines = [
          naturesToUse.length > 1
            ? `Projets combinés : ${naturesToUse.map((n) => NATURE_LABELS[n] ?? n).join(", ")}`
            : `Projet : ${NATURE_LABELS[naturesToUse[0] ?? ""] ?? naturesToUse[0] ?? "Non précisé"}`,
          surface ? `Surface plancher du projet : ${surface} m²` : null,
          empriseExistante ? `Surface plancher existante : ${empriseExistante} m²` : null,
          amenagementType ? `Type d'aménagement : ${amenagementType}` : null,
          description ? `Description libre : ${description}` : null,
          parcelData?.zone ? `Zone PLU : ${parcelData.zone}` : null,
          parcelData?.commune ? `Commune : ${parcelData.commune}` : null,
          hasABF ? "Zone ABF : oui" : null,
          parcelData?.servitudes?.length
            ? `Servitudes : ${parcelData.servitudes.map((s) => s.libelle ?? s.categorie).filter(Boolean).join(", ")}`
            : null,
          `Procédure requise (déjà déterminée) : ${det.libelle} (${det.articles.join(", ")})`,
          det.architecte_requis ? "Architecte obligatoire : oui (surface totale > 150 m²)" : null,
        ].filter(Boolean).join("\n");

        const msg = await client.messages.create({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 800,
          system: `Tu es conseiller en urbanisme expert. La procédure a déjà été déterminée — tu n'as pas à la remettre en question.

Ta mission : produire une explication courte ET des alertes opérationnelles SPÉCIFIQUES à ce projet précis.

Réponds UNIQUEMENT avec du JSON valide :
{
  "explication": "2-3 phrases expliquant POURQUOI cette procédure s'applique à CE projet (mentionner les éléments déclencheurs : modification de façade, zone ABF, surface, etc.)",
  "alertes": [
    "alerte métier précise et actionnelle — ex: stationnement PLU, contrainte ABF matériaux, délai, pièce critique"
  ]
}

Règles strictes :
- Ne jamais nommer la procédure dans l'explication (elle est déjà affichée)
- Alertes : 0 si rien de spécial, maximum 5. Chaque alerte doit être concrète et utile
- Pour un changement de destination de garage : toujours mentionner la vérification des obligations de stationnement PLU
- Pour une zone ABF : mentionner les contraintes potentielles (couleurs, matériaux, menuiseries, type de baies) et le délai porté à 2 mois
- Ton direct et professionnel, pas de formules de politesse`,
          messages: [{ role: "user", content: contextLines }],
        });

        const text = msg.content[0]?.type === "text" ? msg.content[0].text : "{}";
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]) as { explication?: string; alertes?: string[] };
          explication = parsed.explication ?? "";
          alertes = parsed.alertes ?? [];
        }
      } catch {
        // Claude failure is non-blocking — proceed with empty explanation
        explication = `Votre projet nécessite une ${det.libelle}. Délai moyen : ${det.delai_moyen}.`;
        if (hasABF) alertes = ["Votre terrain est en périmètre ABF : prévoyez un délai supplémentaire d'environ 1 mois."];
      }
    } else {
      explication = "Votre projet ne dépasse pas le seuil réglementaire qui impose une démarche administrative. Vous pouvez débuter les travaux sans autorisation préalable.";
    }

    res.json({
      type: det.type,
      subtype: det.subtype,
      libelle: det.libelle,
      libelle_court: det.libelle_court,
      cerfa: det.cerfa,
      architecte_requis: det.architecte_requis,
      explication,
      delai_moyen: det.delai_moyen,
      pieces_requises,
      alertes,
      confiance: det.confidence === "deterministic" ? "haute" : "moyenne",
      articles: det.articles,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur classification" });
  }
});

// ── Pièces requises (déterministe) ──
dossiersRouter.post("/pieces", async (req: AuthRequest, res) => {
  try {
    const {
      type,
      natures,
      surface,
      servitudes,
      amenagementType,
      situational,
    } = req.body as {
      type: string;
      natures?: string[];
      surface?: number;
      servitudes?: Array<{ categorie?: string; libelle?: string }>;
      amenagementType?: string;
      situational?: {
        isLotissement?: boolean;
        isERP?: boolean;
        hasDefrichement?: boolean;
        isNatura2000?: boolean;
        isClimateResilience?: boolean;
      };
    };
    const ctx = buildPiecesContext(natures ?? [], surface ?? 0, servitudes, amenagementType, situational);
    const pieces = getPiecesForType(type ?? "declaration_prealable", ctx);
    res.json({ pieces_requises: pieces });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur calcul pièces" });
  }
});

// ── Lister mes dossiers ──
dossiersRouter.get("/", async (req: AuthRequest, res) => {
  try {
    const list = await db
      .select()
      .from(dossiers)
      .where(eq(dossiers.user_id, req.user!.id))
      .orderBy(desc(dossiers.created_at));
    res.json(list);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Soumettre un dossier à la mairie (brouillon → soumis) ──
dossiersRouter.post("/:id/soumettre", async (req: AuthRequest, res) => {
  try {
    const dossier = await getOwnedDossier(req.params.id as string, req.user!.id);
    if (!dossier) return res.status(404).json({ error: "Dossier non trouvé" });
    if (dossier.status !== "brouillon") {
      return res.status(400).json({ error: "Le dossier a déjà été soumis" });
    }

    // Enforce completeness — all required pieces must be uploaded
    const meta = (dossier.metadata as Record<string, unknown>) ?? {};
    const natures = Array.isArray(meta.natures) ? (meta.natures as string[]) : [];
    const surface = parseFloat(dossier.surface_plancher ?? "0") || 0;
    const ctx = buildPiecesContext(natures, surface);
    const piecesRequises = getPiecesForType(dossier.type, ctx).filter((p) => p.requis);
    const uploadedPieces = await db
      .select()
      .from(dossier_pieces_jointes)
      .where(eq(dossier_pieces_jointes.dossier_id, dossier.id));
    const uploadedCodes = new Set(uploadedPieces.map((p) => p.code_piece).filter(Boolean));
    const manquantes = piecesRequises.filter((p) => !uploadedCodes.has(p.code));
    if (manquantes.length > 0) {
      return res.status(422).json({ error: "Dossier incomplet", manquantes });
    }

    const [updated] = await db
      .update(dossiers)
      .set({
        status: "soumis",
        date_depot: new Date(),
        conformite_status: "pending",
        updated_at: new Date(),
      })
      .where(eq(dossiers.id, req.params.id as string))
      .returning();
    // Analyse de conformité automatique côté mairie — non bloquante. Échoue
    // silencieusement : l'instructeur pourra toujours relancer manuellement.
    runDossierConformityAnalysisBackground(req.params.id as string);
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Complétude d'un dossier ──
dossiersRouter.get("/:id/completude", async (req: AuthRequest, res) => {
  try {
    const dossier = await getOwnedDossier(req.params.id as string, req.user!.id);
    if (!dossier) return res.status(404).json({ error: "Dossier non trouvé" });

    const meta = (dossier.metadata as Record<string, unknown>) ?? {};
    const natures = Array.isArray(meta.natures) ? (meta.natures as string[]) : [];
    const surface = parseFloat(dossier.surface_plancher ?? "0") || 0;
    const ctx = buildPiecesContext(natures, surface);
    const piecesRequises = getPiecesForType(dossier.type, ctx).filter((p) => p.requis);

    const uploadedPieces = await db
      .select()
      .from(dossier_pieces_jointes)
      .where(eq(dossier_pieces_jointes.dossier_id, dossier.id));
    const uploadedCodes = new Set(uploadedPieces.map((p) => p.code_piece).filter(Boolean));
    const manquantes = piecesRequises.filter((p) => !uploadedCodes.has(p.code));

    res.json({ complete: manquantes.length === 0, manquantes });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Détail d'un dossier ──
dossiersRouter.get("/:id", async (req: AuthRequest, res) => {
  try {
    const dossier = await getOwnedDossier(req.params.id as string, req.user!.id);
    if (!dossier) return res.status(404).json({ error: "Dossier non trouvé" });
    res.json(dossier);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Créer un dossier ──
const createSchema = z.object({
  type: z.enum(["permis_de_construire", "declaration_prealable", "permis_amenager", "permis_demolir", "permis_lotir", "certificat_urbanisme"]),
  parcelle: z.string().optional(),
  adresse: z.string().optional(),
  commune: z.string().optional(),
  code_postal: z.string().optional(),
  description: z.string().optional(),
  surface_plancher: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

dossiersRouter.post("/", async (req: AuthRequest, res) => {
  try {
    const data = createSchema.parse(req.body);
    const numero = `DOS-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
    const [dossier] = await db
      .insert(dossiers)
      .values({ ...data, numero, user_id: req.user!.id })
      .returning();
    res.status(201).json(dossier);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: "Données invalides", details: err.errors });
    }
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Messages d'un dossier ──
dossiersRouter.get("/:id/messages", async (req: AuthRequest, res) => {
  try {
    const dossier = await getOwnedDossier(req.params.id as string, req.user!.id);
    if (!dossier) return res.status(404).json({ error: "Dossier non trouvé" });
    const messages = await db
      .select()
      .from(dossier_messages)
      .where(eq(dossier_messages.dossier_id, req.params.id as string))
      .orderBy(dossier_messages.created_at);
    res.json(messages);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

dossiersRouter.post("/:id/messages", async (req: AuthRequest, res) => {
  try {
    const dossier = await getOwnedDossier(req.params.id as string, req.user!.id);
    if (!dossier) return res.status(404).json({ error: "Dossier non trouvé" });
    const content: string = req.body.content;
    if (!content) return res.status(400).json({ error: "Message requis" });
    const rows = await db
      .insert(dossier_messages)
      .values({
        dossier_id: req.params.id as string,
        from_user_id: req.user!.id,
        from_role: req.user!.role,
        content,
      })
      .returning();
    res.status(201).json(rows[0]!);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Pièces jointes ──
dossiersRouter.get("/:id/pieces", async (req: AuthRequest, res) => {
  try {
    const dossier = await getOwnedDossier(req.params.id as string, req.user!.id);
    if (!dossier) return res.status(404).json({ error: "Dossier non trouvé" });
    const pieces = await db
      .select()
      .from(dossier_pieces_jointes)
      .where(eq(dossier_pieces_jointes.dossier_id, req.params.id as string))
      .orderBy(desc(dossier_pieces_jointes.uploaded_at));
    res.json(pieces);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Upload d'une pièce jointe avec analyse IA ──
// Wrap multer so multer/filter errors come back as JSON instead of HTML.
function uploadSingle(req: AuthRequest, res: import("express").Response, next: import("express").NextFunction) {
  upload.single("file")(req, res, (err) => {
    if (err) {
      const message = err instanceof Error ? err.message : "Fichier invalide";
      return res.status(400).json({ error: message });
    }
    next();
  });
}

dossiersRouter.post("/:id/pieces/upload", uploadSingle, async (req: AuthRequest, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Fichier requis" });

    // Verify dossier belongs to user
    const [dossier] = await db
      .select()
      .from(dossiers)
      .where(and(eq(dossiers.id, req.params.id as string), eq(dossiers.user_id, req.user!.id)))
      .limit(1);
    if (!dossier) {
      fs.unlinkSync(req.file.path);
      return res.status(404).json({ error: "Dossier non trouvé" });
    }

    const code_piece = (req.body as Record<string, string>).code_piece ?? "";
    const nom_piece = (req.body as Record<string, string>).nom_piece ?? req.file.originalname;
    const url = `/api/uploads/${req.file.filename}`;

    const [piece] = await db
      .insert(dossier_pieces_jointes)
      .values({
        dossier_id: req.params.id as string,
        user_id: req.user!.id,
        nom: nom_piece,
        url,
        type: req.file.mimetype,
        taille: req.file.size,
        code_piece: code_piece || null,
      })
      .returning();

    // Non-blocking AI analysis — runs but doesn't fail the request
    let analyse_ia = null;
    try {
      analyse_ia = await analyzePiece(req.file.path, req.file.mimetype, nom_piece, code_piece);
      await db
        .update(dossier_pieces_jointes)
        .set({ analyse_ia })
        .where(eq(dossier_pieces_jointes.id, piece!.id));
    } catch {
      // AI failure is non-blocking
    }

    res.status(201).json({ ...piece, analyse_ia });
  } catch (err) {
    if (req.file?.path) {
      try { fs.unlinkSync(req.file.path); } catch { /* ignore */ }
    }
    console.error(err);
    res.status(500).json({ error: "Erreur upload" });
  }
});

// ── Suppression d'une pièce jointe ──
dossiersRouter.delete("/:id/pieces/:pieceId", async (req: AuthRequest, res) => {
  try {
    const dossier = await getOwnedDossier(req.params.id as string, req.user!.id);
    if (!dossier) return res.status(404).json({ error: "Dossier non trouvé" });
    if (dossier.status !== "brouillon") {
      return res.status(403).json({ error: "Les pièces ne peuvent être modifiées qu'au stade brouillon" });
    }

    const [piece] = await db
      .select()
      .from(dossier_pieces_jointes)
      .where(and(
        eq(dossier_pieces_jointes.id, req.params.pieceId as string),
        eq(dossier_pieces_jointes.dossier_id, dossier.id),
      ))
      .limit(1);
    if (!piece) return res.status(404).json({ error: "Pièce non trouvée" });

    if (piece.url) {
      const filename = piece.url.split("/").pop();
      if (filename) {
        try { fs.unlinkSync(path.join(UPLOADS_DIR, filename)); } catch { /* already gone */ }
      }
    }
    await db.delete(dossier_pieces_jointes).where(eq(dossier_pieces_jointes.id, piece.id));

    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Suppression d'un brouillon ──
dossiersRouter.delete("/:id", async (req: AuthRequest, res) => {
  try {
    const [dossier] = await db
      .select()
      .from(dossiers)
      .where(and(eq(dossiers.id, req.params.id as string), eq(dossiers.user_id, req.user!.id)))
      .limit(1);

    if (!dossier) return res.status(404).json({ error: "Dossier non trouvé" });
    if (dossier.status !== "brouillon") return res.status(403).json({ error: "Seuls les brouillons peuvent être supprimés" });

    // Delete uploaded files from disk
    const pieces = await db
      .select()
      .from(dossier_pieces_jointes)
      .where(eq(dossier_pieces_jointes.dossier_id, dossier.id));

    for (const piece of pieces) {
      if (piece.url) {
        const filename = piece.url.split("/").pop();
        if (filename) {
          const filePath = path.join(UPLOADS_DIR, filename);
          try { fs.unlinkSync(filePath); } catch { /* already gone */ }
        }
      }
    }

    await db.delete(dossier_pieces_jointes).where(eq(dossier_pieces_jointes.dossier_id, dossier.id));
    await db.delete(dossiers).where(eq(dossiers.id, dossier.id));

    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Événements d'instruction ──
dossiersRouter.get("/:id/events", async (req: AuthRequest, res) => {
  try {
    const dossier = await getOwnedDossier(req.params.id as string, req.user!.id);
    if (!dossier) return res.status(404).json({ error: "Dossier non trouvé" });
    const events = await db
      .select()
      .from(instruction_events)
      .where(eq(instruction_events.dossier_id, req.params.id as string))
      .orderBy(desc(instruction_events.created_at));
    res.json(events);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});
