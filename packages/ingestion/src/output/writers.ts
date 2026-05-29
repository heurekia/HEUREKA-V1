/**
 * Output writers — segments.json, segments_flat.csv, ingestion_report.json.
 */
import fs from "node:fs";
import path from "node:path";
import type { Segment, ValidationIssue } from "../adapters/interface.ts";

export interface IngestionReport {
  generated_at: string;
  insee: string;
  commune_name: string;
  doc_type: string;
  doc_version: string;
  doc_source_file: string;
  counts: {
    segments: number;
    zones: number;
    articles: number;
    overrides: number;
    cross_refs: number;
  };
  validation: {
    errors: number;
    warnings: number;
    issues: ValidationIssue[];
  };
}

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function buildReport(
  segments: Segment[],
  issues: ValidationIssue[],
  ctx: { insee: string; commune_name: string; doc_type: string; doc_version: string; doc_source_file: string },
): IngestionReport {
  const zones = segments.filter((s) => s.segment_type === "zone");
  const articles = segments.filter((s) => s.segment_type === "article");
  return {
    generated_at: new Date().toISOString(),
    ...ctx,
    counts: {
      segments: segments.length,
      zones: zones.length,
      articles: articles.length,
      overrides: segments.reduce((n, s) => n + s.overrides.length, 0),
      cross_refs: segments.reduce((n, s) => n + s.cross_refs.length, 0),
    },
    validation: {
      errors: issues.filter((i) => i.severity === "error").length,
      warnings: issues.filter((i) => i.severity === "warning").length,
      issues,
    },
  };
}

export function writeOutputs(
  outDir: string,
  basename: string,
  segments: Segment[],
  report: IngestionReport,
): { json: string; csv: string; reportPath: string } {
  fs.mkdirSync(outDir, { recursive: true });

  const json = path.join(outDir, `${basename}_segments.json`);
  fs.writeFileSync(json, JSON.stringify(segments, null, 2), "utf-8");

  const headers = [
    "id", "insee", "commune_name", "doc_type", "doc_version",
    "segment_code", "segment_type", "parent_code", "title",
    "char_count", "n_subsections", "n_overrides", "n_cross_refs", "raw_text",
  ];
  const rows = segments.map((s) =>
    [
      s.id, s.insee, s.commune_name, s.doc_type, s.doc_version,
      s.segment_code, s.segment_type, s.parent_code, s.title,
      s.char_count, s.subsections.length, s.overrides.length, s.cross_refs.length, s.raw_text,
    ].map(csvCell).join(","),
  );
  const csv = path.join(outDir, `${basename}_flat.csv`);
  fs.writeFileSync(csv, "﻿" + [headers.join(","), ...rows].join("\n"), "utf-8");

  const reportPath = path.join(outDir, `${basename}_report.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf-8");

  return { json, csv, reportPath };
}
