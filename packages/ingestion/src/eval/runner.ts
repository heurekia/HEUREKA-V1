/**
 * Eval harness — runner.
 *
 * runFixture(path) : lit un golden.json, exécute le pipeline réel sur le PDF
 * cible, compare la sortie aux attendus, renvoie un EvalResult exploitable
 * par le CLI ou par la CI. I/O isolés ici ; la logique de diff est pure
 * (cf. compare.ts) et testée séparément.
 */
import fs from "node:fs";
import path from "node:path";
import { runIngestion } from "../engine/pipeline.ts";
import { diffArticles, diffZones, evaluatePass, validateGoldenShape } from "./compare.ts";
import type { EvalResult, GoldenFixture } from "./types.ts";

/** Charge et valide un fichier golden. Throw en cas de schéma cassé. */
export function loadGolden(filePath: string): GoldenFixture {
  const raw = fs.readFileSync(filePath, "utf-8");
  const parsed = JSON.parse(raw) as GoldenFixture;
  if (parsed?._meta?.fixture_version !== 1) {
    throw new Error(`Fixture ${filePath} : fixture_version invalide (attendu 1)`);
  }
  const shapeIssues = validateGoldenShape(parsed.expected);
  if (shapeIssues.length) {
    throw new Error(`Fixture ${filePath} mal formée :\n  - ${shapeIssues.join("\n  - ")}`);
  }
  return parsed;
}

/**
 * Résout le chemin du PDF source par rapport au golden : on cherche d'abord
 * relativement au golden, puis à la racine du repo (chemins commençant par
 * `docs/` ou `seeds/`).
 */
export function resolveSourcePdf(goldenPath: string, sourcePdf: string, repoRoot: string): string {
  const nearGolden = path.resolve(path.dirname(goldenPath), sourcePdf);
  if (fs.existsSync(nearGolden)) return nearGolden;
  const atRepoRoot = path.resolve(repoRoot, sourcePdf);
  if (fs.existsSync(atRepoRoot)) return atRepoRoot;
  throw new Error(
    `PDF source introuvable : ${sourcePdf}\n  cherché à : ${nearGolden}\n  et à : ${atRepoRoot}`,
  );
}

export interface RunFixtureOptions {
  /** Racine du repo, pour résoudre les chemins relatifs des PDFs. */
  repoRoot: string;
  /** Si vrai, le runner échoue silencieusement en cas de PDF manquant (status=skipped). */
  skipMissingPdf?: boolean;
}

export function runFixture(goldenPath: string, opts: RunFixtureOptions): EvalResult {
  const startedAt = Date.now();
  const golden = loadGolden(goldenPath);

  let sourcePdf: string;
  try {
    sourcePdf = resolveSourcePdf(goldenPath, golden._meta.source_pdf, opts.repoRoot);
  } catch (err) {
    if (opts.skipMissingPdf) {
      return {
        fixture_path: goldenPath,
        meta: golden._meta,
        passed: false,
        zones: { found: [], expected: golden.expected.zones, missing: golden.expected.zones, spurious: [], scores: { tp: 0, fp: 0, fn: golden.expected.zones.length, precision: 1, recall: 0, f1: 0 } },
        articles: [],
        rules: [],
        validation: { errors: 1, warnings: 0 },
        duration_ms: Date.now() - startedAt,
        failure_reasons: [err instanceof Error ? err.message : String(err)],
      };
    }
    throw err;
  }

  const { segments, report } = runIngestion({
    file: sourcePdf,
    adapter: golden._meta.adapter,
    insee: golden._meta.insee,
    commune: golden._meta.commune,
    version: golden._meta.doc_version,
    write: false,
  });

  const zones = diffZones(segments, golden.expected.zones);
  const articles = diffArticles(segments, golden.expected.articles_per_zone ?? {});
  const { passed, reasons } = evaluatePass(zones, articles, golden.tolerances);

  return {
    fixture_path: goldenPath,
    meta: golden._meta,
    passed,
    zones,
    articles,
    rules: [], // structuration LLM : Phase 0.5
    validation: { errors: report.validation.errors, warnings: report.validation.warnings },
    duration_ms: Date.now() - startedAt,
    failure_reasons: reasons,
  };
}

/** Cherche tous les `*.golden.json` sous un dossier (récursif). */
export function findFixtures(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  const walk = (d: string) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith(".golden.json")) out.push(full);
    }
  };
  walk(dir);
  return out.sort();
}
