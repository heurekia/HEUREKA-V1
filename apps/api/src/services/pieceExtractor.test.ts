import { describe, it, expect } from "vitest";
import { parseExtraction, reconcileCoupeHeights } from "./pieceExtractor.js";

describe("reconcileCoupeHeights — recalage hauteurs sur NGF (anti-rotation)", () => {
  const base = {
    sol_naturel_ngf_m: null, sol_fini_ngf_m: null, egout_ngf_m: null,
    faitage_ngf_m: null, acrotere_ngf_m: null, hauteur_egout_m: null,
    hauteur_faitage_m: null, hauteur_acrotere_m: null, pente_terrain_pct: null,
  };

  it("écrase une hauteur cotée incohérente par la différence des NGF (15,56 → 4,8)", () => {
    const { plan_coupe, note } = reconcileCoupeHeights({
      ...base, sol_naturel_ngf_m: 100.0, faitage_ngf_m: 104.8, hauteur_faitage_m: 15.56,
    });
    expect(plan_coupe.hauteur_faitage_m).toBe(4.8);
    expect(note).toMatch(/incohérente|NGF retenue/i);
  });

  it("dérive une hauteur manquante depuis les NGF", () => {
    const { plan_coupe, note } = reconcileCoupeHeights({
      ...base, sol_naturel_ngf_m: 50, egout_ngf_m: 56.5, hauteur_egout_m: null,
    });
    expect(plan_coupe.hauteur_egout_m).toBe(6.5);
    expect(note).toMatch(/dérivée des cotes NGF/i);
  });

  it("ne touche pas une hauteur cohérente (écart ≤ tolérance)", () => {
    const { plan_coupe, note } = reconcileCoupeHeights({
      ...base, sol_naturel_ngf_m: 100, faitage_ngf_m: 109, hauteur_faitage_m: 9.0,
    });
    expect(plan_coupe.hauteur_faitage_m).toBe(9.0);
    expect(note).toBeNull();
  });

  it("ne corrige rien sans cote de sol naturel (pas de référence)", () => {
    const { plan_coupe, note } = reconcileCoupeHeights({
      ...base, faitage_ngf_m: 104.8, hauteur_faitage_m: 15.56,
    });
    expect(plan_coupe.hauteur_faitage_m).toBe(15.56);
    expect(note).toBeNull();
  });

  it("ignore une différence NGF négative ou nulle (cotes aberrantes)", () => {
    const { plan_coupe, note } = reconcileCoupeHeights({
      ...base, sol_naturel_ngf_m: 105, faitage_ngf_m: 104.8, hauteur_faitage_m: 9,
    });
    expect(plan_coupe.hauteur_faitage_m).toBe(9);
    expect(note).toBeNull();
  });

  it("parseExtraction applique le recalage et journalise la note", () => {
    const r = parseExtraction(JSON.stringify({
      piece_type: "plan_coupe", confidence_type: 0.9, quality: "lisible",
      plan_coupe: { sol_naturel_ngf_m: 100, faitage_ngf_m: 104.8, hauteur_faitage_m: 15.56 },
    }));
    expect(r.plan_coupe?.hauteur_faitage_m).toBe(4.8);
    expect(r.notes).toMatch(/NGF/i);
  });
});

// ── Phase 5 : checklist graphique étendue ─────────────────────────────────
describe("parseExtraction — graphics", () => {
  it("garde graphics=null quand le LLM ne renseigne rien (rétro-compat)", () => {
    const r = parseExtraction(JSON.stringify({
      piece_type: "plan_masse",
      confidence_type: 0.9,
      quality: "lisible",
      echelle: "1/200",
      nord_visible: true,
    }));
    expect(r.graphics).toBeNull();
    // legacy nord_visible préservé.
    expect(r.nord_visible).toBe(true);
  });

  it("reconnaît une rose des vents comme orientation présente", () => {
    const r = parseExtraction(JSON.stringify({
      piece_type: "plan_masse",
      confidence_type: 0.9,
      quality: "lisible",
      graphics: {
        orientation: { kind: "rose_des_vents", visible: true, evidence: "rose en bas à droite" },
      },
    }));
    expect(r.graphics?.orientation?.kind).toBe("rose_des_vents");
    expect(r.graphics?.orientation?.visible).toBe(true);
    // nord_visible dérivé de graphics — rose des vents = orientation visible.
    expect(r.nord_visible).toBe(true);
  });

  it("normalise les synonymes français pour la flèche Nord", () => {
    const r = parseExtraction(JSON.stringify({
      piece_type: "plan_masse",
      confidence_type: 0.9,
      quality: "lisible",
      graphics: { orientation: { kind: "flèche nord", visible: true } },
    }));
    expect(r.graphics?.orientation?.kind).toBe("fleche_nord");
  });

  it("kind=absent dérive nord_visible=false", () => {
    const r = parseExtraction(JSON.stringify({
      piece_type: "plan_masse",
      confidence_type: 0.9,
      quality: "lisible",
      graphics: { orientation: { kind: "absent", visible: false } },
    }));
    expect(r.nord_visible).toBe(false);
  });

  it("kind=inconnu dérive nord_visible=null (non vérifiable)", () => {
    const r = parseExtraction(JSON.stringify({
      piece_type: "plan_masse",
      confidence_type: 0.9,
      quality: "lisible",
      graphics: { orientation: { kind: "inconnu", visible: false } },
    }));
    expect(r.nord_visible).toBeNull();
  });

  it("accepte les flags de présence en string ou booléen brut", () => {
    const r = parseExtraction(JSON.stringify({
      piece_type: "plan_masse",
      confidence_type: 0.9,
      quality: "lisible",
      graphics: {
        echelle_graphique: "present",
        legende: false,
        limites: true,
        acces: "absent",
        emprise: "inconnu",
      },
    }));
    expect(r.graphics?.echelle_graphique).toBe("present");
    expect(r.graphics?.legende).toBe("absent");
    expect(r.graphics?.limites).toBe("present");
    expect(r.graphics?.acces).toBe("absent");
    expect(r.graphics?.emprise).toBe("inconnu");
  });

  it("parse les prises de vue avec page optionnelle", () => {
    const r = parseExtraction(JSON.stringify({
      piece_type: "plan_masse",
      confidence_type: 0.9,
      quality: "lisible",
      graphics: {
        prises_de_vue: [
          { label: "Vue 1 — depuis la rue", page: 2 },
          { label: "Vue 2" },
          "Vue 3 — string brut",
        ],
      },
    }));
    expect(r.graphics?.prises_de_vue).toHaveLength(3);
    expect(r.graphics?.prises_de_vue?.[0]?.page).toBe(2);
    expect(r.graphics?.prises_de_vue?.[2]?.label).toBe("Vue 3 — string brut");
  });
});

// ── Phase 2.3 : observations cadastrales sur le document ──────────────────
describe("parseExtraction — parcelles_observees", () => {
  it("renvoie null par défaut (aucun champ → backward compat)", () => {
    const r = parseExtraction(JSON.stringify({
      piece_type: "cerfa",
      confidence_type: 0.9,
      quality: "lisible",
    }));
    expect(r.parcelles_observees).toBeNull();
  });

  it("parse une liste section/numero/qualificatif", () => {
    const r = parseExtraction(JSON.stringify({
      piece_type: "plan_situation",
      confidence_type: 0.9,
      quality: "lisible",
      parcelles_observees: [
        { section: "AI", numero: "217", qualificatif: "entiere", source_field: "cartouche" },
        { section: "AI", numero: "218", qualificatif: "partie", source_field: "plan_masse", citation: "AI 218p" },
      ],
    }));
    expect(r.parcelles_observees).toHaveLength(2);
    expect(r.parcelles_observees?.[0]).toMatchObject({ section: "AI", numero: "217", qualificatif: "entiere" });
    expect(r.parcelles_observees?.[1]).toMatchObject({ section: "AI", numero: "218", qualificatif: "partie", citation: "AI 218p" });
  });

  it("force la section en majuscules et accepte les variantes de 'partie'", () => {
    const r = parseExtraction(JSON.stringify({
      piece_type: "plan_masse",
      confidence_type: 0.9,
      quality: "lisible",
      parcelles_observees: [
        { section: "ai", numero: "217", qualificatif: "p" },
        { section: "ai", numero: "218", qualificatif: "(partie)" },
        { section: "ai", numero: "219", qualificatif: "part" },
      ],
    }));
    expect(r.parcelles_observees?.every((p) => p.section === "AI")).toBe(true);
    expect(r.parcelles_observees?.every((p) => p.qualificatif === "partie")).toBe(true);
  });

  it("rejette silencieusement les entrées sans section ou numéro (n'invente rien)", () => {
    const r = parseExtraction(JSON.stringify({
      piece_type: "plan_situation",
      confidence_type: 0.9,
      quality: "lisible",
      parcelles_observees: [
        { section: "AI", numero: "217" },
        { section: "", numero: "218" },
        { numero: "219" },
        {},
      ],
    }));
    expect(r.parcelles_observees).toHaveLength(1);
    expect(r.parcelles_observees?.[0]?.numero).toBe("217");
  });

  it("rejette les source_field hors enum", () => {
    const r = parseExtraction(JSON.stringify({
      piece_type: "plan_masse",
      confidence_type: 0.9,
      quality: "lisible",
      parcelles_observees: [
        { section: "AI", numero: "217", source_field: "made_up_zone" },
      ],
    }));
    expect(r.parcelles_observees?.[0]?.source_field).toBeNull();
  });

  it("renvoie null quand la liste est vide (rien à exploiter)", () => {
    const r = parseExtraction(JSON.stringify({
      piece_type: "plan_situation",
      confidence_type: 0.9,
      quality: "lisible",
      parcelles_observees: [],
    }));
    expect(r.parcelles_observees).toBeNull();
  });
});

// ── Garde-fou général : JSON cassé ne doit pas faire crasher la pipeline ──
describe("parseExtraction — fallback", () => {
  it("renvoie une extraction 'autre' illisible quand le JSON est cassé", () => {
    const r = parseExtraction("pas du JSON");
    expect(r.piece_type).toBe("autre");
    expect(r.quality).toBe("illisible");
    expect(r.graphics).toBeNull();
    expect(r.parcelles_observees).toBeNull();
  });
});
