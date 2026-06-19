/**
 * Embedder Mistral — modèle `mistral-embed` (1024 dims), hébergé France.
 * Requiert MISTRAL_API_KEY (déjà utilisée pour l'inférence LLM). Batches
 * jusqu'à 128 inputs par requête. Pas de distinction document/query.
 *
 * Tracking : `embedTexts()` accepte un callback optionnel `onUsage` appelé
 * pour chaque batch avec les tokens consommés et la durée. C'est la façon
 * dont apps/api injecte sa fonction `trackExternalMistralUsage()` (qui vit
 * dans le service aiUsage et ne peut pas être importée depuis ce package
 * indépendant). Sans callback, l'appel reste fonctionnel mais invisible
 * dans l'onglet Coûts IA.
 */
const MISTRAL_API_BASE = process.env.MISTRAL_API_BASE ?? "https://api.mistral.ai/v1";
const MODEL = "mistral-embed";
const MAX_BATCH = 128;

export const EMBEDDING_DIM = 1024;

export interface EmbedUsage {
  model: string;
  prompt_tokens: number;
  duration_ms: number;
}

export interface EmbedOptions {
  /**
   * Callback appelé après chaque batch embeddings réussi. Injecté par
   * apps/api pour persister dans ai_usage_events. Erreurs avalées : un
   * échec de tracking ne doit jamais faire échouer l'indexation.
   */
  onUsage?: (u: EmbedUsage) => void;
}

export async function embedTexts(texts: string[], opts: EmbedOptions = {}): Promise<number[][]> {
  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey) throw new Error("MISTRAL_API_KEY non configurée — requise pour générer les embeddings.");

  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += MAX_BATCH) {
    const batch = texts.slice(i, i + MAX_BATCH);
    const startedAt = Date.now();
    const r = await fetch(`${MISTRAL_API_BASE}/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: MODEL, input: batch }),
    });
    if (!r.ok) {
      throw new Error(`Mistral embeddings API ${r.status} : ${await r.text().catch(() => r.statusText)}`);
    }
    const data = (await r.json()) as {
      data?: Array<{ embedding: number[]; index: number }>;
      usage?: { prompt_tokens?: number; total_tokens?: number };
    };
    const sorted = (data.data ?? []).sort((a, b) => a.index - b.index);
    out.push(...sorted.map((d) => d.embedding));

    if (opts.onUsage) {
      try {
        opts.onUsage({
          model: MODEL,
          prompt_tokens: data.usage?.prompt_tokens ?? data.usage?.total_tokens ?? 0,
          duration_ms: Date.now() - startedAt,
        });
      } catch {
        /* tracking best-effort */
      }
    }
  }
  return out;
}
