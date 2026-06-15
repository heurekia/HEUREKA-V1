/**
 * CLI du harnais de benchmark — Mistral La Plateforme.
 *
 *   pnpm benchmark:llm                                    → exécute toutes les fixtures
 *   pnpm benchmark:llm --limit 3                          → smoke test sur 3 fixtures
 *   pnpm benchmark:llm --out rapport.md                   → chemin du rapport
 *   pnpm benchmark:llm --mistral-models pixtral-large,pixtral-12b
 *
 * Variable d'environnement requise :
 *   MISTRAL_API_KEY            → clé API Mistral La Plateforme
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runBenchmark } from "./runner.js";
import { renderMarkdownReport } from "./report.js";
import type { BenchmarkProvider } from "./types.js";

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const DEFAULT_FIXTURES = path.join(REPO_ROOT, "packages/ingestion/benchmark-fixtures");
const fixturesDir = arg("--dir") ?? DEFAULT_FIXTURES;
const outPath = arg("--out") ?? path.join(REPO_ROOT, "docs/security/benchmark-llm-resultats.md");
const limitArg = arg("--limit");
const limit = limitArg ? Number(limitArg) : undefined;

const MISTRAL_MODELS = {
  "pixtral-large": "pixtral-large-latest",
  "pixtral-12b": "pixtral-12b-2409",
} as const;
type MistralModel = (typeof MISTRAL_MODELS)[keyof typeof MISTRAL_MODELS];

function resolveMistralModels(flag: string | undefined): MistralModel[] {
  if (!flag) return [MISTRAL_MODELS["pixtral-large"]];
  return flag.split(",").map((s) => s.trim()).map((alias) => {
    const resolved = MISTRAL_MODELS[alias as keyof typeof MISTRAL_MODELS]
      ?? (Object.values(MISTRAL_MODELS).includes(alias as MistralModel) ? (alias as MistralModel) : null);
    if (!resolved) {
      throw new Error(`Modèle inconnu \`${alias}\`. Valeurs supportées : ${Object.keys(MISTRAL_MODELS).join(", ")}`);
    }
    return resolved;
  });
}

async function loadProviders(): Promise<BenchmarkProvider[]> {
  const { MistralProvider } = await import("./providers/mistral.js");
  return resolveMistralModels(arg("--mistral-models")).map((m) => new MistralProvider(m));
}

async function main() {
  console.log(`\n🔬 Benchmark LLM HEUREKA (Mistral La Plateforme)`);
  console.log(`   fixtures   : ${fixturesDir}`);
  console.log(`   sortie     : ${outPath}`);
  if (limit) console.log(`   limit      : ${limit} fixtures`);
  console.log("");

  const providers = await loadProviders();
  if (providers.length === 0) {
    console.error("Aucun provider chargé — vérifier la variable d'environnement MISTRAL_API_KEY.");
    process.exit(1);
  }

  const run = await runBenchmark(providers, { fixturesDir, limit });
  const md = renderMarkdownReport(run);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, md);
  console.log(`\n✅ Rapport écrit : ${outPath}`);
  console.log(`   ${run.fixtures_count} fixtures × ${run.providers.length} providers`);
  for (const p of run.providers) {
    console.log(`   · ${p.provider.name}: F1=${(p.avg_f1 * 100).toFixed(1)}%  lat=${Math.round(p.p50_latency_ms)}ms  coût=${p.total_cost_eur.toFixed(4)}€`);
  }
}

main().catch((err) => {
  console.error("Benchmark échoué :", err);
  process.exit(1);
});
