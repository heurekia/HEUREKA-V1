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

export interface PieceExtraction {
  piece_type: PieceType;
  // Confiance du modèle sur le TYPE détecté (0..1).
  confidence_type: number;
  quality: "lisible" | "partiellement_lisible" | "illisible";
  echelle: string | null;       // ex: "1/200", "1/500", null si non visible
  nord_visible: boolean | null;
  legende_visible: boolean | null;

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
  // Ex: ["recul voie 4.20 m", "H égout = 6.80 m / NGF 105.10"]
  citations: string[];

  // Note libre pour le cas où le modèle a un doute sur l'identification.
  notes: string | null;
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
- plan de masse : "échelle absente", "flèche Nord absente", "cote de recul voie absente", "cote de recul limites séparatives absente", "emprise au sol non chiffrée", "distinction existant/projeté absente".
- plan de coupe : "cote NGF sol naturel absente", "cote NGF égout absente", "cote NGF acrotère/faîtage absente", "hauteur calculée absente".
- plan de façade : "matériau de toiture non précisé", "teintes non précisées".
- CERFA : "surface plancher créée non renseignée", "destination non renseignée", "nb logements non renseigné" — UNIQUEMENT si attendu pour le projet.

ÉTAPE 4 — "citations" : liste les extraits textuels EXACTS que tu as lus pour appuyer chaque valeur extraite. Ex: ["recul voie 4.20 m", "H égout = 6.80 m / NGF 105.10", "SP créée : 95 m²"]. Sans citation, pas de valeur.

ÉTAPE 5 — Si l'identification de type est incertaine (< 0.7), mets confidence_type bas et explique dans "notes".

SORTIE — UNIQUEMENT du JSON valide, sans markdown, sans préambule :
{
  "piece_type": "cerfa|plan_situation|plan_masse|plan_coupe|plan_facade|notice|photo|insertion|autre",
  "confidence_type": 0.0,
  "quality": "lisible|partiellement_lisible|illisible",
  "echelle": "1/200" | null,
  "nord_visible": true|false|null,
  "legende_visible": true|false|null,
  "cerfa": null | { "surface_terrain_m2": ..., "surface_plancher_existante_m2": ..., "surface_plancher_creee_m2": ..., "emprise_sol_existante_m2": ..., "emprise_sol_creee_m2": ..., "hauteur_max_m": ..., "destination": "habitation"|null, "nb_logements": ..., "nb_places_stationnement": ..., "architecte_obligatoire": true|false|null },
  "plan_masse": null | { "recul_voie_m": ..., "reculs_limites_m": [3.5, 4.2], "distances_entre_batiments_m": [...], "emprise_au_sol_m2": ..., "longueur_batiment_m": ..., "largeur_batiment_m": ..., "existant_projete_distingue": true|false|null },
  "plan_coupe": null | { "sol_naturel_ngf_m": ..., "sol_fini_ngf_m": ..., "egout_ngf_m": ..., "faitage_ngf_m": ..., "acrotere_ngf_m": ..., "hauteur_egout_m": ..., "hauteur_faitage_m": ..., "hauteur_acrotere_m": ..., "pente_terrain_pct": ... },
  "plan_facade": null | { "materiaux_principaux": ["enduit blanc"], "teintes": ["RAL 9010"], "toiture_type": "deux pans"|null, "pente_toiture_deg": ... },
  "notice": null | { "description_projet": "...", "insertion_paysagere": "...", "materiaux_decrits": [...] },
  "photo": null | { "contexte_decrit": "...", "point_vue": "..." },
  "missing_elements": ["échelle absente", "flèche Nord absente"],
  "citations": ["recul voie 4.20 m"],
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
      missing_elements: ["Extraction IA non concluante."],
      citations: [],
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

  return {
    piece_type,
    confidence_type,
    quality: normalizeQuality(obj.quality),
    echelle: s(obj.echelle),
    nord_visible: b(obj.nord_visible),
    legende_visible: b(obj.legende_visible),
    cerfa,
    plan_masse,
    plan_coupe,
    plan_facade,
    notice,
    photo,
    missing_elements: arrS(obj.missing_elements) ?? [],
    citations: arrS(obj.citations) ?? [],
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
