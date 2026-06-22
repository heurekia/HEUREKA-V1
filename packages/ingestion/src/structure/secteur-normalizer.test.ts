import { describe, it, expect } from "vitest";
import { detectSecteurCodes, normalizeSecteur } from "./secteur-normalizer.ts";

describe("detectSecteurCodes", () => {
  it("détecte les codes sûrs sans mot-clé (UBa, UCi, 1AUh, UA1)", () => {
    expect(detectSecteurCodes("Dans UBai et UCi, plancher surélevé.")).toEqual(["UBai", "UCi"]);
    expect(detectSecteurCodes("Le secteur 1AUh autorise…")).toContain("1AUh");
    expect(detectSecteurCodes("Hauteur en UA1 limitée.")).toContain("UA1");
  });

  it("détecte les codes courts SEULEMENT via un mot-clé (Ap, Nh, UMr/UMs)", () => {
    expect(detectSecteurCodes("en secteurs UMr et UMs")).toEqual(["UMr", "UMs"]);
    expect(detectSecteurCodes("dans le secteur Ap")).toEqual(["Ap"]);
    expect(detectSecteurCodes("zone Nh")).toEqual(["Nh"]);
  });

  it("n'invente pas de code sur des mots courants ou acronymes", () => {
    for (const t of ["Une construction au bord", "Au moins 3 mètres", "Nous, Avenue de la gare", "périmètre UNESCO", "la ZAC des Prés", "zone urbaine dense", "secteur sauvegardé"]) {
      expect(detectSecteurCodes(t)).toEqual([]);
    }
  });

  it("ne confond pas la zone mère (UB) avec un sous-secteur", () => {
    expect(detectSecteurCodes("zone UB")).toEqual([]); // pas de suffixe → zone, pas secteur
  });
});

describe("normalizeSecteur — promotion en sub_theme", () => {
  it("promeut un secteur du texte quand sub_theme est vide", () => {
    const r = normalizeSecteur({ sub_theme: null, rule_text: "Dans le secteur UCi, plancher à +0,50 m." });
    expect(r.sub_theme).toBe("Secteur UCi");
    expect(r.note).toBeNull(); // étiqueté → pas d'orphelin
  });

  it("conserve un sub_theme thématique déjà fourni", () => {
    const r = normalizeSecteur({ sub_theme: "10.1 Hauteur", rule_text: "Hauteur maximale 9 m." });
    expect(r.sub_theme).toBe("10.1 Hauteur");
  });
});

describe("normalizeSecteur — note d'alerte si variante non étiquetée", () => {
  it("signale un secteur resté dans conditions alors que sub_theme parle d'autre chose", () => {
    const r = normalizeSecteur({
      sub_theme: "10.1 Hauteur",
      conditions: "Toutefois en secteur UMz, la hauteur est portée à 12 m.",
    });
    expect(r.note).toMatch(/UMz/);
    expect(r.note).toMatch(/éclater/i);
  });

  it("aucune note quand aucun secteur n'est mentionné", () => {
    const r = normalizeSecteur({ sub_theme: "10.1 Hauteur", conditions: "Sauf services publics." });
    expect(r.note).toBeNull();
    expect(r.detected).toEqual([]);
  });
});

describe("normalizeSecteur — inférence applies_if (sûre)", () => {
  it("infère inondable à partir d'un signal explicite (PPRI, inondable, plus hautes eaux)", () => {
    expect(normalizeSecteur({ rule_text: "Respect du PPRI." }).appliesIfAdd).toContain("inondable");
    expect(normalizeSecteur({ conditions: "au-dessus des plus hautes eaux connues" }).appliesIfAdd).toContain("inondable");
  });

  it("n'infère PAS inondable sur le seul suffixe « i » d'un code", () => {
    // « UCi » sans mention de risque → on ne suppose pas inondable (éviterait
    // d'écarter la règle à tort pour une parcelle non inondable).
    expect(normalizeSecteur({ rule_text: "Dans le secteur UCi, clôtures limitées." }).appliesIfAdd).toEqual([]);
  });

  it("est idempotent : renormaliser un sub_theme déjà promu ne change rien", () => {
    const once = normalizeSecteur({ sub_theme: null, rule_text: "Secteur UCi : plancher +0,50 m. PPRI applicable." });
    const twice = normalizeSecteur({ sub_theme: once.sub_theme, rule_text: "Secteur UCi : plancher +0,50 m. PPRI applicable." });
    expect(twice.sub_theme).toBe(once.sub_theme);
  });
});
