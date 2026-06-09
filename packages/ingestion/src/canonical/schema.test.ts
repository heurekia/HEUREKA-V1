import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseCanonical, CANONICAL_SCHEMA_VERSION } from "./schema.ts";
import { canonicalToZoneRules } from "./loader.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXAMPLE_PATH = path.resolve(__dirname, "../../canonical-examples/ballan-mire-fragment.canonical.json");

function minimalPLU() {
  return {
    schema_version: 1 as const,
    _meta: {
      commune: "Ballan-Miré",
      insee: "37018",
      doc_version: "M5_20180129",
    },
    zones: [
      {
        code: "UA",
        label: "Zone urbaine centre",
        type: "U" as const,
        rules: [
          {
            article_number: 10,
            article_title: "Hauteur maximale",
            topic: "hauteur",
            rule_text: "La hauteur maximale est de 9 mètres à l'égout.",
            value_max: 9,
            unit: "m",
          },
        ],
      },
    ],
  };
}

describe("parseCanonical()", () => {
  it("accepte un document minimal valide et applique les défauts", () => {
    const r = parseCanonical(minimalPLU());
    expect(r.ok).toBe(true);
    const rule = r.data!.zones[0]!.rules[0]!;
    expect(rule.value_max).toBe(9);
    expect(rule.cases).toEqual([]);
    expect(rule.applies_if).toEqual([]);
    expect(rule.citizen_relevant).toBe(true);
    expect(rule.source).toBeNull();
  });

  it("rejette un schema_version non supporté", () => {
    const r = parseCanonical({ ...minimalPLU(), schema_version: 2 });
    expect(r.ok).toBe(false);
    expect(r.errors!.some((e) => /schema_version/.test(e))).toBe(true);
  });

  it("rejette un INSEE mal formé avec un message utile", () => {
    const bad = minimalPLU();
    bad._meta.insee = "INVALID";
    const r = parseCanonical(bad);
    expect(r.ok).toBe(false);
    expect(r.errors!.some((e) => /insee/.test(e))).toBe(true);
  });

  it("rejette une zone sans rule_text", () => {
    const bad = minimalPLU();
    (bad.zones[0]!.rules[0] as Record<string, unknown>).rule_text = "";
    const r = parseCanonical(bad);
    expect(r.ok).toBe(false);
    expect(r.errors!.some((e) => /rule_text/.test(e))).toBe(true);
  });

  it("rejette une absence totale de zones", () => {
    const bad = minimalPLU();
    bad.zones = [];
    const r = parseCanonical(bad);
    expect(r.ok).toBe(false);
  });

  it("warning sur topic non standard mais reste ok", () => {
    const doc = minimalPLU();
    doc.zones[0]!.rules[0]!.topic = "topic_exotique";
    const r = parseCanonical(doc);
    expect(r.ok).toBe(true);
    expect(r.warnings).toBeDefined();
    expect(r.warnings!.some((w) => /topic_exotique/.test(w))).toBe(true);
  });

  it("warning sur applies_if non reconnu", () => {
    const doc = minimalPLU();
    (doc.zones[0]!.rules[0] as Record<string, unknown>).applies_if = ["tag_inconnu"];
    const r = parseCanonical(doc);
    expect(r.ok).toBe(true);
    expect(r.warnings!.some((w) => /tag_inconnu/.test(w))).toBe(true);
  });

  it("CANONICAL_SCHEMA_VERSION exposé en constante pour les imports tiers", () => {
    expect(CANONICAL_SCHEMA_VERSION).toBe(1);
  });

  it("valide l'exemple Ballan-Miré sans erreur ni warning", () => {
    const raw = JSON.parse(fs.readFileSync(EXAMPLE_PATH, "utf-8"));
    const r = parseCanonical(raw);
    expect(r.ok).toBe(true);
    expect(r.errors).toBeUndefined();
    expect(r.warnings).toBeUndefined();
    expect(r.data!.zones[0]!.code).toBe("UA");
    expect(r.data!.zones[0]!.rules).toHaveLength(3);
    // Vérifie la robustesse du cas conditionnel (stationnement)
    const stationnement = r.data!.zones[0]!.rules.find((rule) => rule.topic === "stationnement");
    expect(stationnement?.cases).toHaveLength(2);
    expect(stationnement?.cases[0]!.value).toBe(1);
  });
});

describe("canonicalToZoneRules()", () => {
  it("convertit en ZoneRules consommables par loadRules", () => {
    const plu = parseCanonical(minimalPLU()).data!;
    const zr = canonicalToZoneRules(plu);
    expect(zr).toHaveLength(1);
    expect(zr[0]!.zone_code).toBe("UA");
    expect(zr[0]!.rules[0]!.value_max).toBe(9);
    expect(zr[0]!.rules[0]!.unit).toBe("m");
  });

  it("préserve les cases et applies_if", () => {
    const doc = minimalPLU();
    const rule = doc.zones[0]!.rules[0] as Record<string, unknown>;
    rule.cases = [
      { condition: "voie sens unique", value: 10, unit: "m", kind: "condition" },
      { condition: "double sens", value: 13, unit: "m", kind: "condition" },
    ];
    rule.applies_if = ["inondable"];

    const plu = parseCanonical(doc).data!;
    const zr = canonicalToZoneRules(plu);
    expect(zr[0]!.rules[0]!.cases).toHaveLength(2);
    expect(zr[0]!.rules[0]!.applies_if).toEqual(["inondable"]);
  });
});
