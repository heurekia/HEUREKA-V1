import { describe, it, expect } from "vitest";
import { renderPieceListHtml } from "./pieceRequest.js";

describe("renderPieceListHtml", () => {
  it("renvoie une chaîne vide si aucune pièce", () => {
    expect(renderPieceListHtml([])).toBe("");
  });

  it("affiche les pièces déposées avec un tag à compléter", () => {
    const html = renderPieceListHtml([
      { piece_id: "p1", code_piece: "PC2", nom: "Plan de masse", manquante: false },
    ]);
    expect(html).toContain("Plan de masse");
    expect(html).toContain("PC2");
    expect(html).toContain("à compléter");
    expect(html).not.toContain("à fournir");
  });

  it("affiche les pièces manquantes avec un tag à fournir", () => {
    const html = renderPieceListHtml([
      { code_piece: "PC5", nom: "Plan des façades", manquante: true },
    ]);
    expect(html).toContain("à fournir");
    expect(html).not.toContain("à compléter");
  });

  it("inclut la raison quand elle est fournie", () => {
    const html = renderPieceListHtml([
      { piece_id: "p1", nom: "Plan en coupe", raison: "Côtes illisibles" },
    ]);
    expect(html).toContain("Côtes illisibles");
  });

  it("échappe les caractères HTML pour éviter toute injection", () => {
    const html = renderPieceListHtml([
      { piece_id: "p1", nom: "<script>alert(1)</script>", raison: "A & B" },
    ]);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("A &amp; B");
  });

  it("préserve l'ordre des pièces", () => {
    const html = renderPieceListHtml([
      { piece_id: "a", nom: "Première" },
      { piece_id: "b", nom: "Deuxième" },
      { code_piece: "X", nom: "Troisième", manquante: true },
    ]);
    const i1 = html.indexOf("Première");
    const i2 = html.indexOf("Deuxième");
    const i3 = html.indexOf("Troisième");
    expect(i1).toBeGreaterThan(0);
    expect(i2).toBeGreaterThan(i1);
    expect(i3).toBeGreaterThan(i2);
  });
});
