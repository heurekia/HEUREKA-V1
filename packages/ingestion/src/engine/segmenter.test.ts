import { describe, it, expect } from "vitest";
import { clean } from "./cleaner.ts";
import { segment } from "./segmenter.ts";
import { PLUReglementAdapter } from "../adapters/plu-reglement.ts";

const FIXTURE = [
  "PLU 5",
  "VILLE DE TOURS",
  "12",
  "RÈGLEMENT",
  "DISPOSITIONS APPLICABLES À LA ZONE UA",
  "UA-ARTICLE 6 : Implantation par rapport aux voies",
  "Recul minimal de 6 m. cf. article L.151-19.",
  "UA-ARTICLE 7 : Implantation par rapport aux limites",
  "Dans le secteur UAa, l'implantation en limite séparative est autorisée.",
  "DISPOSITIONS APPLICABLES À LA ZONE 1AU",
  "1AU-ARTICLE 6 : Implantation",
  "Recul de 5 m. cf. schéma n°3.",
].join("\n");

const ctx = { insee: "37261", commune_name: "Tours", doc_version: "M1_20220627", doc_source_file: "test.pdf" };

describe("PLU règlement pipeline", () => {
  const { lines } = clean(FIXTURE, PLUReglementAdapter.noise_patterns);

  it("strips header/footer/page noise", () => {
    expect(lines).not.toContain("PLU 5");
    expect(lines).not.toContain("VILLE DE TOURS");
    expect(lines).not.toContain("12");
    expect(lines).not.toContain("RÈGLEMENT");
    expect(lines.some((l) => l.includes("ZONE UA"))).toBe(true);
  });

  it("detects zones (incl. leading-digit codes like 1AU)", () => {
    const zones = PLUReglementAdapter.detectSegments(lines).map((z) => z.code);
    expect(zones).toEqual(["UA", "1AU"]);
  });

  it("detects articles with their parent zone", () => {
    const arts = PLUReglementAdapter.detectSubsections(lines);
    expect(arts.map((a) => a.code)).toEqual(["UA_ART_6", "UA_ART_7", "1AU_ART_6"]);
    expect(arts[0]!.parent_code).toBe("UA");
    expect(arts[0]!.title).toBe("Implantation par rapport aux voies");
  });

  it("builds zone + article segments with stable ids", () => {
    const segs = segment(lines, PLUReglementAdapter, ctx);
    const zones = segs.filter((s) => s.segment_type === "zone");
    const articles = segs.filter((s) => s.segment_type === "article");
    expect(zones.map((z) => z.segment_code)).toEqual(["UA", "1AU"]);
    expect(articles.map((a) => a.id)).toContain("37261_PLU_REG_UA_ART_7");

    const ua = zones.find((z) => z.segment_code === "UA")!;
    expect(ua.parent_code).toBeNull();
    expect(ua.subsections.map((s) => s.number)).toEqual(["6", "7"]);

    const art7 = articles.find((a) => a.segment_code === "UA_ART_7")!;
    expect(art7.parent_code).toBe("UA");
    expect(art7.raw_text).toContain("secteur UAa");
  });

  it("extracts secteur overrides", () => {
    const ov = PLUReglementAdapter.detectOverrides!("Dans le secteur UAa, l'implantation en limite est autorisée.");
    expect(ov).toHaveLength(1);
    expect(ov[0]!.scope).toEqual(["UAa"]);
    expect(ov[0]!.kind).toBe("secteur");
  });

  it("extracts cross-references (code de l'urbanisme + schéma)", () => {
    const refs = PLUReglementAdapter.detectCrossRefs!("Recul. cf. article L.151-19 et cf. schéma n°3.");
    const kinds = refs.map((r) => `${r.kind}:${r.ref}`);
    expect(kinds).toContain("code_urbanisme:151-19");
    expect(kinds).toContain("schema:3");
  });
});
