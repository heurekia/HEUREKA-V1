export interface BuildabilityInput {
  parcelSurfaceM2: number;
  existingFootprintM2: number;
  calculationVariables: {
    maxFootprintRatio: number | null;
    maxHeightM: number | null;
    minSetbackFromRoadM: number | null;
    minSetbackFromBoundariesM: number | null;
    parkingRules: string | null;
    greenSpaceRatio: number | null;
  };
}

export interface BuildabilityOutput {
  maxFootprintM2: number;
  remainingFootprintM2: number | null;
  maxHeightM: number | null;
  minSetbackFromRoadM: number | null;
  minSetbackFromBoundariesM: number | null;
  estimatedFloors: number | null;
  parkingRules: string | null;
  greenSpaceRatio: number | null;
  greenSpaceRequiredM2: number | null;
  confidence: number;
  assumptions: string[];
  resultSummary: string;
}

function sanitizePercent(val: number | null): number | null {
  if (val === null || val === undefined) return null;
  return val > 1 ? val / 100 : val;
}

export function calculateBuildability(input: BuildabilityInput): BuildabilityOutput {
  const { parcelSurfaceM2, existingFootprintM2, calculationVariables } = input;
  const assumptions: string[] = [];
  let maxPossiblePoints = 0;
  let earnedPoints = 0;

  const footprintRatio = sanitizePercent(calculationVariables.maxFootprintRatio);
  const greenRatio = sanitizePercent(calculationVariables.greenSpaceRatio);

  // ── Emprise au sol ──
  maxPossiblePoints += 25;
  let maxFootprintM2: number;
  if (footprintRatio !== null) {
    // L'emprise au sol max = STRICTEMENT la règle d'emprise (ex. 60 %). On ne la
    // mélange pas avec la contrainte d'espaces verts (règle distincte, affichée à
    // part) : sinon le chiffre ne correspond plus à aucune règle lisible.
    maxFootprintM2 = footprintRatio * parcelSurfaceM2;
    assumptions.push(`Emprise au sol max : ${(footprintRatio * 100).toFixed(0)}% = ${maxFootprintM2.toFixed(0)} m²`);
    earnedPoints += 25;
  } else {
    maxFootprintM2 = parcelSurfaceM2;
    assumptions.push("⚠️ Aucune règle d'emprise au sol trouvée - utilisation de la surface totale");
  }

  // « Restante » = emprise max moins le bâti DÉJÀ existant. On ne la renseigne que
  // si l'on connaît réellement ce bâti — sinon elle vaudrait toujours l'emprise max
  // (existant = 0), ce qui est trompeur. null = donnée non disponible (non affichée).
  const remainingFootprintM2 = existingFootprintM2 > 0
    ? Math.max(0, maxFootprintM2 - existingFootprintM2)
    : null;
  if (remainingFootprintM2 !== null) {
    assumptions.push(`Surface restante constructible : ${remainingFootprintM2.toFixed(0)} m² (déjà ${existingFootprintM2.toFixed(0)} m² existant)`);
  }

  // ── Hauteur ──
  maxPossiblePoints += 25;
  const maxHeightM = calculationVariables.maxHeightM;
  let estimatedFloors: number | null = null;
  if (maxHeightM !== null) {
    const FLOOR_HEIGHT = 3.0;
    estimatedFloors = Math.floor(maxHeightM / FLOOR_HEIGHT);
    assumptions.push(`Hauteur max : ${maxHeightM} m soit environ ${estimatedFloors} étages`);
    earnedPoints += 25;
  } else {
    assumptions.push("⚠️ Aucune règle de hauteur trouvée");
  }

  // ── Recul voie ──
  maxPossiblePoints += 15;
  const minSetbackFromRoadM = calculationVariables.minSetbackFromRoadM;
  if (minSetbackFromRoadM !== null) {
    assumptions.push(`Recul voie publique : ${minSetbackFromRoadM} m minimum`);
    earnedPoints += 15;
  } else {
    assumptions.push("⚠️ Aucune règle de recul par rapport aux voies trouvée");
  }

  // ── Recul limites ──
  maxPossiblePoints += 15;
  const minSetbackFromBoundariesM = calculationVariables.minSetbackFromBoundariesM;
  if (minSetbackFromBoundariesM !== null) {
    assumptions.push(`Recul limites séparatives : ${minSetbackFromBoundariesM} m minimum`);
    earnedPoints += 15;
  } else {
    assumptions.push("⚠️ Aucune règle de recul par rapport aux limites séparatives trouvée");
  }

  // ── Stationnement ──
  maxPossiblePoints += 10;
  const parkingRules = calculationVariables.parkingRules;
  if (parkingRules) {
    assumptions.push(`Stationnement : ${parkingRules}`);
    earnedPoints += 10;
  } else {
    assumptions.push("⚠️ Aucune règle de stationnement trouvée");
  }

  // ── Espaces verts ──
  maxPossiblePoints += 10;
  const greenSpaceRequiredM2 = greenRatio !== null ? greenRatio * parcelSurfaceM2 : null;
  if (greenSpaceRequiredM2 !== null) {
    assumptions.push(`Espaces verts : ${(greenRatio! * 100).toFixed(0)}% soit ${greenSpaceRequiredM2.toFixed(0)} m² minimum`);
    earnedPoints += 10;
  } else {
    assumptions.push("⚠️ Aucune règle d'espaces verts trouvée");
  }

  // ── Score de confiance ──
  const confidence = maxPossiblePoints > 0 ? earnedPoints / maxPossiblePoints : 0;

  // ── Résumé ──
  const parts: string[] = [];
  if (footprintRatio !== null) parts.push(`${(footprintRatio * 100).toFixed(0)}% d'emprise au sol`);
  if (maxHeightM !== null) parts.push(`${maxHeightM}m de hauteur`);
  if (minSetbackFromRoadM !== null) parts.push(`${minSetbackFromRoadM}m de recul voie`);
  const surfacePart = footprintRatio !== null
    ? ` Emprise au sol constructible : jusqu'à ${maxFootprintM2.toFixed(0)} m².`
    : "";
  const resultSummary = parts.length > 0
    ? `Parcelle constructible avec les règles suivantes : ${parts.join(", ")}.${surfacePart}`
    : "Analyse non concluante - règles réglementaires insuffisantes pour déterminer la constructibilité.";

  return {
    maxFootprintM2,
    remainingFootprintM2,
    maxHeightM,
    minSetbackFromRoadM,
    minSetbackFromBoundariesM,
    estimatedFloors,
    parkingRules,
    greenSpaceRatio: calculationVariables.greenSpaceRatio,
    greenSpaceRequiredM2,
    confidence,
    assumptions,
    resultSummary,
  };
}
