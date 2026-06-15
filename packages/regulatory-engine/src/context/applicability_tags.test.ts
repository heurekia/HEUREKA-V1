import { describe, it, expect } from "vitest";
import { deriveApplicabilityTags } from "./applicability_tags.ts";
import type { ParcelleContext, ProjectContext } from "./types.ts";

const emptyParcelle: ParcelleContext = {};
const emptyProjet: ProjectContext = {};

describe("deriveApplicabilityTags", () => {
  it("returns no tags for an empty context", () => {
    expect(deriveApplicabilityTags(emptyParcelle, emptyProjet)).toEqual([]);
  });

  it("emits abf only when parcel is explicitly in ABF perimeter", () => {
    expect(deriveApplicabilityTags({ abf: true }, emptyProjet)).toContain("abf");
    // Undefined ≠ false : on n'émet ni 'abf' ni 'hors_abf'. Voir convention
    // dans applicability_tags.ts.
    expect(deriveApplicabilityTags({ abf: undefined }, emptyProjet)).not.toContain("abf");
    expect(deriveApplicabilityTags({ abf: false }, emptyProjet)).not.toContain("abf");
  });

  it("flags inondable when a risk matches /inond/i", () => {
    expect(
      deriveApplicabilityTags({ risques: ["Zone inondable PPRI"] }, emptyProjet),
    ).toContain("inondable");
    expect(
      deriveApplicabilityTags({ risques: ["mouvement de terrain"] }, emptyProjet),
    ).not.toContain("inondable");
  });

  it("prefixes PLU zones with zone_", () => {
    expect(
      deriveApplicabilityTags({ zonage_plu: ["UA", "1AU"] }, emptyProjet),
    ).toEqual(expect.arrayContaining(["zone_UA", "zone_1AU"]));
  });

  it("emits changement_destination only when before != after", () => {
    expect(
      deriveApplicabilityTags(emptyParcelle, {
        destination_avant: "habitation",
        destination_apres: "commerce",
      }),
    ).toContain("changement_destination");
    expect(
      deriveApplicabilityTags(emptyParcelle, {
        destination_avant: "habitation",
        destination_apres: "habitation",
      }),
    ).not.toContain("changement_destination");
    // Une seule des deux : pas de tag (on ne sait pas s'il y a changement).
    expect(
      deriveApplicabilityTags(emptyParcelle, { destination_apres: "commerce" }),
    ).not.toContain("changement_destination");
  });

  it("returns a sorted, deduplicated list", () => {
    const tags = deriveApplicabilityTags(
      { abf: true, zonage_plu: ["UA", "UA"] },
      { extension: true, demolition: true },
    );
    expect(tags).toEqual([...tags].sort());
    expect(new Set(tags).size).toBe(tags.length);
  });
});
