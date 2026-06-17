/**
 * HEUREKA ingestion CLI.
 *
 *   pnpm ingest --file seeds/37261_reglement.pdf --adapter plu-reglement \
 *     --insee 37261 --commune "Tours" --version "M1_20220627"
 */
import { runIngestion } from "./engine/pipeline.ts";
import { loadSegments } from "./db/loader.ts";
import { structureSegments } from "./structure/structurer.ts";
import { mistralLlm } from "./structure/mistral-llm.ts";
import { loadRules } from "./db/rules-loader.ts";

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function flag(name: string): boolean {
  return process.argv.includes(name);
}

async function main() {
  const file = arg("--file");
  const adapter = arg("--adapter") ?? "plu-reglement";
  const insee = arg("--insee");
  const commune = arg("--commune");
  const version = arg("--version") ?? "v1";
  const outDir = arg("--out");

  if (!file || !insee || !commune) {
    console.error(
      "Usage : ingest --file <doc> --adapter <name> --insee <code> --commune <nom> [--version <v>] [--out <dir>]",
    );
    process.exit(1);
  }

  console.log(`\n📥 Ingestion — ${commune} (${insee}) · ${adapter} · ${file}`);
  const { segments, report, files } = runIngestion({ file, adapter, insee, commune, version, outDir });

  console.log(
    `\n✓ ${report.counts.zones} zones · ${report.counts.articles} articles · ` +
      `${report.counts.overrides} overrides · ${report.counts.cross_refs} cross-refs`,
  );
  if (report.validation.errors || report.validation.warnings) {
    console.log(`⚠ ${report.validation.errors} erreur(s), ${report.validation.warnings} avertissement(s) :`);
    for (const i of report.validation.issues) console.log(`   [${i.severity}] ${i.rule} — ${i.message}`);
  }
  if (files) console.log(`\n📄 ${files.json}\n   ${files.csv}\n   ${files.reportPath}`);

  // --rules : structuration par article (agent Mistral Pixtral Large) → tables
  // citoyennes (zones + zone_regulatory_rules, statut brouillon). Le LLM ne voit
  // que le texte COURT des articles d'une zone, jamais le PDF entier.
  if (flag("--rules")) {
    console.log(`\n🤖 Structuration des règles par article (Mistral)…`);
    const zoneRules = await structureSegments(segments, mistralLlm(), {
      onZone: (zone, count) => console.log(`   ${zone} → ${count} règles`),
    });
    const res = await loadRules(insee, commune, zoneRules, { zipCode: arg("--zip") });
    console.log(`✓ ${res.zones} zones · ${res.rules} règles écrites (brouillon) dans zone_regulatory_rules.`);
  }

  // --load : pousse les segments + embeddings (mistral-embed) dans pgvector.
  if (flag("--load")) {
    console.log(`\n🔗 Chargement en base (pgvector)…`);
    const { upserted } = await loadSegments(segments);
    console.log(`✓ ${upserted} segments chargés dans document_segments.`);
  }

  if (report.validation.errors > 0) process.exit(2);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
