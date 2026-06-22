export function cn(...classes: (string | boolean | undefined | null)[]): string {
  return classes.filter(Boolean).join(" ");
}

/**
 * Normalise une chaîne pour une recherche tolérante : minuscules, sans accents
 * et sans séparateurs (espaces, tirets, apostrophes). Ainsi « saint cyr »
 * correspond à « Saint-Cyr-sur-Loire » et « luynes » à « Luynes ».
 */
export function normalizeForSearch(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}
