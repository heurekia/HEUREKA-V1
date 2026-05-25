import { Router } from "express";
import { db } from "../db.js";
import {
  decisions, decision_events, signataires, notifications, users, dossiers,
} from "@heureka-v1/db";
import { eq, and, or, desc } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { requireAuth, type AuthRequest } from "../middlewares/auth.js";

export const decisionsRouter = Router();
decisionsRouter.use(requireAuth);

const RECOURS_MOIS: Record<string, number> = {
  permis_de_construire: 2, declaration_prealable: 2,
  permis_amenager: 2, permis_demolir: 2, permis_lotir: 2,
  certificat_urbanisme: 2,
};

function addMonths(date: Date, months: number): string {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d.toISOString().split("T")[0]!;
}

const instructeurU = alias(users, "instructeur_user");
const signataireU = alias(users, "signataire_user");

// ── GET /api/decisions/pending ──────────────────────────────────────────────
decisionsRouter.get("/pending", async (req: AuthRequest, res) => {
  const rows = await db
    .select({
      id: decisions.id,
      status: decisions.status,
      type: decisions.type,
      commune: decisions.commune,
      motif_refus_signature: decisions.motif_refus_signature,
      prescriptions: decisions.prescriptions,
      arrete_numero: decisions.arrete_numero,
      date_decision: decisions.date_decision,
      created_at: decisions.created_at,
      dossier: {
        id: dossiers.id,
        numero: dossiers.numero,
        type: dossiers.type,
        commune: dossiers.commune,
        adresse: dossiers.adresse,
      },
      instructeur: {
        prenom: instructeurU.prenom,
        nom: instructeurU.nom,
      },
    })
    .from(decisions)
    .leftJoin(dossiers, eq(decisions.dossier_id, dossiers.id))
    .leftJoin(instructeurU, eq(decisions.instructeur_id, instructeurU.id))
    .where(
      and(
        eq(decisions.signataire_id, req.user!.id),
        eq(decisions.status, "soumis_signature"),
      )
    )
    .orderBy(desc(decisions.created_at));
  res.json(rows);
});

// ── GET /api/decisions/is-signataire ────────────────────────────────────────
// Returns whether the current user is an active signataire in any commune
decisionsRouter.get("/is-signataire", async (req: AuthRequest, res) => {
  const rows = await db
    .select({ id: signataires.id })
    .from(signataires)
    .where(and(eq(signataires.user_id, req.user!.id), eq(signataires.active, true)))
    .limit(1);
  res.json({ isSignataire: rows.length > 0 });
});

// ── GET /api/decisions/pending-count ────────────────────────────────────────
decisionsRouter.get("/pending-count", async (req: AuthRequest, res) => {
  const rows = await db
    .select({ id: decisions.id })
    .from(decisions)
    .where(
      and(
        eq(decisions.signataire_id, req.user!.id),
        eq(decisions.status, "soumis_signature"),
      )
    );
  res.json({ count: rows.length });
});

// ── GET /api/decisions/dossier/:dossierId ────────────────────────────────────
decisionsRouter.get("/dossier/:dossierId", async (req: AuthRequest, res) => {
  const { dossierId } = req.params as { dossierId: string };
  const rows = await db
    .select({
      id: decisions.id,
      dossier_id: decisions.dossier_id,
      commune: decisions.commune,
      type: decisions.type,
      motif: decisions.motif,
      prescriptions: decisions.prescriptions,
      conditions: decisions.conditions,
      status: decisions.status,
      instructeur_id: decisions.instructeur_id,
      signataire_id: decisions.signataire_id,
      arrete_numero: decisions.arrete_numero,
      date_decision: decisions.date_decision,
      date_notification: decisions.date_notification,
      date_limite_recours: decisions.date_limite_recours,
      motif_refus_signature: decisions.motif_refus_signature,
      created_at: decisions.created_at,
      updated_at: decisions.updated_at,
      signataire: {
        id: signataireU.id,
        prenom: signataireU.prenom,
        nom: signataireU.nom,
        email: signataireU.email,
      },
    })
    .from(decisions)
    .leftJoin(signataireU, eq(decisions.signataire_id, signataireU.id))
    .where(eq(decisions.dossier_id, dossierId))
    .orderBy(desc(decisions.created_at))
    .limit(1);
  res.json(rows[0] ?? null);
});

// ── POST /api/decisions/dossier/:dossierId ───────────────────────────────────
// Create or update the draft decision (upsert)
decisionsRouter.post("/dossier/:dossierId", async (req: AuthRequest, res) => {
  const { dossierId } = req.params as { dossierId: string };
  const { type, motif, prescriptions, conditions, signataire_id, commune } = req.body as {
    type: string;
    motif?: string;
    prescriptions?: string[];
    conditions?: string;
    signataire_id?: string | null;
    commune: string;
  };

  const existing = await db
    .select({ id: decisions.id })
    .from(decisions)
    .where(
      and(
        eq(decisions.dossier_id, dossierId),
        or(eq(decisions.status, "brouillon"), eq(decisions.status, "revision_necessaire"))
      )
    )
    .limit(1);

  let decision;
  if (existing.length > 0) {
    [decision] = await db
      .update(decisions)
      .set({
        type,
        motif: motif ?? null,
        prescriptions: (prescriptions ?? []) as string[],
        conditions: conditions ?? null,
        signataire_id: signataire_id ?? null,
        motif_refus_signature: null,
        updated_at: new Date(),
      })
      .where(eq(decisions.id, existing[0]!.id))
      .returning();
  } else {
    [decision] = await db
      .insert(decisions)
      .values({
        dossier_id: dossierId,
        commune,
        type,
        motif: motif ?? null,
        prescriptions: (prescriptions ?? []) as string[],
        conditions: conditions ?? null,
        signataire_id: signataire_id ?? null,
        instructeur_id: req.user!.id,
        status: "brouillon",
      })
      .returning();

    await db.insert(decision_events).values({
      decision_id: decision!.id,
      user_id: req.user!.id,
      event_type: "cree",
    });
  }

  // Set dossier to decision_en_cours
  await db.update(dossiers).set({ status: "decision_en_cours" as const, updated_at: new Date() })
    .where(and(eq(dossiers.id, dossierId)));

  res.json(decision);
});

// ── POST /api/decisions/:id/submit ──────────────────────────────────────────
decisionsRouter.post("/:id/submit", async (req: AuthRequest, res) => {
  const { id } = req.params as { id: string };

  const [decision] = await db
    .update(decisions)
    .set({ status: "soumis_signature", updated_at: new Date() })
    .where(
      and(
        eq(decisions.id, id),
        eq(decisions.instructeur_id, req.user!.id),
        or(eq(decisions.status, "brouillon"), eq(decisions.status, "revision_necessaire"))
      )
    )
    .returning();

  if (!decision) return res.status(404).json({ error: "Décision introuvable ou non modifiable" });

  await db.insert(decision_events).values({
    decision_id: id, user_id: req.user!.id, event_type: "soumis",
  });

  if (decision.signataire_id) {
    await db.insert(notifications).values({
      user_id: decision.signataire_id,
      dossier_id: decision.dossier_id,
      type: "signature_requise",
      title: "Signature requise",
      message: `Un projet d'arrêté est en attente de votre signature (commune : ${decision.commune}).`,
    });
  }

  res.json(decision);
});

// ── POST /api/decisions/:id/sign ────────────────────────────────────────────
decisionsRouter.post("/:id/sign", async (req: AuthRequest, res) => {
  const { id } = req.params as { id: string };
  const { arrete_numero } = req.body as { arrete_numero?: string };

  const now = new Date();
  const dateStr = now.toISOString().split("T")[0];

  const existing = await db.select().from(decisions).where(eq(decisions.id, id)).limit(1);
  if (!existing.length) return res.status(404).json({ error: "Décision introuvable" });
  const dec = existing[0]!;

  // Any signataire of the commune can sign, or the assigned signataire
  const dossierRow = await db.select({ type: dossiers.type }).from(dossiers)
    .where(eq(dossiers.id, dec.dossier_id)).limit(1);
  const dossierType = dossierRow[0]?.type ?? "permis_de_construire";
  const recoursMonths = RECOURS_MOIS[dossierType] ?? 2;

  const [decision] = await db
    .update(decisions)
    .set({
      status: "signe",
      signataire_id: req.user!.id,
      arrete_numero: arrete_numero ?? `ARRETE-${now.getFullYear()}-${id.slice(0, 6).toUpperCase()}`,
      date_decision: dateStr,
      date_limite_recours: addMonths(now, recoursMonths),
      motif_refus_signature: null,
      updated_at: now,
    })
    .where(eq(decisions.id, id))
    .returning();

  if (!decision) return res.status(500).json({ error: "Erreur lors de la signature" });

  // Update dossier status
  const dossierStatus =
    decision.type === "accord" ? "accepte" :
    decision.type === "accord_prescription" || decision.type === "non_opposition_prescription" ? "accord_prescription" :
    "refuse";

  await db.update(dossiers)
    .set({ status: dossierStatus as "accepte" | "refuse" | "accord_prescription", date_delivrance: now, updated_at: now })
    .where(eq(dossiers.id, decision.dossier_id));

  await db.insert(decision_events).values({
    decision_id: id, user_id: req.user!.id, event_type: "signe",
  });

  await db.insert(notifications).values({
    user_id: decision.instructeur_id,
    dossier_id: decision.dossier_id,
    type: "decision_signee",
    title: "Arrêté signé",
    message: `L'arrêté ${decision.arrete_numero ?? id} a été signé. Vous pouvez notifier le pétitionnaire.`,
  });

  res.json(decision);
});

// ── POST /api/decisions/:id/refuse-signature ─────────────────────────────────
decisionsRouter.post("/:id/refuse-signature", async (req: AuthRequest, res) => {
  const { id } = req.params as { id: string };
  const { motif } = req.body as { motif: string };

  const [decision] = await db
    .update(decisions)
    .set({ status: "revision_necessaire", motif_refus_signature: motif, updated_at: new Date() })
    .where(eq(decisions.id, id))
    .returning();

  if (!decision) return res.status(404).json({ error: "Décision introuvable" });

  await db.insert(decision_events).values({
    decision_id: id, user_id: req.user!.id, event_type: "refuse", note: motif,
  });

  await db.insert(notifications).values({
    user_id: decision.instructeur_id,
    dossier_id: decision.dossier_id,
    type: "signature_refusee",
    title: "Signature refusée",
    message: `Le projet d'arrêté a été refusé : ${motif}`,
  });

  res.json(decision);
});

// ── POST /api/decisions/:id/notify ──────────────────────────────────────────
decisionsRouter.post("/:id/notify", async (req: AuthRequest, res) => {
  const { id } = req.params as { id: string };
  const { date_notification } = req.body as { date_notification?: string };

  const [decision] = await db
    .update(decisions)
    .set({
      status: "notifie",
      date_notification: date_notification ?? new Date().toISOString().split("T")[0],
      updated_at: new Date(),
    })
    .where(eq(decisions.id, id))
    .returning();

  if (!decision) return res.status(404).json({ error: "Décision introuvable" });

  await db.insert(decision_events).values({
    decision_id: id, user_id: req.user!.id, event_type: "notifie",
  });

  res.json(decision);
});

// ── GET /api/decisions/communes/:commune/signataires ─────────────────────────
decisionsRouter.get("/communes/:commune/signataires", async (req: AuthRequest, res) => {
  const commune = decodeURIComponent(String(req.params["commune"] ?? ""));
  const rows = await db
    .select({
      id: signataires.id,
      user_id: signataires.user_id,
      commune: signataires.commune,
      role: signataires.role,
      delegation_arrete: signataires.delegation_arrete,
      delegation_date: signataires.delegation_date,
      active: signataires.active,
      user: {
        id: users.id,
        prenom: users.prenom,
        nom: users.nom,
        email: users.email,
      },
    })
    .from(signataires)
    .leftJoin(users, eq(signataires.user_id, users.id))
    .where(and(eq(signataires.commune, commune), eq(signataires.active, true)));
  res.json(rows);
});

// ── POST /api/decisions/communes/:commune/signataires ────────────────────────
decisionsRouter.post("/communes/:commune/signataires", async (req: AuthRequest, res) => {
  const commune = decodeURIComponent(String(req.params["commune"] ?? ""));
  const { user_id, role, delegation_arrete, delegation_date } = req.body as {
    user_id: string; role: string; delegation_arrete?: string; delegation_date?: string;
  };

  const [row] = await db.insert(signataires).values({
    user_id, commune, role,
    delegation_arrete: delegation_arrete ?? null,
    delegation_date: delegation_date ?? null,
  }).returning();

  res.status(201).json(row);
});

// ── PUT /api/decisions/communes/:commune/signataires/:id ─────────────────────
decisionsRouter.put("/communes/:commune/signataires/:id", async (req: AuthRequest, res) => {
  const { id } = req.params as { id: string };
  const { role, delegation_arrete, delegation_date, active } = req.body as {
    role?: string; delegation_arrete?: string; delegation_date?: string; active?: boolean;
  };

  const update: Record<string, unknown> = { updated_at: new Date() };
  if (role !== undefined) update.role = role;
  if (delegation_arrete !== undefined) update.delegation_arrete = delegation_arrete;
  if (delegation_date !== undefined) update.delegation_date = delegation_date;
  if (active !== undefined) update.active = active;

  const [row] = await db.update(signataires).set(update).where(eq(signataires.id, id)).returning();
  res.json(row);
});

// ── DELETE /api/decisions/communes/:commune/signataires/:id ──────────────────
decisionsRouter.delete("/communes/:commune/signataires/:id", async (req: AuthRequest, res) => {
  const { id } = req.params as { id: string };
  await db.update(signataires).set({ active: false }).where(eq(signataires.id, id));
  res.json({ ok: true });
});

// ── GET /api/decisions/:id/events ────────────────────────────────────────────
decisionsRouter.get("/:id/events", async (req: AuthRequest, res) => {
  const { id } = req.params as { id: string };
  const rows = await db
    .select({
      id: decision_events.id,
      event_type: decision_events.event_type,
      note: decision_events.note,
      created_at: decision_events.created_at,
      user: { prenom: users.prenom, nom: users.nom },
    })
    .from(decision_events)
    .leftJoin(users, eq(decision_events.user_id, users.id))
    .where(eq(decision_events.decision_id, id))
    .orderBy(desc(decision_events.created_at));
  res.json(rows);
});
