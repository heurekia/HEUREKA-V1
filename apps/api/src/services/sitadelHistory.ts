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
  const numDau = pickStr(row, "NUM_DAU");
  const typeDau = pickStr(row, "TYPE_DAU");
  if (!numDau || !typeDau) return null;

  const etatCode = pickStr(row, "ETAT_DAU") ?? "";

  const adresseParts = [
    pickStr(row, "ADR_NUM_TER"),
    pickStr(row, "ADR_LIBVOIE_TER"),
    pickStr(row, "ADR_LIEUDIT_TER"),
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
    superficie_terrain: pickNum(row, "SUPERFICIE_TERRAIN"),
    cadastre: buildCadastre(row),
    nature_projet: pickStr(row, "NATURE_PROJET_COMPLETEE") ?? pickStr(row, "NATURE_PROJET_DECLAREE"),
    destination: pickStr(row, "DESTINATION_PRINCIPALE"),
    nb_logements: pickNum(row, "NB_LGT_TOT_CREES"),
    surface_creee: pickNum(row, "SURF_HAB_CREEE") ?? pickNum(row, "SURF_LOC_CREEE"),
    source,
  };
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
  /** Si true, on filtre uniquement sur la parcelle. Sinon toute la commune. */
  parcelOnly?: boolean;
  /** Max de lignes ramenées par fichier source. Défaut 50. */
  maxPerSource?: number;
}

export async function fetchSitadelHistory(q: SitadelQuery): Promise<SitadelHistoryResult> {
  const maxPerSource = q.maxPerSource ?? 50;
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

  let permits = results.flat();

  // Filtrage cadastral en mémoire — l'API tabulaire ne permet pas de combiner
  // un filtre commune + un filtre section/numéro de façon fiable, et SITADEL
  // peut référencer la parcelle dans SEC_CADASTRE1, SEC_CADASTRE2 ou SEC_CADASTRE3.
  if (q.parcelOnly && q.cadastre && q.cadastre.length > 0) {
    const targets = new Set(
      q.cadastre.map((c) => `${c.section.toUpperCase()}|${c.numero.replace(/^0+/, "")}`),
    );
    permits = permits.filter((p) =>
      p.cadastre.some((c) =>
        targets.has(`${c.section.toUpperCase()}|${c.numero.replace(/^0+/, "")}`),
      ),
    );
  }

  // Tri antéchronologique sur date d'autorisation (ou de dépôt à défaut).
  permits.sort((a, b) => {
    const da = a.date_autorisation ?? (a.an_depot ? `${a.an_depot}-01-01` : "");
    const db = b.date_autorisation ?? (b.an_depot ? `${b.an_depot}-01-01` : "");
    return db.localeCompare(da);
  });

  const total = permits.length;
  const truncated = results.some((r) => r.length >= maxPerSource);

  return {
    permits: permits.slice(0, 100),
    total,
    truncated,
    sources_consulted: Object.keys(RESOURCES),
    warnings,
  };
}
