import { Router } from "express";
import { z } from "zod";
import { db } from "../db.js";
import { dossiers, dossier_messages, dossier_pieces_jointes, instruction_events, dossier_courriers, users } from "@heureka-v1/db";
import { eq, desc, and, ilike, gt, sql, isNull } from "drizzle-orm";
import { requireAuth, type AuthRequest } from "../middlewares/auth.js";
import { auditMutations } from "../middlewares/auditMutations.js";
import crypto from "crypto";
import { callAi } from "../services/aiUsage.js";
import path from "path";
import multer from "multer";
import { classifyPermit } from "../services/classificationEngine.js";
import { buildPiecesContext, getPiecesForType, getPieceByCode } from "../data/piecesRequises.js";
import { changeDossierStatus, WorkflowError } from "../services/dossierWorkflow.js";
import { notifyDossierAgents } from "../services/notify.js";
import { analyzePiece } from "../services/pieceAnalyzer.js";
import { extractPiece, expectedTypeFromCode, type PieceExtraction } from "../services/pieceExtractor.js";
import { runDossierConformityAnalysisBackground } from "../services/dossierConformity.js";
import { syncDossierFactsFromPieces } from "../services/dossierFacts.js";
import { autoReopenAfterCitizenUpload } from "../services/dossierWorkflow.js";
import { computeInstructionDelay } from "../services/instructionDelays.js";
import { getStorageProvider } from "../services/storage.js";
import { attachCerfaToDossier } from "../services/cerfaAttachment.js";

// Multer stocke le fichier en MÉMOIRE (Buffer) plutôt que sur disque local.
// On délègue l'écriture finale au StorageProvider (local OU S3), ce qui
// permet de basculer Cellar/Scaleway/OVH OS sans toucher au code des routes.
const upload = multer({
  storage: multer.memoryStorage(),
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

// Le fileFilter ci-dessus ne voit que l'extension et le MIME déclarés par le
// client (falsifiables). On vérifie donc aussi la signature binaire réelle
// du contenu avant toute écriture en storage.
function sniffFileType(buf: Buffer): "pdf" | "jpeg" | "png" | "gif" | "webp" | "tiff" | null {
  if (buf.length < 12) return null;
  // Les lecteurs PDF tolèrent un préambule avant "%PDF" (limité à 1 Ko ici).
  if (buf.subarray(0, 1024).includes("%PDF")) return "pdf";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg";
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "png";
  if (buf.subarray(0, 4).toString("latin1") === "GIF8") return "gif";
  if (buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP") return "webp";
  if (buf[0] === 0x49 && buf[1] === 0x49 && buf[2] === 0x2a && buf[3] === 0x00) return "tiff";
  if (buf[0] === 0x4d && buf[1] === 0x4d && buf[2] === 0x00 && buf[3] === 0x2a) return "tiff";
  return null;
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
// Traçabilité super admin : tout dépôt/modification de dossier par un citoyen
// (création, upload de pièce, soumission, messages) est journalisé. Le label
// d'acteur est dérivé du rôle réel du user au moment de la requête, donc une
// mairie qui agit ici sera taggée "mairie".
dossiersRouter.use(auditMutations({
  actor: "citoyen",
  ignorePaths: new Set([
    "/:id/messages/read",
  ]),
}));

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

    // Délai légal pré-calculé pour CE dossier (base + extensions). On le
    // fournit à Claude pour qu'il n'invente PAS de durée — il doit reprendre
    // exactement les composantes qu'on lui donne.
    const delaiCalc = computeInstructionDelay(
      det.type,
      { natures: naturesToUse, certificatType },
      parcelData?.servitudes ?? null,
    );
    const delaiText = `${delaiCalc.total_mois} mois (${delaiCalc.breakdown.map((b) => `${b.label} ${b.mois > 0 ? "+" : ""}${b.mois}`).join(", ")})`;

    if (det.type !== "aucune_autorisation") {
      try {
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
          `Délai légal d'instruction (déjà calculé) : ${delaiText}`,
          det.architecte_requis ? "Architecte obligatoire : oui (surface totale > 150 m²)" : null,
        ].filter(Boolean).join("\n");

        const msg = await callAi(
          { purpose: "procedure_explain", userId: req.user?.id ?? null },
          {
            model: "ai-fast",
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
- Pour une zone ABF : mentionner les contraintes potentielles (couleurs, matériaux, menuiseries, type de baies) ET le délai supplémentaire (+1 mois au titre de R.423-24 b)). NE JAMAIS écrire "porté à 2 mois" — la procédure peut être 2, 3 ou 4 mois selon le type ; ne donne PAS de durée totale inventée.
- Quand tu dois mentionner le délai d'instruction (ABF, dérogation, évaluation environnementale…), reprends EXACTEMENT les composantes fournies dans "Délai légal d'instruction (déjà calculé)" ci-dessus, sans inventer d'autre chiffre.
- Ton direct et professionnel, pas de formules de politesse`,
            messages: [{ role: "user", content: contextLines }],
          },
        );

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
      // On préfère le délai calculé légalement (base + extensions) à la
      // fourchette générique "delai_moyen" du moteur déterministe.
      delai_moyen: delaiCalc.total_mois > 0 ? `${delaiCalc.total_mois} mois` : det.delai_moyen,
      delai_breakdown: delaiCalc.breakdown,
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
// Pagination défensive (mêmes bornes que la route mairie) : un citoyen aura
// rarement plus de quelques dizaines de dossiers, mais la limite serveur
// garantit qu'aucun client mal formé ne peut demander un volume arbitraire.
dossiersRouter.get("/", async (req: AuthRequest, res) => {
  try {
    const rawLimit = Number.parseInt((req.query.limit as string | undefined) ?? "", 10);
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 500) : 100;
    const rawOffset = Number.parseInt((req.query.offset as string | undefined) ?? "", 10);
    const offset = Number.isFinite(rawOffset) && rawOffset > 0 ? rawOffset : 0;

    const list = await db
      .select()
      .from(dossiers)
      .where(eq(dossiers.user_id, req.user!.id))
      .orderBy(desc(dossiers.created_at))
      .limit(limit)
      .offset(offset);
    res.json(list);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Liste des conversations du citoyen ──
// Un dossier = une conversation avec la mairie. On renvoie la liste des
// dossiers du citoyen avec, pour chacun, le dernier message + le nombre de
// messages non lus (= messages d'instructeur que le citoyen n'a pas encore
// consultés). Seuls les fils citoyen↔mairie sont remontés (consultation_id IS NULL).
// Placée AVANT la route `/:id` pour éviter la collision « conversations » → :id.
dossiersRouter.get("/conversations", async (req: AuthRequest, res) => {
  try {
    const rows = await db.execute(sql`
      WITH my_dossiers AS (
        SELECT id, numero, type, status, commune
        FROM dossiers
        WHERE user_id = ${req.user!.id}
      ),
      last_msg AS (
        SELECT DISTINCT ON (dm.dossier_id)
          dm.dossier_id, dm.content, dm.from_role, dm.created_at
        FROM dossier_messages dm
        WHERE dm.consultation_id IS NULL
          AND dm.dossier_id IN (SELECT id FROM my_dossiers)
        ORDER BY dm.dossier_id, dm.created_at DESC
      ),
      unread AS (
        SELECT dm.dossier_id, COUNT(*)::int AS cnt
        FROM dossier_messages dm
        WHERE dm.consultation_id IS NULL
          AND dm.from_role <> 'citoyen'
          AND dm.read_at IS NULL
          AND dm.dossier_id IN (SELECT id FROM my_dossiers)
        GROUP BY dm.dossier_id
      )
      SELECT
        d.id AS dossier_id, d.numero, d.type, d.status, d.commune,
        lm.content AS last_content, lm.from_role AS last_from_role, lm.created_at AS last_at,
        COALESCE(ur.cnt, 0) AS unread_count
      FROM my_dossiers d
      LEFT JOIN last_msg lm ON lm.dossier_id = d.id
      LEFT JOIN unread ur ON ur.dossier_id = d.id
      ORDER BY lm.created_at DESC NULLS LAST, d.numero DESC
    `);
    res.json(rows);
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
    // Notifie les agents (instructeur assigné ou agents de la commune) qu'un
    // nouveau dossier vient d'arriver. Non bloquant.
    void notifyDossierAgents({
      dossier_id: req.params.id as string,
      type: "dossier_soumis",
      title: "Nouveau dossier déposé",
      message: `Le dossier ${dossier.numero} (${dossier.commune ?? "commune non précisée"}) vient d'être déposé par le pétitionnaire.`,
      exclude_user_id: req.user!.id,
    });
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

// ── Pièces à compléter (citoyen) ──
// Quand l'instructeur a émis une demande de pièces complémentaires, le citoyen
// doit pouvoir consulter la liste exacte des pièces réclamées (et seulement
// celles-là) avec, pour chacune, la description officielle de la pièce attendue
// + la raison libre saisie par l'instructeur. La source de vérité est le dernier
// courrier de type "pieces_complementaires" émis sur le dossier.
dossiersRouter.get("/:id/pieces-a-completer", async (req: AuthRequest, res) => {
  try {
    const dossier = await getOwnedDossier(req.params.id as string, req.user!.id);
    if (!dossier) return res.status(404).json({ error: "Dossier non trouvé" });

    const [courrier] = await db
      .select()
      .from(dossier_courriers)
      .where(and(
        eq(dossier_courriers.dossier_id, dossier.id),
        eq(dossier_courriers.type, "pieces_complementaires"),
      ))
      .orderBy(desc(dossier_courriers.emis_le))
      .limit(1);

    if (!courrier) {
      return res.json({ courrier_id: null, emis_le: null, pieces: [] });
    }

    // Contexte pour résoudre l'aide officielle conditionnelle (ABF, surface…).
    const meta = (dossier.metadata as Record<string, unknown>) ?? {};
    const natures = Array.isArray(meta.natures) ? (meta.natures as string[]) : [];
    const surface = parseFloat(dossier.surface_plancher ?? "0") || 0;
    const ctx = buildPiecesContext(natures, surface);

    const requested = courrier.pieces_jointes_ids ?? [];

    // Pour savoir si une pièce a déjà été redéposée, on cherche un upload
    // postérieur à l'émission du courrier dont le nom commence par le libellé
    // exact de la pièce demandée (le citoyen upload avec
    // nom = "${piece.nom} - ${file.name}"). Cela permet de distinguer deux
    // emplacements qui partagent le même code_piece (ex. deux annexes).
    const uploadsAfter = await db
      .select({
        id: dossier_pieces_jointes.id,
        nom: dossier_pieces_jointes.nom,
        url: dossier_pieces_jointes.url,
        code_piece: dossier_pieces_jointes.code_piece,
        uploaded_at: dossier_pieces_jointes.uploaded_at,
      })
      .from(dossier_pieces_jointes)
      .where(and(
        eq(dossier_pieces_jointes.dossier_id, dossier.id),
        gt(dossier_pieces_jointes.uploaded_at, courrier.emis_le),
      ))
      .orderBy(desc(dossier_pieces_jointes.uploaded_at));

    const findUploadForSlot = (slotNom: string, slotCode: string | null | undefined) => {
      const prefix = `${slotNom} - `;
      return uploadsAfter.find((u) => {
        if (!u.nom.startsWith(prefix)) return false;
        if (slotCode && u.code_piece && u.code_piece !== slotCode) return false;
        return true;
      });
    };

    const pieces = requested.map((p) => {
      const aideSource = p.code_piece ? getPieceByCode(p.code_piece, ctx) : null;
      const upload = findUploadForSlot(p.nom, p.code_piece);
      return {
        code_piece: p.code_piece ?? null,
        nom: p.nom,
        raison: p.raison ?? null,
        manquante: p.manquante ?? !p.piece_id,
        aide: aideSource?.aide ?? null,
        deja_redeposee: !!upload,
        redepot: upload
          ? { id: upload.id, nom: upload.nom, url: upload.url, uploaded_at: upload.uploaded_at }
          : null,
      };
    });

    res.json({
      courrier_id: courrier.id,
      emis_le: courrier.emis_le,
      subject: courrier.subject,
      pieces,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Resoumettre un dossier après dépôt des compléments ──
// Bascule incomplet → pre_instruction quand toutes les pièces réclamées dans
// le dernier courrier "pieces_complementaires" ont été redéposées. La machine
// à états refuse la transition si le dossier n'est pas en "incomplet" — c'est
// notre garantie qu'on ne resoumet pas un dossier déjà en cours d'instruction.
dossiersRouter.post("/:id/resoumettre", async (req: AuthRequest, res) => {
  try {
    const dossier = await getOwnedDossier(req.params.id as string, req.user!.id);
    if (!dossier) return res.status(404).json({ error: "Dossier non trouvé" });
    if (dossier.status !== "incomplet") {
      return res.status(400).json({ error: "Le dossier n'est pas en attente de pièces complémentaires" });
    }

    const [courrier] = await db
      .select()
      .from(dossier_courriers)
      .where(and(
        eq(dossier_courriers.dossier_id, dossier.id),
        eq(dossier_courriers.type, "pieces_complementaires"),
      ))
      .orderBy(desc(dossier_courriers.emis_le))
      .limit(1);
    if (!courrier) {
      return res.status(400).json({ error: "Aucune demande de pièces complémentaires sur ce dossier" });
    }

    const requested = courrier.pieces_jointes_ids ?? [];
    const uploadsAfter = await db
      .select({ code_piece: dossier_pieces_jointes.code_piece, nom: dossier_pieces_jointes.nom })
      .from(dossier_pieces_jointes)
      .where(and(
        eq(dossier_pieces_jointes.dossier_id, dossier.id),
        gt(dossier_pieces_jointes.uploaded_at, courrier.emis_le),
      ));
    // Un emplacement est considéré rempli lorsqu'au moins un upload postérieur
    // au courrier porte un nom commençant par "${slot.nom} - " (et, si
    // disponible, le même code_piece). Permet à deux emplacements partageant
    // le même code (ex. deux annexes) d'être tracés indépendamment.
    const manquantes = requested.filter((p) => {
      const prefix = `${p.nom} - `;
      return !uploadsAfter.some((u) => {
        if (!u.nom.startsWith(prefix)) return false;
        if (p.code_piece && u.code_piece && u.code_piece !== p.code_piece) return false;
        return true;
      });
    });
    if (manquantes.length > 0) {
      return res.status(422).json({
        error: "Toutes les pièces demandées doivent être redéposées avant de retransmettre le dossier",
        manquantes: manquantes.map((p) => ({ code_piece: p.code_piece ?? null, nom: p.nom })),
      });
    }

    try {
      await changeDossierStatus(dossier.id, "pre_instruction", req.user!.id, {
        reason: "compléments transmis par le pétitionnaire",
        eventType: "pieces_complementaires_recues",
        extraMetadata: { courrier_id: courrier.id, pieces_count: requested.length },
      });
    } catch (err) {
      if (err instanceof WorkflowError) {
        return res.status(400).json({ error: err.message, code: err.code });
      }
      throw err;
    }

    const [updated] = await db
      .select()
      .from(dossiers)
      .where(eq(dossiers.id, dossier.id))
      .limit(1);
    // Notifie l'instructeur (ou les agents de la commune) que les compléments
    // sont arrivés et que le dossier est prêt à être réexaminé.
    void notifyDossierAgents({
      dossier_id: dossier.id,
      type: "pieces_complementaires_recues",
      title: `Pièces complémentaires reçues — dossier ${dossier.numero}`,
      message: `Le pétitionnaire a redéposé ${requested.length} pièce${requested.length > 1 ? "s" : ""}. Le dossier est en attente de réexamen de complétude.`,
      exclude_user_id: req.user!.id,
    });
    res.json(updated);
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

    // Génération + attachement du CERFA prérempli, best-effort : un échec
    // ici (PDF template manquant, erreur storage) ne doit pas bloquer la
    // création du brouillon. Le citoyen pourra retrouver le formulaire vide
    // sur service-public.fr et le déposer manuellement.
    attachCerfaToDossier(dossier!.id).catch((err) => {
      console.error("[dossiers] attachCerfaToDossier a échoué:", err instanceof Error ? `${err.name}: ${err.message}` : err);
    });

    res.status(201).json(dossier);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: "Données invalides", details: err.errors });
    }
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Mise à jour d'un dossier brouillon ──
// Permet au citoyen d'ajuster ses informations entre la création (étape 6 du
// wizard) et la soumission. Régénère automatiquement le CERFA prérempli si
// un champ « source » change (parcelle, adresse, description, surface,
// metadata.cerfa_data). Les statuts post-brouillon ne sont pas modifiables
// via cette route — il faut alors passer par la mairie.
const updateSchema = z.object({
  parcelle: z.string().optional(),
  adresse: z.string().optional(),
  commune: z.string().optional(),
  code_postal: z.string().optional(),
  description: z.string().optional(),
  surface_plancher: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

const CERFA_SOURCE_FIELDS = [
  "parcelle",
  "adresse",
  "commune",
  "code_postal",
  "description",
  "surface_plancher",
] as const;

function metadataCerfaChanged(prev: unknown, next: unknown): boolean {
  const p = (prev as Record<string, unknown> | null)?.cerfa_data;
  const n = (next as Record<string, unknown> | null)?.cerfa_data;
  return JSON.stringify(p ?? null) !== JSON.stringify(n ?? null);
}

dossiersRouter.patch("/:id", async (req: AuthRequest, res) => {
  try {
    const dossier = await getOwnedDossier(req.params.id as string, req.user!.id);
    if (!dossier) return res.status(404).json({ error: "Dossier non trouvé" });
    if (dossier.status !== "brouillon") {
      return res.status(403).json({ error: "Le dossier n'est plus modifiable une fois soumis" });
    }

    const data = updateSchema.parse(req.body);

    // Détecte si une régénération du CERFA est nécessaire AVANT l'écriture
    // (sinon on comparerait l'état contre lui-même).
    const sourceChanged = CERFA_SOURCE_FIELDS.some(
      (k) => k in data && (data[k] ?? null) !== (dossier[k] ?? null),
    );
    const cerfaDataChanged = "metadata" in data && metadataCerfaChanged(dossier.metadata, data.metadata);
    const needsRegen = sourceChanged || cerfaDataChanged;

    const [updated] = await db
      .update(dossiers)
      .set({ ...data, updated_at: new Date() })
      .where(eq(dossiers.id, req.params.id as string))
      .returning();

    if (needsRegen) {
      attachCerfaToDossier(updated!.id).catch((err) => {
        console.error("[dossiers] régénération CERFA a échoué:", err instanceof Error ? `${err.name}: ${err.message}` : err);
      });
    }

    res.json(updated);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: "Données invalides", details: err.errors });
    }
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Messages d'un dossier (citoyen ↔ mairie uniquement) ──
// Filtre consultation_id IS NULL pour cacher les fils services consultés
// (ABF/SDIS/…) que le citoyen ne doit jamais voir.
dossiersRouter.get("/:id/messages", async (req: AuthRequest, res) => {
  try {
    const dossier = await getOwnedDossier(req.params.id as string, req.user!.id);
    if (!dossier) return res.status(404).json({ error: "Dossier non trouvé" });
    const messages = await db
      .select()
      .from(dossier_messages)
      .where(and(
        eq(dossier_messages.dossier_id, req.params.id as string),
        isNull(dossier_messages.consultation_id),
      ))
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
    // Notifie les agents en charge — uniquement quand l'expéditeur est le
    // citoyen ; un message intra-mairie est déjà visible dans la fil de
    // discussion sans bruit supplémentaire.
    if (req.user!.role === "citoyen") {
      const preview = content.length > 120 ? `${content.slice(0, 117)}…` : content;
      void notifyDossierAgents({
        dossier_id: req.params.id as string,
        type: "message_citoyen",
        title: `Message — dossier ${dossier.numero}`,
        message: preview,
        exclude_user_id: req.user!.id,
      });
    }
    res.status(201).json(rows[0]!);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Marquer comme lus les messages d'instructeur d'un dossier ──
dossiersRouter.post("/:id/messages/read", async (req: AuthRequest, res) => {
  try {
    const dossier = await getOwnedDossier(req.params.id as string, req.user!.id);
    if (!dossier) return res.status(404).json({ error: "Dossier non trouvé" });
    await db
      .update(dossier_messages)
      .set({ read_at: new Date() })
      .where(and(
        eq(dossier_messages.dossier_id, req.params.id as string),
        isNull(dossier_messages.consultation_id),
        sql`from_role <> 'citoyen'`,
        isNull(dossier_messages.read_at),
      ));
    res.json({ ok: true });
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
  // Avec multer.memoryStorage(), req.file.buffer contient le contenu binaire
  // et req.file.path est undefined. La key est générée ici (UUID + extension)
  // puis l'écriture est déléguée au StorageProvider (local OU S3).
  const storage = getStorageProvider();
  const fileKey = req.file
    ? `${crypto.randomUUID()}${path.extname(req.file.originalname)}`
    : null;
  try {
    if (!req.file || !fileKey) return res.status(400).json({ error: "Fichier requis" });

    if (sniffFileType(req.file.buffer) === null) {
      return res.status(400).json({ error: "Le contenu du fichier ne correspond pas à un format supporté (PDF, JPEG, PNG, GIF, WEBP, TIFF)" });
    }

    // Verify dossier belongs to user
    const [dossier] = await db
      .select()
      .from(dossiers)
      .where(and(eq(dossiers.id, req.params.id as string), eq(dossiers.user_id, req.user!.id)))
      .limit(1);
    if (!dossier) {
      // Pas de fichier écrit côté storage à ce stade — rien à nettoyer.
      return res.status(404).json({ error: "Dossier non trouvé" });
    }

    const code_piece = (req.body as Record<string, string>).code_piece ?? "";
    const nom_piece = (req.body as Record<string, string>).nom_piece ?? req.file.originalname;
    const aiConsentRaw = (req.body as Record<string, string>).ai_consent;
    // Si l'upload ne précise pas le consentement (cas typique d'un dépôt
    // complémentaire après "incomplet"), on retombe sur la dernière décision
    // explicite du citoyen enregistrée au niveau du dossier. NULL = pas de
    // consentement explicite → on n'exécute pas l'IA.
    const aiConsent: boolean | null = aiConsentRaw === undefined
      ? (dossier.ai_consent ?? null)
      : aiConsentRaw === "true";
    const runAi = aiConsent === true;

    // 1) Écriture du fichier via l'abstraction de stockage (local OU S3).
    const stored = await storage.put({
      key: fileKey,
      body: req.file.buffer,
      mime: req.file.mimetype,
    });

    const [piece] = await db
      .insert(dossier_pieces_jointes)
      .values({
        dossier_id: req.params.id as string,
        user_id: req.user!.id,
        nom: nom_piece,
        url: stored.url,
        type: req.file.mimetype,
        taille: req.file.size,
        code_piece: code_piece || null,
      })
      .returning();

    // RGPD : persiste le consentement au niveau du dossier (dernière valeur
    // explicite du pétitionnaire). Permet l'audit "ce dossier a-t-il été
    // soumis à l'analyse automatisée ?".
    if (aiConsent !== null) {
      await db
        .update(dossiers)
        .set({ ai_consent: aiConsent, ai_consent_at: new Date() })
        .where(eq(dossiers.id, req.params.id as string));
    }

    let analyse_ia: Awaited<ReturnType<typeof analyzePiece>> | null = null;
    let extraction_ia: PieceExtraction | null = null;
    // Remonté au client quand l'IA était attendue mais a échoué (clé Mistral
    // manquante, pdftoppm absent, time-out…). Permet au wizard d'afficher
    // « analyse indisponible » au lieu d'un silence trompeur.
    let ai_error: string | null = null;

    if (runAi) {
      // Deux passes IA en parallèle, non-bloquantes :
      //   1) analyse qualitative (score conforme/acceptable/incomplet/non_conforme)
      //   2) extraction structurée (dimensions, surfaces, NGF…) qui alimentera
      //      ensuite le moteur de conformité au moment de l'instruction.
      const expected = expectedTypeFromCode(code_piece);
      // Imputation par commune : recherche tolérante sur le nom (les dossiers
      // n'ont qu'un commune textuel, pas d'FK directe).
      let communeIdForTrace: string | null = null;
      if (dossier.commune) {
        const { communes } = await import("@heureka-v1/db");
        const [c] = await db.select({ id: communes.id }).from(communes).where(ilike(communes.name, dossier.commune)).limit(1);
        communeIdForTrace = c?.id ?? null;
      }
      const trace = { dossierId: req.params.id as string, userId: req.user!.id, communeId: communeIdForTrace };
      // On passe directement le Buffer aux services d'analyse — plus de
      // chemin disque. Les services prennent en charge local ET S3 via le
      // StorageProvider en relisant la key si besoin (cf. signature *FromBuffer).
      // Diagnostic : on log explicitement les erreurs au lieu de les avaler
      // silencieusement, sinon un échec Bedrock (model ID invalide,
      // AccessDenied, etc.) reste invisible.
      const fileBuffer = req.file.buffer;
      const mimeType = req.file.mimetype;
      const captureErr = (label: string) => (err: unknown) => {
        const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
        console.error(`[upload] ${label} a échoué:`, msg);
        // Première erreur rencontrée = celle qu'on remonte. On masque la clé
        // API au passage si elle a fuité dans le message (paranoïa).
        if (!ai_error) ai_error = msg.replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer ***");
      };
      [analyse_ia, extraction_ia] = await Promise.all([
        analyzePiece(fileBuffer, mimeType, nom_piece, code_piece, undefined, trace).catch((err) => {
          captureErr("analyzePiece")(err);
          return null;
        }),
        extractPiece(fileBuffer, mimeType, {
          expected_type: expected,
          nom_piece,
          code_piece,
        }, trace).catch((err) => {
          captureErr("extractPiece")(err);
          return null as PieceExtraction | null;
        }),
      ]);
    }

    if (analyse_ia || extraction_ia || !runAi) {
      await db
        .update(dossier_pieces_jointes)
        .set({
          analyse_ia: analyse_ia ?? null,
          extraction_ia: extraction_ia ?? null,
          ai_processed: runAi && (analyse_ia !== null || extraction_ia !== null),
        })
        .where(eq(dossier_pieces_jointes.id, piece!.id));
    }

    // Auto-réouverture si le dossier était en "incomplet" : le pétitionnaire
    // vient de redéposer une pièce, donc la complétude doit être réexaminée.
    // Best-effort : on n'échoue jamais l'upload pour un problème de transition.
    try {
      await autoReopenAfterCitizenUpload(req.params.id as string, req.user!.id);
    } catch (e) {
      console.warn("[upload] autoReopen:", e);
    }

    // Best-effort : remappe les extractions IA en dossier_facts pour que le
    // moteur réglementaire dispose de données fraiches dès que l'instructeur
    // ouvre le dossier — pas besoin de relancer manuellement. Sync défensive
    // côté /api/regulatory/analyze couvre les cas où celle-ci échoue.
    if (extraction_ia) {
      try {
        await syncDossierFactsFromPieces(req.params.id as string);
      } catch (e) {
        console.warn("[upload] syncDossierFacts:", e);
      }
    }

    res.status(201).json({
      ...piece,
      analyse_ia,
      extraction_ia,
      ai_processed: runAi && (analyse_ia !== null || extraction_ia !== null),
      ai_requested: runAi,
      ai_error,
    });
  } catch (err) {
    // Si le fichier a été écrit dans le storage avant l'erreur, on le retire
    // pour éviter les orphelins. Best-effort.
    if (fileKey) {
      try { await storage.remove(fileKey); } catch { /* ignore */ }
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
      const storage = getStorageProvider();
      await storage.remove(storage.keyFromUrl(piece.url));
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

    // Suppression des fichiers physiques via l'abstraction StorageProvider
    // (local ou S3-compatible), puis purge en base.
    const pieces = await db
      .select({ url: dossier_pieces_jointes.url })
      .from(dossier_pieces_jointes)
      .where(eq(dossier_pieces_jointes.dossier_id, dossier.id));
    const storage = getStorageProvider();
    const keys = pieces
      .map((p) => p.url)
      .filter((u): u is string => !!u)
      .map((u) => storage.keyFromUrl(u));
    await storage.removeBulk(keys);

    await db.delete(dossier_pieces_jointes).where(eq(dossier_pieces_jointes.dossier_id, dossier.id));
    await db.delete(dossiers).where(eq(dossiers.id, dossier.id));

    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Événements d'instruction ──
// Vue citoyen : on masque l'historique RH interne (réassignations, redirections
// pour absence, retraits) pour ne conserver que la dernière attribution
// effective. Sa description est normalisée pour n'exposer ni le motif
// (absence, réassignation) ni les agents précédents — seul le nom de
// l'instructeur courant est révélé, comme l'exige la loi DCRA du 12 avril
// 2000 (art. 4).
const ASSIGNMENT_EVENT_TYPES = new Set([
  "instructeur_assigned",
  "instructeur_reassigned",
  "instructeur_redirected_absence",
  "instructeur_unassigned",
]);

dossiersRouter.get("/:id/events", async (req: AuthRequest, res) => {
  try {
    const dossier = await getOwnedDossier(req.params.id as string, req.user!.id);
    if (!dossier) return res.status(404).json({ error: "Dossier non trouvé" });
    const events = await db
      .select()
      .from(instruction_events)
      .where(eq(instruction_events.dossier_id, req.params.id as string))
      .orderBy(desc(instruction_events.created_at));

    const latestAssignmentIdx = events.findIndex((e) => ASSIGNMENT_EVENT_TYPES.has(e.type));
    const latestAssignment = latestAssignmentIdx >= 0 ? events[latestAssignmentIdx]! : null;
    const hasCurrentInstructeur =
      latestAssignment !== null && latestAssignment.type !== "instructeur_unassigned";

    let currentInstructeurName: string | null = null;
    if (hasCurrentInstructeur && latestAssignment) {
      const meta = latestAssignment.metadata as { new_instructeur_id?: string } | null;
      const instructeurId = meta?.new_instructeur_id ?? null;
      if (instructeurId) {
        const [u] = await db
          .select({ prenom: users.prenom, nom: users.nom })
          .from(users)
          .where(eq(users.id, instructeurId))
          .limit(1);
        if (u) currentInstructeurName = [u.prenom, u.nom].filter(Boolean).join(" ").trim() || null;
      }
    }

    const filtered = events
      .filter((e, i) => {
        if (!ASSIGNMENT_EVENT_TYPES.has(e.type)) return true;
        return hasCurrentInstructeur && i === latestAssignmentIdx;
      })
      .map((e) => {
        if (!ASSIGNMENT_EVENT_TYPES.has(e.type)) return e;
        return {
          ...e,
          type: "instructeur_assigned",
          description: currentInstructeurName
            ? `Votre dossier est pris en charge par ${currentInstructeurName}`
            : "Votre dossier est pris en charge",
          metadata: null,
        };
      });

    res.json(filtered);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});
