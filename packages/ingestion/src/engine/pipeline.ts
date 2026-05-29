/**
 * Pipeline — orchestrates extract → clean → segment → enrich → validate → output.
 * Pure of CLI concerns; returns the produced artefacts so callers (CLI, tests,
 * or a future DB loader) can consume them.
 */
import path from "node:path";
import { getAdapter } from "../adapters/registry.ts";
import type { Segment, ValidationIssue } from "../adapters/interface.ts";
import { extractText } from "./extractor.ts";
import { clean } from "./cleaner.ts";
import { segment, type SegmentContext } from "./segmenter.ts";
import { enrich } from "./enricher.ts";
import { validate } from "./validator.ts";
import { buildReport, writeOutputs, type IngestionReport } from "../output/writers.ts";

export interface IngestParams {
  file: string;
  adapter: string;
  insee: string;
  commune: string;
  version: string;
  outDir?: string;
  write?: boolean; // default true
}

export interface IngestResult {
  segments: Segment[];
  issues: ValidationIssue[];
  report: IngestionReport;
  files?: { json: string; csv: string; reportPath: string };
}

export function runIngestion(params: IngestParams): IngestResult {
  const adapter = getAdapter(params.adapter);
  const ctx: SegmentContext = {
    insee: params.insee,
    commune_name: params.commune,
    doc_version: params.version,
    doc_source_file: path.basename(params.file),
  };

  const raw = extractText(params.file);
  const { lines } = clean(raw, adapter.noise_patterns);
  const segments = enrich(segment(lines, adapter, ctx), adapter);
  const issues = validate(segments, adapter);

  const report = buildReport(segments, issues, {
    insee: ctx.insee,
    commune_name: ctx.commune_name,
    doc_type: adapter.doc_type,
    doc_version: ctx.doc_version,
    doc_source_file: ctx.doc_source_file,
  });

  let files: IngestResult["files"];
  if (params.write !== false) {
    const outDir = params.outDir ?? path.resolve("outputs");
    const basename = `${params.insee}_${adapter.doc_type}`;
    files = writeOutputs(outDir, basename, segments, report);
  }

  return { segments, issues, report, files };
}
