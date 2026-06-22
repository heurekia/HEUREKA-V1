import { describe, it, expect } from "vitest";
import { buildParcelSynthesis, type SynthesisInput } from "./parcelSynthesis.js";
import type { RegDbRule, RiskResult, ServitudeResult } from "./parcelAnalysis.js";

// ── Fabriques de fixtures ───────────────────────────────────────────────────────
function rule(p: Partial<RegDbRule>): RegDbRule {
  return {
    id: p.id ?? Math.random().toString(36).slice(2),
    article_number: p.article_number ?? null,
    topic: p.topic ?? "general",
    rule_text: p.rule_text ?? "Texte de la règle.",
    value_min: p.value_min ?? null,
    value_max: p.value_max ?? null,
    value_exact: p.value_exact ?? null,
    unit: p.unit ?? null,
    summary: p.summary ?? null,
    conditions: p.conditions ?? null,
    exceptions: p.exceptions ?? null,
    validation_status: p.validation_status ?? "valide",
    cases: p.cases ?? null,
    applies_if: p.applies_if ?? null,
    sub_theme: p.sub_theme ?? null,
    citizen_title: p.citizen_title ?? null,
    citizen_summary: p.citizen_summary ?? null,
    citizen_relevant: p.citizen_relevant ?? true,
    relevance: p.relevance ?? "general",
  };
}

const noRisks: RiskResult = {
  flood_risk: "nul", seismic_zone: "1", clay_risk: "nul", landslide_risk: "nul", radon_level: "1",
};

function synth(over: Partial<SynthesisInput>): SynthesisInput {
  return {
    rules: over.rules ?? [],
    risks: over.risks,
    servitudes: over.servitudes ?? [],
    prescriptions: over.prescriptions ?? [],
    plu_zone: over.plu_zone ?? { zone_code: "UC", zone_label: "Zone UC", zone_type: "U" },
    db_zone: over.db_zone ?? null,
  };
}

describe("buildParcelSynthesis — regroupement par thème", () => {
  it("regroupe hauteur + emprise sous « construire » et les reculs sous « implanter »", () => {
    const r = buildParcelSynthesis(synth({
      rules: [
        rule({ topic: "hauteur", article_number: 10, value_max: 9, unit: "m" }),
        rule({ topic: "emprise_sol", article_number: 9, value_max: 50, unit: "%" }),
        rule({ topic: "recul_voie", article_number: 6, value_min: 3, unit: "m" }),
      ],
    }));
    const keys = r.themes.map((t) => t.key);
    expect(keys).toContain("construire");
    expect(keys).toContain("implanter");
    const construire = r.themes.find((t) => t.key === "construire")!;
    expect(construire.instructor.items).toHaveLength(2);
    const implanter = r.themes.find((t) => t.key === "implanter")!;
    expect(implanter.instructor.items).toHaveLength(1);
  });

  it("vue citoyen = nombre nu ; vue instructeur = seuil avec sémantique min/max", () => {
    const r = buildParcelSynthesis(synth({
      rules: [rule({ topic: "hauteur", article_number: 10, value_max: 9, unit: "m" })],
    }));
    const t = r.themes.find((t) => t.key === "construire")!;
    expect(t.citizen.points[0]).toBe("Hauteur maximale : 9 m");
    expect(t.instructor.items[0]!.value).toBe("≤ 9 m");
    // Traçabilité : la source pointe l'article et porte l'id de la règle.
    expect(t.instructor.items[0]!.source.label).toContain("art. 10");
    expect(t.instructor.items[0]!.source.label).toContain("UC");
  });

  it("le décimal s'affiche à la française (6,5 m)", () => {
    const r = buildParcelSynthesis(synth({
      rules: [rule({ topic: "hauteur", article_number: 10, value_max: 6.5, unit: "m" })],
    }));
    expect(r.themes.find((t) => t.key === "construire")!.citizen.points[0]).toBe("Hauteur maximale : 6,5 m");
  });
});

describe("buildParcelSynthesis — précision des hauteurs et des reculs", () => {
  it("développe les cas chiffrés d'une hauteur (égout / faîtage) en un seul point", () => {
    const r = buildParcelSynthesis(synth({
      rules: [rule({
        topic: "hauteur", article_number: 10, unit: "m",
        cases: [
          { condition: "à l'égout", value: 6.5, unit: "m", kind: "parametre" },
          { condition: "au faîtage", value: 9, unit: "m", kind: "parametre" },
        ],
      })],
    }));
    const p = r.themes.find((t) => t.key === "construire")!.citizen.points;
    expect(p[0]).toBe("Hauteur maximale : 6,5 m à l'égout · 9 m au faîtage");
  });

  it("qualifie une hauteur unique à partir du référentiel cité dans le texte (acrotère)", () => {
    const r = buildParcelSynthesis(synth({
      rules: [rule({
        topic: "hauteur", article_number: 10, value_max: 7, unit: "m",
        rule_text: "La hauteur maximale est fixée à 7 m mesurés à l'acrotère.",
      })],
    }));
    expect(r.themes.find((t) => t.key === "construire")!.citizen.points[0]).toBe("Hauteur maximale (à l'acrotère) : 7 m");
  });

  it("préfère le sous-thème au texte pour qualifier la hauteur (faîtage)", () => {
    const r = buildParcelSynthesis(synth({
      rules: [rule({ topic: "hauteur", article_number: 10, value_max: 12, unit: "m", sub_theme: "Hauteur au faîtage" })],
    }));
    expect(r.themes.find((t) => t.key === "construire")!.citizen.points[0]).toBe("Hauteur maximale (au faîtage) : 12 m");
  });

  it("précise le critère d'une valeur non-hauteur via le sous-thème (stationnement)", () => {
    const r = buildParcelSynthesis(synth({
      rules: [rule({ topic: "stationnement", article_number: 12, value_exact: 2, unit: "places", sub_theme: "logements de plus de 80 m²" })],
    }));
    expect(r.themes.find((t) => t.key === "stationnement")!.citizen.points[0]).toBe(
      "Stationnement (logements de plus de 80 m²) : 2 places",
    );
  });

  it("précise le critère d'un accès via la première clause des conditions", () => {
    const r = buildParcelSynthesis(synth({
      rules: [rule({ topic: "desserte_voies", article_number: 3, value_min: 6, unit: "m", conditions: "voie desservant plusieurs logements ; sauf impasse" })],
    }));
    expect(r.themes.find((t) => t.key === "acces")!.citizen.points[0]).toBe(
      "Accès & voirie (voie desservant plusieurs logements) : 6 m",
    );
  });

  it("déplie les cas chiffrés d'un thème non-hauteur avec leur critère (stationnement)", () => {
    const r = buildParcelSynthesis(synth({
      rules: [rule({
        topic: "stationnement", article_number: 12, unit: "places",
        cases: [
          { condition: "par logement", value: 1, unit: "places", kind: "parametre" },
          { condition: "pour un T4 ou plus", value: 2, unit: "places", kind: "condition" },
        ],
      })],
    }));
    expect(r.themes.find((t) => t.key === "stationnement")!.citizen.points[0]).toBe(
      "Stationnement : 1 places par logement · 2 places pour un T4 ou plus",
    );
  });

  it("n'ajoute pas de critère redondant quand le sous-thème répète le thème", () => {
    const r = buildParcelSynthesis(synth({
      rules: [rule({ topic: "espaces_verts", article_number: 13, value_min: 20, unit: "%", sub_theme: "Espaces verts à préserver" })],
    }));
    expect(r.themes.find((t) => t.key === "verts")!.citizen.points[0]).toBe("Espaces verts à préserver : 20 %");
  });

  it("laisse la hauteur nue quand aucun référentiel n'est disponible", () => {
    const r = buildParcelSynthesis(synth({
      rules: [rule({ topic: "hauteur", article_number: 10, value_max: 9, unit: "m" })],
    }));
    expect(r.themes.find((t) => t.key === "construire")!.citizen.points[0]).toBe("Hauteur maximale : 9 m");
  });

  it("reste neutre si le texte d'une hauteur unique cite plusieurs référentiels (ambigu)", () => {
    const r = buildParcelSynthesis(synth({
      rules: [rule({
        topic: "hauteur", article_number: 10, value_max: 6.5, unit: "m",
        rule_text: "Hauteur maximale : 6,5 m à l'égout, 9 m au faîtage.",
      })],
    }));
    // Une seule valeur (6,5 m) mais deux référentiels cités → on n'invente pas
    // l'association, on laisse la valeur nue plutôt que de risquer un faux libellé.
    expect(r.themes.find((t) => t.key === "construire")!.citizen.points[0]).toBe("Hauteur maximale : 6,5 m");
  });

  it("explicite qu'un recul de 0 m autorise l'implantation en limite", () => {
    const r = buildParcelSynthesis(synth({
      rules: [rule({ topic: "recul_limite", article_number: 7, value_exact: 0, unit: "m" })],
    }));
    expect(r.themes.find((t) => t.key === "implanter")!.citizen.points[0]).toBe(
      "Recul par rapport aux limites (implantation en limite possible) : 0 m",
    );
  });

  it("précise la limite concernée par un recul à partir des conditions", () => {
    const r = buildParcelSynthesis(synth({
      rules: [rule({ topic: "recul_limite", article_number: 7, value_min: 3, unit: "m", conditions: "en limite séparative latérale" })],
    }));
    expect(r.themes.find((t) => t.key === "implanter")!.citizen.points[0]).toBe(
      "Recul par rapport aux limites (limites latérales) : 3 m",
    );
  });
});

describe("buildParcelSynthesis — texte exact de la règle", () => {
  it("expose le texte fidèle de l'article (quote) sur chaque élément PLU", () => {
    const verbatim = "La hauteur des constructions ne peut excéder 9 mètres au faîtage.";
    const r = buildParcelSynthesis(synth({
      rules: [rule({ topic: "hauteur", article_number: 10, value_max: 9, unit: "m", rule_text: verbatim })],
    }));
    const item = r.themes.find((t) => t.key === "construire")!.instructor.items[0]!;
    expect(item.quote).toBe(verbatim);
    // La source reste tracée vers l'article (pour afficher « Article 10 »).
    expect(item.source.label).toContain("art. 10");
  });
});

describe("buildParcelSynthesis — filtrage de la vue citoyen", () => {
  it("masque les règles citizen_relevant=false côté citoyen mais les garde côté instructeur", () => {
    const r = buildParcelSynthesis(synth({
      rules: [rule({ topic: "desserte_reseaux", article_number: 4, citizen_relevant: false, summary: "Raccordement obligatoire." })],
    }));
    const acces = r.themes.find((t) => t.key === "acces")!;
    expect(acces.citizen.points).toHaveLength(0);
    expect(acces.instructor.items).toHaveLength(1); // l'instructeur voit tout
  });

  it("masque les règles « exclues » et « conditionnelles » côté citoyen", () => {
    const r = buildParcelSynthesis(synth({
      rules: [
        rule({ topic: "hauteur", article_number: 10, value_max: 9, unit: "m", relevance: "general" }),
        rule({ topic: "hauteur", article_number: 10, sub_theme: "secteur inondable", value_max: 6, unit: "m", relevance: "excluded" }),
      ],
    }));
    const t = r.themes.find((t) => t.key === "construire")!;
    expect(t.citizen.points).toEqual(["Hauteur maximale : 9 m"]); // la règle exclue n'apparaît pas
    expect(t.instructor.items).toHaveLength(2); // mais reste tracée pour l'instructeur
  });

  it("masque les dispositions « sans objet » (COS / art. 14)", () => {
    const r = buildParcelSynthesis(synth({
      rules: [rule({ topic: "cos", article_number: 14, summary: "Sans objet (loi ALUR)." })],
    }));
    const construire = r.themes.find((t) => t.key === "construire");
    // Pas de point citoyen ; si le thème existe, il est vide côté citoyen.
    expect(construire?.citizen.points ?? []).toHaveLength(0);
  });

  it("le thème « usages » passe en tonalité interdit s'il porte des interdictions", () => {
    const r = buildParcelSynthesis(synth({
      rules: [rule({ topic: "interdictions", article_number: 1, citizen_summary: "Camping et caravaning interdits." })],
    }));
    const usages = r.themes.find((t) => t.key === "usages")!;
    expect(usages.citizen.tone).toBe("interdit");
    expect(usages.instructor.items[0]!.tone).toBe("interdit");
  });
});

describe("buildParcelSynthesis — transversalité (risques & servitudes)", () => {
  it("crée un thème « risques » avec attestation parasismique en zone sismique ≥ 3", () => {
    const r = buildParcelSynthesis(synth({
      risks: { ...noRisks, flood_risk: "moyen", clay_risk: "fort", seismic_zone: "3" },
    }));
    const risques = r.themes.find((t) => t.key === "risques")!;
    expect(risques.citizen.tone).toBe("attention");
    expect(risques.instructor.items.some((i) => /parasismique/i.test(i.detail ?? ""))).toBe(true);
    expect(risques.instructor.items.some((i) => /argile/i.test(i.detail ?? "") || /argile/i.test(i.label))).toBe(true);
    // Source PPRI distincte de GéoRisques → vraie transversalité documentaire.
    expect(risques.instructor.sources.length).toBeGreaterThanOrEqual(2);
  });

  it("un périmètre ABF (AC1) crée le thème servitudes ET se renvoie dans « aspect »", () => {
    const servitudes: ServitudeResult[] = [{ categorie: "AC1", nomsup: "Église Saint-Symphorien", urlacte: "https://example.gouv.fr/acte" }];
    const r = buildParcelSynthesis(synth({
      rules: [rule({ topic: "aspect", article_number: 11, citizen_summary: "Matériaux en harmonie avec la rue." })],
      servitudes,
    }));
    const serv = r.themes.find((t) => t.key === "servitudes")!;
    expect(serv.instructor.items[0]!.detail).toMatch(/ABF|Architecte/i);
    expect(serv.instructor.items[0]!.source.url).toBe("https://example.gouv.fr/acte");
    // Renvoi transversal : le thème aspect mentionne l'ABF et la source AC1.
    const aspect = r.themes.find((t) => t.key === "aspect")!;
    expect(aspect.citizen.points.some((p) => /ABF|Architecte/i.test(p))).toBe(true);
    expect(aspect.citizen.tone).toBe("attention");
    expect(aspect.instructor.sources.some((s) => s.ref === "AC1")).toBe(true);
  });
});

describe("buildParcelSynthesis — robustesse & compteurs", () => {
  it("entrée vide → aucun thème, pas d'exception", () => {
    const r = buildParcelSynthesis(synth({}));
    expect(r.themes).toEqual([]);
    expect(r.counts.themes).toBe(0);
    expect(r.zone_code).toBe("UC");
  });

  it("compte les thèmes en attention / interdit", () => {
    const r = buildParcelSynthesis(synth({
      rules: [rule({ topic: "interdictions", article_number: 1, citizen_summary: "Dépôts interdits." })],
      risks: { ...noRisks, flood_risk: "faible" },
    }));
    expect(r.counts.interdit).toBeGreaterThanOrEqual(1);
    expect(r.counts.attention).toBeGreaterThanOrEqual(1);
  });
});
