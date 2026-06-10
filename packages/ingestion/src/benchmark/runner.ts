/**
 * Runner du benchmark : pour chaque fixture, lance chaque provider
 * (analyse + extraction), score les résultats et agrège.
 */
import fs from "node:fs";
import path from "node:path";
import { scoreExtraction, scoreAnalysis, median, p95 } from "./scoring.js";
import type {
  BenchmarkProvider,
  BenchmarkRun,
  PieceFixture,
  ProviderAggregate,
  ProviderResponse,
} from "./types.js";

export interface RunOptions {
  /** Dossier qui contient manifest.json + pieces/. */
  fixturesDir: string;
  /** Concurrence par provider (par défaut 1 pour ne pas saturer les rate limits). */
  concurrency?: number;
  /** N° max de fixtures à exécuter (pour smoke test). */
  limit?: number;
}

export function loadFixtures(fixturesDir: string): PieceFixture[] {
  const manifestPath = path.join(fixturesDir, "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`manifest.json introuvable dans ${fixturesDir}`);
  }
  const raw = fs.readFileSync(manifestPath, "utf8");
  const fixtures = JSON.parse(raw) as PieceFixture[];
  for (const f of fixtures) {
    const filePath = path.join(fixturesDir, "pieces", f.file);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Fichier introuvable pour fixture ${f.id} : ${filePath}`);
    }
  }
  return fixtures;
}

function aggregate(
  provider: BenchmarkProvider,
  results: Array<{ analysis: ProviderResponse; extraction: ProviderResponse;
                    sa: ReturnType<typeof scoreAnalysis>; se: ReturnType<typeof scoreExtraction>; }>,
): ProviderAggregate {
  const n = results.length;
  const f1s = results.map((r) => r.se.f1);
  const precisions = results.map((r) => r.se.precision);
  const recalls = results.map((r) => r.se.recall);
  const lats = results.map((r) => r.extraction.duration_ms + r.analysis.duration_ms);
  const costs = results.reduce((acc, r) => acc + r.analysis.cost_eur + r.extraction.cost_eur, 0);
  const errs = results.filter((r) => r.analysis.error || r.extraction.error).length;
  const typesOk = results.filter((r) => r.se.type_match).length;
  const jsonOk = results.filter((r) => r.se.valid_json && r.sa.valid_json).length;

  return {
    provider,
    n,
    avg_precision: n === 0 ? 0 : precisions.reduce((a, b) => a + b, 0) / n,
    avg_recall: n === 0 ? 0 : recalls.reduce((a, b) => a + b, 0) / n,
    avg_f1: n === 0 ? 0 : f1s.reduce((a, b) => a + b, 0) / n,
    type_accuracy: n === 0 ? 0 : typesOk / n,
    json_validity: n === 0 ? 0 : jsonOk / n,
    avg_latency_ms: n === 0 ? 0 : lats.reduce((a, b) => a + b, 0) / n,
    p50_latency_ms: median(lats),
    p95_latency_ms: p95(lats),
    total_cost_eur: costs,
    errors: errs,
  };
}

export async function runBenchmark(
  providers: BenchmarkProvider[],
  opts: RunOptions,
): Promise<BenchmarkRun> {
  const allFixtures = loadFixtures(opts.fixturesDir);
  const fixtures = opts.limit ? allFixtures.slice(0, opts.limit) : allFixtures;
  const started_at = new Date().toISOString();
  const per_piece: BenchmarkRun["per_piece"] = [];
  // Pour l'agrégation finale.
  const byProvider = new Map<
    string,
    Array<{ analysis: ProviderResponse; extraction: ProviderResponse;
            sa: ReturnType<typeof scoreAnalysis>; se: ReturnType<typeof scoreExtraction>; }>
  >();
  for (const p of providers) byProvider.set(p.name, []);

  for (const fxt of fixtures) {
    const buf = fs.readFileSync(path.join(opts.fixturesDir, "pieces", fxt.file));
    const results: BenchmarkRun["per_piece"][number]["results"] = [];
    for (const provider of providers) {
      console.log(`  · ${fxt.id} → ${provider.name}`);
      const [analysis, extraction] = await Promise.all([
        provider.analyze(fxt, buf),
        provider.extract(fxt, buf),
      ]);
      const sa = scoreAnalysis(analysis, fxt);
      const se = scoreExtraction(extraction, fxt);
      byProvider.get(provider.name)!.push({ analysis, extraction, sa, se });
      results.push({
        provider: provider.name,
        analysis, extraction,
        score_analysis: sa, score_extraction: se,
      });
    }
    per_piece.push({ fixture: fxt, results });
  }

  const providersAgg: ProviderAggregate[] = providers.map((p) =>
    aggregate(p, byProvider.get(p.name)!),
  );
  return {
    started_at,
    finished_at: new Date().toISOString(),
    fixtures_count: fixtures.length,
    providers: providersAgg,
    per_piece,
  };
}
