import { describe, it, expect, vi } from "vitest";
import crypto from "crypto";

// Charge le module avec un petit seuil + une petite tranche, pour FORCER le
// chemin « découpé + cession » et exercer de nombreuses frontières de tranche
// sans allouer de gros buffers. THRESHOLD=64 octets, CHUNK=24 (multiple de 12).
async function loadChunked() {
  vi.resetModules();
  vi.stubEnv("CPU_YIELD_THRESHOLD_BYTES", "64");
  vi.stubEnv("CPU_CHUNK_BYTES", "24");
  const mod = await import("./cpuOffload.js");
  vi.unstubAllEnvs();
  return mod;
}

function randomBuffer(len: number): Buffer {
  const buf = Buffer.allocUnsafe(len);
  for (let i = 0; i < len; i++) buf[i] = (i * 31 + 7) & 0xff; // déterministe
  return buf;
}

describe("cpuOffload — équivalence stricte avec les appels natifs (chemin découpé)", () => {
  // Tailles autour des frontières : multiples et non-multiples de 3 (base64),
  // sous le seuil, juste au-dessus, et bien au-dessus avec tranche partielle.
  const sizes = [0, 1, 2, 3, 4, 60, 63, 64, 65, 72, 100, 101, 102, 256, 999, 1000];

  it("toBase64Async == Buffer.toString('base64')", async () => {
    const { toBase64Async } = await loadChunked();
    for (const n of sizes) {
      const buf = randomBuffer(n);
      expect(await toBase64Async(buf)).toBe(buf.toString("base64"));
    }
  });

  it("sha256HexAsync == crypto sha256", async () => {
    const { sha256HexAsync } = await loadChunked();
    for (const n of sizes) {
      const buf = randomBuffer(n);
      expect(await sha256HexAsync(buf)).toBe(
        crypto.createHash("sha256").update(buf).digest("hex"),
      );
    }
  });

  it("sha256HexConcatAsync == sha256 de la concaténation", async () => {
    const { sha256HexConcatAsync } = await loadChunked();
    const groups: Buffer[][] = [
      [],
      [randomBuffer(10)],
      [randomBuffer(100), randomBuffer(1)],
      [randomBuffer(0), randomBuffer(999), randomBuffer(50)],
    ];
    for (const bufs of groups) {
      expect(await sha256HexConcatAsync(bufs)).toBe(
        crypto.createHash("sha256").update(Buffer.concat(bufs)).digest("hex"),
      );
    }
  });
});

describe("cpuOffload — chemin synchrone (sous le seuil par défaut)", () => {
  it("produit le même résultat que les appels natifs", async () => {
    vi.resetModules();
    const { toBase64Async, sha256HexAsync, sha256HexConcatAsync } = await import("./cpuOffload.js");
    const buf = randomBuffer(1234); // < 8 Mo → chemin natif direct
    expect(await toBase64Async(buf)).toBe(buf.toString("base64"));
    expect(await sha256HexAsync(buf)).toBe(crypto.createHash("sha256").update(buf).digest("hex"));
    expect(await sha256HexConcatAsync([buf, buf])).toBe(
      crypto.createHash("sha256").update(Buffer.concat([buf, buf])).digest("hex"),
    );
  });
});
