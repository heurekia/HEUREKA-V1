/**
 * CLI du harnais de benchmark.
 *
 *   pnpm benchmark:llm                                    → exécute toutes les fixtures
 *   pnpm benchmark:llm --limit 3                          → smoke test sur 3 fixtures
 *   pnpm benchmark:llm --out rapport.md                   → chemin du rapport
 *   pnpm benchmark:llm --providers anthropic,mistral      → providers à comparer
 *   pnpm benchmark:llm --anthropic-models haiku           → restreindre les modèles Anthropic
 *   pnpm benchmark:llm --mistral-models pixtral-large,pixtral-12b
 *
 * Variables d'environnement requises :
 *   ANTHROPIC_API_KEY          → pour provider "anthropic"
 *   AI_PROVIDER=bedrock        → pour basculer Anthropic sur Bedrock UE
 *   AWS_REGION + AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY → si Bedrock
 *   MISTRAL_API_KEY            → pour provider "mistral"
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
const providersSelected = (arg("--providers") ?? "anthropic,mistral").split(",").map((s) => s.trim());

/** Modèles supportés par provider — alias courts pour le CLI. */
const ANTHROPIC_MODELS = {
  haiku: "claude-haiku-4-5-20251001",
  sonnet: "claude-sonnet-4-6",
} as const;
type AnthropicModel = (typeof ANTHROPIC_MODELS)[keyof typeof ANTHROPIC_MODELS];

const MISTRAL_MODELS = {
  "pixtral-large": "pixtral-large-latest",
  "pixtral-12b": "pixtral-12b-2409",
} as const;
type MistralModel = (typeof MISTRAL_MODELS)[keyof typeof MISTRAL_MODELS];

function resolveModels<T extends Record<string, string>>(
  map: T,
  flag: string | undefined,
  defaults: Array<T[keyof T]>,
): Array<T[keyof T]> {
  if (!flag) return defaults;
  return flag.split(",").map((s) => s.trim()).map((alias) => {
    const resolved = map[alias as keyof T] ?? alias;
    if (!Object.values(map).includes(resolved as T[keyof T])) {
      throw new Error(`Modèle inconnu \`${alias}\`. Valeurs supportées : ${Object.keys(map).join(", ")}`);
    }
    return resolved as T[keyof T];
  });
}

async function loadProviders(names: string[]): Promise<BenchmarkProvider[]> {
  const providers: BenchmarkProvider[] = [];
  const anthropicModels = resolveModels(ANTHROPIC_MODELS, arg("--anthropic-models"), [
    ANTHROPIC_MODELS.haiku, ANTHROPIC_MODELS.sonnet,
  ]) as AnthropicModel[];
  const mistralModels = resolveModels(MISTRAL_MODELS, arg("--mistral-models"), [
    MISTRAL_MODELS["pixtral-large"],
  ]) as MistralModel[];

  for (const name of names) {
    try {
      if (name === "anthropic") {
        const { AnthropicProvider } = await import("./providers/anthropic.js");
        for (const m of anthropicModels) providers.push(new AnthropicProvider(m));
      } else if (name === "mistral") {
        const { MistralProvider } = await import("./providers/mistral.js");
        for (const m of mistralModels) providers.push(new MistralProvider(m));
      } else {
        console.warn(`Provider inconnu : ${name}`);
      }
    } catch (err) {
      console.error(`⚠️  Provider ${name} ignoré : ${err instanceof Error ? err.message : err}`);
    }
  }
  return providers;
}

async function main() {
  console.log(`\n🔬 Benchmark LLM HEUREKA`);
  console.log(`   fixtures   : ${fixturesDir}`);
  console.log(`   providers  : ${providersSelected.join(", ")}`);
  console.log(`   sortie     : ${outPath}`);
  if (limit) console.log(`   limit      : ${limit} fixtures`);
  console.log("");

  const providers = await loadProviders(providersSelected);
  if (providers.length === 0) {
    console.error("Aucun provider chargé — vérifier les variables d'environnement (ANTHROPIC_API_KEY, MISTRAL_API_KEY).");
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
