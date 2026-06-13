import type { ParcelleContext, ProjectContext } from "./types.js";

// Dérive les tags d'applicabilité ('abf', 'extension', 'inondable', etc.)
// consommés par les `applies_if` des règles de zone.
//
// Convention : un tag absent signifie "pas d'information disponible", PAS
// "absence avérée". Une règle qui dépend de l'inverse d'une condition
// (ex: "hors secteur ABF") doit l'exprimer explicitement — on ne déduit
// pas la négation pour éviter d'écarter des règles à tort.
export function deriveApplicabilityTags(
  parcelle: ParcelleContext,
  projet: ProjectContext,
): string[] {
  const tags = new Set<string>();
  if (parcelle.abf === true) tags.add("abf");
  if (parcelle.risques?.some((r) => /inond/i.test(r))) tags.add("inondable");
  if (parcelle.oap && parcelle.oap.length > 0) tags.add("oap");
  for (const zone of parcelle.zonage_plu ?? []) tags.add(`zone_${zone}`);
  if (projet.extension) tags.add("extension");
  if (projet.surelevation) tags.add("surelevation");
  if (projet.demolition) tags.add("demolition");
  if (projet.annexe) tags.add("annexe");
  if (projet.cloture) tags.add("cloture");
  if (projet.destination_avant && projet.destination_apres &&
      projet.destination_avant !== projet.destination_apres) {
    tags.add("changement_destination");
  }
  return [...tags].sort();
}
