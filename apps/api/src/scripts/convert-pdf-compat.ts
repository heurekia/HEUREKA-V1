/**
 * Backfill : génère la variante "compat" (re-encodée par pdftocairo) des
 * PDF déjà déposés dont le rendu pdf.js est dégradé à cause du JPEG 2000.
 *
 * Architecture : cf. apps/api/src/services/pdfCompat.ts.
 *
 * Usage :
 *   pnpm --filter @heureka-v1/api convert-pdf-compat --dry-run
 *   pnpm --filter @heureka-v1/api convert-pdf-compat                # toutes les pièces
 *   pnpm --filter @heureka-v1/api convert-pdf-compat --only-failed  # rejoue ce qui a planté
 *   pnpm --filter @heureka-v1/api convert-pdf-compat --concurrency 3 (défaut 1)
 *
 * Idempotent : on saute les pièces dont la version compat existe déjà.
 */
import "dotenv/config";
import { eq } from "drizzle-orm";
import { db } from "../db.js";
import { dossier_pieces_jointes } from "@heureka-v1/db";
import { getStorageProvider } from "../services/storage.js";
import { containsJpx, convertToCompatPdf, compatKeyFor } from "../services/pdfCompat.js";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const onlyFailed = args.includes("--only-failed");
const concurrencyArg = args.indexOf("--concurrency");
const concurrency = concurrencyArg >= 0 ? Math.max(1, Number(args[concurrencyArg + 1]) || 1) : 1;

interface Row {
  id: string;
  url: string;
  nom: string;
}

function keyFromUrl(url: string): string | null {
  const m = url.match(/\/api\/uploads\/([^?#]+)$/);
  return m ? m[1]! : null;
}

async function processOne(provider: ReturnType<typeof getStorageProvider>, row: Row): Promise<"converted" | "skipped_no_jpx" | "skipped_already" | "failed"> {
  const key = keyFromUrl(row.url);
  if (!key) return "failed";
  const compatKey = compatKeyFor(key);

  // Idempotence : ne rien faire si la compat existe déjà.
  try {
    await provider.getStream(compatKey);
    return "skipped_already";
  } catch (err) {
    const code = (err as { name?: string; code?: string }).name
      ?? (err as { code?: string }).code;
    if (code !== "NoSuchKey" && code !== "NotFound" && code !== "ENOENT") throw err;
  }

  // Récupère l'original et regarde si JPX dedans.
  const buf = await provider.getBuffer(key);
  if (!containsJpx(buf)) return "skipped_no_jpx";

  if (dryRun) {
    console.log(`  [DRY] aurait converti ${row.nom} (${key})`);
    return "converted";
  }

  const compatBuf = await convertToCompatPdf(buf);
  await provider.put({ key: compatKey, body: compatBuf, mime: "application/pdf" });
  console.log(`  ✓ ${row.nom} → ${compatKey} (${(compatBuf.length / 1024).toFixed(0)} KB)`);
  return "converted";
}

async function main() {
  const provider = getStorageProvider();

  // Toutes les pièces PDF. Le filtre JPX se fait sur le contenu (on ne le
  // connaît pas avant de lire le buffer), pas en SQL.
  const rows = await db
    .select({ id: dossier_pieces_jointes.id, url: dossier_pieces_jointes.url, nom: dossier_pieces_jointes.nom })
    .from(dossier_pieces_jointes)
    .where(eq(dossier_pieces_jointes.type, "application/pdf"));

  console.log(`[compat] ${rows.length} PDF candidat(s) à inspecter${dryRun ? " (DRY-RUN)" : ""}, concurrence=${concurrency}.`);

  let converted = 0, skippedNoJpx = 0, skippedAlready = 0, failed = 0;
  const queue = [...rows];

  async function worker() {
    while (queue.length > 0) {
      const row = queue.shift()!;
      try {
        const r = await processOne(provider, row);
        if (r === "converted") converted++;
        else if (r === "skipped_no_jpx") skippedNoJpx++;
        else if (r === "skipped_already") skippedAlready++;
        else failed++;
      } catch (err) {
        failed++;
        console.error(`  ✗ ${row.nom} (${row.id}) :`, err instanceof Error ? err.message : err);
        if (onlyFailed) {
          // En mode --only-failed on ne fait rien d'autre, le compteur est déjà mis à jour.
        }
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  console.log(`\n[compat] Terminé.`);
  console.log(`  converti(s)         : ${converted}`);
  console.log(`  passé(s) (pas JPX)  : ${skippedNoJpx}`);
  console.log(`  passé(s) (déjà fait): ${skippedAlready}`);
  console.log(`  échec(s)            : ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("[compat] échec fatal :", err);
  process.exit(2);
});
