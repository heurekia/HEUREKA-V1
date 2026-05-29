import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runIngestion } from "./pipeline.ts";

const FIXTURE = [
  "PLU 5",
  "VILLE DE TOURS",
  "DISPOSITIONS APPLICABLES À LA ZONE UA",
  "UA-ARTICLE 6 : Implantation par rapport aux voies",
  "Recul minimal de 6 m. cf. article L.151-19.",
  "UA-ARTICLE 7 : Implantation par rapport aux limites",
  "Dans le secteur UAa, l'implantation en limite est autorisée.",
  "DISPOSITIONS APPLICABLES À LA ZONE 1AU",
  "1AU-ARTICLE 6 : Implantation",
  "Recul de 5 m. cf. schéma n°3.",
].join("\n");

let tmpFile: string;

beforeAll(() => {
  tmpFile = path.join(os.tmpdir(), `heureka-ingest-${Date.now()}.txt`);
  fs.writeFileSync(tmpFile, FIXTURE, "utf-8");
});
afterAll(() => {
  try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
});

describe("runIngestion (end-to-end, .txt input)", () => {
  it("produces zone + article segments with enrichments and a report", () => {
    const { segments, report, issues } = runIngestion({
      file: tmpFile,
      adapter: "plu-reglement",
      insee: "37261",
      commune: "Tours",
      version: "M1_20220627",
      write: false,
    });

    expect(report.counts.zones).toBe(2);
    expect(report.counts.articles).toBe(3);

    const art7 = segments.find((s) => s.segment_code === "UA_ART_7")!;
    expect(art7.overrides.map((o) => o.scope[0])).toContain("UAa");
    expect(art7.embedding_text.startsWith("[Tours · reglement_litteral · UA_ART_7]")).toBe(true);

    const art6 = segments.find((s) => s.segment_code === "UA_ART_6")!;
    expect(art6.cross_refs.some((r) => r.kind === "code_urbanisme" && r.ref === "151-19")).toBe(true);

    // Zones have < 14 articles → article_count_per_zone warnings, no errors.
    expect(report.validation.errors).toBe(0);
    expect(issues.some((i) => i.rule === "article_count_per_zone" && i.severity === "warning")).toBe(true);
  });
});
