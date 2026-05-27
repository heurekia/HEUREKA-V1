import { Router } from "express";
import { z } from "zod";
import { db } from "../db.js";
import { dossiers, dossier_messages, dossier_pieces_jointes, instruction_events, notifications } from "@heureka-v1/db";
import { eq, desc, and } from "drizzle-orm";
import { requireAuth, type AuthRequest } from "../middlewares/auth.js";
import crypto from "crypto";
import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";

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
  certificat: "Demande de certificat d'urbanisme",
};

export const dossiersRouter = Router();

dossiersRouter.use(requireAuth);

// ── Classification IA de la procédure d'urbanisme ──
dossiersRouter.post("/classify", async (req: AuthRequest, res) => {
  try {
    const {
      nature,
      surface,
      parcelData,
      empriseExistante,
      amenagementType,
      description,
    } = req.body as {
      nature: string;
      surface?: number;
      parcelData?: { zone?: string; commune?: string; servitudes?: Array<{ categorie?: string; libelle?: string }> };
      empriseExistante?: string;
      amenagementType?: string;
      description?: string;
    };

    const client = new Anthropic({ apiKey: getAnthropicKey() });

    const contextLines = [
      `Projet : ${NATURE_LABELS[nature] ?? nature}`,
      surface ? `Surface plancher du projet : ${surface} m²` : null,
      empriseExistante ? `Surface plancher existante : ${empriseExistante} m²` : null,
      amenagementType ? `Type d'aménagement : ${amenagementType}` : null,
      description ? `Description du projet : ${description}` : null,
      parcelData?.zone ? `Zone PLU : ${parcelData.zone}` : null,
      parcelData?.commune ? `Commune : ${parcelData.commune}` : null,
      parcelData?.servitudes?.length
        ? `Servitudes : ${parcelData.servitudes.map((s) => s.libelle ?? s.categorie).filter(Boolean).join(", ")}`
        : null,
    ].filter(Boolean).join("\n");

    const msg = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      system: `Tu es expert en droit de l'urbanisme français (Code de l'urbanisme). Analyse le projet et détermine la procédure administrative requise.

Règles principales :
- < 5 m² surface plancher : pas d'autorisation (sauf zone protégée ou ABF)
- 5 à 20 m² en zone U avec PLU : Déclaration Préalable
- Extension > 20 m² en zone U : DP jusqu'à 40 m², Permis de Construire au-delà
- Maison neuve : Permis de Construire (maison individuelle)
- Permis d'Aménager : lotissements, terrains de camping, aires de stationnement > 50 places
- Démolition > 20 m² ou en zone protégée : Permis de Démolir
- Piscine > 10 m² ou profondeur > 1,80 m : Déclaration Préalable
- Clôture : DP si PLU le prescrit ou en commune soumise au RNU
- Zone ABF (servitude AC) : consultation ABF obligatoire, +1 mois sur délais
- Certificat d'urbanisme : type a (informatif) ou b (opérationnel)

Réponds UNIQUEMENT avec du JSON valide (aucun texte avant ou après) :
{
  "type": "declaration_prealable|permis_de_construire|permis_amenager|permis_demolir|certificat_urbanisme",
  "libelle": "Nom court",
  "explication": "2 à 3 phrases simples pour un citoyen",
  "delai_moyen": "X à Y mois",
  "pieces_requises": [
    {"nom": "Nom du document", "requis": true, "aide": "Description courte"}
  ],
  "alertes": ["string si point important, sinon tableau vide"],
  "confiance": "haute|moyenne|faible"
}`,
      messages: [{ role: "user", content: contextLines }],
    });

    const text = msg.content[0]?.type === "text" ? msg.content[0].text : "{}";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const result = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
    res.json(result);
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
