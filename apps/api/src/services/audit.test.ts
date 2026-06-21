import { describe, expect, it } from "vitest";
import { sanitizeMetadataValue } from "./audit.js";

describe("sanitizeMetadataValue", () => {
  it("strippe les clés sensibles à tous les niveaux", () => {
    const out = sanitizeMetadataValue({
      email: "a@b.fr",
      password: "secret",
      nested: { token: "abc", keep: 42, password_hash: "x" },
    }) as Record<string, unknown>;
    expect(out["email"]).toBe("a@b.fr");
    expect(out).not.toHaveProperty("password");
    const nested = out["nested"] as Record<string, unknown>;
    expect(nested).not.toHaveProperty("token");
    expect(nested).not.toHaveProperty("password_hash");
    expect(nested["keep"]).toBe(42);
  });

  it("tronque les chaînes très longues", () => {
    const long = "x".repeat(800);
    const out = sanitizeMetadataValue({ body: long }) as { body: string };
    expect(out.body.length).toBeLessThan(560);
    expect(out.body).toContain("…(800)");
  });

  it("limite la profondeur à 2 (évite le JSON imbriqué incontrôlé)", () => {
    const deep = { a: { b: { c: { d: "trop loin" } } } };
    const out = sanitizeMetadataValue(deep) as Record<string, unknown>;
    // À profondeur 2, on remplace l'objet par "(object)" — n'importe quelle
    // imbrication plus profonde est coupée nette.
    const a = out["a"] as Record<string, unknown>;
    expect(a["b"]).toBe("(object)");
  });

  it("préserve les types primitifs", () => {
    const out = sanitizeMetadataValue({ n: 42, b: true, s: "x", nil: null });
    expect(out).toEqual({ n: 42, b: true, s: "x", nil: null });
  });
});
