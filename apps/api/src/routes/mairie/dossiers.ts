import { Router } from "express";
import { db, client as pgClient } from "../../db.js";
import { dossiers, users, instruction_events } from "@heureka-v1/db";
import { eq, desc, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { type AuthRequest } from "../../middlewares/auth.js";
import { inArray } from "drizzle-orm";
import { requireRole } from "../../middlewares/auth.js";
import multer from "multer";
import crypto from "crypto";
import path from "path";
import { z } from "zod";
import { callAi } from "../../services/aiUsage.js";
import { extractFirstJson, sha256Buffer } from "../../services/pieceAnalyzer.js";
import { attachCerfaToDossier } from "../../services/cerfaAttachment.js";
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
// directement à Claude vision, on n'écrit jamais ce fichier sur disque.
const ocrUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
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
    const cursor = commune
      ? pgClient`
          SELECT
            d.numero, d.type, d.status, d.adresse, d.commune, d.code_postal,
            d.parcelle, d.surface_plancher, d.description,
            d.date_depot, d.date_completude, d.date_limite_instruction,
            d.is_tacite, d.created_at, d.updated_at,
            u.prenom AS demandeur_prenom, u.nom AS demandeur_nom, u.email AS demandeur_email
          FROM dossiers d
          LEFT JOIN users u ON u.id = d.user_id
          WHERE d.commune ILIKE ${commune}
          ORDER BY d.created_at DESC
        `.cursor(1000)
      : pgClient`
          SELECT
            d.numero, d.type, d.status, d.adresse, d.commune, d.code_postal,
            d.parcelle, d.surface_plancher, d.description,
            d.date_depot, d.date_completude, d.date_limite_instruction,
            d.is_tacite, d.created_at, d.updated_at,
            u.prenom AS demandeur_prenom, u.nom AS demandeur_nom, u.email AS demandeur_email
          FROM dossiers d
          LEFT JOIN users u ON u.id = d.user_id
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
  type: z.enum(["permis_de_construire", "declaration_prealable", "permis_amenager", "permis_demolir", "permis_lotir", "certificat_urbanisme"]),
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
      metadata: data.metadata ?? {},
      date_depot: validDepot,
    }).returning();

    // Génération + attachement CERFA prérempli (best-effort, comme côté citoyen).
    attachCerfaToDossier(dossier!.id).catch((err) => {
      console.error("[mairie/dossiers] attachCerfaToDossier:", err instanceof Error ? `${err.name}: ${err.message}` : err);
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
// L'opérateur uploade un CERFA scanné ; on appelle Claude vision avec un prompt
// dédié aux métadonnées administratives (type, pétitionnaire, adresse, parcelle,
// surfaces). Le résultat n'est PAS persisté : l'opérateur peut le corriger avant
// de cliquer « Créer le dossier ».
const OCR_CERFA_SYSTEM = `Tu es un agent d'instruction expérimenté qui dépouille un CERFA d'urbanisme scanné (Permis de construire, Déclaration préalable, Permis d'aménager, Permis de démolir, Certificat d'urbanisme).

Ta mission : LIRE ce qui est explicitement écrit ou coché sur le formulaire pour pré-remplir le formulaire d'enregistrement au comptoir. Tu N'INVENTES JAMAIS de valeur.

CHAMPS À EXTRAIRE :
- type : déduis du numéro CERFA en haut du formulaire — 13406 = permis_de_construire_mi (PCMI, maison individuelle) ; 13409 = permis_de_construire (PC autre que maison individuelle, mais aussi PA) ; 13703 = declaration_prealable ; 13405 = permis_demolir ; 13410 = certificat_urbanisme. Pour 13410, regarde les cases cochées en haut du formulaire : « a) Certificat d'urbanisme d'information » → certificat_urbanisme_a ; « b) Certificat d'urbanisme opérationnel » → certificat_urbanisme_b ; si aucune case lisible, mets certificat_urbanisme_b par défaut. Sinon, lis le titre du formulaire.
- numero_cerfa : le numéro complet visible (ex. "13406*08").
- petitionnaire_prenom + petitionnaire_nom : rubrique « Identité du demandeur ». Si une raison sociale est cochée (entreprise), mets la raison sociale dans petitionnaire_nom et laisse prenom vide.
- petitionnaire_email : si visible.
- siret : si une entreprise est déclarée et le SIRET est lisible.
- adresse : adresse du terrain / projet (« 12 rue des Lilas »). Pas l'adresse personnelle du demandeur.
- code_postal + commune : du terrain.
- parcelle : références cadastrales (section + numéro, ex. « AB 142 »). Si plusieurs, concatène séparées par « , ».
- surface_plancher : surface de plancher créée en m² (chiffre seul, ex. "95").
- description : courte phrase libre décrivant le projet si une zone « description du projet » est remplie.

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
    const base64 = buf.toString("base64");
    const fileHash = sha256Buffer(buf);
    const communeIdForTrace = await resolveCommuneIdFromUser(req);

    const documentBlock = sniffed === "pdf"
      ? { type: "document" as const, source: { type: "base64" as const, media_type: "application/pdf" as const, data: base64 } }
      : { type: "image" as const, source: { type: "base64" as const, media_type: (sniffed === "jpeg" ? "image/jpeg" : "image/png") as "image/jpeg" | "image/png", data: base64 } };

    const msg = await callAi(
      { purpose: "ocr_cerfa_admin", dossierId: null, communeId: communeIdForTrace, userId: req.user?.id ?? null, fileHash },
      {
        model: "ai-smart",
        max_tokens: 1500,
        system: OCR_CERFA_SYSTEM,
        messages: [{
          role: "user",
          content: [
            documentBlock,
            { type: "text", text: "Extrais les métadonnées administratives de ce CERFA." },
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
