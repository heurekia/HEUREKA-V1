/**
 * Chunker générique pour documents réglementaires.
 *
 * Découpe un texte en chunks d'environ TARGET_CHARS caractères, en respectant
 * les frontières naturelles : paragraphe → phrase → mot. Une page = un ou
 * plusieurs chunks (jamais un chunk à cheval entre deux pages — important pour
 * la traçabilité juridique "PPRI, p. 23").
 *
 * Le contrat est volontairement minimal : pas d'adapter à écrire, on peut
 * indexer n'importe quel PDF dès qu'on a son texte page par page. C'est ce
 * qui rend l'indexation des annexes (PPRI, OAP, PEB, servitudes…) viable
 * sans construire un adapter spécifique par type.
 */

export interface Chunk {
  /** Index dans la liste retournée (0-based). */
  index: number;
  /** Page d'origine (1-based — comme le PDF). */
  page: number;
  text: string;
  char_count: number;
}

export interface ChunkOptions {
  /** Taille cible en caractères. ~600 ≈ 150 tokens, ~1200 ≈ 300 tokens. */
  target_chars?: number;
  /** Recouvrement entre chunks pour préserver le contexte aux frontières. */
  overlap_chars?: number;
  /** Si vrai, on retire les pages d'index/sommaire/page blanche (heuristique). */
  drop_noise?: boolean;
}

const DEFAULT_TARGET = 1200;
const DEFAULT_OVERLAP = 150;

/** Retire les pages clairement non utiles (sommaire, page blanche). */
function isNoisePage(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 50) return true; // page quasi-blanche
  // Heuristique sommaire : beaucoup de lignes "TITRE........... N°" ou liste de
  // numéros de pages. ≥ 60 % de lignes "courtes finissant par chiffre" → on
  // considère que c'est un sommaire et on laisse tomber.
  const lines = trimmed.split(/\n+/).filter((l) => l.trim().length > 0);
  if (lines.length < 4) return false;
  const tocLike = lines.filter((l) => /\.{3,}\s*\d+\s*$/.test(l) || /^\s*\d+\s*$/.test(l)).length;
  return tocLike / lines.length > 0.6;
}

/**
 * Découpe un texte (une page) en sous-blocs ≤ target en respectant les
 * frontières paragraphe → phrase → mot. Garantit qu'aucun bloc ne dépasse
 * 2 × target (protège contre les paragraphes monolithiques).
 */
function splitText(text: string, target: number): string[] {
  if (text.length <= target) return [text.trim()].filter(Boolean);

  // 1. paragraphes
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const blocks: string[] = [];
  let buf = "";
  for (const p of paragraphs) {
    if (buf && (buf.length + p.length + 2) > target) {
      blocks.push(buf);
      buf = p;
    } else {
      buf = buf ? `${buf}\n\n${p}` : p;
    }
  }
  if (buf) blocks.push(buf);

  // 2. si un bloc reste > 2× target, recoupe par phrases
  const finer: string[] = [];
  for (const b of blocks) {
    if (b.length <= target * 2) {
      finer.push(b);
      continue;
    }
    const sentences = b.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
    let s = "";
    for (const sent of sentences) {
      if (s && (s.length + sent.length + 1) > target) {
        finer.push(s);
        s = sent;
      } else {
        s = s ? `${s} ${sent}` : sent;
      }
    }
    if (s) finer.push(s);
  }

  // 3. ultime garde-fou : coupe brute par mots si encore trop gros
  const safe: string[] = [];
  for (const b of finer) {
    if (b.length <= target * 2) {
      safe.push(b);
      continue;
    }
    for (let i = 0; i < b.length; i += target) safe.push(b.slice(i, i + target));
  }
  return safe;
}

/** Recouvrement : ajoute la fin du chunk précédent au début du suivant. */
function applyOverlap(chunks: string[], overlap: number): string[] {
  if (overlap <= 0) return chunks;
  return chunks.map((c, i) => {
    if (i === 0) return c;
    const prev = chunks[i - 1]!;
    const tail = prev.slice(Math.max(0, prev.length - overlap));
    // Cherche une frontière de mot au début du tail pour éviter "…rure du quart"
    const cleanTail = tail.replace(/^\S*\s+/, "");
    return cleanTail ? `${cleanTail} ${c}` : c;
  });
}

/**
 * Chunker principal. Prend les pages d'un document (1 string par page) et
 * retourne une liste de chunks avec leur page d'origine.
 */
export function chunkPages(pages: string[], opts: ChunkOptions = {}): Chunk[] {
  const target = opts.target_chars ?? DEFAULT_TARGET;
  const overlap = opts.overlap_chars ?? DEFAULT_OVERLAP;
  const dropNoise = opts.drop_noise !== false;

  const chunks: Chunk[] = [];
  let globalIndex = 0;

  for (let pageIdx = 0; pageIdx < pages.length; pageIdx++) {
    const pageText = pages[pageIdx] ?? "";
    if (dropNoise && isNoisePage(pageText)) continue;

    const blocks = splitText(pageText, target);
    const withOverlap = applyOverlap(blocks, overlap);

    for (const text of withOverlap) {
      if (text.trim().length < 30) continue; // ignore microbloc < 30 chars
      chunks.push({
        index: globalIndex++,
        page: pageIdx + 1,
        text: text.trim(),
        char_count: text.length,
      });
    }
  }

  return chunks;
}
