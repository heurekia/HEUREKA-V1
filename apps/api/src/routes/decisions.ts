import { Router } from "express";
import { db } from "../db.js";
import {
  decisions, decision_events, signataires, users, dossiers,
} from "@heureka-v1/db";
import { eq, and, or, desc, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth.js";
import { requirePermission } from "../middlewares/permissions.js";
import { getCommuneScope, communeInScope } from "../middlewares/dossierAccess.js";
import { changeDossierStatus, ensureAssignedToActor } from "../services/dossierWorkflow.js";
import { notifyUser } from "../services/notify.js";

/**
 * Charge le dossier référencé par une décision et vérifie que sa commune
 * appartient au scope de l'utilisateur connecté. Renvoie le dossier en cas
 * de succès, OU `null` après avoir écrit la réponse 403/404 sur res.
 */
async function loadDossierForDecision(req: AuthRequest, res: import("express").Response, decisionId: string) {
  const [row] = await db.select({
    decision_id: decisions.id,
    dossier_id: decisions.dossier_id,
    commune: decisions.commune,
    dossier_commune: dossiers.commune,
  })
    .from(decisions)
    .leftJoin(dossiers, eq(decisions.dossier_id, dossiers.id))
    .where(eq(decisions.id, decisionId))
    .limit(1);
  if (!row) {
    res.status(404).json({ error: "Décision introuvable" });
    return null;
  }
  const scope = await getCommuneScope(req.user!.id, req.user!.role);
  const targetCommune = row.dossier_commune ?? row.commune;
  if (!communeInScope(targetCommune, scope)) {
    res.status(404).json({ error: "Décision introuvable" });
    return null;
  }
  return row;
}

async function loadDossierForDossierId(req: AuthRequest, res: import("express").Response, dossierId: string) {
  const [row] = await db.select({ id: dossiers.id, commune: dossiers.commune })
    .from(dossiers).where(eq(dossiers.id, dossierId)).limit(1);
  if (!row) {
    res.status(404).json({ error: "Dossier introuvable" });
    return null;
  }
  const scope = await getCommuneScope(req.user!.id, req.user!.role);
  if (!communeInScope(row.commune, scope)) {
    res.status(404).json({ error: "Dossier introuvable" });
    return null;
  }
  return row;
}

export const decisionsRouter = Router();
decisionsRouter.use(requireAuth);

const RECOURS_MOIS: Record<string, number> = {
  permis_de_construire: 2, permis_de_construire_mi: 2,
  declaration_prealable: 2,
  permis_amenager: 2, permis_demolir: 2, permis_lotir: 2,
  certificat_urbanisme: 2, certificat_urbanisme_a: 2, certificat_urbanisme_b: 2,
};

function addMonths(date: Date, months: number): string {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d.toISOString().split("T")[0]!;
}

const instructeurU = alias(users, "instructeur_user");
const signataireU = alias(users, "signataire_user");

// Comparaison de commune insensible à la casse et aux espaces, alignée sur
// getCommuneScope/communeInScope (lower+trim). Indispensable ici car la commune
// d'une décision dérive de dossiers.commune — texte libre saisi tel quel
// (« TOURS ») — alors que signataires.commune provient des Paramètres
// (« Tours »). Un eq() strict ne matchait jamais : le signataire restait
// invisible dans le panneau Décision (« Aucun signataire configuré pour cette
// commune ») et, plus grave, la signature lui était refusée à tort
// (« Vous n'êtes pas signataire actif de cette commune »).
const signataireCommuneEq = (value: string) =>
  sql`lower(trim(${signataires.commune})) = ${value.trim().toLowerCase()}`;

// Le pouvoir de signer — ou de refuser de signer — un arrêté découle de
// l'appartenance ACTIVE à la liste des signataires de la commune, et non du
// rôle de compte. Dans une petite commune, la même personne instruit et signe :
// un agent de rôle « instructeur » désigné signataire doit donc pouvoir agir.
// (C'est cette habilitation, et non le rôle, qui rend visibles l'onglet
// « Signatures » et la liste des arrêtés en attente — cf. /is-signataire et
// /pending, sans restriction de rôle.)
async function isActiveSignataire(userId: string, commune: string): Promise<boolean> {
  const [row] = await db
    .select({ id: signataires.id })
    .from(signataires)
    .where(and(
      eq(signataires.user_id, userId),
      signataireCommuneEq(commune),
      eq(signataires.active, true),
    ))
    .limit(1);
  return !!row;
}

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
  const dossier = await loadDossierForDossierId(req, res, dossierId);
  if (!dossier) return;
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
      // Instructeur AUTEUR de la décision (instructeur_id est NOT NULL : toujours
      // présent). À ne pas confondre avec l'instructeur ASSIGNÉ au dossier, qui
      // peut être « Non assigné ». Le panneau Décision affiche cet auteur dans
      // le circuit de signature (ligne « Instructeur·trice »).
      instructeur: {
        id: instructeurU.id,
        prenom: instructeurU.prenom,
        nom: instructeurU.nom,
      },
      signataire: {
        id: signataireU.id,
        prenom: signataireU.prenom,
        nom: signataireU.nom,
        email: signataireU.email,
      },
    })
    .from(decisions)
    .leftJoin(instructeurU, eq(decisions.instructeur_id, instructeurU.id))
    .leftJoin(signataireU, eq(decisions.signataire_id, signataireU.id))
    .where(eq(decisions.dossier_id, dossierId))
    .orderBy(desc(decisions.created_at))
    .limit(1);
  res.json(rows[0] ?? null);
});

// ── POST /api/decisions/dossier/:dossierId ───────────────────────────────────
// Create or update the draft decision (upsert)
decisionsRouter.post("/dossier/:dossierId", requireRole("mairie", "instructeur", "admin"), requirePermission("dossiers.decision"), async (req: AuthRequest, res) => {
  const { dossierId } = req.params as { dossierId: string };
  const dossier = await loadDossierForDossierId(req, res, dossierId);
  if (!dossier) return;
  const { type, motif, prescriptions, conditions, signataire_id } = req.body as {
    type: string;
    motif?: string;
    prescriptions?: string[];
    conditions?: string;
    signataire_id?: string | null;
  };
  // La commune est dérivée du dossier (source de vérité), jamais du body :
  // un instructeur ne peut pas créer une décision pour une commune dont il
  // n'a pas accès via le scope user_communes.
  const commune = dossier.commune ?? "";
  if (!commune) return res.status(400).json({ error: "Dossier sans commune" });

  // Prise en charge implicite : produire un arrêté est un acte d'instruction.
  // On évite ainsi qu'une décision soit créée (et son bloc signature renseigné)
  // sur un dossier resté « Non assigné ». No-op si déjà pris en charge.
  await ensureAssignedToActor(dossierId, req.user!.id, req.user!.role);

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

  // Le dossier bascule en "décision en cours" — transition imposée par le
  // moteur de décision, donc bypass de la machine à états mais on garde la
  // trace dans instruction_events via le service workflow.
  await changeDossierStatus(dossierId, "decision_en_cours", req.user!.id, {
    bypassStateMachine: true,
    eventType: "decision_initiated",
    reason: "création d'une décision",
    extraMetadata: { decision_id: decision!.id },
  });

  res.json(decision);
});

// ── POST /api/decisions/:id/submit ──────────────────────────────────────────
decisionsRouter.post("/:id/submit", requireRole("mairie", "instructeur", "admin"), requirePermission("dossiers.decision"), async (req: AuthRequest, res) => {
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
    await notifyUser({
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
decisionsRouter.post("/:id/sign", requireRole("mairie", "instructeur", "admin"), async (req: AuthRequest, res) => {
  const { id } = req.params as { id: string };
  const { arrete_numero } = req.body as { arrete_numero?: string };

  const now = new Date();
  const dateStr = now.toISOString().split("T")[0];

  if (!await loadDossierForDecision(req, res, id)) return;
  const existing = await db.select().from(decisions).where(eq(decisions.id, id)).limit(1);
  if (!existing.length) return res.status(404).json({ error: "Décision introuvable" });
  const dec = existing[0]!;
  // Le signataire doit appartenir à la liste active des signataires de la
  // commune de la décision. C'est cette habilitation — et non le rôle de
  // compte — qui autorise la signature : empêche un agent d'une autre commune
  // (mais figurant dans son scope) de signer un arrêté qui ne le concerne pas.
  if (!await isActiveSignataire(req.user!.id, dec.commune)) {
    return res.status(403).json({ error: "Vous n'êtes pas signataire actif de cette commune" });
  }

  // Le circuit de signature ne peut être court-circuité : on ne signe qu'un
  // arrêté effectivement soumis à la signature. Bloque la signature directe
  // d'un brouillon / d'une révision et la re-signature d'un arrêté déjà signé
  // ou notifié (la machine d'état de l'UI ne propose « Signer » que depuis
  // soumis_signature ; ce garde-fou ferme le contournement par appel direct).
  if (dec.status !== "soumis_signature") {
    const already = dec.status === "signe" || dec.status === "notifie";
    return res.status(409).json({
      error: already
        ? "Cet arrêté est déjà signé."
        : "Cet arrêté doit d'abord être soumis à la signature.",
    });
  }

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

  // Update dossier status — transition terminale imposée par la signature.
  const dossierStatus =
    decision.type === "accord" ? "accepte" :
    decision.type === "accord_prescription" || decision.type === "non_opposition_prescription" ? "accord_prescription" :
    "refuse";

  await db.update(dossiers)
    .set({ date_delivrance: now, updated_at: now })
    .where(eq(dossiers.id, decision.dossier_id));
  await changeDossierStatus(decision.dossier_id, dossierStatus as "accepte" | "refuse" | "accord_prescription", req.user!.id, {
    bypassStateMachine: true,
    eventType: "decision_signed",
    reason: "signature de l'arrêté",
    extraMetadata: { decision_id: id, arrete_numero: decision.arrete_numero },
  });

  await db.insert(decision_events).values({
    decision_id: id, user_id: req.user!.id, event_type: "signe",
  });

  await notifyUser({
    user_id: decision.instructeur_id,
    dossier_id: decision.dossier_id,
    type: "decision_signee",
    title: "Arrêté signé",
    message: `L'arrêté ${decision.arrete_numero ?? id} a été signé. Vous pouvez notifier le pétitionnaire.`,
  });

  res.json(decision);
});

// ── POST /api/decisions/:id/refuse-signature ─────────────────────────────────
decisionsRouter.post("/:id/refuse-signature", requireRole("mairie", "instructeur", "admin"), async (req: AuthRequest, res) => {
  const { id } = req.params as { id: string };
  const { motif } = req.body as { motif: string };
  if (!motif || !motif.trim()) return res.status(400).json({ error: "Motif du refus requis" });

  const ctx = await loadDossierForDecision(req, res, id);
  if (!ctx) return;
  // Même règle d'autorisation que la signature : refuser de signer (et renvoyer
  // l'arrêté en révision) est un acte réservé au signataire actif de la commune.
  if (!await isActiveSignataire(req.user!.id, ctx.commune)) {
    return res.status(403).json({ error: "Vous n'êtes pas signataire actif de cette commune" });
  }
  const [decision] = await db
    .update(decisions)
    .set({ status: "revision_necessaire", motif_refus_signature: motif, updated_at: new Date() })
    .where(eq(decisions.id, id))
    .returning();

  if (!decision) return res.status(404).json({ error: "Décision introuvable" });

  await db.insert(decision_events).values({
    decision_id: id, user_id: req.user!.id, event_type: "refuse", note: motif,
  });

  await notifyUser({
    user_id: decision.instructeur_id,
    dossier_id: decision.dossier_id,
    type: "signature_refusee",
    title: "Signature refusée",
    message: `Le projet d'arrêté a été refusé : ${motif}`,
  });

  res.json(decision);
});

// ── POST /api/decisions/:id/notify ──────────────────────────────────────────
decisionsRouter.post("/:id/notify", requireRole("mairie", "instructeur", "admin"), async (req: AuthRequest, res) => {
  const { id } = req.params as { id: string };
  const { date_notification } = req.body as { date_notification?: string };

  if (!await loadDossierForDecision(req, res, id)) return;
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
// Réservé aux agents ET au périmètre commune de l'appelant : la réponse expose
// signature_image / tampon_image (signature manuscrite + cachet officiel), des
// données qui permettraient la contrefaçon d'arrêtés si elles fuyaient.
decisionsRouter.get("/communes/:commune/signataires", requireRole("mairie", "instructeur", "admin"), async (req: AuthRequest, res) => {
  const commune = decodeURIComponent(String(req.params["commune"] ?? ""));
  const scope = await getCommuneScope(req.user!.id, req.user!.role);
  if (!communeInScope(commune, scope)) {
    return res.status(403).json({ error: "Commune hors de votre périmètre" });
  }
  const rows = await db
    .select({
      id: signataires.id,
      user_id: signataires.user_id,
      commune: signataires.commune,
      role: signataires.role,
      fonction: signataires.fonction,
      signature_image: signataires.signature_image,
      tampon_image: signataires.tampon_image,
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
    .where(and(signataireCommuneEq(commune), eq(signataires.active, true)));
  res.json(rows);
});

// ── POST /api/decisions/communes/:commune/signataires ────────────────────────
decisionsRouter.post("/communes/:commune/signataires", requirePermission("signataires.manage"), requireRole("mairie", "admin"), async (req: AuthRequest, res) => {
  const commune = decodeURIComponent(String(req.params["commune"] ?? ""));
  const scope = await getCommuneScope(req.user!.id, req.user!.role);
  if (!communeInScope(commune, scope)) {
    return res.status(403).json({ error: "Commune hors de votre périmètre" });
  }
  const { user_id, role, fonction, signature_image, tampon_image, delegation_arrete, delegation_date } = req.body as {
    user_id: string; role: string; fonction?: string; signature_image?: string; tampon_image?: string;
    delegation_arrete?: string; delegation_date?: string;
  };

  const [row] = await db.insert(signataires).values({
    user_id, commune, role,
    fonction: fonction ?? null,
    signature_image: signature_image ?? null,
    tampon_image: tampon_image ?? null,
    delegation_arrete: delegation_arrete ?? null,
    delegation_date: delegation_date ?? null,
  }).returning();

  res.status(201).json(row);
});

// ── PUT /api/decisions/communes/:commune/signataires/:id ─────────────────────
decisionsRouter.put("/communes/:commune/signataires/:id", requirePermission("signataires.manage"), requireRole("mairie", "admin"), async (req: AuthRequest, res) => {
  const { id } = req.params as { id: string };
  const commune = decodeURIComponent(String(req.params["commune"] ?? ""));
  const scope = await getCommuneScope(req.user!.id, req.user!.role);
  if (!communeInScope(commune, scope)) {
    return res.status(403).json({ error: "Commune hors de votre périmètre" });
  }
  // Anti-IDOR : le :commune (vérifié ci-dessus) ne garantit pas que :id lui
  // appartient. On vérifie la commune RÉELLE du signataire ciblé, sinon un
  // agent pourrait réécrire la signature d'une commune hors de son périmètre
  // en passant un :commune valide et un :id arbitraire.
  const [existingSig] = await db.select({ commune: signataires.commune }).from(signataires).where(eq(signataires.id, id)).limit(1);
  if (!existingSig || !communeInScope(existingSig.commune, scope)) {
    return res.status(404).json({ error: "Signataire introuvable" });
  }
  const { role, fonction, signature_image, tampon_image, delegation_arrete, delegation_date, active } = req.body as {
    role?: string; fonction?: string | null; signature_image?: string | null; tampon_image?: string | null;
    delegation_arrete?: string; delegation_date?: string; active?: boolean;
  };

  const update: Record<string, unknown> = { updated_at: new Date() };
  if (role !== undefined) update.role = role;
  if (fonction !== undefined) update.fonction = fonction;
  if (signature_image !== undefined) update.signature_image = signature_image;
  if (tampon_image !== undefined) update.tampon_image = tampon_image;
  if (delegation_arrete !== undefined) update.delegation_arrete = delegation_arrete;
  if (delegation_date !== undefined) update.delegation_date = delegation_date;
  if (active !== undefined) update.active = active;

  const [row] = await db.update(signataires).set(update).where(eq(signataires.id, id)).returning();
  res.json(row);
});

// ── DELETE /api/decisions/communes/:commune/signataires/:id ──────────────────
decisionsRouter.delete("/communes/:commune/signataires/:id", requirePermission("signataires.manage"), requireRole("mairie", "admin"), async (req: AuthRequest, res) => {
  const { id } = req.params as { id: string };
  const commune = decodeURIComponent(String(req.params["commune"] ?? ""));
  const scope = await getCommuneScope(req.user!.id, req.user!.role);
  if (!communeInScope(commune, scope)) {
    return res.status(403).json({ error: "Commune hors de votre périmètre" });
  }
  // Anti-IDOR : vérifier la commune RÉELLE du signataire ciblé (cf. PUT).
  const [existingSig] = await db.select({ commune: signataires.commune }).from(signataires).where(eq(signataires.id, id)).limit(1);
  if (!existingSig || !communeInScope(existingSig.commune, scope)) {
    return res.status(404).json({ error: "Signataire introuvable" });
  }
  await db.update(signataires).set({ active: false }).where(eq(signataires.id, id));
  res.json({ ok: true });
});

// ── GET /api/decisions/:id/events ────────────────────────────────────────────
// Réservé aux agents ET au périmètre : l'historique contient les motifs de
// refus de signature et les noms d'agents — pas de lecture cross-commune.
decisionsRouter.get("/:id/events", requireRole("mairie", "instructeur", "admin"), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params as { id: string };
    if (!(await loadDossierForDecision(req, res, id))) return;
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
  } catch (err) {
    console.error("[decisions:events]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});
