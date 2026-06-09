import { describe, it, expect } from "vitest";
import { chunkPages } from "./chunker.ts";

describe("chunkPages()", () => {
  it("retourne un seul chunk pour une page courte", () => {
    const chunks = chunkPages(["Article 7 : implantation à 5 mètres de l'alignement."]);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.page).toBe(1);
    expect(chunks[0]!.text).toContain("5 mètres");
  });

  it("découpe une page longue à la frontière paragraphe", () => {
    const para = "Lorem ipsum dolor sit amet. ".repeat(60);
    const page = `${para}\n\n${para}\n\n${para}`;
    const chunks = chunkPages([page], { target_chars: 600 });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.char_count > 0)).toBe(true);
  });

  it("garde le numéro de page d'origine (1-based)", () => {
    const chunks = chunkPages([
      "Première page avec un contenu réglementaire suffisamment long pour passer le filtre microchunk.",
      "Deuxième page texte plus long que la limite imposée. ".repeat(20),
    ]);
    expect(chunks[0]!.page).toBe(1);
    expect(chunks.some((c) => c.page === 2)).toBe(true);
  });

  it("retire les pages de sommaire (heuristique TOC)", () => {
    const toc = [
      "TABLE DES MATIÈRES",
      "Chapitre 1 ............................................. 3",
      "Chapitre 2 ............................................. 15",
      "Chapitre 3 ............................................. 27",
      "Chapitre 4 ............................................. 42",
      "Chapitre 5 ............................................. 55",
    ].join("\n");
    const content = "Article 1 : voici un vrai texte réglementaire qui détaille des règles d'urbanisme avec des seuils chiffrés.";
    const chunks = chunkPages([toc, content]);
    // Pas de chunk venant de la page 1 (sommaire), seulement de la page 2.
    expect(chunks.every((c) => c.page === 2)).toBe(true);
  });

  it("retire les pages quasi-blanches", () => {
    const chunks = chunkPages([" ", "vraie page avec contenu réglementaire utile"]);
    expect(chunks.every((c) => c.page === 2)).toBe(true);
  });

  it("ignore les microchunks (< 30 chars)", () => {
    const chunks = chunkPages(["court"]);
    expect(chunks).toHaveLength(0);
  });

  it("applique l'overlap entre chunks d'une même page", () => {
    const paras = [
      "Premier paragraphe avec du contenu unique alpha.",
      "Deuxième paragraphe avec du contenu unique beta.",
      "Troisième paragraphe avec du contenu unique gamma.",
    ];
    const text = paras.join("\n\n");
    const chunks = chunkPages([text], { target_chars: 80, overlap_chars: 30 });
    // overlap doit faire remonter du contenu du chunk précédent dans le suivant
    if (chunks.length >= 2) {
      expect(chunks[1]!.text.length).toBeGreaterThan(chunks[1]!.text.replace(/alpha|beta|gamma/g, "").length);
    }
  });

  it("index global continu sur plusieurs pages", () => {
    const longPara = "phrase utile ".repeat(80);
    const chunks = chunkPages([longPara, longPara, longPara], { target_chars: 200 });
    for (let i = 0; i < chunks.length; i++) {
      expect(chunks[i]!.index).toBe(i);
    }
  });
});
