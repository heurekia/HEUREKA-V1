import { describe, it, expect } from "vitest";
import {
  parseRules,
  structureSegments,
  inferZoneType,
  isRelativeHeightConstraint,
  neutralizeRelativeHeightRule,
  type LlmFn,
} from "./structurer.ts";
import type { Segment } from "../adapters/interface.ts";

describe("parseRules", () => {
  it("parse un tableau JSON de règles et coerce les types", () => {
    const raw = `Voici: [
      {"article_number":7,"article_title":"Implantation","topic":"recul_limite","rule_text":"En limite ou H/2 min 3 m.","value_min":3,"unit":"m","summary":"≥3m"},
      {"article_number":"x","topic":"aspect","rule_text":"Toitures en tuiles, teinte terre cuite.","summary":"toiture tuile"}
    ]`;
    const rules = parseRules(raw);
    expect(rules).toHaveLength(2);
    expect(rules[0]!.topic).toBe("recul_limite");
    expect(rules[0]!.value_min).toBe(3);
    expect(rules[1]!.article_number).toBeNull(); // "x" → null
    expect(rules[1]!.rule_text).toContain("tuiles");
  });

  it("parse les cas conditionnels (dualité de valeurs)", () => {
    const raw = `[{"article_number":3,"topic":"desserte_voies","rule_text":"10 m sens unique ; 13 m double sens","summary":"largeur voie",
      "cases":[{"condition":"voie à sens unique","value":10,"unit":"m","kind":"condition"},{"condition":"voie à double sens","value":13,"unit":"m","kind":"condition"}]}]`;
    const rules = parseRules(raw);
    expect(rules[0]!.cases).toHaveLength(2);
    expect(rules[0]!.cases[1]).toEqual({ condition: "voie à double sens", value: 13, unit: "m", kind: "condition" });
  });

  it("renvoie [] si pas de JSON exploitable", () => {
    expect(parseRules("désolé je ne sais pas")).toEqual([]);
    expect(parseRules("[oups")).toEqual([]);
  });

  it("rejette les règles invalides en les signalant, sans perdre les valides", () => {
    const issues: string[] = [];
    const raw = `[
      {"topic":"hauteur","rule_text":"9 m au faîtage.","summary":"9m"},
      {"topic":"general"},
      "pas un objet"
    ]`;
    const rules = parseRules(raw, (msg) => issues.push(msg));
    expect(rules).toHaveLength(1);
    expect(rules[0]!.rule_text).toBe("9 m au faîtage.");
    expect(issues).toHaveLength(2);
    expect(issues[0]).toContain("règle 2/3 rejetée");
    expect(issues[1]).toContain("règle 3/3 rejetée");
  });
});

describe("hauteurs relatives (garde-fou niveau 1)", () => {
  it("détecte les formulations relatives et épargne les seuils absolus", () => {
    // Relatif : écart par rapport à une autre référence → neutralisé.
    expect(
      isRelativeHeightConstraint(
        "Le faîtage ne peut pas dépasser de plus de 4 mètres la hauteur de la construction autorisée.",
      ),
    ).toBe(true);
    expect(isRelativeHeightConstraint("Hauteur supérieure de 2 m à l'égout du bâtiment voisin.")).toBe(true);
    // Absolu : « X m DE hauteur » / « X m au faîtage » → conservé.
    expect(isRelativeHeightConstraint("La hauteur maximale est de 9 m au faîtage.")).toBe(false);
    expect(isRelativeHeightConstraint("Construction de plus de 4 mètres de hauteur interdite.")).toBe(false);
  });

  it("cas Boucau : ne réduit plus « +4 m au-dessus de la hauteur autorisée » à un plafond de 4 m", () => {
    const raw = `[{"article_number":10,"article_title":"Hauteur (UC)","topic":"hauteur",
      "rule_text":"Le faîtage de toutes nouvelles constructions ne peut pas dépasser de plus de 4 mètres la hauteur de la construction autorisée.",
      "value_max":4,"unit":"m","summary":"Hauteur maximale au faîtage : 4m"}]`;
    const rule = parseRules(raw)[0]!;
    // Le seuil chiffré est neutralisé → règle qualitative (l'évaluateur la
    // remontera en « à vérifier », plus de faux non-conforme bloquant).
    expect(rule.value_max).toBeNull();
    expect(rule.value_min).toBeNull();
    expect(rule.value_exact).toBeNull();
    // Le chiffre et le sens restent tracés pour l'instructeur.
    expect(rule.sub_theme).toBe("hauteur_relative");
    expect(rule.instructor_note).toContain("max 4");
    expect(rule.instructor_note).toContain("RELATIVE");
    // La prose source n'est pas altérée.
    expect(rule.rule_text).toContain("la hauteur de la construction autorisée");
  });

  it("ne touche pas une règle de hauteur absolue", () => {
    const rule = neutralizeRelativeHeightRule({
      article_number: 10, article_title: "Hauteur", topic: "hauteur",
      rule_text: "La hauteur au faîtage est limitée à 9 m.",
      value_min: null, value_max: 9, value_exact: null, unit: "m",
      conditions: null, summary: "9 m au faîtage", instructor_note: null,
      cases: [], sub_theme: null, applies_if: [],
    });
    expect(rule.value_max).toBe(9);
    expect(rule.instructor_note).toBeNull();
  });

  it("n'agit que sur le topic hauteur", () => {
    const rule = neutralizeRelativeHeightRule({
      article_number: 7, article_title: "Implantation", topic: "recul_limite",
      rule_text: "Recul supérieur de 2 m à la hauteur.", // formulation relative mais autre topic
      value_min: null, value_max: 2, value_exact: null, unit: "m",
      conditions: null, summary: "", instructor_note: null,
      cases: [], sub_theme: null, applies_if: [],
    });
    expect(rule.value_max).toBe(2);
  });
});

describe("inferZoneType", () => {
  it("déduit le type depuis le code", () => {
    expect(inferZoneType("UA")).toBe("U");
    expect(inferZoneType("1AU")).toBe("AU");
    expect(inferZoneType("A")).toBe("A");
    expect(inferZoneType("Ni")).toBe("N");
  });
});

describe("structureSegments", () => {
  const zone = (code: string, subs: Array<{ number: string; title: string; raw_text: string }>): Segment => ({
    id: `37261_PLU_REG_${code}`,
    insee: "37261", commune_name: "Tours",
    doc_type: "PLU_REGLEMENT", doc_subtype: "reglement_litteral",
    doc_version: "v1", doc_source_file: "t.pdf",
    segment_code: code, segment_type: "zone", parent_code: null,
    title: `Zone ${code}`, raw_text: "…", char_count: 1,
    subsections: subs.map((s) => ({ code: `${code}_ART_${s.number}`, ...s })),
    overrides: [], cross_refs: [], embedding_text: "", metadata: {},
  });

  it("appelle le LLM par zone et agrège les règles structurées", async () => {
    const calls: string[] = [];
    const fakeLlm: LlmFn = async (_sys, user) => {
      calls.push(user);
      return `[{"article_number":7,"article_title":"Implantation","topic":"recul_limite","rule_text":"H/2 min 3 m.","value_min":3,"unit":"m","summary":"≥3m"}]`;
    };
    const segs = [
      zone("UA", [{ number: "7", title: "Implantation", raw_text: "En limite ou H/2 min 3 m." }]),
      zone("1AU", [{ number: "10", title: "Hauteur", raw_text: "9 m au faîtage." }]),
    ];
    const result = await structureSegments(segs, fakeLlm);
    expect(result).toHaveLength(2);
    expect(result[0]!.zone_code).toBe("UA");
    expect(result[0]!.rules[0]!.topic).toBe("recul_limite");
    expect(result[1]!.zone_type).toBe("AU");
    // chaque appel ne contient QUE le texte de sa zone (pas tout le PLU)
    expect(calls[0]).toContain("En limite ou H/2");
    expect(calls[0]).not.toContain("faîtage");
    // provenance fine : chaque règle pointe vers le segment de sa zone
    // (= ligne document_segments) + verbatim citable.
    expect(result[0]!.rules[0]!.source_segment_id).toBe("37261_PLU_REG_UA");
    expect(result[0]!.rules[0]!.source_quote).toBe("H/2 min 3 m.");
    expect(result[0]!.rules[0]!.source_page).toBeNull();
  });

  it("une zone dont le LLM échoue renvoie 0 règle sans casser le reste", async () => {
    const flakyLlm: LlmFn = async (_sys, user) => {
      if (user.includes("UA")) throw new Error("boom");
      return `[{"topic":"hauteur","rule_text":"9 m.","summary":"9m"}]`;
    };
    const segs = [
      zone("UA", [{ number: "7", title: "X", raw_text: "..." }]),
      zone("UB", [{ number: "10", title: "Hauteur", raw_text: "9 m." }]),
    ];
    const result = await structureSegments(segs, flakyLlm);
    expect(result.find((z) => z.zone_code === "UA")!.rules).toEqual([]);
    expect(result.find((z) => z.zone_code === "UB")!.rules).toHaveLength(1);
  });
});
