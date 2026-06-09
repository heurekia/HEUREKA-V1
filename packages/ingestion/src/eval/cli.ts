/**
 * Eval harness — CLI.
 *
 *   pnpm eval:ingestion                       → exécute toutes les fixtures
 *   pnpm eval:ingestion --dir <path>          → racine de fixtures alternative
 *   pnpm eval:ingestion --fixture <path>      → une seule fixture
 *   pnpm eval:ingestion --bootstrap <pdf> --adapter <a> --insee <i> --commune <c> --version <v> --out <golden>
 *
 * Exit code : 0 si tout passe, 2 sinon (utilisable en CI / pre-deploy).
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findFixtures, runFixture } from "./runner.ts";
import { bootstrapGolden } from "./bootstrap.ts";
import type { EvalResult } from "./types.ts";

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function flag(name: string): boolean {
  return process.argv.includes(name);
}

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const DEFAULT_FIXTURE_DIR = path.join(REPO_ROOT, "packages/ingestion/eval-fixtures");

function pct(n: number): string {
  return (n * 100).toFixed(0).padStart(3) + "%";
}

function printResult(r: EvalResult): void {
  const status = r.passed ? "✓" : "✗";
  const label = `${path.relative(REPO_ROOT, r.fixture_path)}`;
  const zP = pct(r.zones.scores.precision);
  const zR = pct(r.zones.scores.recall);
  const zF = pct(r.zones.scores.f1);
  const macroArtF1 =
    r.articles.length === 0
      ? "—"
      : pct(r.articles.reduce((s, a) => s + a.scores.f1, 0) / r.articles.length);
  console.log(
    `${status} ${label}\n   zones P/R/F1 ${zP}/${zR}/${zF}   articles F1 (macro) ${macroArtF1}   ${r.duration_ms} ms`,
  );
  if (r.zones.missing.length) console.log(`   manquantes : ${r.zones.missing.join(", ")}`);
  if (r.zones.spurious.length) console.log(`   en trop    : ${r.zones.spurious.join(", ")}`);
  for (const a of r.articles) {
    if (a.scores.f1 < 1) {
      console.log(
        `   zone ${a.zone} — articles manquants : [${a.missing.join(",")}], en trop : [${a.spurious.join(",")}]`,
      );
    }
  }
  for (const reason of r.failure_reasons) console.log(`   ⚠ ${reason}`);
}

async function main(): Promise<void> {
  if (flag("--bootstrap")) {
    const pdf = arg("--bootstrap");
    const adapter = arg("--adapter");
    const insee = arg("--insee");
    const commune = arg("--commune");
    const version = arg("--version") ?? "v1";
    const out = arg("--out");
    if (!pdf || !adapter || !insee || !commune || !out) {
      console.error(
        "Usage : --bootstrap <pdf> --adapter <name> --insee <code> --commune <nom> [--version <v>] --out <golden.json>",
      );
      process.exit(1);
    }
    const { outPath, fixture } = bootstrapGolden({
      pdfPath: pdf,
      adapter,
      insee,
      commune,
      doc_version: version,
      outPath: out,
    });
    console.log(`✓ Golden brouillon écrit dans ${path.relative(REPO_ROOT, outPath)}`);
    console.log(
      `  ${fixture.expected.zones.length} zones, ${Object.values(fixture.expected.articles_per_zone ?? {}).reduce((n, a) => n + a.length, 0)} articles détectés.`,
    );
    console.log(`  → Relire le fichier, corriger les erreurs, remplacer annotated_by.`);
    return;
  }

  const single = arg("--fixture");
  const dir = arg("--dir") ?? DEFAULT_FIXTURE_DIR;
  const fixtures = single ? [path.resolve(single)] : findFixtures(dir);

  if (fixtures.length === 0) {
    console.log(`Aucune fixture trouvée dans ${path.relative(REPO_ROOT, dir)}.`);
    console.log(
      `Bootstrapper une fixture : pnpm eval:ingestion --bootstrap <pdf> --adapter plu-reglement --insee 37261 --commune Tours --out eval-fixtures/37261/plu-reglement.golden.json`,
    );
    return;
  }

  console.log(`Évaluation de ${fixtures.length} fixture(s)…\n`);
  const results: EvalResult[] = [];
  for (const f of fixtures) {
    const r = runFixture(f, { repoRoot: REPO_ROOT, skipMissingPdf: true });
    printResult(r);
    results.push(r);
  }

  const passed = results.filter((r) => r.passed).length;
  const failed = results.length - passed;
  console.log(`\nRésumé : ${passed}/${results.length} passées · ${failed} échec(s)`);

  if (failed > 0) process.exit(2);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
