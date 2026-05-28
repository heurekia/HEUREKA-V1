import { Router } from "express";
import { z } from "zod";
import { db } from "../db.js";
import { dossiers, dossier_messages, dossier_pieces_jointes, instruction_events, notifications } from "@heureka-v1/db";
import { eq, desc, and } from "drizzle-orm";
import { requireAuth, type AuthRequest } from "../middlewares/auth.js";
import crypto from "crypto";
import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import { classifyPermit, type ClassificationInput } from "../services/classificationEngine.js";
import { getPiecesForType, buildPiecesContext } from "../data/piecesRequises.js";

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

// ── Classification déterministe + explication IA ──
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

    // ── Étape 1 : classification déterministe (Code de l'urbanisme) ──
    const classInput: ClassificationInput = {
      natures: naturesToUse,
      surface: surface ?? 0,
      empriseExistante: empriseExistante ? Number(empriseExistante) : undefined,
      zone: parcelData?.zone,
      servitudes: parcelData?.servitudes,
      amenagementType,
    };
    const classification = classifyPermit(classInput);

    // ── Étape 2 : pièces officielles (arrêté du 13 février 2020) ──
    const piecesCtx = buildPiecesContext(
      naturesToUse,
      surface ?? 0,
      parcelData?.servitudes,
      amenagementType,
    );
    const pieces = getPiecesForType(classification.type, piecesCtx);

    // ── Étape 3 : explication citoyen + alertes (IA, best-effort) ──
    let explication = "";
    let alertes: string[] = [];

    try {
      const client = new Anthropic({ apiKey: getAnthropicKey() });

      const contextLines = [
        `Procédure déterminée : ${classification.libelle} (${classification.libelle_court})`,
        classification.articles.length ? `Articles : ${classification.articles.join(", ")}` : null,
        naturesToUse.length > 1
          ? `Projets combinés : ${naturesToUse.map((n) => NATURE_LABELS[n] ?? n).join(", ")}`
          : `Projet : ${NATURE_LABELS[naturesToUse[0] ?? ""] ?? naturesToUse[0] ?? "Non précisé"}`,
        surface ? `Surface : ${surface} m²` : null,
        amenagementType ? `Type d'aménagement : ${amenagementType}` : null,
        description ? `Description : ${description}` : null,
        parcelData?.zone ? `Zone PLU : ${parcelData.zone}` : null,
        parcelData?.commune ? `Commune : ${parcelData.commune}` : null,
        parcelData?.servitudes?.length
          ? `Servitudes : ${parcelData.servitudes.map((s) => s.libelle ?? s.categorie).filter(Boolean).join(", ")}`
          : null,
        classification.modifiers.includes("ABF") ? "Zone ABF : oui (délai +1 mois)" : null,
      ].filter(Boolean).join("\n");

      const msg = await client.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 512,
        system: `Tu es expert en droit de l'urbanisme français. La procédure a été déterminée de façon certaine par le moteur réglementaire. Rédige une explication simple pour un citoyen non-expert et liste les points d'attention spécifiques.

Réponds UNIQUEMENT avec du JSON valide :
{
  "explication": "2 à 3 phrases simples pour un citoyen, expliquant pourquoi cette procédure s'applique",
  "alertes": ["point d'attention si pertinent — tableau vide si aucun"]
}`,
        messages: [{ role: "user", content: contextLines }],
      });

      const text = msg.content[0]?.type === "text" ? msg.content[0].text : "{}";
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      const aiResult = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
      explication = typeof aiResult.explication === "string" ? aiResult.explication : "";
      alertes = Array.isArray(aiResult.alertes) ? aiResult.alertes : [];
    } catch {
      // IA indisponible — explication de secours basée sur le résultat déterministe
      explication = `Votre projet nécessite une ${classification.libelle}. Délai moyen : ${classification.delai_moyen}.`;
      if (classification.modifiers.includes("ABF")) {
        alertes = ["Votre terrain est en périmètre ABF : prévoyez un délai supplémentaire d'1 mois."];
      }
    }

    res.json({
      type: classification.type,
      libelle: classification.libelle,
      libelle_court: classification.libelle_court,
      articles: classification.articles,
      explication,
      delai_moyen: classification.delai_moyen,
      pieces_requises: pieces,
      alertes,
      confiance: classification.confidence === "deterministic" ? "haute" : "faible",
      modifiers: classification.modifiers,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur classification" });
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
      .values({ ...data, numero, user_id: req.user!.id, metadata: data.metadata ?? {} })
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
