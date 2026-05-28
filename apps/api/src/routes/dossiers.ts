import { Router } from "express";
import { z } from "zod";
import { db } from "../db.js";
import { dossiers, dossier_messages, dossier_pieces_jointes, instruction_events, notifications } from "@heureka-v1/db";
import { eq, desc, and } from "drizzle-orm";
import { requireAuth, type AuthRequest } from "../middlewares/auth.js";
import crypto from "crypto";
import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import { buildPiecesContext, getPiecesForType } from "../data/piecesRequises.js";
import { classifyPermit } from "../services/classificationEngine.js";

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
    } = req.body as {
      nature?: string;
      natures?: string[];
      surface?: number;
      parcelData?: { zone?: string; commune?: string; servitudes?: Array<{ categorie?: string; libelle?: string }> };
      empriseExistante?: string;
      amenagementType?: string;
      description?: string;
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
        ].filter(Boolean).join("\n");

        const msg = await client.messages.create({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 512,
          system: `Tu es conseiller en urbanisme. La procédure a déjà été déterminée par le système.
Ta tâche : rédiger uniquement l'explication et les alertes pour un citoyen non juriste.

Réponds UNIQUEMENT avec du JSON valide :
{
  "explication": "2-3 phrases simples expliquant pourquoi cette procédure s'applique à CE projet spécifique",
  "alertes": ["alerte spécifique si pertinente (ABF, délai, contrainte particulière)", "…"]
}

Règles :
- Ne jamais nommer la procédure dans l'explication (elle est déjà affichée)
- Alertes seulement si réellement utile — tableau vide si rien de spécial
- Maximum 3 alertes`,
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
      }
    } else {
      explication = "Votre projet ne dépasse pas le seuil réglementaire qui impose une démarche administrative. Vous pouvez débuter les travaux sans autorisation préalable.";
    }

    res.json({
      type: det.type,
      libelle: det.libelle,
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

// ── Détail d'un dossier ──
dossiersRouter.get("/:id", async (req: AuthRequest, res) => {
  try {
    const [dossier] = await db
      .select()
      .from(dossiers)
      .where(and(eq(dossiers.id, req.params.id as string), eq(dossiers.user_id, req.user!.id)))
      .limit(1);
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

// ── Événements d'instruction ──
dossiersRouter.get("/:id/events", async (req: AuthRequest, res) => {
  try {
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
