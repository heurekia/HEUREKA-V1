// Légifrance / PISTE integration — article caching service
// OAuth2 CC token is kept in memory and refreshed automatically.

const OAUTH_URL = "https://oauth.piste.gouv.fr/api/oauth/token";
const API_BASE  = "https://api.piste.gouv.fr/dila/legifrance/lf-engine-app";

export const CODE_URBANISME_ID   = "LEGITEXT000006074075";
export const CODE_URBANISME_NAME = "Code de l'urbanisme";

// Articles to pre-cache. Group: ref → friendly title hint (used as fallback label).
export const ARTICLES_TO_CACHE: Record<string, string> = {
  // Décisions
  "L424-1": "Non-opposition / accord",
  "L424-2": "Non-opposition tacite",
  "L424-3": "Motivation du refus",
  "L424-4": "Sursis à statuer",
  "L424-5": "Décision de non-opposition conditionnée",
  "L424-6": "Affichage de la décision",
  // Achèvement / conformité
  "L462-1": "Déclaration d'achèvement (DAACT)",
  "L462-2": "Conformité des travaux",
  "L462-4": "Non-conformité partielle",
  "R462-1": "Délai de contestation DAACT",
  "R462-2": "Procédure de récolement",
  "R462-3": "Attestation de conformité",
  // Instruction / pièces
  "R423-26": "Délai d'instruction",
  "R423-38": "Demande de pièces complémentaires",
  "R423-39": "Suspension du délai — pièces manquantes",
  "R423-40": "Retrait de demande incomplète",
  "R423-43": "Délai de notification de la décision",
  "R423-54": "Prolongation du délai d'instruction",
  // Notification
  "R424-1": "Modalités de notification",
  "R424-2": "Notification du refus",
  "R424-3": "Délai de recours",
  "R424-5": "Affichage et notification",
  // Recours contentieux
  "L600-1": "Délai de recours contentieux",
  "L600-2": "Délai de recours des tiers",
  // Certificat d'urbanisme
  "L410-1": "Nature du certificat d'urbanisme",
  "L410-2": "Contenu et effets",
};

// Suggestion mapping: "{type_dossier}:{category}" or "*:{category}" → article refs
export const MENTIONS_MAP: Record<string, string[]> = {
  // Permis de construire
  "permis_de_construire:avis_favorable":         ["L424-1", "L462-1", "R462-1", "R462-3"],
  "permis_de_construire:avis_defavorable":        ["L424-3", "L600-2", "R424-2", "R424-3"],
  "permis_de_construire:avis_reserves":           ["L424-1", "L462-4", "R462-1"],
  "permis_de_construire:accord_tacite":           ["L424-2", "R423-26", "R423-43"],
  "permis_de_construire:pieces_complementaires":  ["R423-38", "R423-39", "R423-40"],
  "permis_de_construire:notification_decision":   ["L424-6", "R424-1", "R424-5"],
  // Déclaration préalable
  "declaration_prealable:avis_favorable":         ["L424-1", "L462-1"],
  "declaration_prealable:avis_defavorable":       ["L424-3", "L600-2", "R424-2"],
  "declaration_prealable:avis_reserves":          ["L424-1", "R424-1"],
  "declaration_prealable:accord_tacite":          ["L424-2", "R423-26"],
  "declaration_prealable:pieces_complementaires": ["R423-38", "R423-39"],
  "declaration_prealable:notification_decision":  ["L424-6", "R424-5"],
  // Permis d'aménager
  "permis_amenager:avis_favorable":               ["L424-1", "L462-1"],
  "permis_amenager:avis_defavorable":             ["L424-3", "R424-2"],
  "permis_amenager:accord_tacite":                ["L424-2"],
  "permis_amenager:pieces_complementaires":       ["R423-38", "R423-39"],
  // Permis de démolir
  "permis_demolir:avis_favorable":                ["L424-1"],
  "permis_demolir:avis_defavorable":              ["L424-3", "R424-2"],
  "permis_demolir:pieces_complementaires":        ["R423-38"],
  // Certificat d'urbanisme
  "certificat_urbanisme:notification_decision":   ["L410-1", "L410-2"],
  // Wildcards
  "*:accord_tacite":                              ["L424-2"],
  "*:pieces_complementaires":                     ["R423-38", "R423-39", "R423-40"],
  "*:avis_defavorable":                           ["L424-3", "L600-2"],
  "*:notification_decision":                      ["L424-6", "R424-5"],
};

// ── Token cache ──────────────────────────────────────────────────────────────

let cachedToken: { value: string; expiresAt: number } | null = null;

export async function getPisteToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;

  // Gravitee uses API Key / Secret Key as OAuth client credentials
  const clientId     = process.env.PISTE_API_KEY     ?? process.env.PISTE_CLIENT_ID!;
  const clientSecret = process.env.PISTE_SECRET_KEY  ?? process.env.PISTE_CLIENT_SECRET!;
  const basicAuth    = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const res = await fetch(OAUTH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Authorization": `Basic ${basicAuth}`,
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      scope: "openid",
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) throw new Error(`PISTE OAuth: ${res.status} ${await res.text()}`);
  const data = await res.json() as { access_token: string; expires_in: number };
  cachedToken = { value: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return cachedToken.value;
}

// ── Article fetcher ──────────────────────────────────────────────────────────

type SearchResult = {
  results?: Array<{ titles?: Array<{ id?: string }> }>;
};
type ArticleResult = {
  article?: { id?: string; titre?: string; texteHtml?: string; texte?: string };
};

export async function fetchLegifranceArticle(
  articleRef: string,
  token: string,
): Promise<{ legiId: string; title: string; html: string } | null> {
  const nowMs = Date.now();
  const apiKey = process.env.PISTE_API_KEY ?? process.env.PISTE_CLIENT_ID!;
  const apiHeaders = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    accept: "application/json",
    "X-Gravitee-Api-Key": apiKey,
  };

  // Step 1 — search for LEGIARTI id
  const searchRes = await fetch(`${API_BASE}/search`, {
    method: "POST",
    headers: apiHeaders,
    body: JSON.stringify({
      recherche: {
        champs: [{
          typeChamp: "NUM_ARTICLE",
          criteres: [{ typeRecherche: "EXACTE", valeur: articleRef, operateur: "ET" }],
          operateur: "ET",
        }],
        filtres: [
          { facette: "NOM_CODE", valeurs: [CODE_URBANISME_NAME] },
          { facette: "DATE_VERSION", singleDate: nowMs },
        ],
        pageNumber: 1, pageSize: 1,
        operateur: "ET", sort: "PERTINENCE", typePagination: "ARTICLE",
      },
      fond: "CODE_DATE",
    }),
    signal: AbortSignal.timeout(12_000),
  });

  if (!searchRes.ok) return null;
  const searchData = await searchRes.json() as SearchResult;
  const legiId = searchData.results?.[0]?.titles?.[0]?.id;
  if (!legiId) return null;

  // Step 2 — get article content
  const artRes = await fetch(`${API_BASE}/consult/getArticle`, {
    method: "POST",
    headers: apiHeaders,
    body: JSON.stringify({ id: legiId }),
    signal: AbortSignal.timeout(12_000),
  });

  if (!artRes.ok) return null;
  const artData = await artRes.json() as ArticleResult;
  const art = artData.article;
  if (!art) return null;

  return {
    legiId,
    title: art.titre ?? `Article ${articleRef}`,
    html: art.texteHtml ?? (art.texte ? `<p>${art.texte}</p>` : ""),
  };
}
