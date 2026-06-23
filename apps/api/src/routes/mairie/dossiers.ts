import { Router } from "express";
import { db, client as pgClient } from "../../db.js";
import { dossiers, users, instruction_events, dossier_pieces_jointes } from "@heureka-v1/db";
import { eq, desc, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { type AuthRequest } from "../../middlewares/auth.js";
import { inArray } from "drizzle-orm";
import { requireRole } from "../../middlewares/auth.js";
import { getCommuneScope, communeScopeFilter } from "../../middlewares/dossierAccess.js";
import multer from "multer";
import crypto from "crypto";
import path from "path";
import { z } from "zod";
import { callAi, convertPdfPagesToPng } from "../../services/aiUsage.js";
import { extractFirstJson, sha256Buffer } from "../../services/pieceAnalyzer.js";
import { attachCerfaToDossier } from "../../services/cerfaAttachment.js";
import { prefetchSitadelHistory } from "../../services/sitadelPrefetch.js";
import { getStorageProvider } from "../../services/storage.js";
import { resolveCommuneIdFromUser } from "./_shared.js";
import {
  computeInstructionDelay,
  applyMonthsToDate,
  type DeadlineMetadata,
  type DeadlineServitude,
} from "../../services/instructionDelays.js";
import {
  changeDossierStatus,
  assignInstructeur,
  unassignInstructeur,
  WorkflowError,
  workflowErrorToHttp,
} from "../../services/dossierWorkflow.js";
import {
  nextStatuses,
  primaryNextAction,
  isTerminal,
  ASSIGNABLE_ROLES,
  type DossierStatus,
} from "@heureka-v1/shared";

// Multer en mémoire pour l'extraction OCR d'un CERFA — le buffer est envoyé
// directement à Pixtral (Mistral) via callAi, on n'écrit jamais ce fichier
// sur disque. Limite 60 Mo : alignée avec la limite "60 Mo" annoncée côté UI
// (MairieApp), couvre les CERFA scannés en haute résolution (≈ 20–40 Mo).
const ocrUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 60 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = /pdf|jpe?g|png/i;
    if (allowed.test(path.extname(file.originalname)) || allowed.test(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Format non supporté (PDF, JPEG, PNG uniquement)"));
    }
  },
});

export const dossiersRouter = Router();

// Pagination défensive : la réponse reste un Array (rétrocompatible avec tous
// les call-sites existants) mais le serveur applique systématiquement un LIMIT.
// Sans cela, sur un parc de 200 000 dossiers, un GET unique chargerait toute
// la table en mémoire → OOM. Le total réel est exposé via le header
// X-Total-Count pour permettre une vraie pagination côté UI.
const DOSSIERS_DEFAULT_LIMIT = 100;
const DOSSIERS_MAX_LIMIT = 500;

dossiersRouter.get("/dossiers", async (req: AuthRequest, res) => {
  try {
    const search = req.query.search as string | undefined;
    const status = req.query.status as string | undefined;
    const commune = req.query.commune as string | undefined;
    const mine = req.query.mine === "true" || req.query.mine === "1";
    const unassigned = req.query.unassigned === "true" || req.query.unassigned === "1";

    const rawLimit = Number.parseInt((req.query.limit as string | undefined) ?? "", 10);
    const limit = Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.min(rawLimit, DOSSIERS_MAX_LIMIT)
      : DOSSIERS_DEFAULT_LIMIT;
    const rawOffset = Number.parseInt((req.query.offset as string | undefined) ?? "", 10);
    const offset = Number.isFinite(rawOffset) && rawOffset > 0 ? rawOffset : 0;

    // Périmètre : le filtre `?commune=` du client est intersecté avec les
    // communes réellement rattachées à l'agent (admin = toutes). Sans ça, un
    // agent pouvait lister les dossiers de n'importe quelle commune.
    const scope = await getCommuneScope(req.user!.id, req.user!.role);
    const communeFilter = communeScopeFilter(sql`dossiers.commune`, scope, commune);
    const assignmentFilter = unassigned
      ? sql`dossiers.instructeur_id IS NULL`
      : mine && req.user?.id
        ? sql`dossiers.instructeur_id = ${req.user.id}`
        : sql`1=1`;

    const instructeurU = alias(users, "instructeur_user");
    // OCR/IA en arrière-plan (dépôt mairie au comptoir) : tant qu'une pièce
    // est encore `pending` ou `processing`, on considère le dossier comme
    // « en cours de chargement » — il sera masqué/grisé dans la liste et son
    // détail renverra 423 (cf. GET /dossiers/:id). Le flag tombe à false
    // automatiquement dès que le worker pieceOcrQueue a fini la dernière
    // pièce, ce qui déclenche aussi la notification « Dossier prêt ».
    const ocrProcessingExpr = sql<boolean>`EXISTS (
      SELECT 1
        FROM dossier_pieces_jointes p
       WHERE p.dossier_id = dossiers.id
         AND p.archived_at IS NULL
         AND p.ocr_status IN ('pending', 'processing')
    )`;
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
      ocr_processing: ocrProcessingExpr,
    };

    const whereClause = search
      ? (() => {
          const pattern = `%${search}%`;
          return sql`(${communeFilter}) AND (${assignmentFilter}) AND dossiers.status != 'brouillon' AND (dossiers.numero ILIKE ${pattern} OR dossiers.adresse ILIKE ${pattern} OR dossiers.commune ILIKE ${pattern} OR users.prenom ILIKE ${pattern} OR users.nom ILIKE ${pattern} OR CONCAT(users.prenom, ' ', users.nom) ILIKE ${pattern})`;
        })()
      : status
        ? sql`(${communeFilter}) AND (${assignmentFilter}) AND dossiers.status = ${status}`
        : sql`(${communeFilter}) AND (${assignmentFilter}) AND dossiers.status != 'brouillon'`;

    const rows = await db.select(sel).from(dossiers)
      .leftJoin(users, eq(dossiers.user_id, users.id))
      .leftJoin(instructeurU, eq(dossiers.instructeur_id, instructeurU.id))
      .where(whereClause)
      .orderBy(desc(dossiers.created_at))
      .limit(limit)
      .offset(offset);

    // Total séparé : utile au frontend pour afficher "X dossiers, page Y/Z"
    // sans charger toutes les lignes. COUNT(*) sur l'index commune/status est
    // peu coûteux comparé au join + ORDER BY.
    const totalRows = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(dossiers)
      .leftJoin(users, eq(dossiers.user_id, users.id))
      .where(whereClause);
    const total = totalRows[0]?.total ?? 0;

    res.setHeader("X-Total-Count", String(total));
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

dossiersRouter.get("/dossiers/export", async (req: AuthRequest, res) => {
  const commune = req.query.commune as string | undefined;

  const esc = (v: unknown): string => {
    if (v === null || v === undefined) return "";
    let s = v instanceof Date ? v.toISOString() : String(v);
    // Anti formula-injection Excel/LibreOffice : toute cellule commençant
    // par =, +, -, @, \t ou \r serait évaluée comme une formule à l'ouverture
    // du fichier. On préfixe ' pour neutraliser tout en restant lisible.
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const headers = [
    "Numéro", "Type", "Statut", "Pétitionnaire", "Email", "Adresse", "Commune",
    "Code postal", "Parcelle", "Surface plancher", "Description",
    "Date dépôt", "Date complétude", "Date limite instruction",
    "Tacite", "Créé le", "Mis à jour le",
  ];

  // Sanitize la commune pour le nom de fichier : seuls a-z0-9-_ sont conservés
  // (évite l'injection de CR/LF dans le header Content-Disposition).
  const safeCommune = (commune ?? "all").toLowerCase().replace(/[^a-z0-9_-]/g, "_").slice(0, 50);
  const filename = `dossiers-${safeCommune}-${new Date().toISOString().slice(0, 10)}.csv`;

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  // BOM UTF-8 pour Excel.
  res.write("﻿");
  res.write(headers.join(",") + "\n");

  try {
    // Même règle de périmètre que la liste : on intersecte ?commune= avec les
    // communes rattachées à l'agent (admin = toutes). postgres.js compose le
    // fragment WHERE — un agent ne peut plus exporter une commune hors scope.
    const scope = await getCommuneScope(req.user!.id, req.user!.role);
    let whereClause;
    if (scope === null) {
      whereClause = commune ? pgClient`d.commune ILIKE ${commune}` : pgClient`true`;
    } else {
      const names = [...scope];
      whereClause = commune
        ? pgClient`lower(trim(d.commune)) = ANY(${names}) AND d.commune ILIKE ${commune}`
        : pgClient`lower(trim(d.commune)) = ANY(${names})`;
    }
    const cursor = pgClient`
          SELECT
            d.numero, d.type, d.status, d.adresse, d.commune, d.code_postal,
            d.parcelle, d.surface_plancher, d.description,
            d.date_depot, d.date_completude, d.date_limite_instruction,
            d.is_tacite, d.created_at, d.updated_at,
            u.prenom AS demandeur_prenom, u.nom AS demandeur_nom, u.email AS demandeur_email
          FROM dossiers d
          LEFT JOIN users u ON u.id = d.user_id
          WHERE ${whereClause}
          ORDER BY d.created_at DESC
        `.cursor(1000);

    for await (const batch of cursor) {
      let chunk = "";
      for (const r of batch) {
        chunk += [
          r.numero, r.type, r.status,
          [r.demandeur_prenom, r.demandeur_nom].filter(Boolean).join(" "),
          r.demandeur_email,
          r.adresse, r.commune, r.code_postal, r.parcelle, r.surface_plancher, r.description,
          r.date_depot, r.date_completude, r.date_limite_instruction,
          r.is_tacite ? "oui" : "non",
          r.created_at, r.updated_at,
        ].map(esc).join(",") + "\n";
      }
      if (!res.write(chunk)) {
        // Backpressure : laisser le socket se vider avant d'écrire le batch suivant.
        await new Promise<void>(resolve => res.once("drain", resolve));
      }
    }
    res.end();
  } catch (err) {
    console.error(err);
    // Les headers ont déjà été envoyés : on ne peut plus changer le statut,
    // on coupe la réponse pour signaler au client que l'export est incomplet.
    res.destroy(err instanceof Error ? err : new Error("Export failed"));
  }
});

dossiersRouter.get("/dossiers/:id", async (req: AuthRequest, res) => {
  try {
    let [dossier] = await db
      .select()
      .from(dossiers)
      .where(eq(dossiers.id, req.params.id as string))
      .limit(1);
    if (!dossier) return res.status(404).json({ error: "Dossier non trouvé" });

    // Verrou OCR : tant qu'au moins une pièce est en attente/traitement, on
    // refuse l'accès au détail. Le dossier reste visible dans la liste mais
    // marqué « Analyse OCR en cours… ». L'instructeur sera notifié via la
    // cloche quand tout sera prêt (cf. pieceOcrQueue.maybeNotifyDossierReady).
    // 423 Locked plutôt que 404 : on signale explicitement que la ressource
    // existe mais n'est pas encore consultable, l'UI peut afficher un toast.
    const ocrPendingProbe = await pgClient<{ remaining: number; total: number }[]>`
      SELECT
        COUNT(*) FILTER (WHERE ocr_status IN ('pending','processing'))::int AS remaining,
        COUNT(*)::int AS total
        FROM dossier_pieces_jointes
       WHERE dossier_id = ${dossier.id}
         AND archived_at IS NULL
    `;
    const ocrRow = ocrPendingProbe[0] ?? { remaining: 0, total: 0 };
    if (ocrRow.remaining > 0) {
      return res.status(423).json({
        error: "Le dossier n'est pas encore consultable : analyse OCR en cours.",
        ocr_processing: true,
        ocr_remaining: ocrRow.remaining,
        ocr_total: ocrRow.total,
        numero: dossier.numero,
      });
    }

    // Backfill paresseux : les dossiers antérieurs au calcul automatique à la
    // création peuvent avoir une date_limite_instruction NULL. On la calcule
    // depuis la date de complétude si elle existe, sinon depuis le dépôt.
    if (!dossier.date_limite_instruction && (dossier.date_completude || dossier.date_depot)) {
      const baseDate = dossier.date_completude ?? dossier.date_depot!;
      const baseSource = dossier.date_completude ? "completude" : "depot";
      const meta = (dossier.metadata as DeadlineMetadata | null) ?? null;
      const servitudes = (meta as { servitudes?: DeadlineServitude[] } | null)?.servitudes ?? null;
      const calc = computeInstructionDelay(dossier.type, meta, servitudes);
      const dateLimite = applyMonthsToDate(new Date(baseDate), calc.total_mois);
      const newMeta = {
        ...((dossier.metadata as Record<string, unknown>) ?? {}),
        delai: {
          total_mois: calc.total_mois,
          breakdown: calc.breakdown,
          base_date: new Date(baseDate).toISOString(),
          base_date_source: baseSource,
          computed_at: new Date().toISOString(),
        },
      };
      await db
        .update(dossiers)
        .set({ date_limite_instruction: dateLimite, metadata: newMeta, updated_at: new Date() })
        .where(eq(dossiers.id, dossier.id));
      dossier = { ...dossier, date_limite_instruction: dateLimite, metadata: newMeta };
    }
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

dossiersRouter.get("/dossiers/:id/events", async (req: AuthRequest, res) => {
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

dossiersRouter.patch("/dossiers/:id/status", async (req: AuthRequest, res) => {
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

// Correction du type d'autorisation d'un dossier déjà créé. Utile quand
// l'extraction OCR du CERFA a renvoyé un type générique (ex. PC au lieu de
// PCMI) et qu'on souhaite reclassifier sans avoir à recréer le dossier.
// Effets de bord : recalcul de la date limite d'instruction, journalisation
// dans instruction_events, régénération best-effort du CERFA prérempli.
const ALLOWED_DOSSIER_TYPES = new Set([
  "permis_de_construire",
  "permis_de_construire_mi",
  "declaration_prealable",
  "permis_amenager",
  "permis_demolir",
  "permis_lotir",
  "certificat_urbanisme",
  "certificat_urbanisme_a",
  "certificat_urbanisme_b",
]);

dossiersRouter.patch("/dossiers/:id/type", requireRole("mairie", "admin", "instructeur"), async (req: AuthRequest, res) => {
  try {
    const { type, reason } = (req.body ?? {}) as { type?: string; reason?: string | null };
    if (!type || !ALLOWED_DOSSIER_TYPES.has(type)) {
      return res.status(400).json({ error: "Type invalide" });
    }
    const dossierId = req.params.id as string;
    const [before] = await db.select().from(dossiers).where(eq(dossiers.id, dossierId)).limit(1);
    if (!before) return res.status(404).json({ error: "Dossier non trouvé" });
    if (before.type === type) return res.json(before);

    const patch: Record<string, unknown> = {
      type: type as typeof before.type,
      updated_at: new Date(),
    };

    // Recalcul du délai légal : le nouveau type peut décaler la deadline
    // (ex. PC 3 mois → PCMI 2 mois, ou CUa 1 mois → CUb 2 mois).
    const startDate = before.date_completude ?? before.date_depot;
    if (startDate) {
      const meta = (before.metadata as DeadlineMetadata | null) ?? null;
      const servitudes = (meta as { servitudes?: DeadlineServitude[] } | null)?.servitudes ?? null;
      const calc = computeInstructionDelay(type, meta, servitudes);
      patch.date_limite_instruction = applyMonthsToDate(new Date(startDate), calc.total_mois);
      patch.metadata = {
        ...((before.metadata as Record<string, unknown>) ?? {}),
        delai: {
          total_mois: calc.total_mois,
          breakdown: calc.breakdown,
          base_date: new Date(startDate).toISOString(),
          base_date_source: before.date_completude ? "completude" : "depot",
          computed_at: new Date().toISOString(),
        },
      };
    }

    await db.update(dossiers).set(patch).where(eq(dossiers.id, dossierId));
    await db.insert(instruction_events).values({
      dossier_id: dossierId,
      type: "type_changed",
      user_id: req.user?.id ?? null,
      description: `Type d'autorisation : ${before.type} → ${type}`,
      metadata: { previous_type: before.type, new_type: type, reason: reason ?? null },
    });

    // Régénération du CERFA prérempli en best-effort : si le nouveau type
    // déclenche un générateur (ex. PCMI) on remplace la pièce existante.
    void attachCerfaToDossier(dossierId).catch((err) => {
      console.warn("[mairie/dossiers/type] CERFA regen failed:", err);
    });

    const [updated] = await db.select().from(dossiers).where(eq(dossiers.id, dossierId)).limit(1);
    res.json(updated);
  } catch (err) {
    console.error("[mairie/dossiers/type]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

dossiersRouter.patch("/dossiers/:id/deadline", async (req: AuthRequest, res) => {
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

dossiersRouter.patch("/dossiers/:id/assign", requireRole("mairie", "admin"), async (req: AuthRequest, res) => {
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

dossiersRouter.delete("/dossiers/:id/assign", requireRole("mairie", "admin"), async (req: AuthRequest, res) => {
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

// ─────────────────────────────────────────────────────────────────────────
// [TEMP_DELETE_DOSSIER] Suppression définitive d'un dossier — TEMPORAIRE.
//
// Exposé côté mairie le temps que le système tourne sur une base de TEST :
// permet de purger un dossier complet directement depuis la liste (menu « ⋮ »).
// Toutes les lignes filles (pièces, courriers, décisions, consultations,
// événements, facts, analyses…) partent via ON DELETE CASCADE ; les fichiers
// physiques des pièces sont retirés du storage en best-effort.
//
// ⚠️ À RETIRER avant la mise en production réelle. Rechercher "TEMP_DELETE_DOSSIER"
// (back + front) pour le retrait complet.
// ─────────────────────────────────────────────────────────────────────────
dossiersRouter.delete("/dossiers/:id", requireRole("mairie", "admin"), async (req: AuthRequest, res) => {
  try {
    const dossierId = req.params.id as string;
    // enforceDossierAccess (cf. mairie/index.ts) a déjà chargé le dossier et
    // vérifié le périmètre commune : on arrive ici uniquement si l'agent y a
    // accès. Un dossier inexistant aurait renvoyé 404 en amont.

    // Purge best-effort des fichiers physiques des pièces jointes : le reste
    // (lignes en base) part en cascade SQL au DELETE du dossier. Un échec
    // storage ne doit pas empêcher la suppression en base.
    try {
      const pieces = await db
        .select({ url: dossier_pieces_jointes.url })
        .from(dossier_pieces_jointes)
        .where(eq(dossier_pieces_jointes.dossier_id, dossierId));
      const storage = getStorageProvider();
      const keys = pieces
        .map((p) => p.url)
        .filter((u): u is string => !!u)
        .map((u) => storage.keyFromUrl(u));
      if (keys.length > 0) await storage.removeBulk(keys);
    } catch (storageErr) {
      console.error("[TEMP_DELETE_DOSSIER] purge storage échouée (poursuite suppression base)", storageErr);
    }

    await db.delete(dossiers).where(eq(dossiers.id, dossierId));
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

dossiersRouter.post("/dossiers/:id/take-charge", async (req: AuthRequest, res) => {
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

// ── Création d'un dossier au comptoir (mairie) ──
// Saisie manuelle OU finalisation d'une extraction OCR. La pétitionnaire n'a
// pas nécessairement de compte citoyen : on crée un utilisateur placeholder
// (rôle citoyen, mot de passe aléatoire non utilisable) pour respecter la
// FK dossiers.user_id. Le dossier est créé directement en statut "soumis"
// (la mairie l'enregistre déjà au comptoir, donc plus de stade brouillon).
const mairieCreateDossierSchema = z.object({
  type: z.enum([
    "permis_de_construire",
    "permis_de_construire_mi",
    "declaration_prealable",
    "permis_amenager",
    "permis_demolir",
    "permis_lotir",
    "certificat_urbanisme",
    "certificat_urbanisme_a",
    "certificat_urbanisme_b",
  ]),
  petitionnaire_nom: z.string().trim().min(1, "Pétitionnaire requis"),
  petitionnaire_prenom: z.string().trim().optional(),
  petitionnaire_email: z.string().trim().email().optional().or(z.literal("")),
  adresse: z.string().trim().optional(),
  commune: z.string().trim().optional(),
  code_postal: z.string().trim().optional(),
  parcelle: z.string().trim().optional(),
  surface_plancher: z.string().trim().optional(),
  description: z.string().trim().optional(),
  date_depot: z.string().trim().optional(),
  instructeur_id: z.string().uuid().optional().or(z.literal("")),
  metadata: z.record(z.unknown()).optional(),
});

dossiersRouter.post("/dossiers", async (req: AuthRequest, res) => {
  try {
    const data = mairieCreateDossierSchema.parse(req.body);

    // Découpage nom complet « Marie DUPONT » → prenom + nom si non fourni.
    let prenom = data.petitionnaire_prenom?.trim() || "";
    let nom = data.petitionnaire_nom.trim();
    if (!prenom) {
      const parts = nom.split(/\s+/);
      if (parts.length >= 2) {
        prenom = parts[0]!;
        nom = parts.slice(1).join(" ");
      } else {
        prenom = "—";
      }
    }

    // Email cible : fourni ou synthétique. Le synthétique reste unique grâce
    // au crypto.randomUUID() ; un échec d'unicité (rarissime) provoque un 500
    // que l'opérateur pourra rejouer.
    const providedEmail = data.petitionnaire_email?.trim().toLowerCase();
    let petitionnaireUserId: string;
    if (providedEmail) {
      const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, providedEmail)).limit(1);
      if (existing) {
        petitionnaireUserId = existing.id;
      } else {
        const { default: bcrypt } = await import("bcryptjs");
        const hash = await bcrypt.hash(crypto.randomBytes(32).toString("hex"), 10);
        const [created] = await db.insert(users).values({
          email: providedEmail,
          password_hash: hash,
          prenom,
          nom,
          role: "citoyen",
          commune: data.commune ?? req.user?.commune ?? null,
        }).returning({ id: users.id });
        petitionnaireUserId = created!.id;
      }
    } else {
      const { default: bcrypt } = await import("bcryptjs");
      const hash = await bcrypt.hash(crypto.randomBytes(32).toString("hex"), 10);
      const syntheticEmail = `dossier-${crypto.randomUUID()}@placeholder.heureka.local`;
      const [created] = await db.insert(users).values({
        email: syntheticEmail,
        password_hash: hash,
        prenom,
        nom,
        role: "citoyen",
        commune: data.commune ?? req.user?.commune ?? null,
      }).returning({ id: users.id });
      petitionnaireUserId = created!.id;
    }

    // TODO PLAT'AU : remplacer ce numéro local par celui retourné par
    // l'API PLAT'AU (réservation de numéro national de dossier) une fois le
    // raccordement effectué. En attendant on garde le format historique
    // DOS-<base36 timestamp>-<hex aléatoire> aligné avec la route citoyen.
    const numero = `DOS-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
    const depotDate = data.date_depot ? new Date(data.date_depot) : new Date();
    const validDepot = Number.isFinite(depotDate.getTime()) ? depotDate : new Date();

    const instructeurId = data.instructeur_id && data.instructeur_id !== "" ? data.instructeur_id : null;

    // Calcul de l'échéance dès la création : base juridique = date de dépôt
    // (R.423-23) tant que la complétude n'est pas prononcée. Sera recalculée
    // depuis date_completude lors de l'auto-bascule en instruction.
    const rawMeta = (data.metadata ?? {}) as Record<string, unknown>;
    const deadlineMeta = rawMeta as DeadlineMetadata;
    const servitudes = (rawMeta as { servitudes?: DeadlineServitude[] }).servitudes ?? null;
    const delaiCalc = computeInstructionDelay(data.type, deadlineMeta, servitudes);
    const dateLimite = applyMonthsToDate(validDepot, delaiCalc.total_mois);
    const metadataWithDelai: Record<string, unknown> = {
      ...rawMeta,
      delai: {
        total_mois: delaiCalc.total_mois,
        breakdown: delaiCalc.breakdown,
        base_date: validDepot.toISOString(),
        base_date_source: "depot",
        computed_at: new Date().toISOString(),
      },
    };

    const [dossier] = await db.insert(dossiers).values({
      numero,
      type: data.type,
      status: "soumis",
      user_id: petitionnaireUserId,
      instructeur_id: instructeurId,
      adresse: data.adresse ?? null,
      commune: data.commune ?? req.user?.commune ?? null,
      code_postal: data.code_postal ?? null,
      parcelle: data.parcelle ?? null,
      surface_plancher: data.surface_plancher ?? null,
      description: data.description ?? null,
      metadata: metadataWithDelai,
      date_depot: validDepot,
      date_limite_instruction: dateLimite,
    }).returning();

    // Génération + attachement CERFA prérempli (best-effort, comme côté citoyen).
    attachCerfaToDossier(dossier!.id).catch((err) => {
      console.error("[mairie/dossiers] attachCerfaToDossier:", err instanceof Error ? `${err.name}: ${err.message}` : err);
    });

    // Pré-chargement de l'historique SITADEL en tâche de fond (best-effort) :
    // balayage complet de la commune mis en cache, pour que l'onglet Parcelle
    // l'affiche instantanément sans rater une autorisation ancienne.
    prefetchSitadelHistory(dossier!.id).catch((err) => {
      console.error("[mairie/dossiers] prefetchSitadelHistory:", err instanceof Error ? `${err.name}: ${err.message}` : err);
    });

    res.status(201).json(dossier);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: "Données invalides", details: err.errors });
    }
    console.error("[mairie/dossiers]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Extraction OCR d'un CERFA pour pré-remplir le formulaire de création ──
// L'opérateur uploade un CERFA scanné ; on appelle Pixtral avec un prompt
// dédié aux métadonnées administratives (type, pétitionnaire, adresse, parcelle,
// surfaces). Le résultat n'est PAS persisté : l'opérateur peut le corriger avant
// de cliquer « Créer le dossier ».
const OCR_CERFA_SYSTEM = `Tu es un agent d'instruction expérimenté qui dépouille un CERFA d'urbanisme scanné (Permis de construire, Déclaration préalable, Permis d'aménager, Permis de démolir, Certificat d'urbanisme).

Ta mission : LIRE ce qui est explicitement écrit ou coché sur le formulaire pour pré-remplir le formulaire d'enregistrement au comptoir. Tu N'INVENTES JAMAIS de valeur.

IMPORTANT — MULTI-PAGES : tu vas recevoir PLUSIEURS images, chacune correspondant à une page successive du même CERFA (page 1, puis page 2, etc.). Tu DOIS examiner CHAQUE image avant de répondre. Sur un PCMI ou un PC, les rubriques sont réparties ainsi :
- Page 1 : numéro CERFA en haut, identité du demandeur (cadre 1), parfois email/téléphone.
- Page 2 : terrain (cadre 2) — adresse du projet, code postal, commune, références cadastrales (section + numéro, ex. « AB 142 »), superficie du terrain.
- Page 3 : projet (cadre 4) — nature des travaux, destination, surface de plancher créée en m², description courte du projet.

Ne te limite JAMAIS à la première page : balaye systématiquement toutes les images jusqu'à avoir trouvé chaque champ, ou conclu qu'il n'est pas rempli.

CHAMPS À EXTRAIRE :
- type : déduis du numéro CERFA en haut du formulaire (page 1) — 13406 = permis_de_construire_mi (PCMI, maison individuelle) ; 13409 = permis_de_construire (PC autre que maison individuelle, mais aussi PA) ; 13703 = declaration_prealable ; 13405 = permis_demolir ; 13410 = certificat_urbanisme. Pour 13410, regarde les cases cochées en haut du formulaire : « a) Certificat d'urbanisme d'information » → certificat_urbanisme_a ; « b) Certificat d'urbanisme opérationnel » → certificat_urbanisme_b ; si aucune case lisible, mets certificat_urbanisme_b par défaut. Sinon, lis le titre du formulaire.
- numero_cerfa : le numéro complet visible page 1 (ex. "13406*08").
- petitionnaire_prenom + petitionnaire_nom : cadre « Identité du demandeur » page 1. Si une raison sociale est cochée (entreprise), mets la raison sociale dans petitionnaire_nom et laisse prenom vide.
- petitionnaire_email : si visible (page 1, parfois page 2).
- siret : si une entreprise est déclarée et le SIRET est lisible.
- adresse : adresse du TERRAIN / projet (cadre « Terrain », page 2). Pas l'adresse personnelle du demandeur de la page 1.
- code_postal + commune : du terrain (page 2).
- parcelle : références cadastrales du terrain (page 2). Format « SECTION NUMERO » (ex. « AB 142 »). Si plusieurs parcelles, concatène séparées par « , ».
- surface_plancher : surface de plancher créée en m² (cadre « Le projet », page 3). Chiffre seul (ex. "95").
- description : courte phrase libre décrivant le projet (cadre « Le projet » ou « Nature des travaux », page 3) si une zone descriptive est remplie.

RÈGLES :
- Toute valeur non visiblement écrite → null.
- Pas de markdown, pas de préambule, juste du JSON valide :

{
  "type": "permis_de_construire"|"permis_de_construire_mi"|"declaration_prealable"|"permis_amenager"|"permis_demolir"|"certificat_urbanisme_a"|"certificat_urbanisme_b"|null,
  "numero_cerfa": "13406*08"|null,
  "petitionnaire_prenom": "Jean"|null,
  "petitionnaire_nom": "DUPONT"|null,
  "petitionnaire_email": "jean.dupont@example.com"|null,
  "siret": "12345678900012"|null,
  "adresse": "12 rue des Lilas"|null,
  "code_postal": "37510"|null,
  "commune": "Ballan-Miré"|null,
  "parcelle": "AB 142"|null,
  "surface_plancher": "95"|null,
  "description": "..."|null,
  "confidence": 0.0
}`;

function ocrSniff(buf: Buffer): "pdf" | "jpeg" | "png" | null {
  if (buf.length < 12) return null;
  if (buf.subarray(0, 1024).includes("%PDF")) return "pdf";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg";
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "png";
  return null;
}

function ocrSingle(req: AuthRequest, res: import("express").Response, next: import("express").NextFunction) {
  ocrUpload.single("file")(req, res, (err) => {
    if (err) {
      const message = err instanceof Error ? err.message : "Fichier invalide";
      return res.status(400).json({ error: message });
    }
    next();
  });
}

dossiersRouter.post("/ocr-cerfa", ocrSingle, async (req: AuthRequest, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Fichier requis" });
    const sniffed = ocrSniff(req.file.buffer);
    if (!sniffed) {
      return res.status(400).json({ error: "Format binaire non supporté (PDF, JPEG, PNG)" });
    }

    const buf = req.file.buffer;
    const fileHash = sha256Buffer(buf);
    const communeIdForTrace = await resolveCommuneIdFromUser(req);

    // Pixtral n'accepte pas le PDF natif → on rend les pages utiles en PNG
    // et on les passe en blocs image. C'est nécessaire car les CERFA ont
    // l'adresse du terrain, la parcelle, la surface de plancher et la
    // description du projet sur les pages 2-3 (parfois 4 sur les PA/PC).
    // Plafond à 8 pages : limite dure côté Mistral (code 3051 "Total number
    // of images exceeds the maximum allowed of 8").
    const imageBlocks: Array<{
      type: "image";
      source: { type: "base64"; media_type: "image/png" | "image/jpeg"; data: string };
    }> = [];
    if (sniffed === "pdf") {
      const pages = convertPdfPagesToPng(buf, { maxPages: 8 });
      for (const png of pages) {
        imageBlocks.push({
          type: "image",
          source: { type: "base64", media_type: "image/png", data: png.toString("base64") },
        });
      }
    } else {
      imageBlocks.push({
        type: "image",
        source: {
          type: "base64",
          media_type: sniffed === "jpeg" ? "image/jpeg" : "image/png",
          data: buf.toString("base64"),
        },
      });
    }

    const msg = await callAi(
      { purpose: "ocr_cerfa_admin", dossierId: null, communeId: communeIdForTrace, userId: req.user?.id ?? null, fileHash },
      {
        model: "ai-smart",
        max_tokens: 1500,
        system: OCR_CERFA_SYSTEM,
        messages: [{
          role: "user",
          content: [
            ...imageBlocks,
            { type: "text", text: `Voici ${imageBlocks.length} image${imageBlocks.length > 1 ? "s" : ""} correspondant aux pages successives d'un CERFA d'urbanisme. Examine CHAQUE page avant de répondre, puis extrais l'ensemble des champs demandés. Réponds en JSON strict, sans markdown.` },
          ],
        }],
      },
    );

    const text = msg.content[0]?.type === "text" ? msg.content[0].text : "{}";
    const parsed = extractFirstJson(text) as Record<string, unknown> | null;
    if (!parsed) {
      return res.status(422).json({ error: "Extraction IA non concluante" });
    }

    const validTypes = new Set([
      "permis_de_construire",
      "permis_de_construire_mi",
      "declaration_prealable",
      "permis_amenager",
      "permis_demolir",
      "permis_lotir",
      "certificat_urbanisme",
      "certificat_urbanisme_a",
      "certificat_urbanisme_b",
    ]);
    const str = (v: unknown): string | null => typeof v === "string" && v.trim() ? v.trim() : null;
    const numeroCerfa = str(parsed.numero_cerfa);
    let typeRaw = str(parsed.type);

    // Sécurité : si le numéro CERFA est lu mais que l'IA n'a pas affiné le type
    // (cas typique : elle renvoie l'ancien "permis_de_construire" ou
    // "certificat_urbanisme" générique), on aligne sur le numéro qui fait foi.
    // 13406 = PCMI, 13409 = PC standard, 13410 = CUb par défaut (CUa nécessite
    // une case cochée, déjà gérée par le prompt).
    if (numeroCerfa) {
      const num = numeroCerfa.match(/\d{5}/)?.[0];
      if (num === "13406") typeRaw = "permis_de_construire_mi";
      else if (num === "13409" && typeRaw !== "permis_amenager") typeRaw = "permis_de_construire";
      else if (num === "13410" && typeRaw !== "certificat_urbanisme_a") typeRaw = "certificat_urbanisme_b";
    }

    const type = typeRaw && validTypes.has(typeRaw) ? typeRaw : null;
    const conf = typeof parsed.confidence === "number" ? Math.max(0, Math.min(1, parsed.confidence)) : 0.5;

    res.json({
      type,
      numero_cerfa: numeroCerfa,
      petitionnaire_prenom: str(parsed.petitionnaire_prenom),
      petitionnaire_nom: str(parsed.petitionnaire_nom),
      petitionnaire_email: str(parsed.petitionnaire_email),
      siret: str(parsed.siret),
      adresse: str(parsed.adresse),
      code_postal: str(parsed.code_postal),
      commune: str(parsed.commune),
      parcelle: str(parsed.parcelle),
      surface_plancher: str(parsed.surface_plancher),
      description: str(parsed.description),
      confidence: conf,
    });
  } catch (err) {
    console.error("[mairie/ocr-cerfa]", err);
    res.status(500).json({ error: "Erreur serveur lors de l'extraction OCR" });
  }
});
