/**
 * Embedder Mistral — modèle `mistral-embed` (1024 dims), hébergé France.
 * Requiert MISTRAL_API_KEY (déjà utilisée pour l'inférence LLM). Batches
 * jusqu'à 128 inputs par requête. Pas de distinction document/query.
 */
const MISTRAL_API_BASE = process.env.MISTRAL_API_BASE ?? "https://api.mistral.ai/v1";
const MODEL = "mistral-embed";
const MAX_BATCH = 128;

export const EMBEDDING_DIM = 1024;

export async function embedTexts(texts: string[]): Promise<number[][]> {
  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey) throw new Error("MISTRAL_API_KEY non configurée — requise pour générer les embeddings.");

  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += MAX_BATCH) {
    const batch = texts.slice(i, i + MAX_BATCH);
    const r = await fetch(`${MISTRAL_API_BASE}/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: MODEL, input: batch }),
    });
    if (!r.ok) {
      throw new Error(`Mistral embeddings API ${r.status} : ${await r.text().catch(() => r.statusText)}`);
    }
    const data = (await r.json()) as { data?: Array<{ embedding: number[]; index: number }> };
    const sorted = (data.data ?? []).sort((a, b) => a.index - b.index);
    out.push(...sorted.map((d) => d.embedding));
  }
  return out;
}
