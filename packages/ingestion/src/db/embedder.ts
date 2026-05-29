/**
 * Voyage AI embedder — voyage-3 (1024 dims), the embeddings provider Anthropic
 * recommends. Requires VOYAGE_API_KEY. Batches up to 128 inputs per request.
 *
 * input_type "document" for the corpus we store; use "query" at search time.
 */
const VOYAGE_URL = "https://api.voyageai.com/v1/embeddings";
const MODEL = "voyage-3";
const MAX_BATCH = 128;

export const EMBEDDING_DIM = 1024;

export async function embedTexts(
  texts: string[],
  inputType: "document" | "query" = "document",
): Promise<number[][]> {
  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) throw new Error("VOYAGE_API_KEY non configurée — requis pour générer les embeddings.");

  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += MAX_BATCH) {
    const batch = texts.slice(i, i + MAX_BATCH);
    const r = await fetch(VOYAGE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: MODEL, input: batch, input_type: inputType }),
    });
    if (!r.ok) {
      throw new Error(`Voyage API ${r.status} : ${await r.text().catch(() => r.statusText)}`);
    }
    const data = (await r.json()) as { data?: Array<{ embedding: number[]; index: number }> };
    const sorted = (data.data ?? []).sort((a, b) => a.index - b.index);
    out.push(...sorted.map((d) => d.embedding));
  }
  return out;
}
