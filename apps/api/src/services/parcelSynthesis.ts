/**
 * ParcelSynthesis — synthèse réglementaire THÉMATIQUE et BI-AUDIENCE d'une parcelle.
 *
 * À partir de l'analyse parcellaire déjà assemblée (règles PLU validées, risques
 * GéoRisques, servitudes & prescriptions du Géoportail de l'Urbanisme), produit
 * une synthèse organisée PAR THÈME, avec deux projections d'une même donnée :
 *
 *  - `citizen`     : langage courant, le chiffre clé d'abord, le non-pertinent masqué.
 *                    Objectif : « comprendre mes droits sur ma parcelle » en un coup d'œil.
 *  - `instructor`  : éléments tracés (article, document source, valeur attendue),
 *                    regroupés par thème et TRANSVERSAUX entre documents (PLU + PPRI
 *                    + servitudes + risques). Objectif : retrouver vite et cibler juste.
 *
 * Fonction PURE et déterministe (aucun appel réseau, aucune IA, aucune écriture) :
 * à analyse identique, synthèse identique → testable et cacheable.
 *
 * La grille de thèmes vit ICI (et non plus seulement dans le composant React) :
 * le moteur citoyen ET l'instruction partagent la même taxonomie.
 */
import type {
  ParcelAnalysis,
  PrescriptionResult,
  RegDbRule,
  RiskResult,
  ServitudeResult,
} from "./parcelAnalysis.js";

// ── Types de sortie ───────────────────────────────────────────────────────────

export type SynthesisTone = "favorable" | "neutre" | "info" | "attention" | "interdit";

/** Document/source ayant contribué à un thème — c'est le pivot « transversal ». */
export interface SynthesisSource {
  kind: "plu" | "ppri" | "servitude" | "prescription" | "risque";
  /** Libellé citable, ex: « PLU — art. 10 (UC) », « SUP AC1 — ABF », « GéoRisques ». */
  label: string;
  /** Référence courte : n° d'article, catégorie SUP, code phénomène… */
  ref?: string;
  /** Lien vers l'acte légal (servitudes) quand disponible. */
  url?: string;
  /** Identifiant de la règle de zone (deep-link instruction). */
  rule_id?: string;
}

/** Élément réglementaire granulaire — vue instructeur. */
export interface ThemeItem {
  label: string;
  /** Valeur attendue formatée pour l'instructeur (« ≤ 9 m », « 50 % », plage…). */
  value: string | null;
  /** Texte court : résumé, conséquence d'instruction, ou texte de la règle. */
  detail: string | null;
  source: SynthesisSource;
  applies_if?: string[];
  exceptions?: string | null;
  relevance?: RegDbRule["relevance"];
  tone: SynthesisTone;
}

export interface SynthesisTheme {
  key: string;
  icon: string;
  title: string;
  citizen: {
    /** Une phrase claire avec le chiffre clé en tête. */
    headline: string;
    /** Puces courtes en langage courant. */
    points: string[];
    tone: SynthesisTone;
  };
  instructor: {
    items: ThemeItem[];
    /** Documents transversaux dédupliqués ayant alimenté le thème. */
    sources: SynthesisSource[];
  };
}

export interface ParcelSynthesis {
  schema_version: 1;
  zone_code: string | null;
  zone_label: string | null;
  themes: SynthesisTheme[];
  counts: { themes: number; attention: number; interdit: number; conditionnel: number };
}

// ── Entrée : sous-ensemble structurel de ParcelAnalysis ─────────────────────────
export type SynthesisInput = Pick<
  ParcelAnalysis,
  "rules" | "risks" | "servitudes" | "prescriptions" | "plu_zone" | "db_zone"
>;

// ── Taxonomie des thèmes ────────────────────────────────────────────────────────
// Alignée sur les rubriques grand public, mais désormais FAISANT FOI côté serveur.
const TOPIC_LABEL: Record<string, string> = {
  recul_voie: "Recul par rapport à la voie",
  recul_limite: "Recul par rapport aux limites",
  recul_batiments: "Distance entre bâtiments",
  emprise_sol: "Emprise au sol maximale",
  hauteur: "Hauteur maximale",
  stationnement: "Stationnement",
  espaces_verts: "Espaces verts à préserver",
  terrain_min: "Superficie minimale du terrain",
  destinations: "Destinations autorisées",
  aspect: "Aspect extérieur",
  interdictions: "Occupations interdites",
  conditions: "Conditions particulières",
  desserte_voies: "Accès & voirie",
  desserte_reseaux: "Raccordement aux réseaux",
  cos: "Coefficient d'occupation des sols",
  general: "Disposition générale",
};

// Thèmes qualitatifs : on affiche la phrase rédigée, pas un badge chiffré.
const QUALITATIVE_TOPICS = new Set(["aspect", "destinations", "general", "conditions", "interdictions"]);

interface ThemeDef {
  key: string;
  icon: string;
  title: string;
  topics: string[];
}

// Ordre = ordre d'affichage. Les thèmes transversaux (risques, servitudes) sont
// alimentés hors PLU et ajoutés en fin de liste s'ils portent du contenu.
const PLU_THEMES: ThemeDef[] = [
  { key: "construire", icon: "🏗️", title: "Ce que vous pouvez construire", topics: ["emprise_sol", "hauteur", "cos", "terrain_min"] },
  { key: "implanter", icon: "📐", title: "Où implanter la construction", topics: ["recul_voie", "recul_limite", "recul_batiments"] },
  { key: "aspect", icon: "🎨", title: "Aspect & matériaux", topics: ["aspect"] },
  { key: "stationnement", icon: "🅿️", title: "Stationnement", topics: ["stationnement"] },
  { key: "verts", icon: "🌳", title: "Espaces verts & plantations", topics: ["espaces_verts"] },
  { key: "acces", icon: "🚗", title: "Accès & réseaux", topics: ["desserte_voies", "desserte_reseaux"] },
  { key: "usages", icon: "🚦", title: "Usages autorisés ou interdits", topics: ["interdictions", "conditions", "destinations"] },
  { key: "autres", icon: "📋", title: "Autres dispositions", topics: ["general"] },
];

// ── Formatage des valeurs ───────────────────────────────────────────────────────
function fmtNum(n: number): string {
  // Décimale française (virgule) ; pas de zéros parasites.
  return String(Math.round(n * 100) / 100).replace(".", ",");
}

/** Valeur « citoyen » : nombre nu (la direction est portée par le libellé). */
function citizenValue(r: RegDbRule): string | null {
  const u = r.unit ? ` ${r.unit}` : "";
  if (r.value_exact != null) return `${fmtNum(r.value_exact)}${u}`;
  if (r.value_max != null) return `${fmtNum(r.value_max)}${u}`;
  if (r.value_min != null) return `${fmtNum(r.value_min)}${u}`;
  const c = r.cases?.find((c) => c.value != null);
  if (c?.value != null) return `${fmtNum(c.value)}${c.unit ? ` ${c.unit}` : u}`;
  return null;
}

/** Valeur « instructeur » : seuil explicite avec sémantique min/max. */
function instructorValue(r: RegDbRule): string | null {
  const u = r.unit ? ` ${r.unit}` : "";
  if (r.value_exact != null) return `= ${fmtNum(r.value_exact)}${u}`;
  if (r.value_min != null && r.value_max != null) return `${fmtNum(r.value_min)}–${fmtNum(r.value_max)}${u}`;
  if (r.value_max != null) return `≤ ${fmtNum(r.value_max)}${u}`;
  if (r.value_min != null) return `≥ ${fmtNum(r.value_min)}${u}`;
  const c = r.cases?.find((c) => c.value != null);
  if (c?.value != null) return `${fmtNum(c.value)}${c.unit ? ` ${c.unit}` : u}`;
  return null;
}

function ruleLabel(r: RegDbRule): string {
  return r.citizen_title?.trim() || r.sub_theme?.trim() || TOPIC_LABEL[r.topic] || "Règle";
}

// ── Précision des hauteurs et des reculs ────────────────────────────────────────
// Une hauteur « 6,5 m » ou un recul « 0 m » n'ont de sens qu'avec leur référentiel :
// à quel point la hauteur se mesure-t-elle (égout / faîtage / acrotère…) ? de quelle
// limite parle-t-on, peut-on bâtir en limite ? On lève cette ambiguïté pour le citoyen
// à partir des champs disponibles (sous-thème, conditions, cas chiffrés, texte fidèle).
const HEIGHT_REF_PATTERNS: Array<[RegExp, string]> = [
  [/fa[iî]tage/i, "au faîtage"],
  [/acrot[èe]re/i, "à l'acrotère"],
  [/sabli[èe]re/i, "à la sablière"],
  [/[ée]gout/i, "à l'égout"],
];

// requireUnique : pour qualifier UNE valeur unique, on n'attache un référentiel que
// s'il est sans ambiguïté. Un texte fidèle citant à la fois « égout » ET « faîtage »
// ne dit pas auquel des deux se rapporte la valeur — mieux vaut alors rester neutre.
function heightRefIn(text: string | null | undefined, requireUnique = false): string | null {
  if (!text) return null;
  const hits = HEIGHT_REF_PATTERNS.filter(([re]) => re.test(text));
  if (hits.length === 0 || (requireUnique && hits.length > 1)) return null;
  return hits[0]![1];
}

/**
 * Cas chiffrés d'une hauteur portant chacun un référentiel distinct (ex:
 * 6,5 m à l'égout / 9 m au faîtage, stockés dans `cases`). Renvoie null s'il n'y
 * a pas au moins deux valeurs dont une au moins est rattachée à un référentiel
 * reconnu — sinon on ne saurait pas lever l'ambiguïté et on reste sur la valeur nue.
 */
function heightCases(r: RegDbRule): Array<{ ref: string | null; value: number; unit: string }> | null {
  const mapped = (r.cases ?? [])
    .filter((c) => c.value != null)
    .map((c) => ({ ref: heightRefIn(c.condition), value: c.value as number, unit: c.unit ?? r.unit ?? "m" }));
  if (mapped.length < 2) return null;
  return mapped.some((m) => m.ref) ? mapped : null;
}

const SETBACK_PATTERNS: Array<[RegExp, string]> = [
  [/lat[ée]ral/i, "limites latérales"],
  [/fond (de |du )?(parcelle|terrain)|limite de fond/i, "fond de parcelle"],
  [/(en|sur) limite|mitoyen|jointif|contig|adoss/i, "en limite séparative"],
];

/** Qualifieur citoyen d'un recul : quelle limite ? implantation possible en limite ? */
function setbackQualifier(r: RegDbRule): string | null {
  const text = `${r.sub_theme ?? ""} ${r.conditions ?? ""} ${r.citizen_title ?? ""}`;
  for (const [re, label] of SETBACK_PATTERNS) if (re.test(text)) return label;
  // Un recul affiché de 0 m signifie qu'on peut bâtir en limite : on l'explicite.
  const shown = r.value_exact ?? r.value_max ?? r.value_min;
  if (r.topic === "recul_limite" && shown === 0) return "implantation en limite possible";
  return null;
}

/** Puce citoyen : libellé + chiffre, ou phrase rédigée si qualitatif. */
function citizenPoint(r: RegDbRule): string {
  // Hauteur : lever l'ambiguïté du référentiel de mesure (égout / faîtage / acrotère).
  if (r.topic === "hauteur") {
    const hLabel = TOPIC_LABEL.hauteur ?? "Hauteur maximale";
    const cases = heightCases(r);
    if (cases) {
      const parts = cases.map((c) => `${fmtNum(c.value)} ${c.unit}${c.ref ? ` ${c.ref}` : ""}`);
      return `${hLabel} : ${parts.join(" · ")}`;
    }
    const v = citizenValue(r);
    if (v) {
      const ref = heightRefIn(r.sub_theme) ?? heightRefIn(r.conditions, true) ?? heightRefIn(r.rule_text, true);
      return `${hLabel}${ref ? ` ${ref}` : ""} : ${v}`;
    }
  }
  // Reculs : préciser la limite concernée (ou l'implantation en limite) si possible.
  if (r.topic === "recul_limite" || r.topic === "recul_voie") {
    const v = citizenValue(r);
    if (v) {
      const q = setbackQualifier(r);
      return `${TOPIC_LABEL[r.topic] ?? ruleLabel(r)}${q ? ` (${q})` : ""} : ${v}`;
    }
  }
  const v = citizenValue(r);
  if (v && !QUALITATIVE_TOPICS.has(r.topic)) {
    return `${TOPIC_LABEL[r.topic] ?? ruleLabel(r)} : ${v}`;
  }
  const phrase = r.citizen_summary?.trim() || r.summary?.trim();
  if (phrase) return phrase;
  return v ? `${ruleLabel(r)} : ${v}` : ruleLabel(r);
}

function pluSource(r: RegDbRule, zoneCode: string | null): SynthesisSource {
  const art = r.article_number != null ? `art. ${fmtNum(r.article_number)}` : "règle";
  const z = zoneCode ? ` (${zoneCode})` : "";
  return { kind: "plu", label: `PLU — ${art}${z}`, ref: r.article_number != null ? String(r.article_number) : undefined, rule_id: r.id };
}

// ── Visibilité citoyen ──────────────────────────────────────────────────────────
// Mêmes garde-fous que la page publique : on masque le non-pertinent et le
// « sans objet » (art. 5 superficie min., art. 14 COS — loi ALUR).
function isVoidRule(r: RegDbRule): boolean {
  return /sans objet|abrog|coefficient d'occupation/i.test(
    `${r.citizen_summary ?? ""} ${r.summary ?? ""} ${r.rule_text}`,
  );
}
function isCitizenVisible(r: RegDbRule): boolean {
  if (r.citizen_relevant === false) return false;
  if (r.relevance === "excluded" || r.relevance === "conditional") return false;
  if (isVoidRule(r)) return false;
  return true;
}

// ── Thèmes transversaux : risques ───────────────────────────────────────────────
function riskThemeItems(risks: RiskResult): { items: ThemeItem[]; points: string[]; tone: SynthesisTone } {
  const items: ThemeItem[] = [];
  const points: string[] = [];
  let tone: SynthesisTone = "info";
  const src: SynthesisSource = { kind: "risque", label: "GéoRisques" };
  const bump = (t: SynthesisTone) => {
    const order: SynthesisTone[] = ["favorable", "neutre", "info", "attention", "interdit"];
    if (order.indexOf(t) > order.indexOf(tone)) tone = t;
  };

  if (risks.flood_risk && risks.flood_risk !== "nul" && risks.flood_risk !== "inconnu") {
    bump("attention");
    points.push(`Zone inondable (aléa ${risks.flood_risk}) — plancher à surélever, voir le PPRI.`);
    items.push({
      label: "Risque inondation",
      value: `aléa ${risks.flood_risk}`,
      detail: "Respect du PPRI : cote de plancher minimale, attestation de prise en compte du risque.",
      source: { kind: "ppri", label: "PPRI / GéoRisques", ref: "inondation" },
      tone: "attention",
    });
  }
  if (risks.clay_risk && risks.clay_risk !== "nul" && risks.clay_risk !== "inconnu") {
    if (risks.clay_risk === "fort" || risks.clay_risk === "moyen") bump("attention");
    points.push(`Sols argileux (aléa ${risks.clay_risk}) — étude de sol recommandée avant de construire.`);
    items.push({
      label: "Retrait-gonflement des argiles",
      value: `aléa ${risks.clay_risk}`,
      detail: "Étude géotechnique (G2) recommandée ; attestation argiles exigible (loi ÉLAN, zones moyen/fort).",
      source: src,
      tone: risks.clay_risk === "faible" ? "info" : "attention",
    });
  }
  const seismic = parseInt(risks.seismic_zone, 10);
  if (Number.isFinite(seismic) && seismic >= 3) {
    bump("attention");
    points.push(`Zone sismique ${risks.seismic_zone} — règles parasismiques applicables.`);
    items.push({
      label: "Aléa sismique",
      value: `zone ${risks.seismic_zone}`,
      detail: "Attestation parasismique (Eurocode 8) requise pour les constructions concernées.",
      source: src,
      tone: "attention",
    });
  } else if (risks.seismic_zone && risks.seismic_zone !== "inconnu") {
    items.push({ label: "Aléa sismique", value: `zone ${risks.seismic_zone}`, detail: null, source: src, tone: "info" });
  }
  if (risks.landslide_risk && risks.landslide_risk !== "nul" && risks.landslide_risk !== "inconnu") {
    bump("attention");
    points.push(`Mouvements de terrain (aléa ${risks.landslide_risk}).`);
    items.push({ label: "Mouvements de terrain", value: `aléa ${risks.landslide_risk}`, detail: null, source: src, tone: "attention" });
  }
  if (risks.radon_level === "3") {
    points.push("Potentiel radon élevé — ventilation adaptée recommandée.");
    items.push({ label: "Potentiel radon", value: "niveau 3", detail: "Dispositions de ventilation / étanchéité recommandées.", source: src, tone: "info" });
  }
  return { items, points, tone };
}

// ── Thèmes transversaux : servitudes (SUP) ──────────────────────────────────────
interface SupMeaning { label: string; consequence: string; tone: SynthesisTone; ppri?: boolean }
function supMeaning(cat: string): SupMeaning {
  const c = cat.toUpperCase();
  if (c.startsWith("AC")) return { label: "Périmètre Monument Historique", consequence: "Avis de l'Architecte des Bâtiments de France (ABF) requis ; délai d'instruction majoré.", tone: "attention" };
  if (c.startsWith("PM")) return { label: "Plan de Prévention des Risques", consequence: "Prescriptions du PPR opposables — vérifier les cotes et interdictions.", tone: "attention", ppri: true };
  if (c.startsWith("AS")) return { label: "Présomption d'archéologie", consequence: "Diagnostic d'archéologie préventive possible (saisine DRAC).", tone: "info" };
  if (c.startsWith("EL")) return { label: "Servitude (voirie / halage / électrique)", consequence: "Distances et accès réglementaires à respecter.", tone: "info" };
  if (c.startsWith("I")) return { label: "Canalisation / réseau", consequence: "Zone de protection autour de l'ouvrage — restrictions de construction.", tone: "info" };
  if (c.startsWith("PT")) return { label: "Télécommunications / faisceau hertzien", consequence: "Limitation de hauteur possible.", tone: "info" };
  if (c.startsWith("T")) return { label: "Servitude ferroviaire / aérienne", consequence: "Contraintes de proximité applicables.", tone: "info" };
  return { label: "Servitude d'utilité publique", consequence: "Contraintes spécifiques applicables.", tone: "info" };
}

// ── Construction d'un thème PLU ─────────────────────────────────────────────────
function worstTone(tones: SynthesisTone[]): SynthesisTone {
  const order: SynthesisTone[] = ["favorable", "neutre", "info", "attention", "interdit"];
  return tones.reduce<SynthesisTone>((acc, t) => (order.indexOf(t) > order.indexOf(acc) ? t : acc), "neutre");
}

function buildPluTheme(def: ThemeDef, rules: RegDbRule[], zoneCode: string | null): SynthesisTheme | null {
  const themeRules = rules.filter((r) => def.topics.includes(r.topic));
  if (themeRules.length === 0) return null;

  // Vue instructeur : TOUTES les règles du thème (y compris conditionnelles),
  // chacune tracée vers son article — c'est la retrouvabilité ciblée.
  const items: ThemeItem[] = themeRules.map((r) => {
    const tone: SynthesisTone = r.topic === "interdictions" ? "interdit" : r.relevance === "conditional" ? "attention" : "neutre";
    return {
      label: ruleLabel(r),
      value: instructorValue(r),
      detail: r.summary?.trim() || (r.rule_text.length > 220 ? `${r.rule_text.slice(0, 220)}…` : r.rule_text),
      source: pluSource(r, zoneCode),
      applies_if: r.applies_if ?? undefined,
      exceptions: r.exceptions ?? null,
      relevance: r.relevance,
      tone,
    };
  });

  // Vue citoyen : seules les règles pertinentes et chiffrables/parlantes.
  const visible = themeRules.filter(isCitizenVisible);
  const points = dedupe(visible.map(citizenPoint)).slice(0, 6);
  const citizenTone = def.key === "usages" && themeRules.some((r) => r.topic === "interdictions")
    ? "interdit"
    : worstTone(items.map((i) => (i.tone === "interdit" ? "attention" : i.tone)));

  return {
    key: def.key,
    icon: def.icon,
    title: def.title,
    citizen: {
      headline: points[0] ?? def.title,
      points,
      tone: points.length === 0 ? "info" : citizenTone,
    },
    instructor: { items, sources: dedupeSources(items.map((i) => i.source)) },
  };
}

function dedupe(xs: string[]): string[] {
  const seen = new Set<string>();
  return xs.filter((x) => x && !seen.has(x) && (seen.add(x), true));
}
function dedupeSources(xs: SynthesisSource[]): SynthesisSource[] {
  const seen = new Set<string>();
  return xs.filter((s) => !seen.has(s.label) && (seen.add(s.label), true));
}

// ── Point d'entrée ──────────────────────────────────────────────────────────────
export function buildParcelSynthesis(input: SynthesisInput): ParcelSynthesis {
  const zoneCode = input.plu_zone?.zone_code ?? input.db_zone?.code ?? null;
  const zoneLabel = input.plu_zone?.zone_label ?? input.db_zone?.label ?? null;
  const rules = input.rules ?? [];
  const themes: SynthesisTheme[] = [];

  // 1) Thèmes PLU
  for (const def of PLU_THEMES) {
    const t = buildPluTheme(def, rules, zoneCode);
    if (t) themes.push(t);
  }

  // 2) Thème transversal « Risques du terrain » (GéoRisques + PPRI)
  if (input.risks) {
    const { items, points, tone } = riskThemeItems(input.risks);
    if (items.length > 0) {
      themes.push({
        key: "risques",
        icon: "⚠️",
        title: "Risques & contraintes du terrain",
        citizen: { headline: points[0] ?? "Risques à prendre en compte", points, tone },
        instructor: { items, sources: dedupeSources(items.map((i) => i.source)) },
      });
    }
  }

  // 3) Thème transversal « Servitudes & protections » (SUP du GPU)
  const servitudes = input.servitudes ?? [];
  if (servitudes.length > 0) {
    const items: ThemeItem[] = [];
    const points: string[] = [];
    for (const s of servitudes) {
      const cat = (s.categorie ?? "").trim();
      const m = supMeaning(cat);
      const name = s.nomsup ?? s.libelle ?? m.label;
      points.push(`${m.label}${name && name !== m.label ? ` — ${name}` : ""}.`);
      items.push({
        label: `${m.label}${cat ? ` (SUP ${cat})` : ""}`,
        value: name && name !== m.label ? name : null,
        detail: m.consequence,
        source: { kind: m.ppri ? "ppri" : "servitude", label: cat ? `SUP ${cat}` : "Servitude d'utilité publique", ref: cat || undefined, url: s.urlacte },
        tone: m.tone,
      });
    }
    themes.push({
      key: "servitudes",
      icon: "🏛️",
      title: "Servitudes & protections",
      citizen: { headline: points[0] ?? "Servitudes applicables", points: dedupe(points).slice(0, 6), tone: worstTone(items.map((i) => i.tone)) },
      instructor: { items, sources: dedupeSources(items.map((i) => i.source)) },
    });

    // Renvoi transversal : un périmètre ABF (AC*) conditionne l'aspect → on
    // injecte la source dans le thème « Aspect » s'il existe.
    const abf = items.find((i) => i.source.ref?.toUpperCase().startsWith("AC"));
    const aspect = themes.find((t) => t.key === "aspect");
    if (abf && aspect) {
      aspect.instructor.sources = dedupeSources([...aspect.instructor.sources, abf.source]);
      if (!aspect.citizen.points.some((p) => /ABF|Architecte/i.test(p))) {
        aspect.citizen.points.unshift("Avis de l'Architecte des Bâtiments de France requis (périmètre protégé).");
        aspect.citizen.tone = "attention";
      }
    }
  }

  // 4) Prescriptions surfaciques (EBC, reculs spéciaux…) → thème « usages »
  const prescriptions = input.prescriptions ?? [];
  if (prescriptions.length > 0) {
    const usages = themes.find((t) => t.key === "usages");
    const items: ThemeItem[] = prescriptions.map((p: PrescriptionResult) => {
      const isEbc = /espace bois|ebc/i.test(`${p.libelle} ${p.txtpsc ?? ""}`);
      return {
        label: p.libelle || "Prescription graphique",
        value: null,
        detail: p.txtpsc ?? null,
        source: { kind: "prescription", label: "PLU — prescription graphique", ref: p.typepsc || undefined },
        tone: isEbc ? "interdit" : "info",
      };
    });
    const target = usages ?? {
      key: "usages",
      icon: "🚦",
      title: "Usages autorisés ou interdits",
      citizen: { headline: "Prescriptions applicables", points: [], tone: "info" as SynthesisTone },
      instructor: { items: [], sources: [] },
    };
    target.instructor.items.push(...items);
    target.instructor.sources = dedupeSources([...target.instructor.sources, ...items.map((i) => i.source)]);
    const ebc = items.find((i) => i.tone === "interdit");
    if (ebc) {
      target.citizen.points.unshift("Espace Boisé Classé : défrichement et construction interdits.");
      target.citizen.tone = "attention";
    }
    if (!usages) themes.push(target);
  }

  const counts = {
    themes: themes.length,
    attention: themes.filter((t) => t.citizen.tone === "attention").length,
    interdit: themes.filter((t) => t.citizen.tone === "interdit").length,
    conditionnel: themes.reduce((n, t) => n + t.instructor.items.filter((i) => i.relevance === "conditional").length, 0),
  };

  return { schema_version: 1, zone_code: zoneCode, zone_label: zoneLabel, themes, counts };
}
