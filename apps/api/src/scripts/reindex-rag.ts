/**
 * Script de ré-indexation RAG : ré-embedde tous les regulatory_documents qui
 * ont un pdf_content stocké, vers le nouvel embedder Mistral.
 *
 * À exécuter UNE FOIS après la bascule Voyage AI → Mistral. Les vecteurs
 * des deux fournisseurs vivent dans des espaces distincts ; sans cette
 * passe, les recherches retournent du bruit.
 *
 * Idempotent : `indexCommuneDocument` supprime les anciens segments avant
 * d'écrire les nouveaux (par source_id). Un re-run après échec partiel
 * reprend proprement.
 *
 * Usage :
 *   pnpm --filter @heureka-v1/api reindex-rag                 # tout le corpus
 *   pnpm --filter @heureka-v1/api reindex-rag --dry-run       # liste sans toucher
 *   pnpm --filter @heureka-v1/api reindex-rag --commune 37018 # restreindre par INSEE
 *   pnpm --filter @heureka-v1/api reindex-rag --only-failed   # rejoue les "indexing_error"
 *
 * Doit voir MISTRAL_API_KEY et DATABASE_URL dans son env.
 */
import "dotenv/config";
import { eq, and, isNotNull } from "drizzle-orm";
import { db } from "../db.js";
import { regulatory_documents, communes } from "@heureka-v1/db";
import { indexCommuneDocument } from "../services/ragService.js";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const onlyFailed = args.includes("--only-failed");
const communeFilter = (() => {
  const i = args.indexOf("--commune");
  return i >= 0 ? args[i + 1] : undefined;
})();

interface Row {
  id: string;
  type: string;
  name: string;
  original_filename: string;
  pdf_content: string;
  status: string;
  insee_code: string;
  commune_name: string;
  commune_id: string;
}

async function loadCorpus(): Promise<Row[]> {
  const conditions = [isNotNull(regulatory_documents.pdf_content)];
  if (onlyFailed) conditions.push(eq(regulatory_documents.status, "indexing_error"));
  if (communeFilter) conditions.push(eq(communes.insee_code, communeFilter));

  const rows = await db
    .select({
      id: regulatory_documents.id,
      type: regulatory_documents.type,
      name: regulatory_documents.name,
      original_filename: regulatory_documents.original_filename,
      pdf_content: regulatory_documents.pdf_content,
      status: regulatory_documents.status,
      insee_code: communes.insee_code,
      commune_name: communes.name,
      commune_id: communes.id,
    })
    .from(regulatory_documents)
    .innerJoin(communes, eq(regulatory_documents.commune_id, communes.id))
    .where(and(...conditions));

  return rows.filter((r): r is Row => r.pdf_content !== null);
}

async function main() {
  const corpus = await loadCorpus();
  console.log(`[reindex] ${corpus.length} document(s) à traiter${dryRun ? " (DRY-RUN)" : ""}.`);

  if (dryRun) {
    for (const r of corpus) {
      console.log(`  · ${r.commune_name} (${r.insee_code}) · ${r.type} · ${r.name} · status=${r.status}`);
    }
    process.exit(0);
  }

  let ok = 0;
  let empty = 0;
  let failed = 0;

  for (const [i, r] of corpus.entries()) {
    const prefix = `[${i + 1}/${corpus.length}] ${r.commune_name} · ${r.type} · ${r.name}`;
    try {
      await db.update(regulatory_documents)
        .set({ status: "indexing", updated_at: new Date() })
        .where(eq(regulatory_documents.id, r.id));

      const result = await indexCommuneDocument({
        document_id: r.id,
        insee: r.insee_code,
        commune_name: r.commune_name,
        doc_type: r.type,
        document_name: r.name,
        original_filename: r.original_filename,
        pdf_base64: r.pdf_content,
        commune_id: r.commune_id,
      });

      const nextStatus = result.chunks > 0 ? "indexed" : "indexing_empty";
      await db.update(regulatory_documents)
        .set({ status: nextStatus, ingested_at: new Date(), updated_at: new Date() })
        .where(eq(regulatory_documents.id, r.id));

      if (result.chunks > 0) ok++; else empty++;
      console.log(`${prefix} → ${nextStatus} (${result.chunks} chunks, ${result.extracted_pages} pages)`);
    } catch (err) {
      failed++;
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`${prefix} → ERREUR : ${msg}`);
      await db.update(regulatory_documents)
        .set({ status: "indexing_error", updated_at: new Date() })
        .where(eq(regulatory_documents.id, r.id))
        .catch(() => { /* best-effort */ });
    }
  }

  console.log(`\n[reindex] terminé : ${ok} indexés · ${empty} vides · ${failed} en erreur.`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("[reindex] échec fatal :", err);
  process.exit(2);
});
