/**
 * Script de migration : copie tous les fichiers de l'ancien disque local
 * (apps/api/uploads/) vers un bucket S3-compatible (Cellar / Scaleway / OVH OS).
 *
 * À exécuter UNE FOIS au moment de la Phase 1 du plan de déploiement, AVANT
 * de basculer STORAGE_PROVIDER=s3 en production. Les enregistrements en base
 * conservent leurs URL "/api/uploads/<key>" — pas de mise à jour DB nécessaire
 * (l'URL est devenue une simple "key d'application", interprétée par
 * StorageProvider.keyFromUrl).
 *
 * Usage :
 *   S3_ENDPOINT=https://cellar-c2.services.clever-cloud.com \
 *   S3_REGION=eu-fr \
 *   S3_BUCKET=heureka-prod \
 *   S3_ACCESS_KEY_ID=... \
 *   S3_SECRET_ACCESS_KEY=... \
 *   pnpm --filter @heureka-v1/api migrate-uploads
 *
 * Options :
 *   --dry-run   N'écrit rien, liste juste ce qui serait copié
 *   --skip-existing  Saute les fichiers déjà présents dans S3 (idempotent)
 *
 * Sécurité : NE SUPPRIME PAS les fichiers locaux. Une seconde passe manuelle
 * de validation (ex : checksum, smoke test) est attendue avant nettoyage.
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { S3StorageProvider, type S3Config } from "../services/storage.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = path.resolve(__dirname, "../../uploads");

const dryRun = process.argv.includes("--dry-run");
const skipExisting = process.argv.includes("--skip-existing");

function buildS3Config(): S3Config {
  const endpoint = process.env.S3_ENDPOINT;
  const region = process.env.S3_REGION;
  const bucket = process.env.S3_BUCKET;
  const accessKeyId = process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
  if (!region || !bucket || !accessKeyId || !secretAccessKey) {
    console.error("[migrate] Variables manquantes : S3_REGION, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY sont obligatoires.");
    process.exit(2);
  }
  return { endpoint, region, bucket, accessKeyId, secretAccessKey };
}

function guessMime(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  if (ext === ".pdf") return "application/pdf";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".png") return "image/png";
  if (ext === ".gif") return "image/gif";
  if (ext === ".webp") return "image/webp";
  if (ext === ".tif" || ext === ".tiff") return "image/tiff";
  return "application/octet-stream";
}

async function main() {
  if (!fs.existsSync(UPLOADS_DIR)) {
    console.log(`[migrate] Aucun dossier ${UPLOADS_DIR} — rien à migrer.`);
    return;
  }

  const files = fs.readdirSync(UPLOADS_DIR).filter((f) => !f.startsWith("."));
  console.log(`[migrate] ${files.length} fichier(s) trouvé(s) sous ${UPLOADS_DIR}`);
  if (dryRun) console.log(`[migrate] 🔍 DRY-RUN — aucune écriture S3.`);

  const cfg = buildS3Config();
  const s3 = new S3StorageProvider(cfg);

  let uploaded = 0;
  let skipped = 0;
  let failed = 0;
  const startedAt = Date.now();

  for (const filename of files) {
    const filePath = path.join(UPLOADS_DIR, filename);
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) continue;

    if (skipExisting && !dryRun) {
      const exists = await s3.exists(filename);
      if (exists) {
        skipped++;
        if (skipped % 50 === 0) console.log(`[migrate] ${skipped} déjà présents`);
        continue;
      }
    }

    if (dryRun) {
      console.log(`  · ${filename} (${(stat.size / 1024).toFixed(1)} KB)`);
      uploaded++;
      continue;
    }

    try {
      const body = fs.readFileSync(filePath);
      await s3.put({ key: filename, body, mime: guessMime(filename) });
      uploaded++;
      if (uploaded % 25 === 0) console.log(`[migrate] ${uploaded} fichiers uploadés`);
    } catch (err) {
      failed++;
      console.error(`[migrate] ❌ ${filename} : ${err instanceof Error ? err.message : err}`);
    }
  }

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`\n[migrate] ✅ Terminé en ${elapsed}s`);
  console.log(`           uploadés : ${uploaded}`);
  console.log(`           skippés  : ${skipped}`);
  console.log(`           échoués  : ${failed}`);
  if (failed > 0) {
    console.log(`\n⚠️  Re-lancer le script avec --skip-existing pour reprendre.`);
    process.exit(1);
  }
  if (!dryRun && uploaded > 0) {
    console.log(`\n📋 Étape suivante :`);
    console.log(`   1) Basculer STORAGE_PROVIDER=s3 dans les variables Railway/Clever Cloud.`);
    console.log(`   2) Vérifier qu'un nouveau dépôt s'écrit bien sur S3 et que la lecture fonctionne.`);
    console.log(`   3) Après ~7 jours stables, supprimer le contenu de ${UPLOADS_DIR}.`);
  }
}

main().catch((err) => {
  console.error("[migrate] Erreur fatale :", err);
  process.exit(1);
});
