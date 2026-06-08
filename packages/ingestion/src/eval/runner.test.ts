import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadGolden, runFixture, findFixtures, resolveSourcePdf } from "./runner.ts";
import type { GoldenFixture } from "./types.ts";

const PLU_TXT = [
  "PLU 5",
  "VILLE DE TOURS",
  "DISPOSITIONS APPLICABLES À LA ZONE UA",
  "UA-ARTICLE 6 : Implantation par rapport aux voies",
  "Recul minimal de 6 m.",
  "UA-ARTICLE 7 : Implantation par rapport aux limites",
  "Texte article 7.",
  "DISPOSITIONS APPLICABLES À LA ZONE 1AU",
  "1AU-ARTICLE 6 : Implantation",
  "Recul de 5 m.",
].join("\n");

let tmpDir: string;
let pdfPath: string;
let goldenPath: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "heureka-eval-"));
  pdfPath = path.join(tmpDir, "plu.txt"); // extractor accepte .txt
  fs.writeFileSync(pdfPath, PLU_TXT, "utf-8");

  const golden: GoldenFixture = {
    _meta: {
      fixture_version: 1,
      source_pdf: "plu.txt",
      adapter: "plu-reglement",
      insee: "37261",
      commune: "Tours",
      doc_version: "test",
      annotated_by: "test",
      annotated_at: "2026-06-08",
    },
    expected: {
      zones: ["UA", "1AU"],
      articles_per_zone: {
        UA: [6, 7],
        "1AU": [6],
      },
    },
    tolerances: { min_zone_f1: 1, min_article_f1: 1 },
  };
  goldenPath = path.join(tmpDir, "test.golden.json");
  fs.writeFileSync(goldenPath, JSON.stringify(golden, null, 2));
});

afterAll(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe("loadGolden()", () => {
  it("charge et valide une fixture saine", () => {
    const g = loadGolden(goldenPath);
    expect(g._meta.commune).toBe("Tours");
  });

  it("rejette une fixture sans zones", () => {
    const bad = path.join(tmpDir, "bad.golden.json");
    fs.writeFileSync(bad, JSON.stringify({ _meta: { fixture_version: 1, source_pdf: "x", adapter: "plu-reglement", insee: "1", commune: "X", doc_version: "v", annotated_by: "t", annotated_at: "t" }, expected: { zones: [] } }));
    expect(() => loadGolden(bad)).toThrow(/zones/);
  });
});

describe("resolveSourcePdf()", () => {
  it("trouve un PDF voisin du golden", () => {
    const resolved = resolveSourcePdf(goldenPath, "plu.txt", "/nowhere");
    expect(resolved).toBe(pdfPath);
  });
  it("lève une erreur claire si introuvable", () => {
    expect(() => resolveSourcePdf(goldenPath, "missing.pdf", "/nowhere")).toThrow(/introuvable/);
  });
});

describe("runFixture() end-to-end", () => {
  it("retourne passed=true sur un golden parfait", () => {
    const r = runFixture(goldenPath, { repoRoot: tmpDir });
    expect(r.passed).toBe(true);
    expect(r.zones.scores.f1).toBe(1);
    expect(r.articles).toHaveLength(2);
    expect(r.articles.every((a) => a.scores.f1 === 1)).toBe(true);
  });

  it("skipMissingPdf rend un EvalResult d'erreur exploitable", () => {
    const broken: GoldenFixture = {
      _meta: { fixture_version: 1, source_pdf: "ne-existe-pas.pdf", adapter: "plu-reglement", insee: "1", commune: "X", doc_version: "v", annotated_by: "t", annotated_at: "t" },
      expected: { zones: ["UA"] },
    };
    const bp = path.join(tmpDir, "missing.golden.json");
    fs.writeFileSync(bp, JSON.stringify(broken));
    const r = runFixture(bp, { repoRoot: tmpDir, skipMissingPdf: true });
    expect(r.passed).toBe(false);
    expect(r.failure_reasons[0]).toMatch(/introuvable/);
  });
});

describe("findFixtures()", () => {
  it("trouve tous les golden.json récursivement", () => {
    const found = findFixtures(tmpDir);
    expect(found.length).toBeGreaterThanOrEqual(1);
    expect(found.every((f) => f.endsWith(".golden.json"))).toBe(true);
  });
  it("renvoie [] si le dossier n'existe pas", () => {
    expect(findFixtures(path.join(tmpDir, "nope"))).toEqual([]);
  });
});
