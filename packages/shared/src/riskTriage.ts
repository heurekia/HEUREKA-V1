/**
 * Tri & lecture « instruction » des risques et servitudes (onglet Terrain).
 *
 * Objectif : transformer une donnée brute (« Zone sismique 2 », « Zone
 * inondable : non déterminé ») en information ACTIONNABLE pour l'instructeur,
 * et la classer par valeur décisionnelle plutôt que par source.
 *
 * Trois niveaux de lecture :
 *   1. opposable   → contrainte juridiquement opposable au PC/DP qui touche la
 *                    parcelle (SUP, PPR approuvé, prescription surfacique).
 *                    Toujours visible, assortie de sa conséquence d'instruction.
 *   2. vigilance   → porter-à-connaissance / aléa non directement opposable mais
 *                    à confronter au règlement (argiles, sismicité, radon, AZI).
 *   3. contexte    → information de fond, communale et non décisive pour un PC
 *                    précis (repliable). Jamais « dans la figure ».
 *
 * Règle anti-bruit : l'ABSENCE de signal n'est pas un signal. Tout ce qui est
 * « inconnu / non déterminé » n'émet PAS de ligne (`show: false`).
 *
 * Pur (aucune dépendance réseau / UI) — testable et partagé api ↔ web.
 */

export type Opposabilite = "opposable" | "porter_a_connaissance" | "informatif";
export type Maille = "parcelle" | "commune";
export type ConstraintTier = 1 | 2 | 3;
export type ConstraintTone = "danger" | "warn" | "ok" | "info" | "abf" | "neutral";

export interface ConstraintReading {
  /** Émettre une ligne ? `false` = pas de signal exploitable (anti-bruit). */
  show: boolean;
  tier: ConstraintTier;
  /** Titre court et parlant (ex. « Sismicité faible (zone 2) »). */
  label: string;
  /** Conséquence concrète pour l'instruction (avis / pièce / délai / refus). */
  consequence?: string;
  opposabilite: Opposabilite;
  maille: Maille;
  tone: ConstraintTone;
}

// ── Sismicité (arrêté du 22 octobre 2010, décret n°2010-1255) ─────────────────
// La zone seule (« Zone 2 ») ne dit rien à l'instructeur ; on lui adjoint le
// libellé réglementaire ET la conséquence constructive (Eurocode 8 / PS-MI).
const SEISMIC: Record<string, { mot: string; tier: ConstraintTier; tone: ConstraintTone; consequence: string }> = {
  "1": {
    mot: "très faible",
    tier: 3,
    tone: "ok",
    consequence: "Aucune règle parasismique pour les bâtiments courants (catégories I et II).",
  },
  "2": {
    mot: "faible",
    tier: 3,
    tone: "neutral",
    consequence:
      "Règles parasismiques applicables aux bâtiments de catégorie d'importance III et IV (ERP, établissements sensibles). Maisons individuelles courantes non concernées.",
  },
  "3": {
    mot: "modérée",
    tier: 2,
    tone: "warn",
    consequence:
      "Règles parasismiques (Eurocode 8 / PS-MI pour les maisons individuelles) obligatoires dès la catégorie II. Attestation de prise en compte exigible.",
  },
  "4": {
    mot: "moyenne",
    tier: 2,
    tone: "warn",
    consequence:
      "Dimensionnement parasismique (Eurocode 8) obligatoire pour tous les bâtiments à risque normal. Attestation parasismique requise (PCMI / PC).",
  },
  "5": {
    mot: "forte",
    tier: 2,
    tone: "danger",
    consequence:
      "Dimensionnement parasismique renforcé (Eurocode 8) obligatoire. Attestation parasismique systématiquement requise.",
  },
};

export function describeSeismicZone(zone: string | undefined | null): ConstraintReading {
  const z = (zone ?? "").trim();
  const def = SEISMIC[z];
  if (!def) {
    return { show: false, tier: 3, label: "Sismicité non déterminée", opposabilite: "informatif", maille: "commune", tone: "neutral" };
  }
  return {
    show: true,
    tier: def.tier,
    label: `Sismicité ${def.mot} (zone ${z})`,
    consequence: def.consequence,
    opposabilite: "informatif", // zonage national, opposable via les règles de construction (hors champ PLU)
    maille: "commune",
    tone: def.tone,
  };
}

/** Libellé court pour les pastilles de synthèse (« Sismicité faible »). */
export function seismicShortLabel(zone: string | undefined | null): string | null {
  const def = SEISMIC[(zone ?? "").trim()];
  return def ? `Sismicité ${def.mot}` : null;
}

// ── Inondation ────────────────────────────────────────────────────────────────
// « Non déterminé » ne produit AUCUNE ligne. Le niveau d'aléa devient opposable
// (tier 1) dès qu'un PPRI/PM1 couvre la parcelle, sinon porter-à-connaissance.
export function describeFloodRisk(level: string | undefined | null, hasPpri = false): ConstraintReading {
  const l = (level ?? "inconnu").trim();
  if (l === "inconnu") {
    return { show: false, tier: 3, label: "Inondation non déterminée", opposabilite: "informatif", maille: "commune", tone: "neutral" };
  }
  if (l === "nul") {
    return {
      show: true,
      tier: 3,
      label: "Hors zone inondable connue",
      opposabilite: "informatif",
      maille: "parcelle",
      tone: "ok",
    };
  }
  const motAlea = l === "fort" ? "fort" : l === "moyen" ? "moyen" : "faible";
  const tone: ConstraintTone = l === "fort" ? "danger" : "warn";
  if (hasPpri) {
    return {
      show: true,
      tier: 1,
      label: `Zone inondable — aléa ${motAlea}`,
      consequence:
        "PPRI opposable : appliquer le règlement de zone du PPRI (cote de référence, prescriptions de construction). Pièce spécifique exigible.",
      opposabilite: "opposable",
      maille: "parcelle",
      tone,
    };
  }
  return {
    show: true,
    tier: 2,
    label: `Zone inondable — aléa ${motAlea}`,
    consequence:
      "Aléa connu (atlas / porter-à-connaissance), à confronter au règlement de zone. Vérifier l'existence d'un PPRI prescrit ou approuvé.",
    opposabilite: "porter_a_connaissance",
    maille: "parcelle",
    tone,
  };
}

// ── Retrait-gonflement des argiles (loi ELAN, art. L.112-20 et s. CCH) ─────────
export function describeClayRisk(level: string | undefined | null): ConstraintReading {
  const l = (level ?? "inconnu").trim();
  if (l === "fort" || l === "moyen") {
    return {
      show: true,
      tier: 2,
      label: `Retrait-gonflement des argiles — aléa ${l}`,
      consequence:
        "Étude géotechnique préalable (G1) obligatoire en cas de vente de terrain à bâtir et étude de conception (G2) avant construction (loi ELAN).",
      opposabilite: "porter_a_connaissance",
      maille: "parcelle",
      tone: l === "fort" ? "warn" : "neutral",
    };
  }
  return { show: false, tier: 3, label: "Argiles — aléa faible ou nul", opposabilite: "informatif", maille: "parcelle", tone: "ok" };
}

// ── Radon (potentiel communal — code de la santé publique) ────────────────────
export function describeRadonLevel(level: string | undefined | null): ConstraintReading {
  const l = (level ?? "inconnu").trim();
  if (l === "3") {
    return {
      show: true,
      tier: 2,
      label: "Potentiel radon — catégorie 3 (significatif)",
      consequence:
        "Commune à potentiel radon élevé : mesure du radon et dispositions de ventilation/étanchéité recommandées (information de l'acquéreur obligatoire).",
      opposabilite: "informatif",
      maille: "commune",
      tone: "warn",
    };
  }
  if (l === "2") {
    return {
      show: true,
      tier: 3,
      label: "Potentiel radon — catégorie 2 (faible sur sources)",
      opposabilite: "informatif",
      maille: "commune",
      tone: "neutral",
    };
  }
  return { show: false, tier: 3, label: "Radon — catégorie 1", opposabilite: "informatif", maille: "commune", tone: "ok" };
}

// ── Servitudes d'utilité publique : conséquence d'instruction par catégorie ───
// Aligné sur instructionDelays.ts (extensions R.423-24/25) et R.151-43 C. urb.
interface SupMeta {
  consequence: string;
  opposabilite: Opposabilite;
  maille: Maille;
  tone: ConstraintTone;
}

const SUP_META: Record<string, SupMeta> = {
  AC1: { consequence: "Avis conforme de l'Architecte des Bâtiments de France requis — délai d'instruction majoré de 1 mois (R.423-24 b). Volet patrimonial (PC/DP) à exiger.", opposabilite: "opposable", maille: "parcelle", tone: "abf" },
  AC2: { consequence: "Site classé ou inscrit : autorisation spéciale / avis de l'ABF — délai majoré de 1 mois (R.423-24 c).", opposabilite: "opposable", maille: "parcelle", tone: "abf" },
  AC3: { consequence: "Réserve naturelle : régime d'autorisation spécifique — délai majoré de 1 mois (R.423-24 d).", opposabilite: "opposable", maille: "parcelle", tone: "warn" },
  AC4: { consequence: "Site patrimonial remarquable (SPR/AVAP/ZPPAUP) : avis conforme de l'ABF — délai majoré de 1 mois (R.423-24 b).", opposabilite: "opposable", maille: "parcelle", tone: "abf" },
  AS1: { consequence: "Périmètre de captage d'eau potable : restrictions d'usage du sol ; avis de l'hydrogéologue / ARS possible.", opposabilite: "opposable", maille: "parcelle", tone: "warn" },
  EL3: { consequence: "Servitude de halage / marchepied le long du cours d'eau : bande non aedificandi à respecter.", opposabilite: "opposable", maille: "parcelle", tone: "info" },
  EL7: { consequence: "Ligne électrique haute tension : distances de sécurité réglementaires ; consultation du gestionnaire de réseau.", opposabilite: "opposable", maille: "parcelle", tone: "warn" },
  EL11: { consequence: "Ligne électrique très haute tension : distances de sécurité réglementaires ; consultation du gestionnaire.", opposabilite: "opposable", maille: "parcelle", tone: "warn" },
  I1: { consequence: "Canalisation d'hydrocarbures : zone de danger ; consultation du transporteur (porter-à-connaissance des distances).", opposabilite: "opposable", maille: "parcelle", tone: "danger" },
  I3: { consequence: "Canalisation de gaz : zone de danger ; consultation du gestionnaire (GRTgaz) — restrictions selon distances.", opposabilite: "opposable", maille: "parcelle", tone: "danger" },
  I4: { consequence: "Canalisation électrique : servitude d'ancrage/passage ; distances de sécurité.", opposabilite: "opposable", maille: "parcelle", tone: "warn" },
  PM1: { consequence: "PPRI (risque inondation) opposable : appliquer le règlement de zone (cote de référence, prescriptions). Pièce PPRI exigible.", opposabilite: "opposable", maille: "parcelle", tone: "danger" },
  PM2: { consequence: "PPRT (risque technologique) opposable : restrictions/interdictions de construction selon le zonage. Pièce PPRT exigible.", opposabilite: "opposable", maille: "parcelle", tone: "danger" },
  PM3: { consequence: "PPRN mouvement de terrain opposable : prescriptions constructives selon l'aléa.", opposabilite: "opposable", maille: "parcelle", tone: "warn" },
  PT1: { consequence: "Servitude de protection des centres radioélectriques : limitation de hauteur / d'obstacle ; consultation du gestionnaire.", opposabilite: "opposable", maille: "parcelle", tone: "info" },
  PT2: { consequence: "Servitude de protection contre les obstacles (faisceaux hertziens) : limitation de hauteur ; consultation du gestionnaire.", opposabilite: "opposable", maille: "parcelle", tone: "info" },
  T1: { consequence: "Voie ferrée : servitude d'alignement / marges de recul ; consultation de SNCF Réseau.", opposabilite: "opposable", maille: "parcelle", tone: "info" },
  T4: { consequence: "Servitudes aéronautiques de dégagement : limitation de hauteur des constructions ; consultation du gestionnaire d'aérodrome / DGAC.", opposabilite: "opposable", maille: "parcelle", tone: "warn" },
  T5: { consequence: "Servitudes aéronautiques de balisage : prescriptions sur les obstacles ; consultation DGAC.", opposabilite: "opposable", maille: "parcelle", tone: "info" },
  T7: { consequence: "Abords des routes : marges de recul / accès réglementés ; consultation du gestionnaire de voirie.", opposabilite: "opposable", maille: "parcelle", tone: "info" },
};

/** Conséquence d'instruction pour une SUP (par code AC1, PM1, EL7…). */
export function supConsequence(categorie: string | undefined | null): SupMeta | null {
  const c = (categorie ?? "").toUpperCase().trim();
  if (!c) return null;
  if (SUP_META[c]) return SUP_META[c];
  // Repli par famille (préfixe lettres) si le code exact n'est pas catalogué.
  const fam = c.match(/^[A-Z]+/)?.[0] ?? "";
  const byFamily: Record<string, SupMeta | undefined> = {
    AC: SUP_META.AC1, AS: SUP_META.AS1, EL: SUP_META.EL7,
    I: SUP_META.I3, PM: SUP_META.PM1, PT: SUP_META.PT1, T: SUP_META.T1,
  };
  return byFamily[fam] ?? { consequence: "Servitude d'utilité publique opposable : se reporter à l'acte instituant la SUP et au gestionnaire.", opposabilite: "opposable", maille: "parcelle", tone: "info" };
}

// ── Prescriptions surfaciques PLU : conséquence d'instruction par typepsc ─────
// Référentiel CNIG ; tier 1 = prescription opposable forte (inconstructibilité,
// protection), tier 2 = prescription d'aménagement/qualité.
const PSC_META: Record<string, { consequence: string; tier: ConstraintTier; tone: ConstraintTone }> = {
  "01": { consequence: "Espace Boisé Classé : défrichement interdit, construction très limitée (L.113-1 C. urb.). Toute coupe soumise à déclaration.", tier: 1, tone: "ok" },
  "02": { consequence: "Élément paysager/patrimonial protégé (L.151-19/23) : travaux soumis à DP, démolition pouvant être refusée.", tier: 1, tone: "warn" },
  "04": { consequence: "Emplacement réservé : terrain grevé au profit d'une collectivité — constructibilité du pétitionnaire restreinte (droit de délaissement).", tier: 1, tone: "warn" },
  "09": { consequence: "Périmètre à risque : prescriptions ou inconstructibilité selon le règlement de zone / PPR associé.", tier: 1, tone: "danger" },
  "10": { consequence: "Zone non aedificandi : inconstructible — motif de refus si construction projetée.", tier: 1, tone: "danger" },
  "12": { consequence: "Périmètre de constructibilité limitée : vérifier les conditions du règlement avant tout accord.", tier: 1, tone: "warn" },
  "13": { consequence: "Périmètre d'attente de projet (PAPA) : sursis à statuer possible sur les demandes (L.424-1).", tier: 1, tone: "warn" },
  "18": { consequence: "OAP : le projet doit être compatible avec l'orientation d'aménagement (opposable en compatibilité).", tier: 1, tone: "info" },
  "19": { consequence: "Zone humide : régime de protection ; étude et mesures ERC possibles.", tier: 2, tone: "warn" },
};

export function prescriptionConsequence(typepsc: string | undefined | null): { consequence: string; tier: ConstraintTier; tone: ConstraintTone } {
  const t = (typepsc ?? "").trim();
  return PSC_META[t] ?? { consequence: "Prescription du PLU opposable : se reporter au règlement de la zone et au texte associé.", tier: 2, tone: "info" };
}
