import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { LocalStorageProvider } from "./storage.js";

describe("LocalStorageProvider", () => {
  let tmpDir: string;
  let provider: LocalStorageProvider;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "heureka-storage-"));
    provider = new LocalStorageProvider(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("écrit un fichier et le retourne avec l'URL legacy", async () => {
    const res = await provider.put({
      key: "abc123.pdf",
      body: Buffer.from("hello pdf"),
      mime: "application/pdf",
    });
    expect(res.key).toBe("abc123.pdf");
    expect(res.url).toBe("/api/uploads/abc123.pdf");
    expect(res.size).toBe(9);
    expect(res.mime).toBe("application/pdf");
    expect(fs.existsSync(path.join(tmpDir, "abc123.pdf"))).toBe(true);
  });

  it("relit le buffer écrit", async () => {
    const payload = Buffer.from("contenu binaire de plan");
    await provider.put({ key: "plan.pdf", body: payload, mime: "application/pdf" });
    const buf = await provider.getBuffer("plan.pdf");
    expect(buf.equals(payload)).toBe(true);
  });

  it("ouvre un flux lisible avec la taille du fichier", async () => {
    const payload = Buffer.from("flux binaire d'un plan");
    await provider.put({ key: "flux.pdf", body: payload, mime: "application/pdf" });
    const { stream, contentLength } = await provider.getStream("flux.pdf");
    expect(contentLength).toBe(payload.length);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk as Buffer);
    }
    expect(Buffer.concat(chunks).equals(payload)).toBe(true);
  });

  it("retourne l'URL publique pour téléchargement (pas de signature en local)", async () => {
    const url = await provider.getDownloadUrl("plan.pdf");
    expect(url).toBe("/api/uploads/plan.pdf");
  });

  it("supprime un fichier existant", async () => {
    await provider.put({ key: "del.pdf", body: Buffer.from("x"), mime: "application/pdf" });
    await provider.remove("del.pdf");
    expect(fs.existsSync(path.join(tmpDir, "del.pdf"))).toBe(false);
  });

  it("ne lève pas d'erreur si on supprime un fichier déjà absent (idempotence RGPD)", async () => {
    await expect(provider.remove("inexistant.pdf")).resolves.toBeUndefined();
  });

  it("supprime en lot et compte deleted/failed", async () => {
    await provider.put({ key: "a.pdf", body: Buffer.from("a"), mime: "application/pdf" });
    await provider.put({ key: "b.pdf", body: Buffer.from("b"), mime: "application/pdf" });
    // c.pdf n'existe pas → comptera quand même comme deleted (idempotent)
    const res = await provider.removeBulk(["a.pdf", "b.pdf", "c.pdf"]);
    expect(res.deleted).toBe(3);
    expect(res.failed).toBe(0);
    expect(fs.existsSync(path.join(tmpDir, "a.pdf"))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, "b.pdf"))).toBe(false);
  });

  it("extrait la key depuis une URL legacy /api/uploads/<key>", () => {
    expect(provider.keyFromUrl("/api/uploads/abc-def.pdf")).toBe("abc-def.pdf");
    expect(provider.keyFromUrl("/api/uploads/uuid.png")).toBe("uuid.png");
  });

  it("lève une erreur sur URL malformée", () => {
    expect(() => provider.keyFromUrl("")).toThrow(/URL invalide/);
  });
});
