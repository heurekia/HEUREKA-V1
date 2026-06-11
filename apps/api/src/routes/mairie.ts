import { Router } from "express";
import { db } from "../db.js";
import { dossiers, users, notifications, dossier_messages, dossier_pieces_jointes, zones, zone_regulatory_rules, communes, courrier_templates, user_communes, legal_mentions, user_availability, user_absences, user_delegations, commune_documents, dossier_consultations, external_services, service_communes, instruction_events, document_segments, document_segment_annotations, ANNOTATION_KINDS, dossier_courriers } from "@heureka-v1/db";
import { eq, desc, and, sql, like, ilike, inArray, isNull } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { CODE_URBANISME_ID } from "../services/legifrance.js";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth.js";
import { analyseParcel } from "../services/parcelAnalysis.js";
import { runDossierConformityAnalysis, runDossierConformityAnalysisBackground, type ConformiteReport } from "../services/dossierConformity.js";
import { parseLooseArray } from "../services/jsonExtract.js";
import { extractPiece, expectedTypeFromCode } from "../services/pieceExtractor.js";
import { callClaude, anthropicClient, trackClaudeStreamUsage } from "../services/aiUsage.js";
import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { PDFDocument } from "pdf-lib";
import { refreshPluZones, pluEtagFor, filterZonesByInsee, PLU_CACHE_TTL_MS, type PluZonesGeoJson } from "../services/pluZones.js";

const __dirname_mairie = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR_MAIRIE = path.resolve(__dirname_mairie, "../../uploads");

// Anthropic limite chaque requête à ~100 pages de PDF. Les gros règlements PLU
// (200+ pages) sont découpés en tronçons ≤ maxPages, avec un léger chevauchement
// pour ne pas couper en deux la section d'une zone à cheval sur deux tronçons.
// Un PLU court (≤ 100 pages) reste en un seul tronçon (le PDF d'origine).
async function splitPdfBase64(base64: string, maxPages = 90, overlap = 8): Promise<string[]> {
  const src = await PDFDocument.load(Buffer.from(base64, "base64"), { ignoreEncryption: true });
  const total = src.getPageCount();
  if (total <= 100) return [base64];

  const chunks: string[] = [];
  const stride = Math.max(1, maxPages - overlap);
  for (let start = 0; start < total; start += stride) {
    const end = Math.min(start + maxPages, total);
    const out = await PDFDocument.create();
    const indices = Array.from({ length: end - start }, (_, i) => start + i);
    const pages = await out.copyPages(src, indices);
    pages.forEach(p => out.addPage(p));
    chunks.push(await out.saveAsBase64());
    if (end >= total) break;
  }
  return chunks;
}

export const mairieRouter = Router();

// Résout l'UUID de commune à partir de l'INSEE du user connecté (cache LRU
// simple : la map ne grossit jamais au-delà du nombre de communes actives).
const _communeIdByInsee = new Map<string, string | null>();
async function resolveCommuneIdFromUser(req: AuthRequest): Promise<string | null> {
  const insee = req.user?.commune_insee;
  if (!insee) return null;
  if (_communeIdByInsee.has(insee)) return _communeIdByInsee.get(insee) ?? null;
  const [row] = await db.select({ id: communes.id }).from(communes).where(eq(communes.insee_code, insee)).limit(1);
  const id = row?.id ?? null;
  _communeIdByInsee.set(insee, id);
  return id;
}

mairieRouter.use(requireAuth);
mairieRouter.use(requireRole("mairie", "instructeur", "admin"));

// Délais réglementaires d'instruction (Code de l'Urbanisme)
// Implémentation détaillée et auditable : voir services/instructionDelays.ts.
// Le tableau ci-dessous reste pour le retour "rules_defaut" de l'admin.
const DELAI_INSTRUCTION_MOIS_DEFAUT: Record<string, number> = {
  permis_de_construire: 3,
  declaration_prealable: 1,
  permis_amenager: 3,
  permis_demolir: 2,
  permis_lotir: 3,
  certificat_urbanisme: 2,
};

import {
  computeInstructionDelay,
  applyMonthsToDate,
  type DeadlineMetadata,
  type DeadlineServitude,
  type DeadlineBreakdownItem,
} from "../services/instructionDelays.js";
import {
  changeDossierStatus,
  assignInstructeur,
  unassignInstructeur,
  autoAdvanceIfAllPiecesValid,
  WorkflowError,
  workflowErrorToHttp,
} from "../services/dossierWorkflow.js";
import {
  emitPieceComplementRequest,
  renderPieceListHtml,
  type PieceRequestItem,
} from "../services/pieceRequest.js";
import {
  nextStatuses,
  primaryNextAction,
  isTerminal,
  ASSIGNABLE_ROLES,
  type DossierStatus,
} from "@heureka-v1/shared";

// Façade legacy (call sites internes encore présents). Préférer computeInstructionDelay
// pour récupérer le breakdown auditable.
export function computeDelaiMois(
  type: string,
  metadata: DeadlineMetadata | null | undefined,
  servitudes: DeadlineServitude[] | null | undefined,
): number {
  return computeInstructionDelay(type, metadata, servitudes).total_mois;
}

// ── Dashboard stats ──
mairieRouter.get("/dashboard", async (req: AuthRequest, res) => {
  try {
    const commune = req.query.commune as string | undefined;
    const communeFilter = commune ? sql`commune ILIKE ${commune}` : sql`1=1`;

    const total = await db.select({ count: sql<number>`count(*)` }).from(dossiers).where(communeFilter);
    const parStatut = await db
      .select({ status: dossiers.status, count: sql<number>`count(*)` })
      .from(dossiers)
      .where(communeFilter)
      .groupBy(dossiers.status);

    const recent = await db
      .select()
      .from(dossiers)
      .where(communeFilter)
      .orderBy(desc(dossiers.updated_at))
      .limit(10);

    const pendingCount = await db
      .select({ count: sql<number>`count(*)` })
      .from(dossiers)
      .where(sql`status NOT IN ('accepte', 'refuse', 'brouillon') AND (${communeFilter})`);

    res.json({
      total_dossiers: Number(total[0]?.count ?? 0),
      dossiers_par_statut: parStatut.map((r) => ({ status: r.status, count: Number(r.count) })),
      dossiers_recents: recent,
      en_cours: Number(pendingCount[0]?.count ?? 0),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Liste tous les dossiers (mairie) ──
// Filtres supportés :
//   ?status=...     statut exact
//   ?search=...     recherche multi-champ
//   ?commune=...    restriction à une commune (ILIKE)
//   ?mine=true      dossiers assignés à l'utilisateur connecté
//   ?unassigned=true dossiers sans instructeur (boîte à trier)
// Le champ instructeur_id est renvoyé pour que l'UI puisse afficher l'agent
// en charge sans aller-retour supplémentaire.
mairieRouter.get("/dossiers", async (req: AuthRequest, res) => {
  try {
    const search = req.query.search as string | undefined;
    const status = req.query.status as string | undefined;
    const commune = req.query.commune as string | undefined;
    const mine = req.query.mine === "true" || req.query.mine === "1";
    const unassigned = req.query.unassigned === "true" || req.query.unassigned === "1";
    const communeFilter = commune ? sql`dossiers.commune ILIKE ${commune}` : sql`1=1`;
    const assignmentFilter = unassigned
      ? sql`dossiers.instructeur_id IS NULL`
      : mine && req.user?.id
        ? sql`dossiers.instructeur_id = ${req.user.id}`
        : sql`1=1`;

    const instructeurU = alias(users, "instructeur_user");
    const sel = {
      id: dossiers.id, numero: dossiers.numero, type: dossiers.type, status: dossiers.status,
      adresse: dossiers.adresse, commune: dossiers.commune, code_postal: dossiers.code_postal,
      parcelle: dossiers.parcelle, surface_plancher: dossiers.surface_plancher,
      description: dossiers.description, date_depot: dossiers.date_depot,
      date_completude: dossiers.date_completude,
      date_limite_instruction: dossiers.date_limite_instruction,
      date_delivrance: dossiers.date_delivrance,
      instructeur_id: dossiers.instructeur_id,
      created_at: dossiers.created_at,
      demandeur_prenom: users.prenom, demandeur_nom: users.nom,
      instructeur_prenom: instructeurU.prenom, instructeur_nom: instructeurU.nom,
    };

    let rows;
    if (search) {
      const pattern = `%${search}%`;
      rows = await db.select(sel).from(dossiers)
        .leftJoin(users, eq(dossiers.user_id, users.id))
        .leftJoin(instructeurU, eq(dossiers.instructeur_id, instructeurU.id))
        .where(sql`(${communeFilter}) AND (${assignmentFilter}) AND dossiers.status != 'brouillon' AND (dossiers.numero ILIKE ${pattern} OR dossiers.adresse ILIKE ${pattern} OR dossiers.commune ILIKE ${pattern} OR users.prenom ILIKE ${pattern} OR users.nom ILIKE ${pattern} OR CONCAT(users.prenom, ' ', users.nom) ILIKE ${pattern})`)
        .orderBy(desc(dossiers.created_at));
    } else if (status) {
      rows = await db.select(sel).from(dossiers)
        .leftJoin(users, eq(dossiers.user_id, users.id))
        .leftJoin(instructeurU, eq(dossiers.instructeur_id, instructeurU.id))
        .where(sql`(${communeFilter}) AND (${assignmentFilter}) AND dossiers.status = ${status}`)
        .orderBy(desc(dossiers.created_at));
    } else {
      rows = await db.select(sel).from(dossiers)
        .leftJoin(users, eq(dossiers.user_id, users.id))
        .leftJoin(instructeurU, eq(dossiers.instructeur_id, instructeurU.id))
        .where(sql`(${communeFilter}) AND (${assignmentFilter}) AND dossiers.status != 'brouillon'`)
        .orderBy(desc(dossiers.created_at));
    }

    res.json(rows.map(r => ({
      ...r,
      demandeur: [r.demandeur_prenom, r.demandeur_nom].filter(Boolean).join(" ") || "—",
      instructeur: [r.instructeur_prenom, r.instructeur_nom].filter(Boolean).join(" ") || null,
    })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Export CSV dossiers ──
mairieRouter.get("/dossiers/export", async (req: AuthRequest, res) => {
  try {
    const commune = req.query.commune as string | undefined;
    const communeFilter = commune ? sql`dossiers.commune ILIKE ${commune}` : sql`1=1`;

    const rows = await db.select({
      id: dossiers.id, numero: dossiers.numero, type: dossiers.type, status: dossiers.status,
      adresse: dossiers.adresse, commune: dossiers.commune, code_postal: dossiers.code_postal,
      parcelle: dossiers.parcelle, description: dossiers.description,
      surface_plancher: dossiers.surface_plancher,
      date_depot: dossiers.date_depot, date_completude: dossiers.date_completude,
      date_limite_instruction: dossiers.date_limite_instruction,
      is_tacite: dossiers.is_tacite, created_at: dossiers.created_at, updated_at: dossiers.updated_at,
      demandeur_prenom: users.prenom, demandeur_nom: users.nom, demandeur_email: users.email,
    })
      .from(dossiers)
      .leftJoin(users, eq(dossiers.user_id, users.id))
      .where(communeFilter)
      .orderBy(desc(dossiers.created_at));

    const esc = (v: unknown): string => {
      if (v === null || v === undefined) return "";
      const s = v instanceof Date ? v.toISOString() : String(v);
      return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
    };

    const headers = [
      "Numéro", "Type", "Statut", "Pétitionnaire", "Email", "Adresse", "Commune",
      "Code postal", "Parcelle", "Surface plancher", "Description",
      "Date dépôt", "Date complétude", "Date limite instruction",
      "Tacite", "Créé le", "Mis à jour le",
    ];

    const csvRows = rows.map(r => [
      r.numero, r.type, r.status,
      [r.demandeur_prenom, r.demandeur_nom].filter(Boolean).join(" "),
      r.demandeur_email,
      r.adresse, r.commune, r.code_postal, r.parcelle, r.surface_plancher, r.description,
      r.date_depot, r.date_completude, r.date_limite_instruction,
      r.is_tacite ? "oui" : "non",
      r.created_at, r.updated_at,
    ].map(esc).join(","));

    const csv = [headers.join(","), ...csvRows].join("\n");
    const filename = `dossiers-${commune ?? "all"}-${new Date().toISOString().slice(0, 10)}.csv`;

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    // BOM for Excel compatibility (UTF-8)
    res.send("﻿" + csv);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Détail dossier mairie ──
// Renvoie aussi les actions de workflow disponibles (prochaine étape, transitions
// admissibles, possibilité de prise en charge) pour que le front affiche un seul
// CTA contextuel sans avoir à recoder la machine à états côté client.
mairieRouter.get("/dossiers/:id", async (req: AuthRequest, res) => {
  try {
    const [dossier] = await db
      .select()
      .from(dossiers)
      .where(eq(dossiers.id, req.params.id as string))
      .limit(1);
    if (!dossier) return res.status(404).json({ error: "Dossier non trouvé" });
    const [demandeur] = await db
      .select({ id: users.id, prenom: users.prenom, nom: users.nom, email: users.email })
      .from(users)
      .where(eq(users.id, dossier.user_id))
      .limit(1);
    let instructeur = null;
    if (dossier.instructeur_id) {
      const [inst] = await db
        .select({ id: users.id, prenom: users.prenom, nom: users.nom, email: users.email })
        .from(users)
        .where(eq(users.id, dossier.instructeur_id))
        .limit(1);
      instructeur = inst ?? null;
    }

    const status = dossier.status as DossierStatus;
    const role = req.user?.role ?? "instructeur";
    const userId = req.user?.id ?? null;
    const isAssigned = !!dossier.instructeur_id;
    const isMine = isAssigned && dossier.instructeur_id === userId;
    const canManageAssignment = (role === "mairie" || role === "admin") && !isTerminal(status);

    const workflow = {
      status,
      next_action: primaryNextAction(status),
      allowed_transitions: nextStatuses(status),
      // Actions liées à l'assignation, déjà filtrées par rôle pour que le
      // front n'ait qu'à les afficher ou non. La (ré)assignation est désactivée
      // sur les dossiers clos (accepté / refusé / accord avec prescriptions).
      can_take_charge: !isAssigned && ASSIGNABLE_ROLES.has(role) && status !== "brouillon" && !isTerminal(status),
      can_reassign: canManageAssignment,
      can_unassign: canManageAssignment && isAssigned,
      is_mine: isMine,
    };

    res.json({ ...dossier, demandeur: demandeur ?? null, instructeur, workflow });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Chronologie : événements d'instruction d'un dossier (mairie) ──
// Renvoie les instruction_events enrichis du nom de l'acteur quand
// l'utilisateur existe encore dans la base.
mairieRouter.get("/dossiers/:id/events", async (req: AuthRequest, res) => {
  try {
    const events = await db
      .select()
      .from(instruction_events)
      .where(eq(instruction_events.dossier_id, req.params.id as string))
      .orderBy(desc(instruction_events.created_at));

    const userIds = Array.from(new Set(events.map((e) => e.user_id).filter((u): u is string => !!u)));
    const userMap = new Map<string, { nom: string | null; prenom: string | null; role: string | null }>();
    if (userIds.length > 0) {
      const rows = await db
        .select({ id: users.id, nom: users.nom, prenom: users.prenom, role: users.role })
        .from(users)
        .where(inArray(users.id, userIds));
      for (const r of rows) {
        userMap.set(r.id, { nom: r.nom, prenom: r.prenom, role: r.role });
      }
    }

    res.json(events.map((e) => {
      const u = e.user_id ? userMap.get(e.user_id) : undefined;
      const actor = u ? [u.prenom, u.nom].filter(Boolean).join(" ").trim() : null;
      return { ...e, actor_name: actor || null, actor_role: u?.role ?? null };
    }));
  } catch (err) {
    console.error("[events]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Pièces déposées d'un dossier (vue mairie) ──
mairieRouter.get("/dossiers/:id/pieces", async (req: AuthRequest, res) => {
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

// ── Annotation d'une pièce par l'instructeur ──
// Permet de poser un statut (valide | rejete | complement_demande | null) et
// une note libre. Chaque transition génère un instruction_event pour le suivi
// de la procédure.
mairieRouter.patch("/dossiers/:id/pieces/:pieceId/annotation", async (req: AuthRequest, res) => {
  try {
    const body = (req.body ?? {}) as { status?: string | null; note?: string | null };
    const VALID_STATUSES = new Set(["valide", "rejete", "complement_demande", null]);
    const rawStatus = body.status === undefined ? undefined : (body.status === "" ? null : body.status);
    const rawNote = body.note === undefined ? undefined : (body.note === null ? null : String(body.note));
    if (rawStatus !== undefined && !VALID_STATUSES.has(rawStatus as string | null)) {
      return res.status(400).json({ error: "Statut invalide" });
    }

    const [piece] = await db
      .select()
      .from(dossier_pieces_jointes)
      .where(and(
        eq(dossier_pieces_jointes.id, req.params.pieceId as string),
        eq(dossier_pieces_jointes.dossier_id, req.params.id as string),
      ))
      .limit(1);
    if (!piece) return res.status(404).json({ error: "Pièce non trouvée" });

    const statusChanged = rawStatus !== undefined && rawStatus !== piece.instructeur_status;
    const noteChanged = rawNote !== undefined && (rawNote ?? null) !== (piece.instructeur_note ?? null);
    if (!statusChanged && !noteChanged) {
      return res.json(piece);
    }

    const patch: Record<string, unknown> = {};
    if (rawStatus !== undefined) {
      patch.instructeur_status = rawStatus;
      patch.instructeur_status_at = new Date();
      patch.instructeur_status_by = req.user?.id ?? null;
    }
    if (rawNote !== undefined) {
      patch.instructeur_note = rawNote && rawNote.trim() ? rawNote.trim() : null;
    }

    const [updated] = await db
      .update(dossier_pieces_jointes)
      .set(patch)
      .where(eq(dossier_pieces_jointes.id, piece.id))
      .returning();

    // Trace dans la chronologie d'instruction.
    if (statusChanged && updated) {
      const TYPE_MAP: Record<string, string> = {
        valide: "piece_validee",
        rejete: "piece_rejetee",
        complement_demande: "piece_complement_demande",
      };
      const evType = rawStatus == null ? "piece_statut_efface" : (TYPE_MAP[rawStatus as string] ?? "piece_statut_modifie");
      const DESC_MAP: Record<string, string> = {
        valide: `Pièce validée : ${updated.nom}`,
        rejete: `Pièce rejetée : ${updated.nom}`,
        complement_demande: `Complément demandé pour : ${updated.nom}`,
      };
      const description = rawStatus == null
        ? `Statut effacé pour : ${updated.nom}`
        : (DESC_MAP[rawStatus as string] ?? `Pièce mise à jour : ${updated.nom}`);
      await db.insert(instruction_events).values({
        dossier_id: piece.dossier_id,
        type: evType,
        user_id: req.user?.id ?? null,
        description,
        metadata: {
          piece_id: piece.id,
          code_piece: piece.code_piece ?? null,
          previous_status: piece.instructeur_status ?? null,
          new_status: rawStatus ?? null,
          note: rawNote ?? piece.instructeur_note ?? null,
        },
      });
    }

    // Auto-bascule pre_instruction → en_instruction si la dernière pièce
    // restante vient d'être validée. Best-effort : on n'échoue jamais la
    // route d'annotation pour un problème de transition.
    if (statusChanged && rawStatus === "valide") {
      try {
        await autoAdvanceIfAllPiecesValid(piece.dossier_id, req.user?.id ?? null);
      } catch (e) {
        console.warn("[pieces/annotation] autoAdvance:", e);
      }
    }

    res.json(updated);
  } catch (err) {
    console.error("[pieces/annotation]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Re-extraction d'une pièce (mairie) ──
// Utile quand l'extraction a échoué au dépôt ou quand on a amélioré le prompt.
// Renvoie l'extraction mise à jour ; ne touche pas à analyse_ia.
mairieRouter.post("/dossiers/:id/pieces/:pieceId/extract", async (req: AuthRequest, res) => {
  try {
    const [piece] = await db
      .select()
      .from(dossier_pieces_jointes)
      .where(and(
        eq(dossier_pieces_jointes.id, req.params.pieceId as string),
        eq(dossier_pieces_jointes.dossier_id, req.params.id as string),
      ))
      .limit(1);
    if (!piece) return res.status(404).json({ error: "Pièce non trouvée" });

    const filename = piece.url.split("/").pop();
    if (!filename) return res.status(404).json({ error: "Fichier non localisable" });
    const filePath = path.join(UPLOADS_DIR_MAIRIE, filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: "Fichier non trouvé sur le disque" });

    const communeIdForPiece = await resolveCommuneIdFromUser(req);
    const extraction = await extractPiece(filePath, piece.type, {
      expected_type: expectedTypeFromCode(piece.code_piece),
      nom_piece: piece.nom,
      code_piece: piece.code_piece ?? "",
    }, { dossierId: req.params.id as string, userId: req.user?.id ?? null, communeId: communeIdForPiece });
    if (!extraction) {
      return res.status(422).json({ error: "Extraction impossible (format non supporté ou fichier trop volumineux)" });
    }

    await db
      .update(dossier_pieces_jointes)
      .set({ extraction_ia: extraction })
      .where(eq(dossier_pieces_jointes.id, piece.id));

    res.json(extraction);
  } catch (err) {
    console.error("[pieces/extract]", err);
    res.status(500).json({ error: "Erreur serveur lors de l'extraction" });
  }
});

// ── Analyse de conformité : récupération du dernier rapport ──
mairieRouter.get("/dossiers/:id/conformite", async (req: AuthRequest, res) => {
  try {
    const [row] = await db
      .select({
        analysis: dossiers.conformite_analysis,
        status: dossiers.conformite_status,
        analyzed_at: dossiers.conformite_analyzed_at,
      })
      .from(dossiers)
      .where(eq(dossiers.id, req.params.id as string))
      .limit(1);
    if (!row) return res.status(404).json({ error: "Dossier non trouvé" });
    res.json({
      status: row.status ?? "absent",
      analyzed_at: row.analyzed_at,
      report: row.analysis as ConformiteReport | null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Analyse de conformité : déclencher / relancer ──
// async=true (défaut) lance en tâche de fond et renvoie 202. async=false attend
// la fin et renvoie le rapport (utile pour tests / petits dossiers).
mairieRouter.post("/dossiers/:id/conformite/analyse", async (req: AuthRequest, res) => {
  try {
    const dossierId = req.params.id as string;
    const [d] = await db.select({
      id: dossiers.id,
      status: dossiers.conformite_status,
    }).from(dossiers).where(eq(dossiers.id, dossierId)).limit(1);
    if (!d) return res.status(404).json({ error: "Dossier non trouvé" });
    if (d.status === "running") {
      return res.status(409).json({ error: "Une analyse est déjà en cours pour ce dossier" });
    }

    const wantSync = req.body?.sync === true;
    if (wantSync) {
      const report = await runDossierConformityAnalysis(dossierId);
      return res.json({ status: "done", report });
    }
    // Marquage immédiat "pending" pour que l'UI sache que c'est lancé,
    // puis exécution en tâche de fond.
    await db
      .update(dossiers)
      .set({ conformite_status: "pending", updated_at: new Date() })
      .where(eq(dossiers.id, dossierId));
    runDossierConformityAnalysisBackground(dossierId);
    res.status(202).json({ status: "pending" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Erreur serveur" });
  }
});

// ── Changer le statut d'un dossier ──
// La transition est validée par la machine à états partagée
// (packages/shared/dossierWorkflow.ts) et journalisée dans instruction_events
// via le service workflow. Cette route gère également deux effets de bord
// historiques : pose de date_depot au passage "soumis" et calcul automatique
// de la date limite d'instruction si elle n'est pas déjà fixée.
mairieRouter.patch("/dossiers/:id/status", async (req: AuthRequest, res) => {
  try {
    const { status, reason } = (req.body ?? {}) as { status?: string; reason?: string | null };
    if (!status) return res.status(400).json({ error: "Statut requis" });

    const dossierId = req.params.id as string;
    const [before] = await db.select().from(dossiers).where(eq(dossiers.id, dossierId)).limit(1);
    if (!before) return res.status(404).json({ error: "Dossier non trouvé" });

    // 1) Transition de statut via la machine à états (refuse si interdite).
    await changeDossierStatus(dossierId, status as DossierStatus, req.user?.id ?? null, { reason: reason ?? null });

    // 2) Effets de bord : date de dépôt + recalcul d'échéance.
    const sideEffects: Partial<typeof before> & { updated_at?: Date } = {};
    let needsSideEffectUpdate = false;
    if (status === "soumis" && !before.date_depot) {
      sideEffects.date_depot = new Date();
      needsSideEffectUpdate = true;
    }
    if (!before.date_limite_instruction) {
      const startDate = (before.date_completude ?? sideEffects.date_depot ?? before.date_depot);
      if (startDate) {
        const meta = (before.metadata as DeadlineMetadata | null) ?? null;
        const servitudes = (meta as { servitudes?: DeadlineServitude[] } | null)?.servitudes ?? null;
        const calc = computeInstructionDelay(before.type, meta, servitudes);
        sideEffects.date_limite_instruction = applyMonthsToDate(new Date(startDate), calc.total_mois);
        sideEffects.metadata = {
          ...((before.metadata as Record<string, unknown>) ?? {}),
          delai: {
            total_mois: calc.total_mois,
            breakdown: calc.breakdown,
            base_date: new Date(startDate).toISOString(),
            base_date_source: before.date_completude ? "completude" : "depot",
            computed_at: new Date().toISOString(),
          },
        };
        needsSideEffectUpdate = true;
      }
    }
    if (needsSideEffectUpdate) {
      sideEffects.updated_at = new Date();
      await db.update(dossiers).set(sideEffects).where(eq(dossiers.id, dossierId));
    }

    const [updated] = await db.select().from(dossiers).where(eq(dossiers.id, dossierId)).limit(1);
    res.json(updated);
  } catch (err) {
    if (err instanceof WorkflowError) {
      const { status, body } = workflowErrorToHttp(err);
      return res.status(status).json(body);
    }
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Recalcul ou réécriture de la date d'échéance d'UN dossier ──
// PATCH /mairie/dossiers/:id/deadline
// Corps :
//   { date_completude?: "YYYY-MM-DD" | null }   → met à jour la date de
//      complétude. L'échéance est recalculée automatiquement à partir d'elle.
//   { date_limite_instruction?: "YYYY-MM-DD" }  → override manuel (rare,
//      utilisé pour des prolongations notifiées au pétitionnaire).
//   { recompute: true }                         → recalcule à partir des
//      règles légales en cours, en repartant de date_completude ?? date_depot.
mairieRouter.patch("/dossiers/:id/deadline", async (req: AuthRequest, res) => {
  try {
    const body = (req.body ?? {}) as {
      date_completude?: string | null;
      date_limite_instruction?: string | null;
      recompute?: boolean;
    };

    const [before] = await db
      .select()
      .from(dossiers)
      .where(eq(dossiers.id, req.params.id as string))
      .limit(1);
    if (!before) return res.status(404).json({ error: "Dossier non trouvé" });

    const patch: Record<string, unknown> = { updated_at: new Date() };

    // 1. Mise à jour éventuelle de date_completude
    if (body.date_completude !== undefined) {
      patch.date_completude = body.date_completude ? new Date(body.date_completude) : null;
    }
    const effectiveCompletude = (body.date_completude !== undefined ? patch.date_completude : before.date_completude) as Date | null;

    // 2. Override manuel de la deadline (priorité absolue)
    if (body.date_limite_instruction !== undefined) {
      patch.date_limite_instruction = body.date_limite_instruction ? new Date(body.date_limite_instruction) : null;
    } else if (body.recompute || body.date_completude !== undefined) {
      // 3. Recalcul automatique
      const startDate = effectiveCompletude ?? before.date_depot;
      if (startDate) {
        const meta = (before.metadata as DeadlineMetadata | null) ?? null;
        const servitudes = (meta as { servitudes?: DeadlineServitude[] } | null)?.servitudes ?? null;
        const calc = computeInstructionDelay(before.type, meta, servitudes);
        patch.date_limite_instruction = applyMonthsToDate(new Date(startDate), calc.total_mois);
        patch.metadata = {
          ...((before.metadata as Record<string, unknown>) ?? {}),
          delai: {
            total_mois: calc.total_mois,
            breakdown: calc.breakdown,
            base_date: new Date(startDate).toISOString(),
            base_date_source: effectiveCompletude ? "completude" : "depot",
            computed_at: new Date().toISOString(),
          },
        };
      }
    }

    const [updated] = await db.update(dossiers).set(patch).where(eq(dossiers.id, before.id)).returning();
    res.json(updated);
  } catch (err) {
    console.error("[deadline]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Assigner / réassigner un instructeur ──
// Réservé aux rôles mairie/admin : un instructeur n'a pas le droit d'imposer
// un autre instructeur sur le dossier (il peut uniquement s'auto-prendre en
// charge via /take-charge).
mairieRouter.patch("/dossiers/:id/assign", requireRole("mairie", "admin"), async (req: AuthRequest, res) => {
  try {
    const { instructeur_id, reason } = (req.body ?? {}) as { instructeur_id?: string; reason?: string | null };
    if (!instructeur_id) return res.status(400).json({ error: "instructeur_id requis" });
    await assignInstructeur(req.params.id as string, instructeur_id, req.user?.id ?? null, { reason: reason ?? null });
    const [dossier] = await db.select().from(dossiers).where(eq(dossiers.id, req.params.id as string)).limit(1);
    res.json(dossier);
  } catch (err) {
    if (err instanceof WorkflowError) {
      const { status, body } = workflowErrorToHttp(err);
      return res.status(status).json(body);
    }
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Retirer l'instructeur d'un dossier ──
mairieRouter.delete("/dossiers/:id/assign", requireRole("mairie", "admin"), async (req: AuthRequest, res) => {
  try {
    const { reason } = (req.body ?? {}) as { reason?: string | null };
    await unassignInstructeur(req.params.id as string, req.user?.id ?? null, { reason: reason ?? null });
    const [dossier] = await db.select().from(dossiers).where(eq(dossiers.id, req.params.id as string)).limit(1);
    res.json(dossier);
  } catch (err) {
    if (err instanceof WorkflowError) {
      const { status, body } = workflowErrorToHttp(err);
      return res.status(status).json(body);
    }
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Prise en charge (self-assign) ──
// Ouvert à tout rôle assignable (instructeur, mairie, admin). Si le dossier
// est encore "soumis", on enchaîne sur la transition pre_instruction qui démarre
// formellement l'instruction. Toute autre transition reste manuelle.
mairieRouter.post("/dossiers/:id/take-charge", async (req: AuthRequest, res) => {
  try {
    const role = req.user?.role ?? "";
    if (!ASSIGNABLE_ROLES.has(role)) {
      return res.status(403).json({ error: "Rôle non autorisé à prendre en charge un dossier" });
    }
    const dossierId = req.params.id as string;
    const [before] = await db.select().from(dossiers).where(eq(dossiers.id, dossierId)).limit(1);
    if (!before) return res.status(404).json({ error: "Dossier non trouvé" });
    if (before.instructeur_id && before.instructeur_id !== req.user!.id) {
      return res.status(409).json({ error: "Dossier déjà assigné à un autre instructeur" });
    }

    await assignInstructeur(dossierId, req.user!.id, req.user!.id, { reason: "prise en charge" });

    // Démarrage formel de l'instruction : soumis → pre_instruction. Toute
    // autre transition reste à la main de l'instructeur.
    if (before.status === "soumis") {
      await changeDossierStatus(dossierId, "pre_instruction", req.user!.id, { reason: "prise en charge" });
    }

    const [updated] = await db.select().from(dossiers).where(eq(dossiers.id, dossierId)).limit(1);
    res.json(updated);
  } catch (err) {
    if (err instanceof WorkflowError) {
      const { status, body } = workflowErrorToHttp(err);
      return res.status(status).json(body);
    }
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Demande de pièces complémentaires : émission ──
// L'instructeur choisit les pièces (déjà déposées ou totalement absentes),
// éventuellement les articles juridiques cités, puis émet le courrier.
// Effets :
//   - création d'une ligne dans dossier_courriers (snapshot du contenu)
//   - bascule des pièces sélectionnées en "complement_demande"
//   - transition du dossier vers "incomplet" via la machine à états
//   - event tracé dans la chronologie d'instruction
mairieRouter.post("/dossiers/:id/courriers/pieces-complementaires", async (req: AuthRequest, res) => {
  try {
    const dossierId = req.params.id as string;
    const body = (req.body ?? {}) as {
      pieces?: PieceRequestItem[];
      articles_cites?: string[];
      body_snapshot?: string | null;
      subject?: string | null;
      delivery_method?: string | null;
    };

    if (!Array.isArray(body.pieces) || body.pieces.length === 0) {
      return res.status(400).json({ error: "Au moins une pièce doit être sélectionnée" });
    }
    // Sécurise les entrées libres : on accepte seulement nom + raison + flags
    // attendus, pas d'HTML brut. Un nom vide est invalide.
    const cleaned: PieceRequestItem[] = body.pieces
      .filter((p) => p && typeof p === "object" && typeof p.nom === "string" && p.nom.trim().length > 0)
      .map((p) => ({
        piece_id: typeof p.piece_id === "string" ? p.piece_id : undefined,
        code_piece: typeof p.code_piece === "string" ? p.code_piece : undefined,
        nom: p.nom.trim(),
        raison: typeof p.raison === "string" && p.raison.trim() ? p.raison.trim() : undefined,
        manquante: p.manquante === true || !p.piece_id,
      }));
    if (cleaned.length === 0) {
      return res.status(400).json({ error: "Aucune pièce valide dans la sélection" });
    }
    const articles = Array.isArray(body.articles_cites) ? body.articles_cites.filter((a) => typeof a === "string") : [];

    const result = await emitPieceComplementRequest({
      dossier_id: dossierId,
      pieces: cleaned,
      articles_cites: articles,
      body_snapshot: body.body_snapshot ?? null,
      subject: body.subject ?? null,
      delivery_method: body.delivery_method ?? null,
      emis_par: req.user!.id,
    });
    res.status(201).json(result);
  } catch (err) {
    console.error("[courriers/pieces-complementaires]", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Erreur serveur" });
  }
});

// ── Aperçu rapide du bloc HTML "pièces à compléter" ──
// Permet à l'UI de pré-visualiser la liste qui sera substituée à
// {liste_pieces_a_completer} dans le template, SANS émettre le courrier.
mairieRouter.post("/dossiers/:id/courriers/pieces-complementaires/preview", async (req: AuthRequest, res) => {
  const body = (req.body ?? {}) as { pieces?: PieceRequestItem[] };
  const pieces = Array.isArray(body.pieces) ? body.pieces.filter((p) => p && typeof p.nom === "string" && p.nom.trim()) : [];
  res.json({ html: renderPieceListHtml(pieces) });
});

// ── Liste des courriers émis pour un dossier ──
mairieRouter.get("/dossiers/:id/courriers", async (req: AuthRequest, res) => {
  try {
    const rows = await db
      .select({
        id: dossier_courriers.id,
        type: dossier_courriers.type,
        subject: dossier_courriers.subject,
        pieces_jointes_ids: dossier_courriers.pieces_jointes_ids,
        articles_cites: dossier_courriers.articles_cites,
        emis_par: dossier_courriers.emis_par,
        emis_le: dossier_courriers.emis_le,
        delivery_method: dossier_courriers.delivery_method,
      })
      .from(dossier_courriers)
      .where(eq(dossier_courriers.dossier_id, req.params.id as string))
      .orderBy(desc(dossier_courriers.emis_le));
    res.json(rows);
  } catch (err) {
    console.error("[courriers list]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Statistiques ──
mairieRouter.get("/stats", async (_req: AuthRequest, res) => {
  try {
    const total = await db.select({ count: sql<number>`count(*)` }).from(dossiers);
    const parType = await db
      .select({ type: dossiers.type, count: sql<number>`count(*)` })
      .from(dossiers)
      .groupBy(dossiers.type);
    const parMois = await db
      .select({
        mois: sql<string>`to_char(date_depot, 'YYYY-MM')`,
        count: sql<number>`count(*)`,
      })
      .from(dossiers)
      .where(sql`date_depot IS NOT NULL`)
      .groupBy(sql`1`)
      .orderBy(sql`1`);

    res.json({
      total: Number(total[0]?.count ?? 0),
      par_type: parType,
      par_mois: parMois,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Liste des instructeurs ──
mairieRouter.get("/instructeurs", async (_req: AuthRequest, res) => {
  try {
    const instructeurs = await db
      .select({ id: users.id, prenom: users.prenom, nom: users.nom, email: users.email })
      .from(users)
      .where(sql`role IN ('instructeur', 'mairie', 'admin')`);
    res.json(instructeurs);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Communes de l'utilisateur connecté ──
// Admin : voit toutes les communes en DB (cohérent avec son rôle "voit tout").
// Mairie/instructeur : restreint via user_communes, sinon fallback sur la
// commune principale.
mairieRouter.get("/my-communes", async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const role = req.user!.role;

    if (role === "admin") {
      const all = await db
        .select({ name: communes.name, insee_code: communes.insee_code })
        .from(communes)
        .orderBy(communes.name);
      return res.json(all);
    }

    const rows = await db
      .select({ name: communes.name, insee_code: communes.insee_code })
      .from(user_communes)
      .innerJoin(communes, eq(user_communes.commune_id, communes.id))
      .where(eq(user_communes.user_id, userId))
      .orderBy(communes.name);
    if (rows.length > 0) return res.json(rows);
    // Fallback: commune principale de l'utilisateur
    const [user] = await db.select({ commune: users.commune, commune_insee: users.commune_insee })
      .from(users).where(eq(users.id, userId)).limit(1);
    if (user?.commune) return res.json([{ name: user.commune, insee_code: user.commune_insee ?? null }]);
    res.json([]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Liste des communes (noms seuls pour le sélecteur) ──
// Filtré par utilisateur sauf pour les admins : un user mairie/instructeur ne
// doit voir QUE les communes auxquelles il a accès (sinon le sélecteur de la
// Carte montrait toute la France et permettait de "sélectionner" une commune
// hors de ses droits → refresh = retour sur sa commune principale par défaut).
mairieRouter.get("/communes", async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const role = req.user!.role;

    if (role === "admin") {
      const rows = await db.select({ name: communes.name }).from(communes).orderBy(communes.name);
      const names = rows.map(r => r.name);
      if (names.length) return res.json(names);
      const fallback = await db.selectDistinct({ commune: dossiers.commune }).from(dossiers).where(sql`commune IS NOT NULL`).orderBy(dossiers.commune);
      return res.json(fallback.map(r => r.commune).filter(Boolean));
    }

    // Mairie / instructeur : restreindre aux communes liées via user_communes,
    // sinon fallback sur la commune principale du user.
    const linked = await db
      .select({ name: communes.name })
      .from(user_communes)
      .innerJoin(communes, eq(user_communes.commune_id, communes.id))
      .where(eq(user_communes.user_id, userId))
      .orderBy(communes.name);
    if (linked.length > 0) return res.json(linked.map(r => r.name));

    const [user] = await db.select({ commune: users.commune }).from(users).where(eq(users.id, userId)).limit(1);
    res.json(user?.commune ? [user.commune] : []);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Liste des communes avec code INSEE (pour la carte et le sélecteur) ──
mairieRouter.get("/commune-list", async (_req: AuthRequest, res) => {
  try {
    const rows = await db.select({
      name: communes.name,
      insee_code: communes.insee_code,
      zip_code: communes.zip_code,
    }).from(communes).orderBy(communes.name);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Lookup INSEE via geo.api.gouv.fr (évite CORS côté navigateur) ──
mairieRouter.get("/admin/insee-lookup", async (req: AuthRequest, res) => {
  try {
    const nom = (req.query.nom as string ?? "").trim();
    if (nom.length < 2) return res.status(400).json({ error: "Nom requis (min 2 caractères)" });
    const r = await fetch(
      `https://geo.api.gouv.fr/communes?nom=${encodeURIComponent(nom)}&fields=code,nom,codesPostaux,departement,region&limit=8&boost=population`,
      { signal: AbortSignal.timeout(6000) }
    );
    if (!r.ok) return res.status(502).json({ error: "geo.api.gouv.fr indisponible" });
    const data = await r.json() as Array<{
      code: string; nom: string;
      codesPostaux?: string[];
      departement?: { nom: string; code: string };
      region?: { nom: string; code: string };
    }>;
    res.json(data.map(c => ({
      nom: c.nom,
      insee: c.code,
      zip: c.codesPostaux?.[0] ?? null,
      departement: c.departement ? `${c.departement.nom} (${c.departement.code})` : null,
      region: c.region?.nom ?? null,
    })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Détails d'une commune (onglet Général) ──
mairieRouter.get("/admin/commune-details", async (req: AuthRequest, res) => {
  try {
    const communeName = (req.query.commune as string ?? "").trim();
    if (!communeName) return res.status(400).json({ error: "Paramètre commune requis" });
    const [row] = await db.select().from(communes).where(ilike(communes.name, communeName));
    if (!row) return res.status(404).json({ error: "Commune non trouvée" });
    res.json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Mise à jour d'une commune (admin uniquement) ──
mairieRouter.patch("/admin/commune-details", requireRole("admin"), async (req: AuthRequest, res) => {
  try {
    const communeName = (req.query.commune as string ?? "").trim();
    if (!communeName) return res.status(400).json({ error: "Paramètre commune requis" });
    const { email, telephone, logo_url, population, surface, departement, region, description } = req.body as Record<string, string | undefined>;
    await db.update(communes)
      .set({ email: email ?? null, telephone: telephone ?? null, logo_url: logo_url ?? null,
             population: population ?? null, surface: surface ?? null,
             departement: departement ?? null, region: region ?? null,
             description: description ?? null, updated_at: new Date() })
      .where(ilike(communes.name, communeName));
    const [updated] = await db.select().from(communes).where(ilike(communes.name, communeName));
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Ajout d'une commune (admin, onboarding) ──
mairieRouter.post("/admin/communes", requireRole("admin"), async (req: AuthRequest, res) => {
  try {
    const { name, insee_code, zip_code, email, telephone, population, surface, departement, region, description } = req.body as Record<string, string | undefined>;
    if (!name || !insee_code) return res.status(400).json({ error: "name et insee_code requis" });
    const [row] = await db.insert(communes).values({
      name, insee_code, zip_code: zip_code ?? null,
      email: email ?? null, telephone: telephone ?? null,
      population: population ?? null, surface: surface ?? null,
      departement: departement ?? null, region: region ?? null,
      description: description ?? null,
    }).onConflictDoUpdate({
      target: communes.insee_code,
      set: { name, zip_code: zip_code ?? null, updated_at: new Date() },
    }).returning();
    res.status(201).json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Liste des utilisateurs d'une commune ──
mairieRouter.get("/admin/users", async (req: AuthRequest, res) => {
  try {
    const communeName = (req.query.commune as string ?? "").trim();
    if (!communeName) return res.status(400).json({ error: "Paramètre commune requis" });
    const rows = await db.select({
      id: users.id, email: users.email, prenom: users.prenom, nom: users.nom,
      role: users.role, commune: users.commune, telephone: users.telephone,
      role_config_id: users.role_config_id,
      created_at: users.created_at,
    }).from(users).where(ilike(users.commune, communeName));
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Création d'un utilisateur (admin ou mairie pour leur commune) ──
mairieRouter.post("/admin/users", requireRole("mairie", "admin"), async (req: AuthRequest, res) => {
  try {
    // "mairie" users can only create agents for their own commune
    const communeName = req.user?.role === "admin"
      ? (req.query.commune as string ?? "").trim()
      : (req.user?.commune ?? "");
    const { email, prenom, nom, role, telephone, role_config_id } = req.body as Record<string, string | undefined>;
    if (!email || !prenom || !nom || !role) return res.status(400).json({ error: "email, prenom, nom, role requis" });
    const validRoles = req.user?.role === "admin" ? ["mairie", "instructeur", "admin"] : ["mairie", "instructeur"];
    if (!validRoles.includes(role)) return res.status(400).json({ error: "Rôle invalide" });
    const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email.toLowerCase().trim()));
    if (existing) return res.status(409).json({ error: "Un compte avec cet email existe déjà" });
    const { default: bcrypt } = await import("bcryptjs");
    const { randomBytes } = await import("crypto");
    const { sendActivationEmail } = await import("../services/mailer.js");
    const { password_tokens } = await import("@heureka-v1/db");
    const hash = await bcrypt.hash(randomBytes(32).toString("hex"), 10);
    const [newUser] = await db.insert(users).values({
      email: email.toLowerCase().trim(), prenom, nom,
      role: role as "mairie" | "instructeur" | "admin",
      commune: communeName || null, telephone: telephone ?? null,
      password_hash: hash,
      role_config_id: role_config_id ?? null,
    }).returning({ id: users.id, email: users.email, prenom: users.prenom, nom: users.nom, role: users.role, commune: users.commune, role_config_id: users.role_config_id });
    const token = randomBytes(32).toString("hex");
    await db.insert(password_tokens).values({
      user_id: newUser!.id,
      token,
      type: "activation",
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });
    await sendActivationEmail({
      to: email.toLowerCase().trim(),
      prenom,
      serviceName: communeName || "Heurekia",
      token,
    }).catch((err) => console.error("[mailer] invitation:", err));
    res.status(201).json({ ...newUser, invited: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Mise à jour rôle/infos d'un utilisateur (admin ou mairie pour leur commune) ──
mairieRouter.patch("/admin/users/:id", requireRole("mairie", "admin"), async (req: AuthRequest, res) => {
  try {
    const userId = req.params.id as string;
    const { role, prenom, nom, telephone, role_config_id } = req.body as Record<string, string | undefined>;
    // "mairie" users can only update agents in their commune
    if (req.user?.role === "mairie") {
      const [target] = await db.select({ commune: users.commune }).from(users).where(eq(users.id, userId));
      if (!target || target.commune?.toLowerCase() !== (req.user.commune ?? "").toLowerCase()) {
        return res.status(403).json({ error: "Accès refusé" });
      }
    }
    const validRoles = req.user?.role === "admin" ? ["mairie", "instructeur", "admin", "citoyen"] : ["mairie", "instructeur"];
    if (role && !validRoles.includes(role)) return res.status(400).json({ error: "Rôle invalide" });
    await db.update(users).set({
      ...(role ? { role: role as "mairie" | "instructeur" | "admin" | "citoyen" } : {}),
      ...(prenom ? { prenom } : {}),
      ...(nom ? { nom } : {}),
      ...(telephone !== undefined ? { telephone } : {}),
      ...(role_config_id !== undefined ? { role_config_id: role_config_id || null } : {}),
      updated_at: new Date(),
    }).where(eq(users.id, userId));
    const [updated] = await db.select({
      id: users.id, email: users.email, prenom: users.prenom, nom: users.nom,
      role: users.role, commune: users.commune, telephone: users.telephone,
      role_config_id: users.role_config_id,
    }).from(users).where(eq(users.id, userId));
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Suppression d'un utilisateur (admin ou mairie pour leur commune) ──
mairieRouter.delete("/admin/users/:id", requireRole("mairie", "admin"), async (req: AuthRequest, res) => {
  try {
    const reqUser = req.user as { id: string; role: string; commune?: string };
    const userId = req.params.id as string;
    if (userId === reqUser.id) return res.status(400).json({ error: "Vous ne pouvez pas supprimer votre propre compte" });
    // "mairie" users can only delete agents in their commune
    if (reqUser.role === "mairie") {
      const [target] = await db.select({ commune: users.commune }).from(users).where(eq(users.id, userId));
      if (!target || target.commune?.toLowerCase() !== (reqUser.commune ?? "").toLowerCase()) {
        return res.status(403).json({ error: "Accès refusé" });
      }
    }
    await db.delete(users).where(eq(users.id, userId));
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Dossiers géolocalisés pour la carte ──
mairieRouter.get("/map-dossiers", async (req: AuthRequest, res) => {
  try {
    const commune = req.query.commune as string | undefined;

    const rows = await db
      .select({
        id: dossiers.id,
        numero: dossiers.numero,
        type: dossiers.type,
        status: dossiers.status,
        adresse: dossiers.adresse,
        commune: dossiers.commune,
        code_postal: dossiers.code_postal,
        metadata: dossiers.metadata,
      })
      .from(dossiers)
      .where(
        commune
          ? sql`commune ILIKE ${commune} AND adresse IS NOT NULL AND status != 'brouillon'`
          : sql`adresse IS NOT NULL AND status != 'brouillon'`
      )
      .orderBy(desc(dossiers.created_at))
      .limit(200);

    // Géocode les dossiers sans coordonnées et met en cache dans metadata
    async function geocode(adresse: string, communeNom: string, codePostal: string | null): Promise<{ lat: number; lng: number } | null> {
      try {
        const q = encodeURIComponent(`${adresse} ${communeNom}`);
        const citycode = codePostal ? `&postcode=${encodeURIComponent(codePostal)}` : "";
        const r = await fetch(`https://api-adresse.data.gouv.fr/search/?q=${q}${citycode}&limit=1`);
        if (!r.ok) return null;
        const data = await r.json() as { features?: { geometry: { coordinates: [number, number] }; properties: { score: number } }[] };
        const feature = data.features?.[0];
        if (!feature || feature.properties.score < 0.4) return null;
        const [lng, lat] = feature.geometry.coordinates;
        return { lat, lng };
      } catch {
        return null;
      }
    }

    const result = await Promise.all(rows.map(async d => {
      const meta = (d.metadata ?? {}) as Record<string, unknown>;
      let lat = parseFloat(String(meta["lat"] ?? ""));
      let lng = parseFloat(String(meta["lng"] ?? ""));

      if ((isNaN(lat) || isNaN(lng)) && d.adresse) {
        const coords = await geocode(d.adresse, d.commune ?? "", d.code_postal ?? null);
        if (coords) {
          lat = coords.lat;
          lng = coords.lng;
          // Cache dans metadata pour les prochains appels
          await db.update(dossiers)
            .set({ metadata: { ...meta, lat, lng } })
            .where(eq(dossiers.id, d.id));
        }
      }

      return { id: d.id, numero: d.numero, type: d.type, status: d.status, adresse: d.adresse ?? "", commune: d.commune ?? "", lat, lng };
    }));

    res.json(result.filter(d => !isNaN(d.lat) && !isNaN(d.lng)));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Conversations : liste avec preview et non-lus ──
mairieRouter.get("/conversations", async (req: AuthRequest, res) => {
  try {
    const commune = req.query.commune as string | undefined;
    const communeFilter = commune ? sql`AND d.commune ILIKE ${commune}` : sql``;
    const rows = await db.execute(sql`
      WITH last_msg AS (
        SELECT DISTINCT ON (dossier_id) dossier_id, content, from_role, created_at
        FROM dossier_messages
        WHERE consultation_id IS NULL
        ORDER BY dossier_id, created_at DESC
      ),
      unread AS (
        SELECT dm.dossier_id, COUNT(*)::int AS cnt
        FROM dossier_messages dm
        WHERE dm.consultation_id IS NULL
          AND dm.from_role = 'citoyen'
          AND dm.read_at IS NULL
        GROUP BY dm.dossier_id
      )
      SELECT
        d.id AS dossier_id, d.numero, d.type, d.status,
        COALESCE(u.prenom || ' ' || u.nom, '—') AS petitionnaire,
        lm.content AS last_content, lm.from_role AS last_from_role,
        lm.created_at AS last_at,
        COALESCE(ur.cnt, 0) AS unread_count
      FROM dossiers d
      JOIN last_msg lm ON lm.dossier_id = d.id
      LEFT JOIN users u ON u.id = d.user_id
      LEFT JOIN unread ur ON ur.dossier_id = d.id
      WHERE 1=1 ${communeFilter}
      ORDER BY lm.created_at DESC
    `);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Nombre total de messages non lus (pour le badge dashboard) ──
// Combine les fils citoyen↔mairie (messages 'citoyen' non lus) et les fils
// mairie↔service externe (messages 'service_externe%' non lus) pour rester
// cohérent avec le badge maintenu en temps réel par MessageScreen.
mairieRouter.get("/conversations/unread-count", async (req: AuthRequest, res) => {
  try {
    const commune = req.query.commune as string | undefined;
    const communeFilter = commune ? sql`AND d.commune ILIKE ${commune}` : sql``;
    const rows = await db.execute(sql`
      SELECT (
        SELECT COUNT(DISTINCT dm.dossier_id)::int
        FROM dossier_messages dm
        JOIN dossiers d ON d.id = dm.dossier_id
        WHERE dm.consultation_id IS NULL
          AND dm.from_role = 'citoyen'
          AND dm.read_at IS NULL ${communeFilter}
      ) + (
        SELECT COUNT(DISTINCT dm.consultation_id)::int
        FROM dossier_messages dm
        JOIN dossiers d ON d.id = dm.dossier_id
        WHERE dm.consultation_id IS NOT NULL
          AND dm.from_role LIKE 'service_externe%'
          AND dm.read_at IS NULL ${communeFilter}
      ) AS count
    `) as unknown as [{ count: number }];
    res.json({ count: rows[0]?.count ?? 0 });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Thread d'une conversation ──
mairieRouter.get("/conversations/:dossierId", async (req: AuthRequest, res) => {
  try {
    const msgs = await db
      .select({
        id: dossier_messages.id,
        content: dossier_messages.content,
        from_role: dossier_messages.from_role,
        created_at: dossier_messages.created_at,
        prenom: users.prenom,
        nom: users.nom,
      })
      .from(dossier_messages)
      .leftJoin(users, sql`dossier_messages.from_user_id::uuid = users.id`)
      .where(and(
        eq(dossier_messages.dossier_id, req.params.dossierId as string),
        isNull(dossier_messages.consultation_id),
      ))
      .orderBy(dossier_messages.created_at);
    res.json(msgs);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Envoyer un message à un citoyen depuis le dossier ──
mairieRouter.post("/conversations/:dossierId", async (req: AuthRequest, res) => {
  try {
    const content = (req.body?.content as string | undefined)?.trim();
    if (!content) return res.status(400).json({ error: "Contenu requis" });

    const [dossier] = await db
      .select({ id: dossiers.id })
      .from(dossiers)
      .where(eq(dossiers.id, req.params.dossierId as string))
      .limit(1);
    if (!dossier) return res.status(404).json({ error: "Dossier introuvable" });

    const [msg] = await db
      .insert(dossier_messages)
      .values({
        dossier_id: req.params.dossierId as string,
        from_user_id: req.user!.id,
        from_role: req.user!.role,
        content,
      })
      .returning();

    const [author] = await db
      .select({ prenom: users.prenom, nom: users.nom })
      .from(users)
      .where(eq(users.id, req.user!.id))
      .limit(1);

    res.status(201).json({ ...msg, prenom: author?.prenom ?? null, nom: author?.nom ?? null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Marquer tous les messages citoyens d'une conversation comme lus ──
mairieRouter.post("/conversations/:dossierId/read", async (req: AuthRequest, res) => {
  try {
    await db
      .update(dossier_messages)
      .set({ read_at: new Date() })
      .where(
        and(
          eq(dossier_messages.dossier_id, req.params.dossierId as string),
          isNull(dossier_messages.consultation_id),
          eq(dossier_messages.from_role, "citoyen"),
          sql`read_at IS NULL`,
        )
      );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Remettre la conversation en non-lu (efface read_at du dernier message citoyen) ──
mairieRouter.post("/conversations/:dossierId/unread", async (req: AuthRequest, res) => {
  try {
    const [last] = await db
      .select({ id: dossier_messages.id })
      .from(dossier_messages)
      .where(
        and(
          eq(dossier_messages.dossier_id, req.params.dossierId as string),
          isNull(dossier_messages.consultation_id),
          eq(dossier_messages.from_role, "citoyen"),
        )
      )
      .orderBy(desc(dossier_messages.created_at))
      .limit(1);
    if (!last) return res.status(404).json({ error: "Aucun message citoyen" });
    await db
      .update(dossier_messages)
      .set({ read_at: null })
      .where(eq(dossier_messages.id, last.id));
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Conversations services consultés (mairie ↔ service externe) ──
// Une conversation = une consultation_id. Le service rattaché est résolu via
// dossier_consultations.external_service_id (peut être NULL si le service n'a
// pas encore de compte/lien — on retombe sur service_name).
mairieRouter.get("/service-conversations", async (req: AuthRequest, res) => {
  try {
    const commune = req.query.commune as string | undefined;
    const communeFilter = commune ? sql`AND d.commune ILIKE ${commune}` : sql``;
    const rows = await db.execute(sql`
      WITH last_msg AS (
        SELECT DISTINCT ON (dm.consultation_id)
          dm.consultation_id, dm.content, dm.from_role, dm.created_at
        FROM dossier_messages dm
        WHERE dm.consultation_id IS NOT NULL
        ORDER BY dm.consultation_id, dm.created_at DESC
      ),
      unread AS (
        SELECT dm.consultation_id, COUNT(*)::int AS cnt
        FROM dossier_messages dm
        WHERE dm.consultation_id IS NOT NULL
          AND dm.from_role LIKE 'service_externe%'
          AND dm.read_at IS NULL
        GROUP BY dm.consultation_id
      )
      SELECT
        c.id AS consultation_id,
        c.dossier_id,
        d.numero,
        d.type,
        d.status,
        c.service_name,
        c.service_type,
        c.status AS consultation_status,
        c.favorable,
        es.id AS service_id,
        es.name AS service_full_name,
        es.email AS service_email,
        lm.content AS last_content,
        lm.from_role AS last_from_role,
        lm.created_at AS last_at,
        COALESCE(ur.cnt, 0) AS unread_count
      FROM dossier_consultations c
      JOIN dossiers d ON d.id = c.dossier_id
      LEFT JOIN external_services es ON es.id = c.external_service_id
      LEFT JOIN last_msg lm ON lm.consultation_id = c.id
      LEFT JOIN unread ur ON ur.consultation_id = c.id
      WHERE 1=1 ${communeFilter}
      ORDER BY COALESCE(lm.created_at, c.created_at) DESC
    `);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

mairieRouter.get("/service-conversations/:consultationId", async (req: AuthRequest, res) => {
  try {
    const msgs = await db
      .select({
        id: dossier_messages.id,
        content: dossier_messages.content,
        from_role: dossier_messages.from_role,
        created_at: dossier_messages.created_at,
        prenom: users.prenom,
        nom: users.nom,
      })
      .from(dossier_messages)
      .leftJoin(users, sql`dossier_messages.from_user_id::uuid = users.id`)
      .where(eq(dossier_messages.consultation_id, req.params.consultationId as string))
      .orderBy(dossier_messages.created_at);
    res.json(msgs);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

mairieRouter.post("/service-conversations/:consultationId", async (req: AuthRequest, res) => {
  try {
    const content = (req.body?.content as string | undefined)?.trim();
    if (!content) return res.status(400).json({ error: "Contenu requis" });

    const [consult] = await db
      .select({ id: dossier_consultations.id, dossier_id: dossier_consultations.dossier_id })
      .from(dossier_consultations)
      .where(eq(dossier_consultations.id, req.params.consultationId as string))
      .limit(1);
    if (!consult) return res.status(404).json({ error: "Consultation introuvable" });

    const [msg] = await db
      .insert(dossier_messages)
      .values({
        dossier_id: consult.dossier_id,
        consultation_id: consult.id,
        from_user_id: req.user!.id,
        from_role: req.user!.role,
        content,
      })
      .returning();

    const [author] = await db
      .select({ prenom: users.prenom, nom: users.nom })
      .from(users)
      .where(eq(users.id, req.user!.id))
      .limit(1);

    res.status(201).json({ ...msg, prenom: author?.prenom ?? null, nom: author?.nom ?? null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

mairieRouter.post("/service-conversations/:consultationId/read", async (req: AuthRequest, res) => {
  try {
    await db
      .update(dossier_messages)
      .set({ read_at: new Date() })
      .where(and(
        eq(dossier_messages.consultation_id, req.params.consultationId as string),
        sql`from_role LIKE 'service_externe%'`,
        sql`read_at IS NULL`,
      ));
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Analyse parcellaire pour un dossier (onglet Parcelle) ──
mairieRouter.get("/dossiers/:id/analyse-parcelle", async (req: AuthRequest, res) => {
  try {
    const qOverride = (req.query.q as string | undefined)?.trim();

    // Always fetch the dossier — we need commune info for the INSEE lookup even when
    // an address override is provided via ?q=, to constrain BAN to the right commune.
    const [dossier] = await db
      .select({ parcelle: dossiers.parcelle, adresse: dossiers.adresse, commune: dossiers.commune })
      .from(dossiers)
      .where(eq(dossiers.id, req.params.id as string))
      .limit(1);
    if (!dossier) return res.status(404).json({ error: "Dossier non trouvé" });

    const communeName = dossier.commune ?? null;

    // Look up commune INSEE code FIRST — needed to expand partial cadastral refs.
    // We require an EXACT case-insensitive match: a substring ilike("%Tours%") would
    // match "Joué-lès-Tours", "Saint-Pierre-des-Corps", etc. and silently send BAN
    // queries to the wrong commune.
    let citycode: string | undefined;
    if (communeName) {
      const [communeRow] = await db.select({ insee_code: communes.insee_code })
        .from(communes)
        .where(ilike(communes.name, communeName))
        .limit(1);
      citycode = communeRow?.insee_code ?? undefined;
    }

    // Build the analysis query.
    // The address is ALWAYS the primary source: geocoding gives exact coordinates,
    // from which we derive the parcel, PLU zone, and all regulatory data.
    // The dossier.parcelle field (often partial like "BM 019") is only used when
    // there is no address and it resolves to a full 14-char cadastral reference.
    let query: string | null;
    if (qOverride) {
      // Instructeur corrected the address via the UI editor
      query = qOverride;
    } else if (dossier.adresse) {
      // Standard flow: address → geocode → parcel → analysis
      // Don't append commune if it's already present in the address string (avoids BAN confusion)
      const communeAlreadyInAddr = dossier.commune &&
        dossier.adresse.toLowerCase().includes(dossier.commune.toLowerCase());
      query = communeAlreadyInAddr
        ? dossier.adresse
        : `${dossier.adresse}${dossier.commune ? ", " + dossier.commune : ""}`;
    } else if (dossier.parcelle) {
      // No address at all — try to use the cadastral reference as a fallback
      const raw = dossier.parcelle.trim().replace(/\s+/g, "");
      if (/^\d{5}[A-Z0-9]{9,}$/i.test(raw)) {
        query = raw;  // Full 14-char ref (e.g. 37018000BM0019)
      } else {
        // Partial ref like "BM 019" — expand with commune INSEE
        const m = /^([A-Z]{1,2})0*(\d{1,4})$/i.exec(raw);
        query = (m && m[1] && m[2] && citycode)
          ? `${citycode}000${m[1].toUpperCase().padStart(2, "0")}${m[2].padStart(4, "0")}`
          : null;
      }
    } else {
      query = null;
    }

    if (!query) return res.status(422).json({ error: "Aucune adresse ni référence parcellaire sur ce dossier." });

    // ?zone= lets the instructeur manually override the PLU zone when GPU fails
    const zoneOverride = (req.query.zone as string | undefined)?.trim();

    // ?lat=&lng= lets the instructeur provide coordinates from a map click
    const latParam = parseFloat(req.query.lat as string);
    const lngParam = parseFloat(req.query.lng as string);
    const coords = !isNaN(latParam) && !isNaN(lngParam) ? { lat: latParam, lng: lngParam } : undefined;

    const analysis = await analyseParcel(query, { citycode, zoneOverride, coords });
    res.json(analysis);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Mise à jour adresse d'un dossier ──
mairieRouter.patch("/dossiers/:id/adresse", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { adresse, commune } = req.body as { adresse?: string; commune?: string };
    if (!adresse) return res.status(400).json({ error: "adresse requis" });
    await db.update(dossiers)
      .set({ adresse, commune: commune ?? null, updated_at: new Date() })
      .where(eq(dossiers.id, req.params.id as string));
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Calcul / recalcul des dates d'échéance théoriques (admin) ───────────────
// POST /mairie/admin/compute-deadlines
// - Body { force: true } → recalcule toutes les échéances (même celles déjà
//   posées) à partir des règles légales actuelles. Utile quand on a corrigé
//   le moteur (ex. PC autre que MI passé de 2 à 3 mois).
// - Sans body / force=false → ne traite que les dossiers sans échéance posée.
mairieRouter.post("/admin/compute-deadlines", async (req: AuthRequest, res) => {
  try {
    const force = (req.body as { force?: boolean } | undefined)?.force === true;
    const baseQuery = db
      .select({ id: dossiers.id, type: dossiers.type, date_depot: dossiers.date_depot, date_completude: dossiers.date_completude, metadata: dossiers.metadata })
      .from(dossiers);
    const toUpdate = await (force
      ? baseQuery.where(sql`date_depot IS NOT NULL`)
      : baseQuery.where(sql`date_depot IS NOT NULL AND date_limite_instruction IS NULL`));

    let updated = 0;
    const breakdown_samples: Array<{ id: string; type: string; total_mois: number; breakdown: DeadlineBreakdownItem[] }> = [];
    for (const d of toUpdate) {
      const meta = (d.metadata as DeadlineMetadata | null) ?? null;
      const servitudes = (meta as { servitudes?: DeadlineServitude[] } | null)?.servitudes ?? null;
      const calc = computeInstructionDelay(d.type, meta, servitudes);
      const startDate = new Date((d.date_completude ?? d.date_depot)!);
      const deadline = applyMonthsToDate(startDate, calc.total_mois);
      const nextMeta = {
        ...((d.metadata as Record<string, unknown>) ?? {}),
        delai: {
          total_mois: calc.total_mois,
          breakdown: calc.breakdown,
          base_date: startDate.toISOString(),
          base_date_source: d.date_completude ? "completude" : "depot",
          computed_at: new Date().toISOString(),
        },
      };
      await db.update(dossiers)
        .set({ date_limite_instruction: deadline, metadata: nextMeta, updated_at: new Date() })
        .where(eq(dossiers.id, d.id));
      updated++;
      if (breakdown_samples.length < 5) {
        breakdown_samples.push({ id: d.id, type: d.type, total_mois: calc.total_mois, breakdown: calc.breakdown });
      }
    }

    res.json({
      ok: true, updated, force,
      breakdown_samples,
      rules_defaut: Object.entries(DELAI_INSTRUCTION_MOIS_DEFAUT).map(([type, mois]) => ({ type, delai_mois_defaut: mois })),
    });
  } catch (err) {
    console.error("[compute-deadlines]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Ingestion PLU depuis PDF (IA — admin uniquement) ──────────────────────────
// POST /mairie/admin/ingest-plu-pdf
// Body: { commune_name, insee_code, zip_code?, pdf_base64 }
// Uses Claude's native PDF document support — no pdftotext required.
// All extracted rules stored as validation_status = "brouillon" for human review.

type PluRuleInput = {
  article_number?: number | null;
  article_title?: string;
  topic: string;
  rule_text: string;
  not_regulated?: boolean;
  value_min?: number | null;
  value_max?: number | null;
  value_exact?: number | null;
  unit?: string | null;
  conditions?: string | null;
  summary: string;
  needs_vision?: boolean;
  needs_external_doc?: boolean;
  external_doc_name?: string | null;
};

const PLU_SAVE_RULE_TOOL: Anthropic.Tool = {
  name: "save_rule",
  description: "Enregistre une règle réglementaire extraite d'un article du PLU.",
  input_schema: {
    type: "object" as const,
    properties: {
      article_number: { type: "integer", description: "Numéro de l'article. Null si non numéroté." },
      article_title: { type: "string", description: "Titre exact de l'article." },
      topic: {
        type: "string",
        enum: ["destinations","terrain_min","recul_voie","recul_limite","recul_batiments","emprise_sol","hauteur","aspect","stationnement","espaces_verts","cos","general"],
        description: "Catégorie réglementaire.",
      },
      rule_text: { type: "string", description: "Texte fidèle de la règle." },
      not_regulated: { type: "boolean", description: "True si article dit 'sans objet' ou 'non réglementé'." },
      value_min: { type: "number", description: "Valeur minimale numérique. Omettre si absent." },
      value_max: { type: "number", description: "Valeur maximale numérique. Omettre si absent." },
      value_exact: { type: "number", description: "Valeur unique exacte. Omettre si absent." },
      unit: { type: "string", enum: ["m","%","m²","places"], description: "Unité. Omettre si pas de valeur numérique." },
      conditions: { type: "string", description: "Conditions ou exceptions. Omettre si aucune." },
      summary: { type: "string", description: "Résumé en 10 mots maximum." },
      needs_vision: { type: "boolean", description: "True si la valeur numérique principale est dans un schéma graphique du document." },
      needs_external_doc: { type: "boolean", description: "True si la règle renvoie explicitement à un document externe (PPRI, PLH, cahier des charges ZAC, servitude…)." },
      external_doc_name: { type: "string", description: "Nom du document externe référencé (ex: 'PPRI', 'PLH', 'cahier des charges ZAC'). Remplir si needs_external_doc = true." },
    },
    required: ["article_number","article_title","topic","rule_text","not_regulated","summary","needs_vision","needs_external_doc"],
  },
};

mairieRouter.post("/admin/ingest-plu-pdf", async (req: AuthRequest, res) => {
  const { commune_name, insee_code, zip_code, pdf_base64 } = req.body as {
    commune_name?: string;
    insee_code?: string;
    zip_code?: string;
    pdf_base64?: string;
  };

  if (!commune_name || !insee_code || !pdf_base64) {
    return res.status(400).json({ error: "commune_name, insee_code et pdf_base64 requis" });
  }

  // SSE streaming so the client sees progress zone by zone
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  const send = (data: Record<string, unknown>) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    // Force the chunk out immediately (defeats any residual buffering).
    (res as unknown as { flush?: () => void }).flush?.();
  };

  try {
    // maxRetries : le SDK réessaie (backoff) sur 429 / 5xx / 529 ; timeout pour
    // ne jamais pendre indéfiniment sur un tronçon PDF lourd.
    const client = anthropicClient({ maxRetries: 3, timeout: 120_000 });

    // Upsert commune
    let commune = (await db.select().from(communes).where(eq(communes.insee_code, insee_code)).limit(1))[0];
    if (!commune) {
      const [created] = await db.insert(communes).values({
        name: commune_name,
        insee_code,
        zip_code: zip_code ?? "",
      }).returning();
      commune = created!;
    } else {
      await db.update(communes).set({ name: commune_name, zip_code: zip_code ?? commune.zip_code ?? "", updated_at: new Date() }).where(eq(communes.id, commune.id));
    }

    // NB : on ne purge PAS l'existant ici. L'extraction (longue) a lieu d'abord ;
    // la purge + insertion se font en transaction à la fin, une fois l'extraction
    // réussie — ainsi une interruption en cours d'extraction ne détruit rien.

    // Découpage du PDF (gère la limite ~100 pages/requête d'Anthropic).
    send({ type: "phase", message: "Préparation du document…" });
    const chunks = await splitPdfBase64(pdf_base64);

    // cache_control marque chaque tronçon pour le prompt caching (réutilisé par
    // les appels d'extraction portant sur le même tronçon).
    const pdfDocFor = (b64: string) => ({
      type: "document" as const,
      source: { type: "base64" as const, media_type: "application/pdf" as const, data: b64 },
      cache_control: { type: "ephemeral" as const },
    });

    // Phase 1 — Détection des zones, tronçon par tronçon (chaque zone est rattachée
    // au premier tronçon où sa section apparaît).
    send({ type: "phase", message: chunks.length > 1 ? `Détection des zones (${chunks.length} parties)…` : "Détection des zones…" });
    const detectChunk = async (c: number) => {
     try {
      const zoneMsg = await callClaude(
        { purpose: "plu_zone_detect", userId: req.user?.id ?? null, communeId: commune.id },
        {
          model: "claude-sonnet-4-6",
          max_tokens: 2000,
          messages: [{
            role: "user",
            content: [
              pdfDocFor(chunks[c]!),
              {
                type: "text",
                text: `Cet extrait fait partie d'un règlement PLU français.

Liste TOUTES les zones et sous-zones qui possèdent, DANS CET EXTRAIT, une section réglementaire dédiée (titre de section + articles ; ex : UA, UB, UC, Ni, Nj, A, Ab, 1AU, 2AU…). Utilise le sommaire s'il est présent dans l'extrait.
Inclure les sous-zones ayant un règlement distinct. Ne pas exclure une zone parce qu'elle semble petite.
Si aucune section de zone n'apparaît dans cet extrait, répondre [].

Répondre UNIQUEMENT avec un JSON array, sans autre texte :
[{"code":"UA","label":"Zone UA – Centre ancien","type":"U"},…]
Types : "U"=urbaine, "AU"=à urbaniser, "A"=agricole, "N"=naturelle.`,
              },
            ],
          }],
        },
        client,
      );
      const raw = zoneMsg.content[0]?.type === "text" ? zoneMsg.content[0].text : "[]";
      const found = JSON.parse(raw.match(/\[[\s\S]*?\]/)?.[0] ?? "[]") as Array<{ code: string; label: string; type: string }>;
      send({ type: "phase", message: `Détection des zones — partie ${c + 1}/${chunks.length} analysée (${found.length} zones)` });
      return found.map(z => ({ ...z, chunk: c }));
     } catch (e) {
      // Un tronçon en échec ne doit pas bloquer ni annuler tout l'import :
      // on continue avec les zones des autres tronçons.
      console.error(`[ingest-plu-pdf] détection tronçon ${c} échouée`, e);
      send({ type: "phase", message: `Détection des zones — partie ${c + 1}/${chunks.length} ignorée (erreur temporaire)` });
      return [] as Array<{ code: string; label: string; type: string; chunk: number }>;
     }
    };

    // Tronçons analysés en parallèle ; on conserve l'ordre pour rattacher chaque
    // zone au PREMIER tronçon où elle apparaît.
    const perChunk = await Promise.all(chunks.map((_, c) => detectChunk(c)));
    const zoneMap = new Map<string, { code: string; label: string; type: string; chunk: number }>();
    for (const list of perChunk) {
      for (const z of list) {
        if (z.code && !zoneMap.has(z.code)) zoneMap.set(z.code, z);
      }
    }
    const zoneDefs = [...zoneMap.values()];

    if (zoneDefs.length === 0) {
      send({ type: "error", message: "Aucune zone détectée. Vérifiez que c'est bien un règlement PLU textuel." });
      return res.end();
    }

    send({ type: "zones_found", zones: zoneDefs.map(z => ({ code: z.code, label: z.label, type: z.type })) });

    // Phase 2 — Règles par zone, extraites depuis le tronçon contenant la zone.
    const extractZone = async (zoneDef: { code: string; label: string; type: string; chunk: number }) => {
     try {
      const ruleMsg = await callClaude(
        { purpose: "plu_rule_extract", userId: req.user?.id ?? null, communeId: commune.id },
        {
          model: "claude-sonnet-4-6",
          max_tokens: 4000,
          tools: [PLU_SAVE_RULE_TOOL],
          tool_choice: { type: "any" },
          messages: [{
            role: "user",
            content: [
              pdfDocFor(chunks[zoneDef.chunk]!),
              {
                type: "text",
                text: `Cet extrait fait partie d'un règlement PLU français. Extrais les règles de la ZONE ${zoneDef.code} uniquement.

Pour CHAQUE article présent dans la section Zone ${zoneDef.code}, appelle save_rule une fois.
Correspondance article → topic :
  1/2 → destinations | 5 → terrain_min | 6 → recul_voie | 7 → recul_limite
  8 → recul_batiments | 9 → emprise_sol | 10 → hauteur | 11 → aspect
  12 → stationnement | 13 → espaces_verts | 14 → cos

- Si l'article dit "sans objet" ou "non réglementé" → not_regulated = true, appelle quand même save_rule.
- Plusieurs valeurs selon sous-secteurs → valeur principale dans value_max, variantes dans conditions.
- Si la valeur numérique est dans un schéma graphique du document → needs_vision = true.
- Si la règle renvoie à un document externe (PPRI, PLH, cahier des charges ZAC, arrêté préfectoral, servitude…) → needs_external_doc = true, external_doc_name = nom exact du document cité.
- N'invente aucune valeur. Si incertain, omets value_min/max/exact.`,
              },
            ],
          }],
        },
        client,
      );

      const rules: PluRuleInput[] = ruleMsg.content
        .filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use")
        .map(b => b.input as PluRuleInput);
      const visionCount = rules.filter(r => r.needs_vision || r.needs_external_doc).length;

      send({ type: "zone_done", zone: zoneDef.code, rules: rules.length, vision: visionCount });
      return { zoneDef, rules, visionCount };
     } catch (e) {
      // Une zone en échec ne fait pas planter tout l'import : on l'enregistre
      // sans règle (l'instructeur pourra la compléter manuellement).
      console.error(`[ingest-plu-pdf] extraction zone ${zoneDef.code} échouée`, e);
      send({ type: "zone_done", zone: zoneDef.code, rules: 0, vision: 0, error: true });
      return { zoneDef, rules: [] as PluRuleInput[], visionCount: 0 };
     }
    };

    // Concurrence bornée : traiter les zones par petits lots évite de saturer
    // l'API IA (toutes les zones d'un coup provoque des 429/529/500).
    const extracted: Array<{ zoneDef: { code: string; label: string; type: string; chunk: number }; rules: PluRuleInput[]; visionCount: number }> = [];
    const CONCURRENCY = 3;
    for (let i = 0; i < zoneDefs.length; i += CONCURRENCY) {
      const batch = zoneDefs.slice(i, i + CONCURRENCY);
      const batchResults = await Promise.all(batch.map(extractZone));
      extracted.push(...batchResults);
    }

    // ── Écriture atomique ──────────────────────────────────────────────────────
    // L'extraction (ci-dessus) est terminée et a réussi : on purge l'existant et
    // on insère le nouveau jeu dans une seule transaction. Une interruption
    // pendant l'extraction n'aura donc jamais détruit les données ; et si la
    // transaction échoue, elle est annulée (pas d'état partiel).
    send({ type: "phase", message: "Enregistrement…" });
    await db.transaction(async (tx) => {
      const oldZones = await tx.select({ id: zones.id }).from(zones).where(eq(zones.commune_id, commune.id));
      if (oldZones.length > 0) {
        await tx.delete(zone_regulatory_rules).where(inArray(zone_regulatory_rules.zone_id, oldZones.map(z => z.id)));
        await tx.delete(zones).where(eq(zones.commune_id, commune.id));
      }
      for (const { zoneDef, rules } of extracted) {
        const [created] = await tx.insert(zones).values({
          commune_id: commune.id,
          zone_code: zoneDef.code,
          zone_label: zoneDef.label,
          zone_type: zoneDef.type,
          summary: `Zone ${zoneDef.code} — extrait par IA, à valider`,
          status: "active",
          is_active: true,
        }).returning();
        const zoneId = created!.id;
        for (const rule of rules) {
          await tx.insert(zone_regulatory_rules).values({
            zone_id: zoneId,
            article_number: rule.article_number ?? null,
            article_title: rule.article_title ?? (rule.article_number ? `Article ${rule.article_number}` : ""),
            topic: rule.topic,
            rule_text: rule.rule_text,
            value_min: rule.value_min ?? null,
            value_max: rule.value_max ?? null,
            value_exact: rule.value_exact ?? null,
            unit: rule.unit ?? null,
            conditions: rule.conditions ?? null,
            summary: rule.summary,
            instructor_note: [
              rule.needs_vision ? "⚠ Valeur dans un schéma graphique — à vérifier manuellement." : null,
              rule.needs_external_doc ? `⚠ Valeur définie dans un document externe : ${rule.external_doc_name ?? "document non identifié"} — à reporter manuellement.` : null,
            ].filter(Boolean).join(" | ") || null,
            validation_status: "brouillon" as const,
          });
        }
      }
    });

    const results = extracted.map(e => ({ zone: e.zoneDef.code, rules: e.rules.length, vision: e.visionCount }));
    send({
      type: "done",
      ok: true,
      commune: commune.name,
      insee_code: commune.insee_code,
      zones: results.length,
      rules: results.reduce((s, z) => s + z.rules, 0),
      needs_review: results.reduce((s, z) => s + z.vision, 0),
      detail: results,
    });

  } catch (err) {
    console.error("[ingest-plu-pdf]", err);
    // Erreurs transitoires de l'API IA (surcharge / 5xx / quota) → message clair.
    const status = (err as { status?: number })?.status;
    const transient = status === 429 || status === 529 || (typeof status === "number" && status >= 500);
    const message = transient
      ? "Le service d'extraction IA est momentanément indisponible ou surchargé. Aucune donnée n'a été modifiée — réessayez dans quelques instants."
      : (err instanceof Error ? err.message : String(err));
    send({ type: "error", message });
  }

  res.end();
});

// ── Disponibilités ────────────────────────────────────────────────────────────

mairieRouter.get("/my-availability", async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const [avail] = await db.select().from(user_availability).where(eq(user_availability.user_id, userId)).limit(1);
    const absences = await db.select({
      id: user_absences.id,
      start_date: user_absences.start_date,
      end_date: user_absences.end_date,
      reason: user_absences.reason,
      note: user_absences.note,
      delegate_user_id: user_absences.delegate_user_id,
      delegate_prenom: users.prenom,
      delegate_nom: users.nom,
    })
      .from(user_absences)
      .leftJoin(users, eq(user_absences.delegate_user_id, users.id))
      .where(eq(user_absences.user_id, userId))
      .orderBy(user_absences.start_date);
    res.json({
      working_days: avail?.working_days ?? [1, 2, 3, 4, 5],
      start_time: avail?.start_time ?? "08:30",
      end_time: avail?.end_time ?? "17:30",
      absences,
    });
  } catch (err) { console.error(err); res.status(500).json({ error: "Erreur serveur" }); }
});

mairieRouter.put("/my-availability", async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const { working_days, start_time, end_time } = req.body as { working_days: number[]; start_time: string; end_time: string };
    await db.insert(user_availability)
      .values({ user_id: userId, working_days, start_time, end_time, updated_at: new Date() })
      .onConflictDoUpdate({ target: user_availability.user_id, set: { working_days, start_time, end_time, updated_at: new Date() } });
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: "Erreur serveur" }); }
});

mairieRouter.post("/my-absences", async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const { start_date, end_date, reason, note, delegate_user_id } = req.body as {
      start_date: string; end_date: string; reason?: string; note?: string; delegate_user_id?: string;
    };
    if (!start_date || !end_date) return res.status(400).json({ error: "start_date et end_date requis" });
    const [row] = await db.insert(user_absences)
      .values({ user_id: userId, start_date, end_date, reason: reason ?? "conges", note: note ?? null, delegate_user_id: delegate_user_id ?? null })
      .returning();
    res.status(201).json(row);
  } catch (err) { console.error(err); res.status(500).json({ error: "Erreur serveur" }); }
});

mairieRouter.delete("/my-absences/:id", async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const { id } = req.params as { id: string };
    await db.delete(user_absences).where(and(eq(user_absences.id, id), eq(user_absences.user_id, userId)));
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: "Erreur serveur" }); }
});

// ── Délégations ──────────────────────────────────────────────────────────────
// Chaîne ordonnée des instructeurs qui prennent le relais pendant une absence.
// L'ordre dans la liste reçue détermine la priorité (1er = principal).

mairieRouter.get("/my-delegations", async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const rows = await db
      .select({
        id: user_delegations.id,
        delegate_user_id: user_delegations.delegate_user_id,
        priority: user_delegations.priority,
        prenom: users.prenom,
        nom: users.nom,
        email: users.email,
      })
      .from(user_delegations)
      .leftJoin(users, eq(user_delegations.delegate_user_id, users.id))
      .where(eq(user_delegations.user_id, userId))
      .orderBy(user_delegations.priority);
    res.json(rows);
  } catch (err) { console.error(err); res.status(500).json({ error: "Erreur serveur" }); }
});

mairieRouter.put("/my-delegations", async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const { delegates } = req.body as { delegates: string[] };
    if (!Array.isArray(delegates)) {
      return res.status(400).json({ error: "delegates doit être un tableau d'UUID" });
    }
    // Pas d'auto-délégation ni de doublons.
    const seen = new Set<string>();
    const ordered = delegates.filter((d) => {
      if (typeof d !== "string" || !d) return false;
      if (d === userId) return false;
      if (seen.has(d)) return false;
      seen.add(d);
      return true;
    });

    if (ordered.length > 0) {
      const found = await db
        .select({ id: users.id })
        .from(users)
        .where(and(inArray(users.id, ordered), sql`role IN ('instructeur', 'mairie', 'admin')`));
      const validIds = new Set(found.map((r) => r.id));
      const filtered = ordered.filter((d) => validIds.has(d));
      if (filtered.length !== ordered.length) {
        return res.status(400).json({ error: "Un ou plusieurs délégués n'ont pas les droits d'instruction" });
      }
    }

    await db.transaction(async (tx) => {
      await tx.delete(user_delegations).where(eq(user_delegations.user_id, userId));
      if (ordered.length === 0) return;
      await tx.insert(user_delegations).values(
        ordered.map((delegate_user_id, idx) => ({
          user_id: userId,
          delegate_user_id,
          priority: idx + 1,
        })),
      );
    });

    const rows = await db
      .select({
        id: user_delegations.id,
        delegate_user_id: user_delegations.delegate_user_id,
        priority: user_delegations.priority,
        prenom: users.prenom,
        nom: users.nom,
        email: users.email,
      })
      .from(user_delegations)
      .leftJoin(users, eq(user_delegations.delegate_user_id, users.id))
      .where(eq(user_delegations.user_id, userId))
      .orderBy(user_delegations.priority);
    res.json(rows);
  } catch (err) { console.error(err); res.status(500).json({ error: "Erreur serveur" }); }
});

mairieRouter.get("/notifications", async (req: AuthRequest, res) => {
  try {
    const list = await db
      .select()
      .from(notifications)
      .where(eq(notifications.user_id, req.user!.id))
      .orderBy(desc(notifications.created_at))
      .limit(50);
    res.json(list);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Réglementation ────────────────────────────────────────────────────────────

// GET /mairie/reglementation?insee_code=37018 (or legacy ?commune_name=Ballan-Miré)
//
// Renvoie les zones et leurs règles. Filtre safe-by-default : seules les règles
// `validation_status = 'valide'` sont incluses. Tout caller qui doit voir les
// brouillons / rejetées (= UI de validation) doit passer `?include_drafts=true`
// explicitement. Les consommateurs « lecture » (carte, dashboards, futurs
// services) reçoivent ainsi par défaut un référentiel utilisable, sans risque
// de mélange visuel avec du contenu non validé.
mairieRouter.get("/reglementation", async (req: AuthRequest, res) => {
  try {
    const communeName = (req.query.commune_name as string | undefined)?.trim();
    const inseeCode = (req.query.insee_code as string | undefined)?.trim();
    const includeDrafts = req.query.include_drafts === "true";
    if (!communeName && !inseeCode) return res.status(400).json({ error: "commune_name ou insee_code requis" });

    const [commune] = await db.select().from(communes)
      .where(inseeCode
        ? eq(communes.insee_code, inseeCode)
        : ilike(communes.name, `%${communeName!}%`))
      .limit(1);
    if (!commune) return res.status(404).json({ error: "Commune non trouvée" });

    const zoneRows = await db.select().from(zones)
      .where(and(eq(zones.commune_id, commune.id), eq(zones.is_active, true)))
      .orderBy(zones.display_order);

    const result = await Promise.all(zoneRows.map(async zone => {
      const allRules = await db.select().from(zone_regulatory_rules)
        .where(eq(zone_regulatory_rules.zone_id, zone.id))
        .orderBy(zone_regulatory_rules.article_number);

      const stats = {
        total: allRules.length,
        valide: allRules.filter(r => r.validation_status === "valide").length,
        brouillon: allRules.filter(r => r.validation_status === "brouillon" || r.validation_status === "draft").length,
        rejete: allRules.filter(r => r.validation_status === "rejete").length,
      };

      const rules = includeDrafts
        ? allRules
        : allRules.filter(r => r.validation_status === "valide");

      return { ...zone, rules, stats };
    }));

    res.json({ commune, zones: result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// GET /mairie/admin/reglementation-status
// Diagnostic (lecture seule) : pour chaque commune, INSEE + nb de zones/règles
// + liste des codes de zone. Permet de voir à quelle commune des règles sont
// réellement rattachées (utile pour repérer des données mal associées).
mairieRouter.get("/admin/reglementation-status", requireRole("mairie", "instructeur", "admin"), async (_req: AuthRequest, res) => {
  try {
    const rows = await db
      .select({
        commune: communes.name,
        insee_code: communes.insee_code,
        zone_count: sql<number>`count(distinct ${zones.id})`,
        rule_count: sql<number>`count(${zone_regulatory_rules.id})`,
        zone_codes: sql<string>`coalesce(string_agg(distinct ${zones.zone_code}, ', '), '')`,
      })
      .from(communes)
      .leftJoin(zones, eq(zones.commune_id, communes.id))
      .leftJoin(zone_regulatory_rules, eq(zone_regulatory_rules.zone_id, zones.id))
      .groupBy(communes.id, communes.name, communes.insee_code)
      .orderBy(communes.insee_code);

    res.json(rows.map(r => ({
      commune: r.commune,
      insee_code: r.insee_code,
      zones: Number(r.zone_count),
      rules: Number(r.rule_count),
      zone_codes: r.zone_codes,
    })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// DELETE /mairie/reglementation?insee_code=37018
// Purge toutes les zones + règles d'une commune (ex. retirer des données résiduelles
// avant de réimporter le vrai PLU).
mairieRouter.delete("/reglementation", requireRole("mairie", "instructeur", "admin"), async (req: AuthRequest, res) => {
  try {
    const inseeCode = (req.query.insee_code as string | undefined)?.trim();
    if (!inseeCode) return res.status(400).json({ error: "insee_code requis" });
    const [commune] = await db.select().from(communes).where(eq(communes.insee_code, inseeCode)).limit(1);
    if (!commune) return res.status(404).json({ error: "Commune non trouvée" });

    const oldZones = await db.select({ id: zones.id }).from(zones).where(eq(zones.commune_id, commune.id));
    if (oldZones.length > 0) {
      await db.delete(zone_regulatory_rules).where(inArray(zone_regulatory_rules.zone_id, oldZones.map(z => z.id)));
      await db.delete(zones).where(eq(zones.commune_id, commune.id));
    }
    res.json({ ok: true, commune: commune.name, insee_code: commune.insee_code, purged_zones: oldZones.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// PATCH /mairie/reglementation/rules/:id — validate, edit or reject a rule
mairieRouter.patch("/reglementation/rules/:id", async (req: AuthRequest, res) => {
  try {
    const id = req.params.id as string;
    const { rule_text, validation_status, value_min, value_max, value_exact, unit, conditions, exceptions, summary, instructor_note, topic, article_number, article_title, cases, applies_if, sub_theme, citizen_title, citizen_summary, citizen_relevant } = req.body as Record<string, unknown>;

    const allowed = new Set(["valide", "brouillon", "rejete", "draft"]);
    if (validation_status !== undefined && !allowed.has(validation_status as string)) {
      return res.status(400).json({ error: "validation_status invalide" });
    }

    const patch: Record<string, unknown> = { updated_at: new Date() };
    if (rule_text !== undefined) patch.rule_text = rule_text;
    if (validation_status !== undefined) patch.validation_status = validation_status;
    if (value_min !== undefined) patch.value_min = value_min === null ? null : Number(value_min);
    if (value_max !== undefined) patch.value_max = value_max === null ? null : Number(value_max);
    if (value_exact !== undefined) patch.value_exact = value_exact === null ? null : Number(value_exact);
    if (unit !== undefined) patch.unit = unit;
    if (conditions !== undefined) patch.conditions = conditions;
    if (exceptions !== undefined) patch.exceptions = exceptions;
    if (summary !== undefined) patch.summary = summary;
    if (instructor_note !== undefined) patch.instructor_note = instructor_note;
    if (topic !== undefined) patch.topic = topic;
    if (article_number !== undefined) patch.article_number = article_number;
    if (article_title !== undefined) patch.article_title = article_title;
    if (cases !== undefined) patch.cases = Array.isArray(cases) ? cases : [];
    if (applies_if !== undefined) patch.applies_if = Array.isArray(applies_if) ? applies_if : [];
    if (sub_theme !== undefined) patch.sub_theme = sub_theme;
    if (citizen_title !== undefined) patch.citizen_title = citizen_title;
    if (citizen_summary !== undefined) patch.citizen_summary = citizen_summary;
    if (citizen_relevant !== undefined) patch.citizen_relevant = citizen_relevant !== false;

    await db.update(zone_regulatory_rules).set(patch).where(eq(zone_regulatory_rules.id, id));
    const [updated] = await db.select().from(zone_regulatory_rules).where(eq(zone_regulatory_rules.id, id)).limit(1);
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// DELETE /mairie/reglementation/rules/:id
mairieRouter.delete("/reglementation/rules/:id", async (req: AuthRequest, res) => {
  try {
    await db.delete(zone_regulatory_rules).where(eq(zone_regulatory_rules.id, req.params.id as string));
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST /mairie/reglementation/zones/:zoneId/rules — add a rule manually
mairieRouter.post("/reglementation/zones/:zoneId/rules", async (req: AuthRequest, res) => {
  try {
    const zone_id = req.params.zoneId as string;
    const [zone] = await db.select({ id: zones.id }).from(zones).where(eq(zones.id, zone_id)).limit(1);
    if (!zone) return res.status(404).json({ error: "Zone non trouvée" });

    const { article_number, article_title, topic, rule_text, value_min, value_max, value_exact, unit, conditions, exceptions, summary, cases, applies_if, sub_theme, citizen_title, citizen_summary, citizen_relevant } = req.body as Record<string, unknown>;
    if (!topic || !rule_text) return res.status(400).json({ error: "topic et rule_text requis" });

    const [created] = await db.insert(zone_regulatory_rules).values({
      zone_id,
      article_number: article_number ? Number(article_number) : null,
      article_title: (article_title as string | undefined) ?? (article_number ? `Article ${article_number}` : ""),
      topic: topic as string,
      rule_text: rule_text as string,
      value_min: value_min != null ? Number(value_min) : null,
      value_max: value_max != null ? Number(value_max) : null,
      value_exact: value_exact != null ? Number(value_exact) : null,
      unit: (unit as string | undefined) ?? null,
      conditions: (conditions as string | undefined) ?? null,
      exceptions: (exceptions as string | undefined) ?? null,
      summary: (summary as string | undefined) ?? null,
      cases: Array.isArray(cases) ? cases : [],
      applies_if: Array.isArray(applies_if) ? applies_if : [],
      sub_theme: (sub_theme as string | undefined) ?? null,
      citizen_title: (citizen_title as string | undefined) ?? null,
      citizen_summary: (citizen_summary as string | undefined) ?? null,
      citizen_relevant: citizen_relevant !== false,
      validation_status: "brouillon",
    }).returning();

    res.status(201).json(created);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST /mairie/reglementation/zones/:zoneId/rules/bulk — ajout en masse (sous-règles)
mairieRouter.post("/reglementation/zones/:zoneId/rules/bulk", requireRole("mairie", "instructeur", "admin"), async (req: AuthRequest, res) => {
  try {
    const zone_id = req.params.zoneId as string;
    const [zone] = await db.select({ id: zones.id }).from(zones).where(eq(zones.id, zone_id)).limit(1);
    if (!zone) return res.status(404).json({ error: "Zone non trouvée" });

    const rules = Array.isArray((req.body as { rules?: unknown }).rules) ? (req.body as { rules: Record<string, unknown>[] }).rules : [];
    if (!rules.length) return res.status(400).json({ error: "Aucune règle à ajouter" });

    const num = (v: unknown) => (v != null && Number.isFinite(Number(v)) ? Number(v) : null);
    const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
    const values = rules
      .filter((r) => str(r.rule_text) && str(r.topic))
      .map((r) => ({
        zone_id,
        article_number: num(r.article_number),
        article_title: str(r.article_title) ?? (r.article_number ? `Article ${r.article_number}` : ""),
        topic: str(r.topic) as string,
        rule_text: str(r.rule_text) as string,
        value_min: num(r.value_min), value_max: num(r.value_max), value_exact: num(r.value_exact),
        unit: str(r.unit),
        conditions: str(r.conditions),
        exceptions: str(r.exceptions),
        summary: str(r.summary),
        cases: Array.isArray(r.cases) ? r.cases : [],
        applies_if: Array.isArray(r.applies_if) ? r.applies_if : [],
        sub_theme: str(r.sub_theme),
        citizen_title: str(r.citizen_title),
        citizen_summary: str(r.citizen_summary),
        citizen_relevant: r.citizen_relevant !== false,
        validation_status: "brouillon" as const,
      }));
    if (!values.length) return res.status(400).json({ error: "Aucune règle valide (topic + rule_text requis)" });

    const created = await db.insert(zone_regulatory_rules).values(values).returning();
    res.status(201).json({ created });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST /mairie/reglementation/structure-article
// « Agent » de structuration : l'instructeur colle le TEXTE d'un article ; Claude
// (texte court, pas le PDF) renvoie les champs structurés pour pré-remplir le
// formulaire. L'instructeur vérifie puis enregistre.
//
// Streaming SSE : la passerelle (Railway/Cloudflare) coupe sans préavis une
// requête HTTP « silencieuse » qui dépasse ~100 s — l'utilisateur voit alors
// un 502 ALORS QUE Anthropic a déjà facturé la génération. Le stream Anthropic
// est forwardé au client en heartbeats SSE → la passerelle voit du trafic
// régulier → plus de 502. À la fin, on parse l'accumulé et on envoie les
// règles dans un événement `done`.
mairieRouter.post("/reglementation/structure-article", requireRole("mairie", "instructeur", "admin"), async (req: AuthRequest, res) => {
  const { text, zone_code, article_number, image_base64, image_media_type } = req.body as { text?: string; zone_code?: string; article_number?: number | string; image_base64?: string; image_media_type?: string };
  const hasImage = typeof image_base64 === "string" && image_base64.length > 0;
  if ((!text || text.trim().length < 5) && !hasImage) return res.status(400).json({ error: "Texte de l'article ou image requis" });

  // Image (tableau / croquis) → vision : Sonnet lit mieux les tableaux complexes.
  const userContent: Anthropic.ContentBlockParam[] = [];
  if (hasImage) {
    const media = (["image/png", "image/jpeg", "image/webp", "image/gif"].includes(image_media_type ?? "") ? image_media_type : "image/png") as "image/png" | "image/jpeg" | "image/webp" | "image/gif";
    userContent.push({ type: "image", source: { type: "base64", media_type: media, data: image_base64! } });
  }
  const prefix = `${zone_code ? `Zone ${zone_code}. ` : ""}${article_number ? `Article ${article_number}. ` : ""}`;
  userContent.push({ type: "text", text: `${prefix}\n\n${text ?? "(Voir le tableau / croquis fourni en image.)"}` });

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  const send = (data: Record<string, unknown>) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    (res as unknown as { flush?: () => void }).flush?.();
  };

  try {
    send({ type: "started" });

    const client = anthropicClient({ maxRetries: 3, timeout: 120_000 });
    const communeId = await resolveCommuneIdFromUser(req);
    const startedAt = Date.now();

    let accumulated = "";
    let lastHeartbeat = Date.now();
    const stream = client.messages.stream({
      model: "claude-sonnet-4-6",
      max_tokens: 6000,
      system: `Tu es un expert en droit de l'urbanisme français. On te donne le TEXTE d'UN article de règlement PLU (souvent long, avec sous-sections) ET/OU une IMAGE (tableau ou croquis).

Si une IMAGE est fournie : lis-la attentivement. Pour un TABLEAU (ex: stationnement art. 12 — colonne « Type »/« Destination » → colonne « Normes »), CHAQUE LIGNE devient une SOUS-RÈGLE (sub_theme = le type, ex: « Habitation », « Bureaux », « Commerce »). Les tranches/seuils d'une même ligne (ex: « 1 place/40 m² entre 300 et 1000 m² », « 1 place/30 m² au-delà de 1000 m² ») deviennent des "cases" (kind "parametre"). Pour un CROQUIS, décris la règle dans rule_text.

Structure le contenu et renvoie UNIQUEMENT un tableau JSON, sans autre texte. Format de chaque objet :
[
  {
    "sub_theme": string,            // numéro + intitulé de la sous-section, ex: "10.1 Calcul de la hauteur", "10.2 Tolérances", "10.3 Hauteurs relatives — prospect H ≤ L", "10.4 Secteurs UMr / UMs", "10.5 Secteur UMz"
    "article_number": number|null,
    "article_title": string,
    "topic": "interdictions|conditions|desserte_voies|desserte_reseaux|terrain_min|recul_voie|recul_limite|recul_batiments|emprise_sol|hauteur|aspect|stationnement|espaces_verts|cos|general",
    "rule_text": string,            // TEXTE QUALITATIF FIDÈLE de CETTE sous-règle (la prose EST la règle ; ne pas sur-résumer)
    "value_min": number|null, "value_max": number|null, "value_exact": number|null,
    "unit": "m|cm|%|m²|places"|null,
    "conditions": string|null,
    "exceptions": string|null,      // dérogations « sauf… / à l'exception de… / hormis… » PROPRES à cette sous-règle
    "summary": string,              // ≤ 15 mots, décrit CETTE sous-règle (pas l'article entier)
    "cases": [ { "condition": string, "value": number|null, "unit": "m|cm|%|m²|places"|null, "kind": "condition|parametre" } ],
    "applies_if": [ ],              // tags d'applicabilité, parmi : protege_l151_19, unesco, abf, inondable, extension, surelevation, ravalement, demolition, cloture_sur_rue, cloture_limite, annexe, devanture_commerciale, equipement_public. [] si général.
    "citizen_title": string,        // TITRE COURT citoyen (2–5 mots, sans jargon), ex: "Hauteur des maisons", "Clôtures sur la rue", "Places de parking"
    "citizen_summary": string,      // UNE phrase simple, concrète, en « vous », avec la valeur clé. Ex: "Votre maison ne peut pas dépasser 10 mètres de haut." Pas de jargon, pas de n° d'article.
    "citizen_relevant": boolean     // false pour les dispositions sans intérêt pour un particulier : articles « sans objet »/abrogés (loi ALUR : superficie minimale, COS), desserte par les réseaux, voiries internes. true par défaut.
  }
]

DÉCOUPAGE — RÈGLE IMPÉRATIVE :
- UN OBJET PAR SOUS-RÈGLE DISTINCTE de l'article. Un article qui couvre plusieurs thèmes (méthode de calcul, tolérances, règle du prospect, plafonds par secteur, retournement d'angle…) doit produire AUTANT d'objets que de sous-règles autoportantes. Ne fusionne PAS « tolérance », « prospect », « hauteur max en UMr/UMs » et « retournement d'angle UMz » en une règle unique : ce sont des régimes différents avec des valeurs différentes et des applicabilités différentes.
- Quand l'article fournit une sous-section numérotée (10.1, 10.2, …) ou un paragraphe clairement étiqueté (« Calcul : … », « Tolérance : … », « Hauteurs relatives : … », « En secteurs UMr et UMs : … », « Secteur UMz : … », « Retour sur voie adjacente : … »), CHAQUE bloc devient UN objet avec un sub_theme explicite.
- À l'inverse, NE découpe PAS une énumération à l'intérieur d'une même sous-règle : plusieurs valeurs conditionnelles d'une MÊME règle (ex: « 10 m sens unique / 13 m double sens ») = autant de "cases" dans la MÊME règle, JAMAIS une nouvelle règle.
- TABLEAU (image) : chaque LIGNE du tableau (type → norme) = un objet (comme avant).

AUTRES RÈGLES :
- "rule_text" : conserve le sens qualitatif (matériaux, teintes, prescriptions) — pour l'aspect (art. 11) c'est l'essentiel, ne le réduis PAS à un nombre. Reste SYNTHÉTIQUE sur les passages très longs.
- "exceptions" : repère les DÉROGATIONS de CETTE sous-règle (« sauf… », « à l'exception de… », « hormis… »). null si aucune.
- "applies_if" : tague une sous-règle qui ne s'applique qu'à un contexte spécifique. Pour des règles propres à un SECTEUR (UMr, UMs, UMz), précise-le dans sub_theme plutôt que dans applies_if (qui sert aux contextes parcellaires).
- VALEUR PRINCIPALE (value_*) = LE seuil de CETTE sous-règle. Respecte min ("≥") vs max ("≤"). NE MÉLANGE JAMAIS valeur et unité. Si rien de chiffré → value_* null.
- "cases" : à utiliser UNIQUEMENT pour des éléments porteurs d'une VALEUR chiffrée ou d'une vraie ALTERNATIVE conditionnelle au sein d'une MÊME sous-règle.
  NE crée PAS de cases pour une simple énumération QUALITATIVE sans valeur (liste d'occupations interdites, de matériaux…) : elle reste dans "rule_text".
- N'invente AUCUNE valeur. Articles 5 et 14 → "sans objet" (loi ALUR) ET citizen_relevant=false.
- VERSION CITOYEN ("citizen_title" + "citizen_summary") : OBLIGATOIRE par sous-règle, COMPRÉHENSIBLE par quelqu'un qui découvre l'urbanisme. Phrases courtes, mots du quotidien, valeur concrète mise en avant. Évite « emprise au sol » → dis « la surface que votre maison occupe au sol ». Ne recopie PAS les exceptions juridiques dans citizen_summary (elles restent dans "exceptions").`,
      messages: [{ role: "user", content: userContent }],
      },
      client,
    );

    // Forward des deltas de texte en heartbeats : la passerelle voit du
    // trafic, le client peut afficher une progression réelle. On limite à un
    // heartbeat toutes les 1.5 s pour ne pas saturer.
    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        accumulated += event.delta.text;
        if (Date.now() - lastHeartbeat > 1500) {
          send({ type: "progress", chars: accumulated.length });
          lastHeartbeat = Date.now();
        }
      }
    }

    const finalMessage = await stream.finalMessage();
    // Tracking coûts IA (best-effort, n'échoue jamais la requête métier).
    trackClaudeStreamUsage(
      { purpose: "plu_article_structure", userId: req.user?.id ?? null, communeId },
      finalMessage,
      startedAt,
    );
    const raw = accumulated || (finalMessage.content[0]?.type === "text" ? finalMessage.content[0].text : "[]");
    const stopReason = finalMessage.stop_reason;

    // Parsing tolérant : si la réponse est tronquée (max_tokens), on récupère les
    // sous-règles COMPLÈTES en fermant l'array au dernier objet entier.
    const arr = parseLooseArray(raw);
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
    const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
    const APPLIES = new Set(["protege_l151_19", "unesco", "abf", "inondable", "extension", "surelevation", "ravalement", "demolition", "cloture_sur_rue", "cloture_limite", "annexe", "devanture_commerciale", "equipement_public"]);
    let rules = (Array.isArray(arr) ? arr : [])
      .filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
      .map((r) => ({
        sub_theme: str(r.sub_theme),
        article_number: num(r.article_number) ?? (article_number ? Number(article_number) : null),
        article_title: str(r.article_title) ?? "",
        topic: str(r.topic) ?? "general",
        rule_text: str(r.rule_text) ?? "",
        value_min: num(r.value_min), value_max: num(r.value_max), value_exact: num(r.value_exact),
        unit: str(r.unit),
        conditions: str(r.conditions),
        exceptions: str(r.exceptions),
        summary: str(r.summary) ?? "",
        cases: Array.isArray(r.cases)
          ? (r.cases as unknown[]).filter((c): c is Record<string, unknown> => !!c && typeof c === "object")
              .map((c) => ({ condition: str(c.condition) ?? "", value: num(c.value), unit: str(c.unit), kind: c.kind === "condition" ? "condition" : "parametre" }))
              // On ne garde QUE les cas porteurs d'une VALEUR chiffrée (pas de « — m » :
              // une énumération qualitative ou un seuil sans nombre reste dans rule_text).
              .filter((c) => c.condition && c.value != null)
          : [],
        applies_if: Array.isArray(r.applies_if)
          ? (r.applies_if as unknown[]).map(str).filter((t): t is string => !!t && APPLIES.has(t))
          : [],
        citizen_title: str(r.citizen_title),
        citizen_summary: str(r.citizen_summary),
        citizen_relevant: r.citizen_relevant !== false,
      }))
      .filter((r) => r.rule_text || r.summary);

    // Repli : rien d'exploitable → une sous-règle brute avec le texte collé.
    if (rules.length === 0) {
      rules.push({ sub_theme: null, article_number: article_number ? Number(article_number) : null, article_title: "", topic: "general", rule_text: (text ?? "").trim() || "Voir le tableau / croquis fourni.", value_min: null, value_max: null, value_exact: null, unit: null, conditions: null, exceptions: null, summary: "", cases: [], applies_if: [], citizen_title: null, citizen_summary: null, citizen_relevant: true });
    }

    // Diagnostic explicite si la sortie a été coupée — l'instructeur saura
    // qu'il doit raccourcir / découper plutôt que de retenter à l'identique
    // (et repayer les mêmes tokens).
    const diagnostic = stopReason === "max_tokens"
      ? "Réponse IA tronquée (limite de 6000 tokens atteinte). Les règles complètes ont été conservées ; pour récupérer la fin, soumettez le reste de l'article séparément."
      : undefined;

    send({ type: "done", rules, stop_reason: stopReason, diagnostic });
    res.end();
  } catch (err) {
    console.error("[structure-article]", err);
    send({ type: "error", message: err instanceof Error ? err.message : "Échec de l'analyse IA — réessayez ou saisissez manuellement." });
    res.end();
  }
});

// POST /mairie/reglementation/structure-zone
// « Agent » de structuration ZONE : l'instructeur colle le règlement COMPLET d'une
// zone (tous les articles, déjà résumés). Claude (Sonnet) renvoie une liste de
// (sous-)règles découpées par sous-section, chacune pré-remplie ET dotée de sa
// version « citoyen » (titre court + une phrase simple). L'instructeur valide.
//
// Streaming SSE : même justification que structure-article, accentuée ici par
// le max_tokens 16k qui peut prendre 2-3 min. Sans streaming la passerelle
// coupe systématiquement → 502 + facturation perdue.
mairieRouter.post("/reglementation/structure-zone", requireRole("mairie", "instructeur", "admin"), async (req: AuthRequest, res) => {
  const { text, zone_code } = req.body as { text?: string; zone_code?: string };
  // Le seuil bas accepte les chunks courts légitimes (Préambule, article
  // « sans objet ») produits par le découpage par article côté front.
  if (!text || text.trim().length < 10) {
    return res.status(400).json({ error: "Texte vide ou trop court — collez le règlement complet de la zone." });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  const send = (data: Record<string, unknown>) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    (res as unknown as { flush?: () => void }).flush?.();
  };

  try {
    send({ type: "started" });

    const client = anthropicClient({ maxRetries: 2, timeout: 180_000 });
    const communeId = await resolveCommuneIdFromUser(req);
    const startedAt = Date.now();

    let accumulated = "";
    let lastHeartbeat = Date.now();
    const stream = client.messages.stream({
      model: "claude-sonnet-4-6",
      // Un règlement complet (14 articles × plusieurs sous-règles citoyen+mairie)
      // dépasse facilement 6 k tokens et provoquait des sorties tronquées. Avec
      // 16 k on couvre les zones les plus chargées sans surcoût significatif
      // (facturation au token réellement émis).
      max_tokens: 16000,
      system: `Tu es un expert en droit de l'urbanisme français. On te donne le texte d'UN article (ou d'un extrait) de règlement de PLU, souvent déjà résumé, avec valeurs et seuils.

Ta mission : découper ce texte en (SOUS-)RÈGLES exploitables, et pour CHACUNE produire EN PLUS une version « citoyen » en langage courant (pour un particulier qui n'y connaît rien).

DÉCOUPAGE — par SOUS-SECTION :
- Crée UNE règle par sous-section thématique cohérente (chaque puce / paragraphe distinct d'un article). Ex. Article 11 « Aspect » → 4 règles : Bâtiments protégés ; Façades et vitrines ; Toitures ; Clôtures. Article 9 « Emprise au sol » → règle générale + dérogations + extensions.
- Si un article ne contient qu'un seul thème, une seule règle suffit.
- IGNORE complètement les articles « sans objet » / abrogés (loi ALUR : superficie minimale, COS) et les articles « non réglementé ». Ne crée AUCUNE règle pour eux.

Renvoie UNIQUEMENT un tableau JSON, sans autre texte. Format de chaque objet :
[
  {
    "sub_theme": string,            // numéro + intitulé, ex: "7.1 Dans les 15 premiers mètres", "11.4 Clôtures", "12.1 Stationnement automobile"
    "article_number": number|null,  // n° d'article d'origine (1–16)
    "article_title": string,        // intitulé de l'article, ex: "Implantation par rapport aux limites séparatives"
    "topic": "interdictions|conditions|desserte_voies|desserte_reseaux|terrain_min|recul_voie|recul_limite|recul_batiments|emprise_sol|hauteur|aspect|stationnement|espaces_verts|cos|general",
    "rule_text": string,            // texte réglementaire fidèle et synthétique de la sous-règle
    "value_min": number|null, "value_max": number|null, "value_exact": number|null,
    "unit": "m|cm|%|m²|places"|null,
    "conditions": string|null,
    "exceptions": string|null,      // dérogations « sauf… / à l'exception de… / hormis… »
    "summary": string,              // résumé technique ≤ 15 mots (pour la mairie)
    "cases": [ { "condition": string, "value": number|null, "unit": "m|cm|%|m²|places"|null, "kind": "condition|parametre" } ],
    "applies_if": [ ],              // tags : protege_l151_19, unesco, abf, inondable, extension, surelevation, ravalement, demolition, cloture_sur_rue, cloture_limite, annexe, devanture_commerciale, equipement_public. [] si général.
    "citizen_title": string,        // TITRE COURT citoyen (2–5 mots, sans jargon), ex: "Hauteur des maisons", "Clôtures sur la rue", "Places de parking"
    "citizen_summary": string,      // UNE phrase simple, concrète, en « vous », avec la valeur clé. Ex: "Votre maison ne peut pas dépasser 10 mètres de haut." / "Un mur sur rue ne doit pas dépasser 1,80 m." Pas de jargon, pas de n° d'article.
    "citizen_relevant": boolean     // false UNIQUEMENT pour les dispositions purement techniques/administratives sans intérêt pour un particulier (ex: desserte réseaux, voiries internes de lotissement). true par défaut.
  }
]

RÈGLES DE STRUCTURATION :
- VALEUR PRINCIPALE (value_*) = LE seuil de la sous-règle dans une unité COHÉRENTE. Respecte min ("≥","au moins") vs max ("≤","ne dépasse pas"). NE MÉLANGE JAMAIS valeur et unité.
- "cases" : pour les seuils/alternatives chiffrés multiples d'une même sous-règle (ex: voirie 10 m sens unique / 13 m double sens → 2 cases ; stationnement commerces 0/40 m²/30 m² → cases). kind "condition" = alternative exclusive ; "parametre" = valeur cumulative. Pas de case sans valeur chiffrée.
- "applies_if" : tag de contexte (clôtures sur rue → cloture_sur_rue ; éléments protégés → protege_l151_19 ; UNESCO → unesco ; zone inondable → inondable ; extension → extension ; surélévation → surelevation).
- N'invente AUCUNE valeur. Reste fidèle au texte fourni.
- La version « citoyen » doit être COMPRÉHENSIBLE par quelqu'un qui découvre l'urbanisme : phrases courtes, mots du quotidien, valeur concrète mise en avant. Évite « emprise au sol », dis « la surface que votre maison occupe au sol ».`,
      messages: [{ role: "user", content: `${zone_code ? `Zone ${zone_code}.\n\n` : ""}${text}` }],
      },
      client,
    );

    // Forward des deltas en heartbeats : passerelle alive + progression visible.
    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        accumulated += event.delta.text;
        if (Date.now() - lastHeartbeat > 1500) {
          send({ type: "progress", chars: accumulated.length });
          lastHeartbeat = Date.now();
        }
      }
    }

    const finalMessage = await stream.finalMessage();
    trackClaudeStreamUsage(
      { purpose: "plu_zone_structure", userId: req.user?.id ?? null, communeId },
      finalMessage,
      startedAt,
    );
    const raw = accumulated || (finalMessage.content[0]?.type === "text" ? finalMessage.content[0].text : "");
    const stopReason = finalMessage.stop_reason;
    const arr = parseLooseArray(raw);
    // Trace de débogage utile : Claude a parlé mais on n'extrait rien.
    // Pointe à coup sûr vers un nouveau format de sortie (wrapper inconnu,
    // fence non standard…) — le snippet permet d'adapter le parseur.
    if (arr.length === 0 && raw.trim().length > 10) {
      console.warn("[structure-zone] parseLooseArray returned 0 elements from non-empty response", {
        zone_code,
        stop_reason: stopReason,
        raw_length: raw.length,
        raw_head: raw.slice(0, 200),
        raw_tail: raw.slice(-200),
      });
    }
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
    const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
    const APPLIES = new Set(["protege_l151_19", "unesco", "abf", "inondable", "extension", "surelevation", "ravalement", "demolition", "cloture_sur_rue", "cloture_limite", "annexe", "devanture_commerciale", "equipement_public"]);
    const rules = (Array.isArray(arr) ? arr : [])
      .filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
      .map((r) => ({
        sub_theme: str(r.sub_theme),
        article_number: num(r.article_number),
        article_title: str(r.article_title) ?? "",
        topic: str(r.topic) ?? "general",
        rule_text: str(r.rule_text) ?? "",
        value_min: num(r.value_min), value_max: num(r.value_max), value_exact: num(r.value_exact),
        unit: str(r.unit),
        conditions: str(r.conditions),
        exceptions: str(r.exceptions),
        summary: str(r.summary) ?? "",
        cases: Array.isArray(r.cases)
          ? (r.cases as unknown[]).filter((c): c is Record<string, unknown> => !!c && typeof c === "object")
              .map((c) => ({ condition: str(c.condition) ?? "", value: num(c.value), unit: str(c.unit), kind: c.kind === "condition" ? "condition" : "parametre" }))
              .filter((c) => c.condition && c.value != null)
          : [],
        applies_if: Array.isArray(r.applies_if)
          ? (r.applies_if as unknown[]).map(str).filter((t): t is string => !!t && APPLIES.has(t))
          : [],
        citizen_title: str(r.citizen_title),
        citizen_summary: str(r.citizen_summary),
        citizen_relevant: r.citizen_relevant !== false,
      }))
      .filter((r) => r.rule_text || r.summary);

    // Diagnostic explicite quand 0 règle : permet au front d'expliquer
    // précisément le problème à l'instructeur (parsing ko, troncature, article
    // « sans objet », règles dropées car rule_text/summary vides…).
    let diagnostic: string | undefined;
    if (rules.length === 0) {
      if (raw.trim().length === 0) {
        diagnostic = "Réponse IA vide.";
      } else if (arr.length === 0) {
        diagnostic = stopReason === "max_tokens"
          ? "Réponse IA tronquée (max_tokens atteint) et non récupérable. Réessayez ou réduisez la taille du texte."
          : "Réponse IA non parsable (format inattendu).";
      } else {
        diagnostic = `Aucune règle exploitable extraite (${arr.length} objet${arr.length > 1 ? "s" : ""} reçu${arr.length > 1 ? "s" : ""} sans rule_text ni summary). L'article est peut-être « sans objet » ou abrogé.`;
      }
    }

    send({ type: "done", rules, stop_reason: stopReason, diagnostic });
    res.end();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[structure-zone]", msg);
    send({ type: "error", message: `Échec de l'analyse IA : ${msg}` });
    res.end();
  }
});

// POST /mairie/reglementation/zones — create a zone manually
// POST /mairie/reglementation/import-canonical
//
// Ingestion directe d'un règlement PLU au format canonique (HEUREKA Canonical
// PLU v1) — voir packages/ingestion/src/canonical/schema.ts. Aucun appel LLM,
// aucun coût Anthropic, aucune hallucination possible : la DB reflète
// strictement ce qu'on importe. Les règles sont marquées "brouillon" et
// doivent être validées une à une comme pour le pipeline IA.
//
// L'opération PURGE les zones + règles existantes de la commune avant
// réinsertion (transaction). C'est volontaire pour rejouer l'import sans
// laisser de résidus, mais ça veut dire qu'il faut soit exporter d'abord, soit
// confirmer côté UI.

// GET /mairie/documents/search?q=...&insee=...&doc_types=PPRI,OAP&top_k=5
//
// Recherche sémantique RAG dans les documents annexes indexés d'une commune.
// Sert au flux d'instruction (le moteur de verdict appellera ce search pour
// récupérer les passages réglementaires pertinents avec leur citation
// "PPRI, p. 23"), mais est aussi exposé pour debug/exploration manuelle.
mairieRouter.get("/documents/search", requireRole("mairie", "instructeur", "admin"), async (req: AuthRequest, res) => {
  try {
    const query = (req.query.q as string | undefined)?.trim();
    const insee = (req.query.insee as string | undefined)?.trim();
    const doc_types = (req.query.doc_types as string | undefined)?.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
    const top_k = req.query.top_k ? Math.min(Math.max(1, parseInt(req.query.top_k as string, 10)), 20) : 5;

    if (!query || !insee) return res.status(400).json({ error: "q et insee requis" });

    const { searchInCommune } = await import("../services/ragService.js");
    const hits = await searchInCommune({ query, insee, doc_types, top_k });
    res.json({ query, insee, hits });
  } catch (err) {
    console.error("[rag-search]", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Erreur serveur" });
  }
});

// ── Annotations chunk-level (Phase 1 niveau B) ──────────────────────────────
// Permet à l'instructeur d'attacher une note à un passage indexé qui
// remontera AVEC le chunk au moment de la recherche RAG. Gate de validation
// identique à commune_documents / zone_regulatory_rules.

const ANNOTATION_KINDS_SET = new Set(ANNOTATION_KINDS as readonly string[]);
const VALID_STATUSES_SET = new Set(["brouillon", "valide", "rejete"]);

// GET /mairie/documents/:docId/segments — liste les chunks indexés d'un
// document avec leur métadonnée + annotations. Sert au visualiseur côté UI
// pour permettre à l'instructeur d'annoter passage par passage.
mairieRouter.get("/documents/:docId/segments", requireRole("mairie", "instructeur", "admin"), async (req: AuthRequest, res) => {
  try {
    const docId = req.params.docId as string;
    const segs = await db.select({
      id: document_segments.id,
      segment_code: document_segments.segment_code,
      raw_text: document_segments.raw_text,
      metadata: document_segments.metadata,
      char_count: document_segments.char_count,
    })
      .from(document_segments)
      .where(sql`${document_segments.metadata}->>'source_id' = ${docId}`)
      .orderBy(document_segments.segment_code);

    // Annotations TOUTES STATUS (pas seulement validées) — l'instructeur
    // doit voir aussi les brouillons et rejets dans le visualiseur pour les
    // gérer.
    const segmentIds = segs.map((s) => s.id);
    const annsRows = segmentIds.length > 0
      ? await db.select().from(document_segment_annotations)
          .where(inArray(document_segment_annotations.segment_id, segmentIds))
      : [];
    const annsBySegment = new Map<string, typeof annsRows>();
    for (const a of annsRows) {
      const arr = annsBySegment.get(a.segment_id) ?? [];
      arr.push(a);
      annsBySegment.set(a.segment_id, arr);
    }

    res.json(segs.map((s) => ({
      ...s,
      annotations: annsBySegment.get(s.id) ?? [],
    })));
  } catch (err) {
    console.error("[segments:list]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// GET /mairie/documents/:docId/annotations — liste toutes les annotations
// d'un document (tous statuts). Sert au panneau de validation côté UI.
mairieRouter.get("/documents/:docId/annotations", requireRole("mairie", "instructeur", "admin"), async (req: AuthRequest, res) => {
  try {
    const docId = req.params.docId as string;
    const rows = await db.select().from(document_segment_annotations)
      .where(eq(document_segment_annotations.source_id, docId))
      .orderBy(desc(document_segment_annotations.created_at));
    res.json(rows);
  } catch (err) {
    console.error("[annotations:list]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST /mairie/segments/:segmentId/annotations — créer une annotation.
// Le statut initial est "brouillon" — il faut une action explicite de
// validation pour qu'elle remonte dans le RAG.
mairieRouter.post("/segments/:segmentId/annotations", requireRole("mairie", "instructeur", "admin"), async (req: AuthRequest, res) => {
  try {
    const segmentId = req.params.segmentId as string;
    const { kind, note, applies_if } = req.body as { kind?: string; note?: string; applies_if?: string[] };

    if (!note || !note.trim()) return res.status(400).json({ error: "note requise" });
    const finalKind = kind && ANNOTATION_KINDS_SET.has(kind) ? kind : "precision";

    // Récupère le segment pour reporter source_id (= commune_documents.id).
    const [seg] = await db.select({ id: document_segments.id, metadata: document_segments.metadata })
      .from(document_segments).where(eq(document_segments.id, segmentId)).limit(1);
    if (!seg) return res.status(404).json({ error: "Segment introuvable" });
    const meta = (seg.metadata ?? {}) as Record<string, unknown>;
    const sourceId = typeof meta.source_id === "string" ? meta.source_id : null;
    if (!sourceId) return res.status(400).json({ error: "Segment sans source_id (incohérence d'index)" });

    const [created] = await db.insert(document_segment_annotations).values({
      segment_id: segmentId,
      source_id: sourceId,
      kind: finalKind,
      note: note.trim(),
      applies_if: Array.isArray(applies_if) ? applies_if : [],
      validation_status: "brouillon",
      author_user_id: req.user?.id ?? null,
    }).returning();

    res.status(201).json(created);
  } catch (err) {
    console.error("[annotations:create]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// PATCH /mairie/annotations/:id — modifier OU valider/rejeter.
// Toute modification de la note rebascule en brouillon (anti-édit silencieux).
mairieRouter.patch("/annotations/:id", requireRole("mairie", "instructeur", "admin"), async (req: AuthRequest, res) => {
  try {
    const id = req.params.id as string;
    const { note, kind, applies_if, validation_status } = req.body as {
      note?: string; kind?: string; applies_if?: string[];
      validation_status?: "brouillon" | "valide" | "rejete";
    };

    const patch: {
      note?: string; kind?: string; applies_if?: string[];
      validation_status?: string; validated_by?: string | null; validated_at?: Date | null;
      updated_at: Date;
    } = { updated_at: new Date() };

    const noteChanged = note !== undefined;
    if (noteChanged) {
      if (!note.trim()) return res.status(400).json({ error: "note non vide requise" });
      patch.note = note.trim();
    }
    if (kind !== undefined) {
      if (!ANNOTATION_KINDS_SET.has(kind)) return res.status(400).json({ error: "kind invalide" });
      patch.kind = kind;
    }
    if (applies_if !== undefined) {
      if (!Array.isArray(applies_if)) return res.status(400).json({ error: "applies_if doit être un tableau" });
      patch.applies_if = applies_if;
    }

    if (validation_status) {
      if (!VALID_STATUSES_SET.has(validation_status)) {
        return res.status(400).json({ error: "validation_status invalide" });
      }
      patch.validation_status = validation_status;
      if (validation_status === "valide") {
        if (!req.user?.id) return res.status(401).json({ error: "Authentification requise pour valider" });
        patch.validated_by = req.user.id;
        patch.validated_at = new Date();
      } else {
        patch.validated_by = null;
        patch.validated_at = null;
      }
    } else if (noteChanged || kind !== undefined || applies_if !== undefined) {
      // Édition de fond sans validation explicite → bascule auto en brouillon.
      patch.validation_status = "brouillon";
      patch.validated_by = null;
      patch.validated_at = null;
    }

    const [updated] = await db.update(document_segment_annotations).set(patch)
      .where(eq(document_segment_annotations.id, id)).returning();
    if (!updated) return res.status(404).json({ error: "Annotation introuvable" });
    res.json(updated);
  } catch (err) {
    console.error("[annotations:patch]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

mairieRouter.delete("/annotations/:id", requireRole("mairie", "instructeur", "admin"), async (req: AuthRequest, res) => {
  try {
    await db.delete(document_segment_annotations).where(eq(document_segment_annotations.id, req.params.id as string));
    res.json({ ok: true });
  } catch (err) {
    console.error("[annotations:delete]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

mairieRouter.post(
  "/reglementation/import-canonical",
  requireRole("mairie", "instructeur", "admin"),
  async (req: AuthRequest, res) => {
    try {
      const { parseCanonical, importCanonical } = await import("@heureka-v1/ingestion/canonical");
      const parsed = parseCanonical(req.body);
      if (!parsed.ok) {
        return res.status(400).json({
          error: "Format canonique invalide",
          schema_errors: parsed.errors,
        });
      }
      const result = await importCanonical(parsed.data!);
      res.json({
        ok: true,
        ...result,
        warnings: parsed.warnings ?? [],
      });
    } catch (err) {
      console.error("[import-canonical]", err);
      res.status(500).json({ error: err instanceof Error ? err.message : "Erreur serveur" });
    }
  },
);

mairieRouter.post("/reglementation/zones", async (req: AuthRequest, res) => {
  try {
    const { insee_code, commune_name, zone_code, zone_label, zone_type } = req.body as {
      insee_code?: string; commune_name?: string;
      zone_code: string; zone_label: string; zone_type: string;
    };
    if (!zone_code || !zone_label || !zone_type) return res.status(400).json({ error: "zone_code, zone_label, zone_type requis" });
    if (!insee_code && !commune_name) return res.status(400).json({ error: "insee_code ou commune_name requis" });

    const [commune] = await db.select().from(communes)
      .where(insee_code ? eq(communes.insee_code, insee_code) : ilike(communes.name, `%${commune_name!}%`))
      .limit(1);
    if (!commune) return res.status(404).json({ error: "Commune non trouvée" });

    const [zone] = await db.insert(zones).values({
      commune_id: commune.id,
      zone_code: zone_code.toUpperCase(),
      zone_label,
      zone_type,
      summary: "",
      status: "active",
      is_active: true,
    }).returning();
    res.status(201).json(zone);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// DELETE /mairie/reglementation/zones/:id — delete a zone and its rules
mairieRouter.delete("/reglementation/zones/:id", async (req: AuthRequest, res) => {
  try {
    await db.delete(zone_regulatory_rules).where(eq(zone_regulatory_rules.zone_id, req.params.id as string));
    await db.delete(zones).where(eq(zones.id, req.params.id as string));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// PATCH /mairie/reglementation/zones/:id — update zone label/summary
mairieRouter.patch("/reglementation/zones/:id", async (req: AuthRequest, res) => {
  try {
    const { zone_label, summary } = req.body as { zone_label?: string; summary?: string };
    await db.update(zones)
      .set({ ...(zone_label !== undefined && { zone_label }), ...(summary !== undefined && { summary }), updated_at: new Date() })
      .where(eq(zones.id, req.params.id as string));
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Proxy APICarto GPU zones (évite le CORS côté navigateur) ─────────────────
// GET /mairie/plu-zones?insee_code=37018 (or legacy ?commune=Ballan-Miré)
// Cache à 3 niveaux : navigateur (ETag + max-age) → DB Postgres → upstream GPU.

// Headers HTTP : on autorise le cache navigateur 1h, puis stale-while-revalidate
// jusqu'à 7 jours — le navigateur sert la version cached instantanément et
// rafraîchit en tâche de fond.
const PLU_CACHE_CONTROL = "private, max-age=3600, stale-while-revalidate=604800";

mairieRouter.get("/plu-zones", async (req: AuthRequest, res) => {
  // Déclaré avant try pour être accessible dans le catch (stale fallback)
  let communeRow: { id: string; plu_zones_geojson: unknown; plu_zones_cached_at: Date | null } | undefined;

  try {
    let inseeCode = (req.query.insee_code as string | undefined)?.trim();
    const communeName = (req.query.commune as string | undefined)?.trim();

    if (!inseeCode && !communeName) {
      return res.status(400).json({ error: "insee_code ou commune requis" });
    }

    // Résolution du code INSEE si non fourni (chemin legacy)
    if (!inseeCode && communeName) {
      const r = await fetch(
        `https://geo.api.gouv.fr/communes?nom=${encodeURIComponent(communeName)}&fields=code&limit=1`,
        { signal: AbortSignal.timeout(8000) }
      ).catch(() => null);
      if (r?.ok) inseeCode = ((await r.json()) as Array<{ code?: string }>)[0]?.code ?? undefined;
    }
    if (!inseeCode) return res.status(404).json({ error: "Commune non trouvée" });

    // `?refresh=1` force un re-fetch (utile après changement du PLU ou bug fix
    // côté pipeline d'extraction — sans attendre l'expiration du cache de 7 j).
    const forceRefresh = req.query.refresh === "1" || req.query.refresh === "true";

    // Charge le cache DB (survit aux redémarrages serveur)
    communeRow = (await db.select({ id: communes.id, plu_zones_geojson: communes.plu_zones_geojson, plu_zones_cached_at: communes.plu_zones_cached_at })
      .from(communes).where(eq(communes.insee_code, inseeCode)).limit(1))[0];

    const sendCached = (zones: unknown, cachedAt: Date | null, hitKind: "DB-HIT" | "STALE") => {
      // Re-filtre par INSEE à la lecture : ça nettoie les anciens caches qui
      // contiennent encore les zones limitrophes des communes voisines (avant
      // le fix du filtre). Pas de coût si déjà filtré.
      const cleaned = filterZonesByInsee(zones as PluZonesGeoJson, inseeCode!);
      const etag = pluEtagFor(inseeCode!, cachedAt);
      if (etag) res.setHeader("ETag", etag);
      res.setHeader("Cache-Control", PLU_CACHE_CONTROL);
      res.setHeader("X-PLU-Cache", hitKind);
      if (etag && req.headers["if-none-match"] === etag) {
        return res.status(304).end();
      }
      return res.json(cleaned);
    };

    if (!forceRefresh && communeRow?.plu_zones_geojson && communeRow.plu_zones_cached_at) {
      const ageMs = Date.now() - communeRow.plu_zones_cached_at.getTime();
      if (ageMs < PLU_CACHE_TTL_MS) {
        return sendCached(communeRow.plu_zones_geojson, communeRow.plu_zones_cached_at, "DB-HIT");
      }
    }

    const wantDiag = req.query.diag === "1" || req.query.diag === "true";

    // Cache expiré, inexistant, ou refresh forcé → fetch upstream
    const result = await refreshPluZones(inseeCode);
    if (!result.ok) {
      if (communeRow?.plu_zones_geojson && !wantDiag) {
        return sendCached(communeRow.plu_zones_geojson, communeRow.plu_zones_cached_at, "STALE");
      }
      return res.status(result.status).json({ error: result.error, diag: result.diag });
    }

    const freshAt = new Date();
    const etag = pluEtagFor(inseeCode, freshAt);
    if (etag) res.setHeader("ETag", etag);
    res.setHeader("Cache-Control", PLU_CACHE_CONTROL);
    res.setHeader("X-PLU-Cache", "MISS");
    if (wantDiag) res.json({ zones: result.zones, diag: result.diag });
    else res.json(result.zones);
  } catch (err) {
    console.error("[plu-zones proxy]", err);
    if (communeRow?.plu_zones_geojson) {
      res.setHeader("X-PLU-Cache", "STALE");
      return res.json(communeRow.plu_zones_geojson as object);
    }
    res.status(500).json({ error: "Erreur serveur", detail: String(err) });
  }
});

// ── Courriers : templates & en-tête commune ───────────────────────────────

// Source of truth: commune_insee (stable) > commune name (fallback).
// Creates a minimal commune row on the fly if none exists yet.
async function getCommuneRowForUser(req: AuthRequest) {
  const userId = req.user!.id;

  // Fetch user fields from DB (always up-to-date even with old JWT tokens)
  const [u] = await db.select({ commune: users.commune, commune_insee: users.commune_insee })
    .from(users).where(eq(users.id, userId)).limit(1);

  const inseeCode = req.user!.commune_insee ?? u?.commune_insee;
  const communeName = req.user!.commune ?? u?.commune;

  // 1. Lookup by INSEE code (unambiguous)
  if (inseeCode) {
    const [byInsee] = await db.select().from(communes).where(eq(communes.insee_code, inseeCode)).limit(1);
    if (byInsee) return byInsee;
  }

  // 2. Fallback: lookup by name (ilike then unaccent)
  if (communeName) {
    const name = communeName.trim();
    const [byName] = await db.select().from(communes).where(ilike(communes.name, name)).limit(1);
    if (byName) return byName;
    const [byUnaccent] = await db.select().from(communes)
      .where(sql`unaccent(name) ILIKE unaccent(${name})`).limit(1);
    if (byUnaccent) return byUnaccent;

    // 3. Commune not in table yet — create minimal row
    const [created] = await db.insert(communes).values({
      name,
      insee_code: `tmp_${name.toLowerCase().replace(/[^a-z0-9]/g, "_")}_${Date.now()}`,
    }).returning();
    return created ?? null;
  }

  return null;
}

async function getCommuneForUser(req: AuthRequest): Promise<string | null> {
  const [u] = await db.select({ commune: users.commune, commune_insee: users.commune_insee })
    .from(users).where(eq(users.id, req.user!.id)).limit(1);
  // Prefer INSEE code as the canonical identifier for template ownership
  return u?.commune_insee ?? u?.commune?.trim() ?? null;
}

mairieRouter.get("/templates", async (req: AuthRequest, res) => {
  try {
    const communeKey = await getCommuneForUser(req);
    if (!communeKey) return res.json([]);
    const rows = await db.select().from(courrier_templates)
      .where(sql`commune_insee = ${communeKey} OR (commune_insee IS NULL AND commune ILIKE ${communeKey})`)
      .orderBy(courrier_templates.created_at);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

mairieRouter.post("/templates", async (req: AuthRequest, res) => {
  try {
    const communeKey = await getCommuneForUser(req);
    if (!communeKey) return res.status(400).json({ error: "Commune introuvable" });
    const { name, category = "general", body = "" } = req.body as { name?: string; category?: string; body?: string };
    if (!name?.trim()) return res.status(400).json({ error: "Nom requis" });
    const [tpl] = await db.insert(courrier_templates).values({
      commune_insee: communeKey,
      name: name.trim(),
      category,
      body,
    }).returning();
    res.status(201).json(tpl);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

mairieRouter.put("/templates/:templateId", async (req: AuthRequest, res) => {
  try {
    const templateId = req.params.templateId as string;
    const communeKey = await getCommuneForUser(req);
    const [existing] = await db.select({ commune_insee: courrier_templates.commune_insee, commune: courrier_templates.commune })
      .from(courrier_templates).where(eq(courrier_templates.id, templateId)).limit(1);
    const ownerKey = existing?.commune_insee ?? existing?.commune;
    if (!existing || ownerKey?.toLowerCase() !== communeKey?.toLowerCase()) return res.status(403).json({ error: "Accès refusé" });
    const { name, category, body } = req.body as { name?: string; category?: string; body?: string };
    if (!name?.trim()) return res.status(400).json({ error: "Nom requis" });
    const [tpl] = await db.update(courrier_templates).set({
      name: name.trim(), category: category ?? "general", body: body ?? "", updated_at: new Date(),
    }).where(eq(courrier_templates.id, templateId)).returning();
    res.json(tpl);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

mairieRouter.delete("/templates/:templateId", async (req: AuthRequest, res) => {
  try {
    const templateId = req.params.templateId as string;
    const communeKey = await getCommuneForUser(req);
    const [existing] = await db.select({ commune_insee: courrier_templates.commune_insee, commune: courrier_templates.commune })
      .from(courrier_templates).where(eq(courrier_templates.id, templateId)).limit(1);
    const ownerKey = existing?.commune_insee ?? existing?.commune;
    if (!existing || ownerKey?.toLowerCase() !== communeKey?.toLowerCase()) return res.status(403).json({ error: "Accès refusé" });
    await db.delete(courrier_templates).where(eq(courrier_templates.id, templateId));
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

mairieRouter.get("/commune-letterhead", async (req: AuthRequest, res) => {
  try {
    const commune = await getCommuneRowForUser(req);
    if (!commune) return res.json({ commune_configured: false });
    res.json({
      commune_configured: true,
      letterhead_logo: commune.letterhead_logo ?? commune.logo_url,
      commune_logo_url: commune.logo_url,
      letterhead_title: commune.letterhead_title ?? commune.name,
      letterhead_subtitle: commune.letterhead_subtitle,
      letterhead_address: commune.letterhead_address,
      footer_text: commune.footer_text,
      signature_image: commune.signature_image,
      tampon_image: commune.tampon_image,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

mairieRouter.put("/commune-letterhead", async (req: AuthRequest, res) => {
  try {
    const commune = await getCommuneRowForUser(req);
    if (!commune) return res.status(404).json({ error: "Commune introuvable — vérifiez que votre compte est bien rattaché à une commune dans l'administration." });
    const { letterhead_logo, letterhead_title, letterhead_subtitle, letterhead_address, footer_text, signature_image, tampon_image } = req.body as Record<string, string | null>;
    await db.update(communes).set({
      letterhead_logo: letterhead_logo ?? null,
      letterhead_title: letterhead_title ?? null,
      letterhead_subtitle: letterhead_subtitle ?? null,
      letterhead_address: letterhead_address ?? null,
      footer_text: footer_text ?? null,
      signature_image: signature_image ?? null,
      tampon_image: tampon_image ?? null,
      updated_at: new Date(),
    }).where(eq(communes.id, commune.id));
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Legal mentions (Code de l'urbanisme cache) ────────────────────────────────
mairieRouter.get("/legal-mentions", async (req: AuthRequest, res) => {
  try {
    const dossierType = (req.query.type as string | undefined) ?? "";
    const courrierType = (req.query.courrier_type as string | undefined) ?? "";

    // Map full dossier type name to short code
    const TYPE_SHORT: Record<string, string> = {
      permis_de_construire: "PC",
      declaration_prealable: "DP",
      permis_amenager: "PA",
      permis_demolir: "PD",
      certificat_urbanisme: "CU",
    };
    const dossierShort = TYPE_SHORT[dossierType] ?? dossierType.toUpperCase();

    const rows = await db
      .select()
      .from(legal_mentions)
      .where(eq(legal_mentions.code, CODE_URBANISME_ID))
      .orderBy(legal_mentions.article_ref);

    res.json(rows.map((r) => {
      const ct = (r.courrier_types as string[]) ?? [];
      const dt = (r.dossier_types as string[]) ?? [];
      const matchesCourrier = !courrierType || ct.length === 0 || ct.includes(courrierType);
      const matchesDossier = !dossierShort || dt.length === 0 || dt.includes(dossierShort);
      return { ...r, suggested: matchesCourrier && matchesDossier };
    }));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── GET /api/mairie/commune-users?commune=... ────────────────────────────────
// Returns users with access to a commune (via user_communes OR users.commune)
mairieRouter.get("/commune-users", requireAuth, async (req: AuthRequest, res) => {
  const communeName = (req.query.commune as string) ?? "";
  if (!communeName) return res.json([]);

  // Users linked via user_communes table
  const viaTable = await db
    .select({ id: users.id, prenom: users.prenom, nom: users.nom, email: users.email })
    .from(users)
    .innerJoin(user_communes, eq(user_communes.user_id, users.id))
    .innerJoin(communes, eq(communes.id, user_communes.commune_id))
    .where(sql`lower(${communes.name}) = lower(${communeName})`);

  // Users whose primary commune matches
  const viaPrimary = await db
    .select({ id: users.id, prenom: users.prenom, nom: users.nom, email: users.email })
    .from(users)
    .where(sql`lower(${users.commune}) = lower(${communeName})`);

  // Merge and deduplicate
  const all = [...viaTable];
  const seen = new Set(viaTable.map(u => u.id));
  for (const u of viaPrimary) {
    if (!seen.has(u.id)) { all.push(u); seen.add(u.id); }
  }

  res.json(all.sort((a, b) => a.nom.localeCompare(b.nom)));
});

// ── Référentiel documentaire par commune ──────────────────────────────────────

mairieRouter.get("/documents", async (req: AuthRequest, res) => {
  try {
    const communeName = req.query.commune as string | undefined;
    if (!communeName) return res.status(400).json({ error: "Paramètre commune requis" });

    const [commune] = await db.select({ id: communes.id })
      .from(communes).where(ilike(communes.name, communeName)).limit(1);
    if (!commune) return res.json([]);

    const docs = await db.select({
      id: commune_documents.id,
      commune_id: commune_documents.commune_id,
      type: commune_documents.type,
      name: commune_documents.name,
      original_filename: commune_documents.original_filename,
      file_size: commune_documents.file_size,
      synthese: commune_documents.synthese,
      status: commune_documents.status,
      validation_status: commune_documents.validation_status,
      validated_by: commune_documents.validated_by,
      validated_at: commune_documents.validated_at,
      ingested_at: commune_documents.ingested_at,
      created_at: commune_documents.created_at,
    })
      .from(commune_documents)
      .where(eq(commune_documents.commune_id, commune.id))
      .orderBy(commune_documents.type, commune_documents.created_at);

    res.json(docs);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

mairieRouter.post("/documents", async (req: AuthRequest, res) => {
  try {
    const { commune_name, type, name, original_filename, file_size, pdf_base64, synthese } = req.body as {
      commune_name: string;
      type: string;
      name: string;
      original_filename: string;
      file_size?: number;
      pdf_base64?: string;
      synthese?: string;
    };

    if (!commune_name || !type || !name || !original_filename) {
      return res.status(400).json({ error: "Champs requis manquants" });
    }

    const [commune] = await db.select({ id: communes.id, insee_code: communes.insee_code, name: communes.name })
      .from(communes).where(ilike(communes.name, commune_name)).limit(1);
    if (!commune) return res.status(404).json({ error: "Commune introuvable" });

    const [doc] = await db.insert(commune_documents).values({
      commune_id: commune.id,
      type,
      name,
      original_filename,
      file_size: file_size ?? null,
      pdf_content: pdf_base64 ?? null,
      synthese: synthese?.trim() || null,
      status: pdf_base64 ? "indexing" : "uploaded",
    }).returning({
      id: commune_documents.id,
      type: commune_documents.type,
      name: commune_documents.name,
      original_filename: commune_documents.original_filename,
      file_size: commune_documents.file_size,
      synthese: commune_documents.synthese,
      status: commune_documents.status,
      created_at: commune_documents.created_at,
    });

    res.json(doc);

    // Indexation RAG en arrière-plan : on a déjà répondu au client. Si ça
    // échoue (Voyage HS, PDF illisible…), on log et on met le statut en
    // "indexing_error" — le doc reste dans la liste avec un badge clair.
    if (pdf_base64 && doc) {
      void (async () => {
        try {
          const { indexCommuneDocument } = await import("../services/ragService.js");
          const result = await indexCommuneDocument({
            document_id: doc.id,
            insee: commune.insee_code,
            commune_name: commune.name,
            doc_type: type,
            document_name: name,
            original_filename,
            pdf_base64,
          });
          await db.update(commune_documents)
            .set({ status: result.chunks > 0 ? "indexed" : "indexing_empty", ingested_at: new Date(), updated_at: new Date() })
            .where(eq(commune_documents.id, doc.id));
        } catch (err) {
          console.error(`[rag] indexation échouée pour doc=${doc.id}:`, err instanceof Error ? err.message : err);
          await db.update(commune_documents)
            .set({ status: "indexing_error", updated_at: new Date() })
            .where(eq(commune_documents.id, doc.id))
            .catch(() => { /* best-effort */ });
        }
      })();
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// Met à jour la synthèse, le nom, ou le statut de validation d'un document.
//
// Règles importantes (gate juridique) :
//  - Toute modification de la synthèse remet le statut à "brouillon" : un
//    édit non explicitement re-validé ne doit pas continuer d'alimenter
//    l'instruction.
//  - Passer à "valide" exige un utilisateur authentifié (validated_by) et
//    horodate la décision (validated_at) — c'est l'amorce de l'audit trail.
mairieRouter.patch("/documents/:id", async (req: AuthRequest, res) => {
  try {
    const { synthese, name, validation_status } = req.body as {
      synthese?: string | null;
      name?: string;
      validation_status?: "valide" | "brouillon" | "rejete";
    };
    const patch: {
      synthese?: string | null;
      name?: string;
      validation_status?: string;
      validated_by?: string | null;
      validated_at?: Date | null;
      updated_at: Date;
    } = { updated_at: new Date() };

    const sytheseChanged = synthese !== undefined;
    if (sytheseChanged) patch.synthese = synthese?.trim() || null;
    if (name !== undefined && name.trim()) patch.name = name.trim();

    if (validation_status) {
      if (!["valide", "brouillon", "rejete"].includes(validation_status)) {
        return res.status(400).json({ error: "validation_status invalide" });
      }
      patch.validation_status = validation_status;
      if (validation_status === "valide") {
        if (!req.user?.id) return res.status(401).json({ error: "Authentification requise pour valider" });
        patch.validated_by = req.user.id;
        patch.validated_at = new Date();
      } else {
        patch.validated_by = null;
        patch.validated_at = null;
      }
    } else if (sytheseChanged) {
      // Édit de synthèse sans validation explicite → bascule auto en brouillon.
      patch.validation_status = "brouillon";
      patch.validated_by = null;
      patch.validated_at = null;
    }

    const [doc] = await db.update(commune_documents)
      .set(patch)
      .where(eq(commune_documents.id, req.params.id as string))
      .returning({
        id: commune_documents.id,
        type: commune_documents.type,
        name: commune_documents.name,
        synthese: commune_documents.synthese,
        validation_status: commune_documents.validation_status,
        validated_by: commune_documents.validated_by,
        validated_at: commune_documents.validated_at,
      });
    if (!doc) return res.status(404).json({ error: "Document introuvable" });
    res.json(doc);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

mairieRouter.delete("/documents/:id", async (req: AuthRequest, res) => {
  try {
    const documentId = req.params.id as string;
    // Nettoyer l'index RAG avant de supprimer la ligne : sinon on laisse des
    // segments orphelins pointant vers un source_id qui n'existe plus.
    try {
      const { deleteIndexFor } = await import("../services/ragService.js");
      await deleteIndexFor(documentId);
    } catch (err) {
      console.error(`[rag] nettoyage index échoué pour doc=${documentId}:`, err instanceof Error ? err.message : err);
    }
    await db.delete(commune_documents).where(eq(commune_documents.id, documentId));
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// Documents thématiques de la commune du dossier, retournés avec leur synthèse
// pour servir de support à l'instruction (l'outil les consulte avant d'analyser
// la conformité d'une demande).
mairieRouter.get("/dossiers/:id/commune-documents", async (req: AuthRequest, res) => {
  try {
    const [dossier] = await db.select({ commune: dossiers.commune })
      .from(dossiers).where(eq(dossiers.id, req.params.id as string)).limit(1);
    if (!dossier?.commune) return res.json([]);

    const [commune] = await db.select({ id: communes.id })
      .from(communes).where(ilike(communes.name, dossier.commune)).limit(1);
    if (!commune) return res.json([]);

    const docs = await db.select({
      id: commune_documents.id,
      type: commune_documents.type,
      name: commune_documents.name,
      original_filename: commune_documents.original_filename,
      file_size: commune_documents.file_size,
      synthese: commune_documents.synthese,
      status: commune_documents.status,
      validation_status: commune_documents.validation_status,
      validated_at: commune_documents.validated_at,
      created_at: commune_documents.created_at,
    })
      .from(commune_documents)
      .where(eq(commune_documents.commune_id, commune.id))
      .orderBy(commune_documents.type, commune_documents.created_at);
    res.json(docs);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Consultations de services pour un dossier ──

mairieRouter.get("/dossiers/:id/consultations", async (req: AuthRequest, res) => {
  try {
    const rows = await db
      .select()
      .from(dossier_consultations)
      .where(eq(dossier_consultations.dossier_id, req.params.id as string))
      .orderBy(desc(dossier_consultations.created_at));
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

mairieRouter.post("/dossiers/:id/consultations", async (req: AuthRequest, res) => {
  try {
    const { service_name, service_type, avis } = req.body as {
      service_name: string;
      service_type: string;
      avis?: string;
    };
    if (!service_name?.trim() || !service_type?.trim()) {
      return res.status(400).json({ error: "service_name et service_type sont requis" });
    }

    // Resolve external_service_id by matching service_type + dossier commune coverage
    let externalServiceId: string | null = null;
    const [dossierRow] = await db.select({ commune: dossiers.commune })
      .from(dossiers).where(eq(dossiers.id, req.params.id as string)).limit(1);
    if (dossierRow?.commune) {
      const [communeRow] = await db.select({ id: communes.id })
        .from(communes)
        .where(sql`lower(trim(${communes.name})) = lower(trim(${dossierRow.commune}))`)
        .limit(1);
      if (communeRow) {
        const [serviceRow] = await db.select({ id: external_services.id })
          .from(external_services)
          .innerJoin(service_communes, eq(service_communes.service_id, external_services.id))
          .where(and(
            eq(external_services.type, service_type.trim()),
            eq(service_communes.commune_id, communeRow.id),
          ))
          .limit(1);
        externalServiceId = serviceRow?.id ?? null;
      }
    }

    const [row] = await db
      .insert(dossier_consultations)
      .values({
        dossier_id: req.params.id as string,
        service_name: service_name.trim(),
        service_type: service_type.trim(),
        external_service_id: externalServiceId,
        status: "en_attente",
        avis: avis?.trim() ?? null,
        created_by_id: req.user?.id ?? null,
      })
      .returning();
    res.status(201).json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

mairieRouter.patch("/dossiers/:id/consultations/:consultationId", async (req: AuthRequest, res) => {
  try {
    const { status, favorable, avis, date_reponse } = req.body as {
      status?: string;
      favorable?: boolean | null;
      avis?: string;
      date_reponse?: string | null;
    };
    const updates: Record<string, unknown> = { updated_at: new Date() };
    if (status !== undefined) updates.status = status;
    if (favorable !== undefined) updates.favorable = favorable;
    if (avis !== undefined) updates.avis = avis ?? null;
    if (date_reponse !== undefined) updates.date_reponse = date_reponse ? new Date(date_reponse) : null;
    if (status === "avis_recu" && !updates.date_reponse) updates.date_reponse = new Date();

    const [row] = await db
      .update(dossier_consultations)
      .set(updates)
      .where(and(
        eq(dossier_consultations.id, req.params.consultationId as string),
        eq(dossier_consultations.dossier_id, req.params.id as string),
      ))
      .returning();
    if (!row) return res.status(404).json({ error: "Consultation non trouvée" });
    res.json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});
