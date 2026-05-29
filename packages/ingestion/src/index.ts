/**
 * HEUREKA ingestion CLI.
 *
 *   pnpm ingest --file seeds/37261_reglement.pdf --adapter plu-reglement \
 *     --insee 37261 --commune "Tours" --version "M1_20220627"
 */
import { runIngestion } from "./engine/pipeline.ts";

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function main() {
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
  const { report, files } = runIngestion({ file, adapter, insee, commune, version, outDir });

  console.log(
    `\n✓ ${report.counts.zones} zones · ${report.counts.articles} articles · ` +
      `${report.counts.overrides} overrides · ${report.counts.cross_refs} cross-refs`,
  );
  if (report.validation.errors || report.validation.warnings) {
    console.log(`⚠ ${report.validation.errors} erreur(s), ${report.validation.warnings} avertissement(s) :`);
    for (const i of report.validation.issues) console.log(`   [${i.severity}] ${i.rule} — ${i.message}`);
  }
  if (files) console.log(`\n📄 ${files.json}\n   ${files.csv}\n   ${files.reportPath}`);

  if (report.validation.errors > 0) process.exit(2);
}

main();
