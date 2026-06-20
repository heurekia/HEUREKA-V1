import fs from "fs";
import { extractFirstJson, sanitizePieceName, sha256Buffer } from "./pieceAnalyzer.js";
import { callAi } from "./aiUsage.js";

/**
 * Extraction structurée d'une pièce du dossier d'urbanisme.
 *
 * Distinct de `analyzePiece` (qui produit un score qualitatif) : ici on LIT
 * ce qui est explicitement coté/écrit sur le document et on le retourne dans
 * un schéma typé. Le moteur de conformité (étape suivante) croise ensuite
 * ces valeurs avec les règles PLU.
 *
 * Règle d'or : on n'invente AUCUNE valeur. Quand un élément n'est pas
 * visiblement annoté sur la pièce → champ null + ligne dans `missing_elements`.
 */

export type PieceType =
  | "cerfa"
  | "plan_situation"
  | "plan_masse"
  | "plan_coupe"
  | "plan_facade"
  | "notice"
  | "photo"
  | "insertion"
  | "autre";

// ── Checklist graphique (Phase 5) ─────────────────────────────────────────────
// L'ancien `nord_visible: boolean` ne capturait pas la diversité réelle des
// conventions (rose des vents, boussole, flèche simple). `graphics` est la
// nouvelle structure canonique : `nord_visible` / `legende_visible` restent
// renseignés en parallèle (rétro-compatibilité consommateurs UI/scoring).
export type OrientationKind =
  | "fleche_nord"
  | "rose_des_vents"
  | "boussole"
  | "absent"
  | "inconnu";

export interface OrientationInfo {
  kind: OrientationKind;
  visible: boolean;
  // Citation ou description courte (ex: "rose des vents en bas à droite").
  evidence?: string | null;
}

// Statut tripartite : présent / absent / inconnu (non vérifiable sur ce doc).
// Volontairement distinct de boolean|null pour éviter la confusion
// "false = absent" vs "null = pas regardé".
export type PresenceFlag = "present" | "absent" | "inconnu";

export interface PriseDeVue {
  label: string;            // ex: "Vue 1 — depuis la rue", "Photo 2"
  page?: number | null;     // page où apparaît le repère sur le plan de masse
}

export interface GraphicsChecklist {
  orientation: OrientationInfo | null;
  // Échelle GRAPHIQUE (segment coté en mètres), distincte de l'échelle
  // numérique (`echelle`: "1/200"). Une pièce conforme a souvent les deux.
  echelle_graphique: PresenceFlag | null;
  legende: PresenceFlag | null;
  // Limites séparatives représentées et identifiables.
  limites: PresenceFlag | null;
  // Accès véhicule / piéton matérialisé sur le plan.
  acces: PresenceFlag | null;
  // Emprise du projet (existant / projeté) tracée.
  emprise: PresenceFlag | null;
  // Présence des cotes attendues (recul, distances, dimensions du bâti).
  cotes_completes: PresenceFlag | null;
  // Niveaux altimétriques (NGF) sur la coupe ou le plan de masse.
  altimetries: PresenceFlag | null;
  // Repères des prises de vue (généralement sur le plan de masse, renvoie aux photos).
  prises_de_vue: PriseDeVue[] | null;
}

// ── Parcelles observées sur le document (Phase 2.3) ───────────────────────────
// Distinct de la parcelle stockée sur le dossier : ici on liste TOUT ce que la
// pièce affiche comme référence cadastrale (cartouche, plan de situation, plan
// de masse, CERFA…). Le moteur de réconciliation (Phase 3) confronte ensuite
// ces observations avec la parcelle déclarée et le résultat cadastre.gouv.fr.
export interface ParcelleObservee {
  section: string;          // ex: "AI"
  numero: string;           // ex: "217"
  qualificatif: "entiere" | "partie";  // "partie" = "AI 217p" / "AI 218p"
  // D'où vient la mention sur la pièce : cartouche, plan, CERFA. Aide le
  // moteur de contradictions à pondérer les sources.
  source_field?: "cartouche" | "plan_situation" | "plan_masse" | "cerfa" | "autre" | null;
  // Citation littérale lue ("AI 217 & AI 218p") pour traçabilité.
  citation?: string | null;
}

export interface PieceExtraction {
  piece_type: PieceType;
  // Confiance du modèle sur le TYPE détecté (0..1).
  confidence_type: number;
  quality: "lisible" | "partiellement_lisible" | "illisible";
  echelle: string | null;       // ex: "1/200", "1/500", null si non visible
  // ── Legacy : conservés pour rétro-compat (UI, scoring, dossierFacts). Si
  // `graphics.orientation` est renseigné, `nord_visible` est dérivé
  // automatiquement (true si visible, false si kind="absent", null si "inconnu").
  nord_visible: boolean | null;
  legende_visible: boolean | null;

  // ── Phase 5 : checklist graphique étendue ───────────────────────────────
  graphics?: GraphicsChecklist | null;

  // ── Phase 2.3 : observations cadastrales sur le document ────────────────
  parcelles_observees?: ParcelleObservee[] | null;

  // Sections typées — toutes optionnelles. Le LLM remplit UNIQUEMENT celle
  // qui correspond au type identifié, et seulement les champs visibles.
  cerfa?: {
    surface_terrain_m2?: number | null;
    surface_plancher_existante_m2?: number | null;
    surface_plancher_creee_m2?: number | null;
    emprise_sol_existante_m2?: number | null;
    emprise_sol_creee_m2?: number | null;
    hauteur_max_m?: number | null;
    destination?: string | null;
    nb_logements?: number | null;
    nb_places_stationnement?: number | null;
    architecte_obligatoire?: boolean | null;
  } | null;

  plan_masse?: {
    recul_voie_m?: number | null;
    reculs_limites_m?: number[] | null;        // toutes les cotes de recul aux limites séparatives
    distances_entre_batiments_m?: number[] | null;
    emprise_au_sol_m2?: number | null;
    longueur_batiment_m?: number | null;
    largeur_batiment_m?: number | null;
    existant_projete_distingue?: boolean | null;
  } | null;

  plan_coupe?: {
    sol_naturel_ngf_m?: number | null;
    sol_fini_ngf_m?: number | null;
    egout_ngf_m?: number | null;
    faitage_ngf_m?: number | null;
    acrotere_ngf_m?: number | null;
    hauteur_egout_m?: number | null;
    hauteur_faitage_m?: number | null;
    hauteur_acrotere_m?: number | null;
    pente_terrain_pct?: number | null;
  } | null;

  plan_facade?: {
    materiaux_principaux?: string[] | null;
    teintes?: string[] | null;
    toiture_type?: string | null;     // ex: "deux pans", "monopente", "terrasse"
    pente_toiture_deg?: number | null;
  } | null;

  notice?: {
    description_projet?: string | null;
    insertion_paysagere?: string | null;
    materiaux_decrits?: string[] | null;
  } | null;

  photo?: {
    contexte_decrit?: string | null;
    point_vue?: string | null;        // ex: "depuis la rue", "depuis le jardin"
  } | null;

  // Éléments réglementairement attendus mais absents du document.
  missing_elements: string[];

  // Citations textuelles vues sur le document (pour traçabilité).
  // Phase 1 : chaque citation peut désormais porter une page et une bbox pour
  // ouvrir la pièce sur la zone surlignée côté UI. Format historique
  // (string[]) toléré en entrée et converti automatiquement.
  citations: CitationRef[];

  // Nombre de pages du document — alimente la sélection d'une vue par page
  // côté UI et le futur refactor multi-vues (Phase 4). null si non lisible.
  page_count?: number | null;

  // Note libre pour le cas où le modèle a un doute sur l'identification.
  notes: string | null;
}

// Phase 1 — Une citation pointe vers un emplacement précis dans la pièce.
// `bbox` est exprimée dans le repère NORMALISÉ de la page (0..1 en x et y)
// pour que l'UI puisse rendre l'annotation quelle que soit la résolution.
export interface CitationRef {
  text: string;
  page?: number | null;
  bbox?: [number, number, number, number] | null;  // [x0, y0, x1, y1]
  confidence?: number | null;
}

const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;
const PDF_TYPE = "application/pdf";
const MAX_INLINE_BYTES = 30 * 1024 * 1024;

function isAllowedImage(mime: string): boolean {
  return (ALLOWED_IMAGE_TYPES as readonly string[]).includes(mime);
}
function isPdf(mime: string): boolean {
  return mime === PDF_TYPE;
}

const SYSTEM_PROMPT = `Tu es expert en instruction de dossiers d'urbanisme (Code de l'Urbanisme, CERFA, conventions de représentation des plans).

Ta mission : EXTRAIRE de manière STRUCTURÉE ce qui est VISIBLEMENT ÉCRIT, COTÉ ou ANNOTÉ sur la pièce fournie. Tu NE mesures PAS le plan, tu NE déduis PAS, tu LIS ce qui est explicitement noté.

RÈGLE D'OR — N'INVENTE RIEN :
- Si une valeur n'est pas explicitement écrite (cote, niveau NGF, surface, matériau) → mets null et signale-la dans "missing_elements".
- Si une dimension est mesurable à la règle mais n'est PAS cotée sur le plan → null + missing_elements. Tu ne mesures jamais.
- Si tu lis une cote mais elle est ambiguë (mal lisible, contradictoire avec une autre) → null + note explicite dans "notes".

ÉTAPE 1 — Identifie le type :
- "cerfa" : formulaire administratif (DP, PC, PA, …) avec cases et champs.
- "plan_situation" : extrait de carte / cadastre / IGN à petite échelle (1/2000+), localisant la parcelle dans la commune.
- "plan_masse" : vue de dessus du projet, avec cotes de recul, emprise, distances. Échelle 1/100 à 1/500.
- "plan_coupe" : coupe verticale du projet, avec niveaux NGF (sol naturel, sol fini, égout, acrotère, faîtage).
- "plan_facade" : élévation verticale d'une façade, avec matériaux/teintes/ouvertures.
- "notice" : description écrite (DP4, PC4) du projet et de son insertion.
- "photo" : photographie du terrain ou de l'environnement.
- "insertion" : insertion paysagère (photomontage du projet sur la photo).
- "autre" : tout le reste.

ÉTAPE 2 — Pour le type identifié, remplis UNIQUEMENT la section correspondante (cerfa | plan_masse | plan_coupe | plan_facade | notice | photo). Les autres sections : null. Pour plan_situation, photo, insertion, autre : rien de chiffré n'est attendu, laisse les sections null.

ÉTAPE 3 — Recense les "missing_elements" attendus réglementairement mais absents :
- plan de masse : "échelle absente", "orientation absente" (ni flèche Nord, ni rose des vents, ni boussole), "cote de recul voie absente", "cote de recul limites séparatives absente", "emprise au sol non chiffrée", "distinction existant/projeté absente".
- plan de coupe : "cote NGF sol naturel absente", "cote NGF égout absente", "cote NGF acrotère/faîtage absente", "hauteur calculée absente".
- plan de façade : "matériau de toiture non précisé", "teintes non précisées".
- CERFA : "surface plancher créée non renseignée", "destination non renseignée", "nb logements non renseigné" — UNIQUEMENT si attendu pour le projet.

ÉTAPE 4 — "citations" : liste les extraits textuels EXACTS que tu as lus pour appuyer chaque valeur extraite. Sans citation, pas de valeur. Deux formats acceptés :
- string brut (rétro-compat) : "recul voie 4.20 m"
- objet enrichi (préféré quand tu peux situer la mention) : { "text": "recul voie 4.20 m", "page": 1 }
Mélange autorisé dans la même liste. Tu peux aussi renseigner "page_count" (nombre total de pages du document) à la racine de la sortie.

ÉTAPE 5 — Si l'identification de type est incertaine (< 0.7), mets confidence_type bas et explique dans "notes".

ÉTAPE 6 — Checklist graphique "graphics" (cherche TOUTES les conventions, pas seulement la flèche Nord) :
- orientation.kind : "fleche_nord" | "rose_des_vents" | "boussole" | "absent" | "inconnu". Une rose des vents ou une boussole comptent comme "orientation présente" — ne réponds pas "absent" simplement parce qu'il n'y a pas de flèche.
- orientation.visible : true si présente, false si "absent", null si "inconnu".
- orientation.evidence : description courte ("rose des vents en bas à droite", "flèche Nord en haut à gauche") si visible.
- echelle_graphique / legende / limites / acces / emprise / cotes_completes / altimetries : "present" | "absent" | "inconnu". "inconnu" si la pièce n'est pas du type qui porte cet élément (ex: altimetries sur un CERFA).
- prises_de_vue : liste des repères de prise de vue lisibles (ex: [{label:"Vue 1"},{label:"Vue 2"}]) — typiquement sur le plan de masse.

ÉTAPE 7 — Observations cadastrales "parcelles_observees" :
- Liste TOUTES les références cadastrales visiblement écrites sur le document (cartouche, plan de situation, plan de masse, CERFA, …).
- Chaque entrée : { section, numero, qualificatif: "entiere"|"partie", source_field, citation }.
- qualificatif="partie" si tu lis "p" / "(p)" / "(partie)" / "partie de" accolés au numéro (ex: "AI 218p" → partie ; "AI 217 & AI 218p" → AI 217 entiere + AI 218 partie).
- source_field : où apparaît la mention ("cartouche" | "plan_situation" | "plan_masse" | "cerfa" | "autre").
- N'invente AUCUNE référence : si rien n'est lisible, parcelles_observees=[].

SORTIE — UNIQUEMENT du JSON valide, sans markdown, sans préambule :
{
  "piece_type": "cerfa|plan_situation|plan_masse|plan_coupe|plan_facade|notice|photo|insertion|autre",
  "confidence_type": 0.0,
  "quality": "lisible|partiellement_lisible|illisible",
  "echelle": "1/200" | null,
  "nord_visible": true|false|null,
  "legende_visible": true|false|null,
  "graphics": {
    "orientation": { "kind": "fleche_nord|rose_des_vents|boussole|absent|inconnu", "visible": true|false, "evidence": "rose des vents en bas à droite" | null } | null,
    "echelle_graphique": "present|absent|inconnu" | null,
    "legende": "present|absent|inconnu" | null,
    "limites": "present|absent|inconnu" | null,
    "acces": "present|absent|inconnu" | null,
    "emprise": "present|absent|inconnu" | null,
    "cotes_completes": "present|absent|inconnu" | null,
    "altimetries": "present|absent|inconnu" | null,
    "prises_de_vue": [{ "label": "Vue 1", "page": 1 }] | null
  } | null,
  "parcelles_observees": [
    { "section": "AI", "numero": "217", "qualificatif": "entiere", "source_field": "cartouche|plan_situation|plan_masse|cerfa|autre", "citation": "AI 217 & AI 218p" }
  ] | null,
  "cerfa": null | { "surface_terrain_m2": ..., "surface_plancher_existante_m2": ..., "surface_plancher_creee_m2": ..., "emprise_sol_existante_m2": ..., "emprise_sol_creee_m2": ..., "hauteur_max_m": ..., "destination": "habitation"|null, "nb_logements": ..., "nb_places_stationnement": ..., "architecte_obligatoire": true|false|null },
  "plan_masse": null | { "recul_voie_m": ..., "reculs_limites_m": [3.5, 4.2], "distances_entre_batiments_m": [...], "emprise_au_sol_m2": ..., "longueur_batiment_m": ..., "largeur_batiment_m": ..., "existant_projete_distingue": true|false|null },
  "plan_coupe": null | { "sol_naturel_ngf_m": ..., "sol_fini_ngf_m": ..., "egout_ngf_m": ..., "faitage_ngf_m": ..., "acrotere_ngf_m": ..., "hauteur_egout_m": ..., "hauteur_faitage_m": ..., "hauteur_acrotere_m": ..., "pente_terrain_pct": ... },
  "plan_facade": null | { "materiaux_principaux": ["enduit blanc"], "teintes": ["RAL 9010"], "toiture_type": "deux pans"|null, "pente_toiture_deg": ... },
  "notice": null | { "description_projet": "...", "insertion_paysagere": "...", "materiaux_decrits": [...] },
  "photo": null | { "contexte_decrit": "...", "point_vue": "..." },
  "missing_elements": ["échelle absente", "orientation absente"],
  "citations": ["recul voie 4.20 m", { "text": "H égout = 6.80 m", "page": 2 }],
  "page_count": 3,
  "notes": null
}`;

function n(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function s(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}
function b(v: unknown): boolean | null {
  if (v === true || v === false) return v;
  return null;
}
function arrN(v: unknown): number[] | null {
  if (!Array.isArray(v)) return null;
  const out = v.map((x) => (typeof x === "number" && Number.isFinite(x) ? x : null)).filter((x): x is number => x != null);
  return out.length ? out : null;
}
function arrS(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const out = v.map((x) => (typeof x === "string" && x.trim() ? x.trim() : null)).filter((x): x is string => !!x);
  return out.length ? out : null;
}

const VALID_TYPES: PieceType[] = ["cerfa", "plan_situation", "plan_masse", "plan_coupe", "plan_facade", "notice", "photo", "insertion", "autre"];

function normalizeType(v: unknown): PieceType {
  const t = String(v ?? "").toLowerCase().trim();
  return (VALID_TYPES as string[]).includes(t) ? (t as PieceType) : "autre";
}
function normalizeQuality(v: unknown): PieceExtraction["quality"] {
  const t = String(v ?? "").toLowerCase().trim();
  if (t === "lisible") return "lisible";
  if (t === "illisible") return "illisible";
  return "partiellement_lisible";
}

const VALID_ORIENTATION_KINDS: OrientationKind[] = [
  "fleche_nord", "rose_des_vents", "boussole", "absent", "inconnu",
];

function normalizeOrientationKind(v: unknown): OrientationKind {
  const t = String(v ?? "").toLowerCase().trim();
  // Synonymes courants — on accepte largement côté entrée pour ne pas perdre
  // l'info sous prétexte que le LLM a écrit "flèche nord" plutôt que
  // "fleche_nord". L'enum interne reste normalisé.
  if (t === "fleche" || t === "flèche" || t === "fleche_nord" || t === "flèche_nord" || t === "fleche nord" || t === "flèche nord") return "fleche_nord";
  if (t === "rose" || t === "rose_des_vents" || t === "rose des vents") return "rose_des_vents";
  if (t === "boussole" || t === "compass") return "boussole";
  if (t === "absent" || t === "aucun" || t === "aucune" || t === "non") return "absent";
  return (VALID_ORIENTATION_KINDS as string[]).includes(t) ? (t as OrientationKind) : "inconnu";
}

function normalizePresence(v: unknown): PresenceFlag | null {
  if (v == null) return null;
  const t = String(v).toLowerCase().trim();
  if (t === "present" || t === "présent" || t === "true" || t === "oui") return "present";
  if (t === "absent" || t === "false" || t === "non") return "absent";
  if (t === "inconnu" || t === "n/a" || t === "na" || t === "unknown") return "inconnu";
  // Booléens bruts émis par certains LLM.
  if (v === true) return "present";
  if (v === false) return "absent";
  return null;
}

function parseOrientation(v: unknown): OrientationInfo | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const kind = normalizeOrientationKind(o.kind);
  // visible : si non renseigné, dérivé du kind (absent ou inconnu → false/null).
  let visible: boolean;
  if (typeof o.visible === "boolean") {
    visible = o.visible;
  } else {
    visible = kind !== "absent" && kind !== "inconnu";
  }
  return {
    kind,
    visible,
    evidence: s(o.evidence),
  };
}

function parsePrisesDeVue(v: unknown): PriseDeVue[] | null {
  if (!Array.isArray(v)) return null;
  const out: PriseDeVue[] = [];
  for (const item of v) {
    if (typeof item === "string" && item.trim()) {
      out.push({ label: item.trim() });
      continue;
    }
    if (item && typeof item === "object") {
      const o = item as Record<string, unknown>;
      const label = s(o.label);
      if (!label) continue;
      out.push({ label, page: n(o.page) });
    }
  }
  return out.length ? out : null;
}

function parseGraphics(v: unknown): GraphicsChecklist | null {
  if (!v || typeof v !== "object") return null;
  const g = v as Record<string, unknown>;
  return {
    orientation: parseOrientation(g.orientation),
    echelle_graphique: normalizePresence(g.echelle_graphique),
    legende: normalizePresence(g.legende),
    limites: normalizePresence(g.limites),
    acces: normalizePresence(g.acces),
    emprise: normalizePresence(g.emprise),
    cotes_completes: normalizePresence(g.cotes_completes),
    altimetries: normalizePresence(g.altimetries),
    prises_de_vue: parsePrisesDeVue(g.prises_de_vue),
  };
}

// Dérive le legacy `nord_visible` depuis `graphics.orientation` quand
// disponible — évite que l'UI/scoring perde l'info après refactor du prompt.
function deriveNordVisible(graphics: GraphicsChecklist | null, fallback: unknown): boolean | null {
  if (graphics?.orientation) {
    const o = graphics.orientation;
    if (o.kind === "inconnu") return null;
    if (o.kind === "absent") return false;
    return o.visible;
  }
  return b(fallback);
}

function deriveLegendeVisible(graphics: GraphicsChecklist | null, fallback: unknown): boolean | null {
  if (graphics?.legende) {
    if (graphics.legende === "inconnu") return null;
    return graphics.legende === "present";
  }
  return b(fallback);
}

// ── Parcelles observées : parsing tolérant ──────────────────────────────────
// Le LLM peut renvoyer numéro en string ou number ; section en majuscules ou
// non. On force section en majuscules (convention cadastrale) et numéro en
// string (un numéro peut être préfixé par des zéros : "0123").
const PARCELLE_SOURCE_FIELDS = new Set([
  "cartouche", "plan_situation", "plan_masse", "cerfa", "autre",
]);

function normalizeQualificatif(v: unknown): "entiere" | "partie" {
  // On retire la ponctuation et les espaces pour accepter "partie", "(partie)",
  // "(p)", "p", "part", "partial", "partie_parcelle", etc.
  const t = String(v ?? "").toLowerCase().replace(/[\s()_-]/g, "");
  if (t === "partie" || t === "p" || t === "part" || t === "partial" || t === "partieparcelle") return "partie";
  return "entiere";
}

// Phase 1 — Citations enrichies (page + bbox).
// Rétro-compatible : si le LLM renvoie un string[], chaque entrée est
// convertie en `{text: ...}` sans page ni bbox. Si une entrée est un objet
// mais sans `text`, elle est ignorée silencieusement.
function parseBbox(v: unknown): [number, number, number, number] | null {
  if (!Array.isArray(v) || v.length !== 4) return null;
  const nums = v.map((x) => (typeof x === "number" && Number.isFinite(x) ? x : null));
  if (nums.some((x) => x === null)) return null;
  return nums as [number, number, number, number];
}

function parseCitations(v: unknown): CitationRef[] {
  if (!Array.isArray(v)) return [];
  const out: CitationRef[] = [];
  for (const item of v) {
    if (typeof item === "string") {
      const t = item.trim();
      if (t) out.push({ text: t });
      continue;
    }
    if (item && typeof item === "object") {
      const o = item as Record<string, unknown>;
      const text = s(o.text);
      if (!text) continue;
      out.push({
        text,
        page: n(o.page),
        bbox: parseBbox(o.bbox),
        confidence: n(o.confidence),
      });
    }
  }
  return out;
}

function parseParcellesObservees(v: unknown): ParcelleObservee[] | null {
  if (!Array.isArray(v)) return null;
  const out: ParcelleObservee[] = [];
  for (const item of v) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const section = String(o.section ?? "").trim().toUpperCase();
    const numero = String(o.numero ?? "").trim();
    if (!section || !numero) continue;
    const sourceRaw = String(o.source_field ?? "").trim().toLowerCase();
    const source_field = PARCELLE_SOURCE_FIELDS.has(sourceRaw)
      ? (sourceRaw as ParcelleObservee["source_field"])
      : null;
    out.push({
      section,
      numero,
      qualificatif: normalizeQualificatif(o.qualificatif),
      source_field,
      citation: s(o.citation),
    });
  }
  return out.length ? out : null;
}

export function parseExtraction(raw: string): PieceExtraction {
  const obj = extractFirstJson(raw) as Record<string, unknown> | null;
  if (!obj || typeof obj !== "object") {
    return {
      piece_type: "autre",
      confidence_type: 0,
      quality: "illisible",
      echelle: null,
      nord_visible: null,
      legende_visible: null,
      graphics: null,
      parcelles_observees: null,
      missing_elements: ["Extraction IA non concluante."],
      citations: [],
      page_count: null,
      notes: null,
    };
  }

  const piece_type = normalizeType(obj.piece_type);
  const confidence_type = typeof obj.confidence_type === "number"
    ? Math.max(0, Math.min(1, obj.confidence_type))
    : 0.5;

  const cerfaRaw = obj.cerfa as Record<string, unknown> | null | undefined;
  const cerfa = cerfaRaw && typeof cerfaRaw === "object" ? {
    surface_terrain_m2: n(cerfaRaw.surface_terrain_m2),
    surface_plancher_existante_m2: n(cerfaRaw.surface_plancher_existante_m2),
    surface_plancher_creee_m2: n(cerfaRaw.surface_plancher_creee_m2),
    emprise_sol_existante_m2: n(cerfaRaw.emprise_sol_existante_m2),
    emprise_sol_creee_m2: n(cerfaRaw.emprise_sol_creee_m2),
    hauteur_max_m: n(cerfaRaw.hauteur_max_m),
    destination: s(cerfaRaw.destination),
    nb_logements: n(cerfaRaw.nb_logements),
    nb_places_stationnement: n(cerfaRaw.nb_places_stationnement),
    architecte_obligatoire: b(cerfaRaw.architecte_obligatoire),
  } : null;

  const pmRaw = obj.plan_masse as Record<string, unknown> | null | undefined;
  const plan_masse = pmRaw && typeof pmRaw === "object" ? {
    recul_voie_m: n(pmRaw.recul_voie_m),
    reculs_limites_m: arrN(pmRaw.reculs_limites_m),
    distances_entre_batiments_m: arrN(pmRaw.distances_entre_batiments_m),
    emprise_au_sol_m2: n(pmRaw.emprise_au_sol_m2),
    longueur_batiment_m: n(pmRaw.longueur_batiment_m),
    largeur_batiment_m: n(pmRaw.largeur_batiment_m),
    existant_projete_distingue: b(pmRaw.existant_projete_distingue),
  } : null;

  const pcRaw = obj.plan_coupe as Record<string, unknown> | null | undefined;
  const plan_coupe = pcRaw && typeof pcRaw === "object" ? {
    sol_naturel_ngf_m: n(pcRaw.sol_naturel_ngf_m),
    sol_fini_ngf_m: n(pcRaw.sol_fini_ngf_m),
    egout_ngf_m: n(pcRaw.egout_ngf_m),
    faitage_ngf_m: n(pcRaw.faitage_ngf_m),
    acrotere_ngf_m: n(pcRaw.acrotere_ngf_m),
    hauteur_egout_m: n(pcRaw.hauteur_egout_m),
    hauteur_faitage_m: n(pcRaw.hauteur_faitage_m),
    hauteur_acrotere_m: n(pcRaw.hauteur_acrotere_m),
    pente_terrain_pct: n(pcRaw.pente_terrain_pct),
  } : null;

  const pfRaw = obj.plan_facade as Record<string, unknown> | null | undefined;
  const plan_facade = pfRaw && typeof pfRaw === "object" ? {
    materiaux_principaux: arrS(pfRaw.materiaux_principaux),
    teintes: arrS(pfRaw.teintes),
    toiture_type: s(pfRaw.toiture_type),
    pente_toiture_deg: n(pfRaw.pente_toiture_deg),
  } : null;

  const noticeRaw = obj.notice as Record<string, unknown> | null | undefined;
  const notice = noticeRaw && typeof noticeRaw === "object" ? {
    description_projet: s(noticeRaw.description_projet),
    insertion_paysagere: s(noticeRaw.insertion_paysagere),
    materiaux_decrits: arrS(noticeRaw.materiaux_decrits),
  } : null;

  const photoRaw = obj.photo as Record<string, unknown> | null | undefined;
  const photo = photoRaw && typeof photoRaw === "object" ? {
    contexte_decrit: s(photoRaw.contexte_decrit),
    point_vue: s(photoRaw.point_vue),
  } : null;

  const graphics = parseGraphics(obj.graphics);
  const parcelles_observees = parseParcellesObservees(obj.parcelles_observees);

  return {
    piece_type,
    confidence_type,
    quality: normalizeQuality(obj.quality),
    echelle: s(obj.echelle),
    // Dérivés de `graphics` quand celui-ci est renseigné — préserve la
    // compatibilité avec les consommateurs historiques (dossierFacts UI,
    // benchmark scoring) sans imposer un double-renseignement au LLM.
    nord_visible: deriveNordVisible(graphics, obj.nord_visible),
    legende_visible: deriveLegendeVisible(graphics, obj.legende_visible),
    graphics,
    parcelles_observees,
    cerfa,
    plan_masse,
    plan_coupe,
    plan_facade,
    notice,
    photo,
    missing_elements: arrS(obj.missing_elements) ?? [],
    citations: parseCitations(obj.citations),
    page_count: n(obj.page_count),
    notes: s(obj.notes),
  };
}

export interface PieceExtractContext {
  // Hint sur le type attendu (depuis le code_piece). Ne court-circuite pas la
  // détection — le modèle peut toujours rectifier — mais aide à lever les
  // ambiguïtés (« CERFA » vs « plan »).
  expected_type?: PieceType;
  nom_piece?: string;
  code_piece?: string;
}

/**
 * Comme analyzePiece : accepte un chemin disque (legacy) OU un Buffer (S3).
 */
export async function extractPiece(
  fileOrPath: string | Buffer,
  mimeType: string,
  ctx?: PieceExtractContext,
  trace?: { dossierId?: string | null; communeId?: string | null; userId?: string | null },
): Promise<PieceExtraction | null> {
  if (!isAllowedImage(mimeType) && !isPdf(mimeType)) return null;

  let buf: Buffer;
  if (typeof fileOrPath === "string") {
    try { buf = fs.readFileSync(fileOrPath); } catch { return null; }
  } else {
    buf = fileOrPath;
  }
  if (buf.length > MAX_INLINE_BYTES) return null;

  const base64 = buf.toString("base64");
  const fileHash = sha256Buffer(buf);
  const isPdfFile = isPdf(mimeType);

  const documentBlock = isPdfFile
    ? { type: "document" as const, source: { type: "base64" as const, media_type: "application/pdf" as const, data: base64 } }
    : { type: "image" as const, source: { type: "base64" as const, media_type: mimeType as "image/jpeg" | "image/png" | "image/gif" | "image/webp", data: base64 } };

  const hint = ctx?.expected_type ? `Hint code pièce : type attendu = ${ctx.expected_type} (à valider visuellement).` : "";
  // RGPD : minimisation — on n'envoie que la rubrique métier, pas le nom de
  // fichier d'origine (qui contient souvent l'identité du pétitionnaire).
  const safeName = ctx?.nom_piece ? sanitizePieceName(ctx.nom_piece) : null;
  const meta = [
    safeName ? `Nom de la pièce : ${safeName}` : null,
    ctx?.code_piece ? `Code pièce : ${ctx.code_piece}` : null,
    hint,
  ].filter(Boolean).join("\n");

  const msg = await callAi(
    { purpose: "piece_extract", dossierId: trace?.dossierId, communeId: trace?.communeId, userId: trace?.userId, fileHash },
    {
      // ai-smart : modèle vision premium pour les plans cotés et les CERFA scannés.
      model: "ai-smart",
      max_tokens: 2500,
      system: SYSTEM_PROMPT,
      messages: [{
        role: "user",
        content: [
          documentBlock,
          { type: "text", text: meta || "Extrais les valeurs visibles sur cette pièce." },
        ],
      }],
    },
  );

  const text = msg.content[0]?.type === "text" ? msg.content[0].text : "{}";
  return parseExtraction(text);
}

// Heuristique simple : depuis un code de pièce, déduire le type attendu.
// Codes usuels CERFA : DP1/PC1 = situation, DP2/PC2 = masse, DP3 = coupe (PC3 = coupe),
// DP4/PC4 = notice, DP5 = façade, DP6/PC6 = photo, DP7/PC7 = photo lointaine, PC8 = insertion.
export function expectedTypeFromCode(code: string | null | undefined): PieceType | undefined {
  if (!code) return undefined;
  const c = code.toUpperCase().trim();
  if (c === "CERFA" || /CERFA/i.test(c)) return "cerfa";
  if (/^(DP|PC)0?1$/.test(c)) return "plan_situation";
  if (/^(DP|PC)0?2$/.test(c)) return "plan_masse";
  if (/^(DP|PC)0?3$/.test(c)) return "plan_coupe";
  if (/^(DP|PC)0?4$/.test(c)) return "notice";
  if (/^(DP)0?5$/.test(c)) return "plan_facade";
  if (/^PC0?5$/.test(c)) return "plan_facade";
  if (/^(DP)0?6$/.test(c) || /^PC0?6$/.test(c)) return "photo";
  if (/^(DP)0?7$/.test(c) || /^PC0?7$/.test(c)) return "photo";
  if (/^PC0?8$/.test(c)) return "insertion";
  return undefined;
}
