/**
 * SitadelHistoryService
 *
 * Récupère l'historique des autorisations d'urbanisme (PC, DP, PA, PD)
 * délivrées sur une parcelle ou une commune via la base ouverte SITADEL,
 * publiée mensuellement par le SDES sur data.gouv.fr et exposée par l'API
 * tabulaire (beta).
 *
 *   Dataset SDES :  https://www.data.gouv.fr/datasets/liste-des-permis-de-construire-et-autres-autorisations-durbanisme
 *   API tabulaire : https://tabular-api.data.gouv.fr/api/
 *
 * L'agrégation tape les 4 fichiers thématiques :
 *  - autorisations créant des logements
 *  - autorisations créant des locaux non résidentiels
 *  - permis d'aménager
 *  - permis de démolir
 *
 * Filtrage côté API par COMM (INSEE) puis filtre cadastral en mémoire
 * (l'API tabulaire ne supporte l'égalité que sur les colonnes indexées,
 * et seule COMM est suffisamment sélective).
 */

const TABULAR_API = "https://tabular-api.data.gouv.fr/api/resources";

// Resource IDs du dataset SDES "Liste des permis de construire et autres
// autorisations d'urbanisme" (689c42fa521ccf80ce954f83). Mis à jour mensuellement.
const RESOURCES = {
  logements: "65a9e264-7a20-46a9-9d98-66becb817bc3",
  locaux: "8f23d65f-7142-4ac5-94c1-077b028255bf",
  amenager: "9db13a09-72a9-4871-b430-13872b4890b3",
  demolir: "8f73cf2d-7bc4-4b5a-b912-718d6991f0a0",
} as const;

const ETAT_DAU_LABELS: Record<string, string> = {
  "1": "Déposé",
  "2": "Recevable",
  "3": "Autorisé",
  "4": "Refusé",
  "5": "DOC déposée",
  "6": "DAACT déposée",
  "7": "Annulé",
  "8": "Retiré",
};

const TYPE_DAU_LABELS: Record<string, string> = {
  PC: "Permis de construire",
  DP: "Déclaration préalable",
  PA: "Permis d'aménager",
  PD: "Permis de démolir",
};

export type SitadelScope = "parcel" | "street" | "commune" | "auto";

export interface SitadelPermit {
  num_dau: string;
  type_dau: string;            // "PC" | "DP" | "PA" | "PD"
  type_label: string;
  etat: string;                // libellé lisible
  etat_code: string;
  date_autorisation: string | null;
  date_doc: string | null;     // déclaration d'ouverture de chantier
  date_daact: string | null;   // déclaration d'achèvement
  an_depot: number | null;
  adresse: string | null;
  voie: string | null;         // ADR_LIBVOIE_TER brut (sert au filtre rue)
  lieudit: string | null;      // ADR_LIEUDIT_TER brut (adresses rurales)
  superficie_terrain: number | null;
  cadastre: Array<{ section: string; numero: string }>;
  // Détails projet (présents selon la source)
  nature_projet: string | null;
  destination: string | null;
  nb_logements: number | null;
  surface_creee: number | null;
  source: "logements" | "locaux" | "amenager" | "demolir";
}

export interface SitadelHistoryResult {
  permits: SitadelPermit[];
  total: number;
  truncated: boolean;
  /** Niveau de filtre effectivement retenu (utile en mode auto). */
  effective_scope: SitadelScope;
  sources_consulted: string[];
  warnings: string[];
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function pickStr(row: Record<string, unknown>, key: string): string | null {
  const v = row[key];
  if (v == null) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
}

function pickNum(row: Record<string, unknown>, key: string): number | null {
  const v = row[key];
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

function buildCadastre(row: Record<string, unknown>): Array<{ section: string; numero: string }> {
  const out: Array<{ section: string; numero: string }> = [];
  for (let i = 1; i <= 3; i++) {
    const sec = pickStr(row, `SEC_CADASTRE${i}`);
    const num = pickStr(row, `NUM_CADASTRE${i}`);
    if (sec && num) out.push({ section: sec, numero: num });
  }
  return out;
}

function normalize(row: Record<string, unknown>, source: SitadelPermit["source"]): SitadelPermit | null {
  const numDau = pickStr(row, "NUM_DAU") ?? pickStr(row, "NUM_PA") ?? pickStr(row, "NUM_PD");
  const typeDau = pickStr(row, "TYPE_DAU")
    ?? (source === "amenager" ? "PA" : source === "demolir" ? "PD" : null);
  if (!numDau || !typeDau) return null;

  const etatCode = pickStr(row, "ETAT_DAU") ?? pickStr(row, "ETAT_PA") ?? pickStr(row, "ETAT_PD") ?? "";

  const voie = pickStr(row, "ADR_LIBVOIE_TER");
  const lieudit = pickStr(row, "ADR_LIEUDIT_TER");
  const adresseParts = [
    pickStr(row, "ADR_NUM_TER"),
    voie,
    lieudit,
    pickStr(row, "ADR_LOCALITE_TER"),
  ].filter(Boolean);
  const adresse = adresseParts.length > 0 ? adresseParts.join(" ") : null;

  return {
    num_dau: numDau,
    type_dau: typeDau,
    type_label: TYPE_DAU_LABELS[typeDau] ?? typeDau,
    etat: ETAT_DAU_LABELS[etatCode] ?? etatCode,
    etat_code: etatCode,
    date_autorisation: pickStr(row, "DATE_REELLE_AUTORISATION"),
    date_doc: pickStr(row, "DATE_REELLE_DOC"),
    date_daact: pickStr(row, "DATE_REELLE_DAACT"),
    an_depot: pickNum(row, "AN_DEPOT"),
    adresse,
    voie,
    lieudit,
    superficie_terrain: pickNum(row, "SUPERFICIE_TERRAIN"),
    cadastre: buildCadastre(row),
    nature_projet: pickStr(row, "NATURE_PROJET_COMPLETEE") ?? pickStr(row, "NATURE_PROJET_DECLAREE"),
    destination: pickStr(row, "DESTINATION_PRINCIPALE"),
    nb_logements: pickNum(row, "NB_LGT_TOT_CREES"),
    surface_creee: pickNum(row, "SURF_HAB_CREEE") ?? pickNum(row, "SURF_LOC_CREEE"),
    source,
  };
}

// ── Filtres / normalisation pour le scope cascadé ───────────────────────────

/** Normalisation FR pour comparer noms de voies SITADEL ↔ adresse dossier.
 *  SITADEL stocke en majuscules non-accentuées (`ADR_LIBVOIE_TER`, 26 car. max),
 *  ex. "AVENUE DE LA REPUBLIQUE". Côté dossier on a souvent du libre saisi mixte,
 *  avec ponctuation et numéro de voie en tête. On enlève accents/ponctuation,
 *  on uppercase, on compacte les espaces. */
function normalizeVoie(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Retire le numéro de voie (et bis/ter/quater) en tête. */
function stripLeadingHouseNumber(s: string): string {
  return s.replace(/^\s*\d+\s*(BIS|TER|QUATER)?\s*/i, "");
}

function cadastreKey(c: { section: string; numero: string }): string {
  return `${c.section.toUpperCase()}|${c.numero.replace(/^0+/, "")}`;
}

function matchesParcel(p: SitadelPermit, cadastre: Array<{ section: string; numero: string }>): boolean {
  if (cadastre.length === 0) return false;
  const targets = new Set(cadastre.map(cadastreKey));
  return p.cadastre.some((c) => targets.has(cadastreKey(c)));
}

function matchesStreet(p: SitadelPermit, streetNorm: string): boolean {
  if (!streetNorm) return false;
  const candidates: string[] = [];
  if (p.voie) candidates.push(normalizeVoie(p.voie));
  if (p.lieudit) candidates.push(normalizeVoie(p.lieudit));
  if (candidates.length === 0) return false;
  // Match symétrique : le libellé SITADEL peut être tronqué à 26 caractères, et
  // l'adresse côté dossier peut au contraire être plus longue (avec commune en
  // suffixe). On accepte donc l'inclusion dans les deux sens.
  return candidates.some((c) => c.includes(streetNorm) || streetNorm.includes(c));
}

async function fetchResource(
  rid: string,
  source: SitadelPermit["source"],
  inseeCode: string,
  maxRows: number,
): Promise<{ rows: SitadelPermit[]; failed: boolean }> {
  // L'API tabulaire accepte des filtres `<COL>__exact=<val>` directement
  // dans la query string. COMM (code INSEE de la commune) est le filtre
  // serveur le plus efficace ; le reste (matching cadastral) se fait en
  // mémoire pour éviter des requêtes paginées coûteuses.
  const params = new URLSearchParams({
    COMM__exact: inseeCode,
    page_size: String(Math.min(maxRows, 50)),
    page: "1",
  });
  const url = `${TABULAR_API}/${rid}/data/?${params.toString()}`;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return { rows: [], failed: true };
    const json = await r.json() as { data?: Array<Record<string, unknown>> };
    const rows = (json.data ?? [])
      .map((row) => normalize(row, source))
      .filter((p): p is SitadelPermit => p !== null);
    return { rows, failed: false };
  } catch {
    return { rows: [], failed: true };
  }
}

// ── API publique ────────────────────────────────────────────────────────────

export interface SitadelQuery {
  insee_code: string;
  cadastre?: Array<{ section: string; numero: string }>;
  /** Libellé de voie (extraite de l'adresse dossier ou saisie). Comparée à
   *  ADR_LIBVOIE_TER / ADR_LIEUDIT_TER après normalisation. */
  street?: string | null;
  /** Stratégie de filtrage. "auto" cascade parcelle → rue → commune et retient
   *  le premier niveau qui ramène au moins un permis. Défaut "auto". */
  scope?: SitadelScope;
  /** Max de lignes ramenées par fichier source. Défaut 50. */
  maxPerSource?: number;
}

export async function fetchSitadelHistory(q: SitadelQuery): Promise<SitadelHistoryResult> {
  const maxPerSource = q.maxPerSource ?? 50;
  const scope: SitadelScope = q.scope ?? "auto";
  const warnings: string[] = [];

  const results = await Promise.all(
    (Object.entries(RESOURCES) as Array<[SitadelPermit["source"], string]>).map(
      async ([source, rid]) => {
        const r = await fetchResource(rid, source, q.insee_code, maxPerSource);
        if (r.failed) warnings.push(`source ${source} indisponible`);
        return r.rows;
      },
    ),
  );

  const allPermits = results.flat();
  const cadastre = q.cadastre ?? [];
  const streetNorm = q.street ? normalizeVoie(stripLeadingHouseNumber(q.street)) : null;

  // Cascade : parcelle → rue → commune. En mode forcé ("parcel" / "street" /
  // "commune") on s'arrête au niveau demandé, même s'il est vide. En mode
  // "auto" on remonte jusqu'au premier niveau non vide, ce qui correspond au
  // comportement attendu sur l'onglet Parcelle : "exact si possible, sinon on
  // élargit".
  let filtered: SitadelPermit[];
  let effective: SitadelScope;

  const tryParcel = () => cadastre.length > 0 ? allPermits.filter((p) => matchesParcel(p, cadastre)) : null;
  const tryStreet = () => streetNorm ? allPermits.filter((p) => matchesStreet(p, streetNorm)) : null;

  if (scope === "parcel") {
    filtered = tryParcel() ?? [];
    effective = "parcel";
  } else if (scope === "street") {
    filtered = tryStreet() ?? [];
    effective = "street";
  } else if (scope === "commune") {
    filtered = allPermits;
    effective = "commune";
  } else {
    // auto
    const atParcel = tryParcel();
    if (atParcel && atParcel.length > 0) {
      filtered = atParcel;
      effective = "parcel";
    } else {
      const atStreet = tryStreet();
      if (atStreet && atStreet.length > 0) {
        filtered = atStreet;
        effective = "street";
      } else {
        filtered = allPermits;
        effective = "commune";
      }
    }
  }

  // Tri antéchronologique sur date d'autorisation (ou de dépôt à défaut).
  filtered.sort((a, b) => {
    const da = a.date_autorisation ?? (a.an_depot ? `${a.an_depot}-01-01` : "");
    const db = b.date_autorisation ?? (b.an_depot ? `${b.an_depot}-01-01` : "");
    return db.localeCompare(da);
  });

  const total = filtered.length;
  const truncated = results.some((r) => r.length >= maxPerSource);

  return {
    permits: filtered.slice(0, 100),
    total,
    truncated,
    effective_scope: effective,
    sources_consulted: Object.keys(RESOURCES),
    warnings,
  };
}
