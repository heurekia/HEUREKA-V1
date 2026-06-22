/**
 * Dépose un « plan des hauteurs » (couche vectorielle GeoJSON) comme document
 * d'instruction `plan_hauteurs` rattaché à une commune.
 *
 * La couche attendue est une FeatureCollection dont chaque feature porte au
 * moins `properties.hauteur_txt` (ex. "18 m", "art. 10 RU", "Non fixée", "PM").
 * On peut la produire depuis le SIG du PLU (couche PRESCRIPTION_SURF, TYPEPSC=39
 * « Hauteur maximale »), reprojetée en WGS84.
 *
 * Usage :
 *   pnpm -F @heureka-v1/api exec tsx src/scripts/ingest-plan-hauteurs.ts \
 *     <chemin.geojson> <code_insee> [--name "Plan des hauteurs"] [--draft]
 *
 * Idempotent : remplace la couche du document plan_hauteurs existant de la
 * commune s'il y en a un, sinon en crée un. `--draft` dépose en brouillon
 * (validation_status=brouillon) au lieu de validé.
 */
import "dotenv/config";
import { readFileSync } from "fs";
import { basename } from "path";
import { and, eq } from "drizzle-orm";
import { db, communes, regulatory_documents } from "@heureka-v1/db";

function fail(msg: string): never {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

async function main() {
  const args = process.argv.slice(2);
  const positional = args.filter((a) => !a.startsWith("--"));
  const geojsonPath = positional[0];
  const insee = positional[1];
  const nameIdx = args.indexOf("--name");
  const name = (nameIdx >= 0 ? args[nameIdx + 1] : undefined) ?? "Plan des hauteurs";
  const draft = args.includes("--draft");

  if (!geojsonPath || !insee) {
    fail("Usage : ingest-plan-hauteurs.ts <chemin.geojson> <code_insee> [--name <nom>] [--draft]");
  }

  // Lecture + validation de la couche.
  let raw: string;
  try {
    raw = readFileSync(geojsonPath, "utf8");
  } catch {
    fail(`Fichier illisible : ${geojsonPath}`);
  }
  let fc: { type?: string; features?: Array<{ properties?: Record<string, unknown> }> };
  try {
    fc = JSON.parse(raw);
  } catch (e) {
    fail(`GeoJSON invalide : ${e instanceof Error ? e.message : String(e)}`);
  }
  const features = fc.features ?? [];
  if (!Array.isArray(features) || features.length === 0) {
    fail("La couche ne contient aucune feature.");
  }
  const withHeight = features.filter((f) => f.properties && "hauteur_txt" in (f.properties ?? {}));
  if (withHeight.length === 0) {
    fail("Aucune feature ne porte `properties.hauteur_txt` — couche inattendue.");
  }

  const commune = (
    await db.select({ id: communes.id, name: communes.name }).from(communes).where(eq(communes.insee_code, insee)).limit(1)
  )[0];
  if (!commune) {
    fail(`Commune INSEE ${insee} introuvable en base (créez-la d'abord).`);
  }

  const validation_status = draft ? "brouillon" : "valide";
  const fileSize = Buffer.byteLength(raw);
  const original_filename = basename(geojsonPath);

  // Upsert : un seul plan_hauteurs par commune.
  const existing = (
    await db
      .select({ id: regulatory_documents.id })
      .from(regulatory_documents)
      .where(and(eq(regulatory_documents.type, "plan_hauteurs"), eq(regulatory_documents.porteur_commune_id, commune.id)))
      .limit(1)
  )[0];

  if (existing) {
    await db
      .update(regulatory_documents)
      .set({ name, original_filename, file_size: fileSize, geojson: fc, status: "ingested", validation_status, updated_at: new Date() })
      .where(eq(regulatory_documents.id, existing.id));
    console.log(`✓ Plan des hauteurs MIS À JOUR pour ${commune.name} (${insee}) — doc ${existing.id}`);
  } else {
    const [inserted] = await db
      .insert(regulatory_documents)
      .values({
        commune_id: commune.id,
        porteur_commune_id: commune.id,
        type: "plan_hauteurs",
        name,
        original_filename,
        file_size: fileSize,
        geojson: fc,
        status: "ingested",
        validation_status,
      })
      .returning({ id: regulatory_documents.id });
    console.log(`✓ Plan des hauteurs DÉPOSÉ pour ${commune.name} (${insee}) — doc ${inserted!.id}`);
  }

  // Résumé.
  const counts = new Map<string, number>();
  for (const f of withHeight) {
    const t = String((f.properties ?? {}).hauteur_txt ?? "?");
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  console.log(`  ${withHeight.length} secteurs de hauteur — validation: ${validation_status}`);
  console.log(`  répartition : ${[...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}×${v}`).join(", ")}`);
  process.exit(0);
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
