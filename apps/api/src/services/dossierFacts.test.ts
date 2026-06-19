import { describe, it, expect } from "vitest";
import {
  extractFactsFromDossier,
  extractFactsFromPiece,
  resolveDossierFacts,
  type DossierForFacts,
  type PieceForFacts,
} from "./dossierFacts.ts";
import type { PieceExtraction } from "./pieceExtractor.ts";

function dossier(overrides: Partial<DossierForFacts> = {}): DossierForFacts {
  return {
    id: overrides.id ?? "d-uuid",
    parcelle: overrides.parcelle ?? null,
    commune: overrides.commune ?? null,
    surface_plancher: overrides.surface_plancher ?? null,
    metadata: overrides.metadata ?? null,
  };
}

function piece(id: string, nom: string, ext: Partial<PieceExtraction> & { piece_type: PieceExtraction["piece_type"] }): PieceForFacts {
  return {
    id,
    nom,
    extraction_ia: {
      piece_type: ext.piece_type,
      confidence_type: ext.confidence_type ?? 0.9,
      quality: ext.quality ?? "lisible",
      echelle: ext.echelle ?? null,
      nord_visible: ext.nord_visible ?? null,
      legende_visible: ext.legende_visible ?? null,
      graphics: ext.graphics ?? null,
      parcelles_observees: ext.parcelles_observees ?? null,
      cerfa: ext.cerfa ?? null,
      plan_masse: ext.plan_masse ?? null,
      plan_coupe: ext.plan_coupe ?? null,
      plan_facade: ext.plan_facade ?? null,
      notice: ext.notice ?? null,
      photo: ext.photo ?? null,
      missing_elements: ext.missing_elements ?? [],
      citations: ext.citations ?? [],
      notes: ext.notes ?? null,
    } as PieceExtraction,
  };
}

describe("extractFactsFromPiece", () => {
  it("returns no facts when extraction_ia is null", () => {
    expect(extractFactsFromPiece({ id: "p1", nom: "x.pdf", extraction_ia: null })).toEqual([]);
  });

  it("maps CERFA fields as citizen_declaration", () => {
    const candidates = extractFactsFromPiece(
      piece("p1", "cerfa.pdf", {
        piece_type: "cerfa",
        cerfa: {
          surface_terrain_m2: 500,
          surface_plancher_existante_m2: 80,
          surface_plancher_creee_m2: 40,
          hauteur_max_m: 7.5,
          destination: "habitation",
        },
      }),
    );
    expect(candidates.every((c) => c.source === "citizen_declaration")).toBe(true);
    const hauteur = candidates.find((c) => c.key === "hauteur");
    expect(hauteur?.value).toBe(7.5);
    expect(hauteur?.unit).toBe("m");
    const sp = candidates.find((c) => c.key === "surface_plancher_apres");
    expect(sp?.value).toBe(120);
  });

  it("maps plan_coupe.hauteur_faitage_m as document_extraction with high priority", () => {
    const candidates = extractFactsFromPiece(
      piece("p1", "coupe.pdf", {
        piece_type: "plan_coupe",
        plan_coupe: { hauteur_faitage_m: 9.2, hauteur_egout_m: 6.5 },
      }),
    );
    const faitage = candidates.find((c) => c.key === "hauteur" && c.source_ref.field.includes("faitage"));
    const egout = candidates.find((c) => c.key === "hauteur" && c.source_ref.field.includes("egout"));
    expect(faitage?.source).toBe("document_extraction");
    expect(faitage?.priority).toBeGreaterThan(egout!.priority);
  });

  it("does NOT emit hauteur from NGF cotes alone (no sol naturel reference)", () => {
    const candidates = extractFactsFromPiece(
      piece("p1", "coupe.pdf", {
        piece_type: "plan_coupe",
        plan_coupe: { sol_naturel_ngf_m: 100, faitage_ngf_m: 109.2 },
      }),
    );
    // We expose no "hauteur" fact when only NGF is available — only
    // hauteur_egout/faitage_m would. Verifies we keep the contract with the
    // hauteur evaluator (which refuses NGF as ambiguous).
    expect(candidates.find((c) => c.key === "hauteur")).toBeUndefined();
  });

  it("emits emprise from plan_masse with priority over CERFA emprise", () => {
    const candidates = extractFactsFromPiece(
      piece("p1", "masse.pdf", {
        piece_type: "plan_masse",
        plan_masse: { emprise_au_sol_m2: 95 },
      }),
    );
    const e = candidates.find((c) => c.key === "emprise");
    expect(e?.source).toBe("document_extraction");
    expect(e?.priority).toBe(100);
  });

  it("emits an emprise sum from CERFA at priority 50 (lower than plan)", () => {
    const candidates = extractFactsFromPiece(
      piece("p1", "cerfa.pdf", {
        piece_type: "cerfa",
        cerfa: { emprise_sol_existante_m2: 60, emprise_sol_creee_m2: 35 },
      }),
    );
    const e = candidates.find((c) => c.key === "emprise");
    expect(e?.value).toBe(95);
    expect(e?.source).toBe("citizen_declaration");
    expect(e?.priority).toBe(50);
  });
});

describe("resolveDossierFacts", () => {
  it("returns one fact per key", () => {
    const candidates = [
      ...extractFactsFromPiece(piece("p1", "cerfa.pdf", { piece_type: "cerfa", cerfa: { hauteur_max_m: 7 } })),
      ...extractFactsFromPiece(piece("p2", "coupe.pdf", { piece_type: "plan_coupe", plan_coupe: { hauteur_faitage_m: 8.4 } })),
    ];
    const resolved = resolveDossierFacts(candidates);
    const hauteurs = resolved.filter((f) => f.key === "hauteur");
    expect(hauteurs).toHaveLength(1);
  });

  it("prefers higher priority (plan over CERFA) on the same key", () => {
    const candidates = [
      ...extractFactsFromPiece(piece("p1", "cerfa.pdf", { piece_type: "cerfa", cerfa: { hauteur_max_m: 7 } })),
      ...extractFactsFromPiece(piece("p2", "coupe.pdf", { piece_type: "plan_coupe", plan_coupe: { hauteur_faitage_m: 8.4 } })),
    ];
    const resolved = resolveDossierFacts(candidates);
    const h = resolved.find((f) => f.key === "hauteur")!;
    expect(h.value).toBe(8.4);
    expect(h.source).toBe("document_extraction");
  });

  it("at equal priority, prefers higher confidence", () => {
    const candidates = [
      ...extractFactsFromPiece(piece("p1", "coupeA.pdf", { piece_type: "plan_coupe", confidence_type: 0.6, plan_coupe: { hauteur_faitage_m: 9.1 } })),
      ...extractFactsFromPiece(piece("p2", "coupeB.pdf", { piece_type: "plan_coupe", confidence_type: 0.95, plan_coupe: { hauteur_faitage_m: 8.7 } })),
    ];
    const resolved = resolveDossierFacts(candidates);
    expect(resolved.find((f) => f.key === "hauteur")!.value).toBe(8.7);
  });

  it("prefers faitage over egout from the same plan_coupe (sub-priority within a single piece)", () => {
    const candidates = extractFactsFromPiece(
      piece("p1", "coupe.pdf", {
        piece_type: "plan_coupe",
        plan_coupe: { hauteur_faitage_m: 8.4, hauteur_egout_m: 6.2 },
      }),
    );
    const resolved = resolveDossierFacts(candidates);
    expect(resolved.find((f) => f.key === "hauteur")!.value).toBe(8.4);
  });

  it("keeps facts for keys emitted by only one piece (smoke test)", () => {
    const candidates = [
      ...extractFactsFromPiece(
        piece("p1", "cerfa.pdf", {
          piece_type: "cerfa",
          cerfa: { destination: "habitation", nb_logements: 2 },
        }),
      ),
      ...extractFactsFromPiece(
        piece("p2", "masse.pdf", { piece_type: "plan_masse", plan_masse: { recul_voie_m: 4.2 } }),
      ),
    ];
    const resolved = resolveDossierFacts(candidates);
    const keys = resolved.map((f) => f.key).sort();
    expect(keys).toContain("destination_apres");
    expect(keys).toContain("nb_logements");
    expect(keys).toContain("recul_voie");
  });
});

describe("extractFactsFromDossier", () => {
  it("emits nothing when metadata is empty", () => {
    expect(extractFactsFromDossier(dossier({}))).toEqual([]);
  });

  it("maps natures to nature_travaux + derived boolean tags (citizen_declaration)", () => {
    const facts = extractFactsFromDossier(
      dossier({ metadata: { natures: ["agrandissement", "demolition"] } }),
    );
    const byKey = new Map(facts.map((f) => [f.key, f]));
    expect(byKey.get("nature_travaux")?.value).toEqual(["agrandissement", "demolition"]);
    expect(byKey.get("extension")?.value).toBe(true);
    expect(byKey.get("demolition")?.value).toBe(true);
    // 'demolition' nature → 'demolition' tag (1:1) and not 'extension'
    expect(byKey.get("annexe")).toBeUndefined();
    for (const f of facts) {
      expect(f.source).toBe("citizen_declaration");
    }
  });

  it("does NOT emit a tag for unknown natures (no silent default)", () => {
    const facts = extractFactsFromDossier(
      dossier({ metadata: { natures: ["maison_neuve", "certificat"] } }),
    );
    // Only nature_travaux is emitted; no derived boolean tag because
    // neither nature has a mapping (maison_neuve is the baseline).
    const keys = facts.map((f) => f.key);
    expect(keys).toEqual(["nature_travaux"]);
  });

  it("emits surface_plancher_apres at priority 40 (below CERFA's 50)", () => {
    const facts = extractFactsFromDossier(dossier({ surface_plancher: "120" }));
    const sp = facts.find((f) => f.key === "surface_plancher_apres");
    expect(sp?.value).toBe(120);
    expect(sp?.priority).toBe(40);
    expect(sp?.source).toBe("citizen_declaration");
  });

  it("tolerates French decimals on surface_plancher", () => {
    const facts = extractFactsFromDossier(dossier({ surface_plancher: "82,5" }));
    expect(facts.find((f) => f.key === "surface_plancher_apres")?.value).toBe(82.5);
  });

  it("ignores unparseable surface_plancher", () => {
    const facts = extractFactsFromDossier(dossier({ surface_plancher: "n.c." }));
    expect(facts.find((f) => f.key === "surface_plancher_apres")).toBeUndefined();
  });

  it("emits zonage_plu from metadata.parcel_analysis as external_data with full confidence", () => {
    const facts = extractFactsFromDossier(
      dossier({ metadata: { parcel_analysis: { plu_zone: { zone_code: "UA" } } } }),
    );
    const zone = facts.find((f) => f.key === "zonage_plu");
    expect(zone?.value).toEqual(["UA"]);
    expect(zone?.source).toBe("external_data");
    expect(zone?.confidence).toBe(1);
  });

  it("emits flagged risques only when fort/moyen, never silent defaults", () => {
    const facts = extractFactsFromDossier(
      dossier({
        metadata: {
          parcel_analysis: {
            risks: { flood_risk: "fort", clay_risk: "faible", landslide_risk: "moyen", seismic_zone: "2" },
          },
        },
      }),
    );
    const risques = facts.find((f) => f.key === "risques")!;
    expect(risques.value).toEqual(["inondation", "mouvement_terrain"]);
  });

  it("flags secteur_abf when a SUP of AC* category is present", () => {
    const facts = extractFactsFromDossier(
      dossier({
        metadata: {
          parcel_analysis: {
            sup_surf: [{ categorie: "AC1", libelle: "Monument historique" }],
            sup_lin: [],
          },
        },
      }),
    );
    expect(facts.find((f) => f.key === "secteur_abf")?.value).toBe(true);
    expect(facts.find((f) => f.key === "servitudes")?.value).toEqual(["AC1"]);
  });

  it("does NOT flag secteur_abf for unrelated SUP categories", () => {
    const facts = extractFactsFromDossier(
      dossier({
        metadata: {
          parcel_analysis: { sup_surf: [{ categorie: "PT2" }], sup_lin: [] },
        },
      }),
    );
    expect(facts.find((f) => f.key === "secteur_abf")).toBeUndefined();
  });

  it("survives totally malformed metadata without throwing (defensive)", () => {
    const facts = extractFactsFromDossier(
      dossier({
        metadata: {
          natures: "not-an-array",
          parcel_analysis: 42,
        },
      } as never),
    );
    expect(facts).toEqual([]);
  });
});
