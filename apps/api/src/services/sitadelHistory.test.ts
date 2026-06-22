import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchSitadelHistory } from "./sitadelHistory.js";

// Resource id du fichier "logements" (cf. RESOURCES dans sitadelHistory.ts).
const LOGEMENTS_RID = "65a9e264-7a20-46a9-9d98-66becb817bc3";

function fillerRow(i: number) {
  return {
    NUM_DAU: `PC037018${String(i).padStart(4, "0")}`,
    TYPE_DAU: "PC",
    ETAT_DAU: "3",
    SEC_CADASTRE1: "ZZ",
    NUM_CADASTRE1: "999",
    AN_DEPOT: 2020,
  };
}

// La DP recherchée, volontairement placée en page 2 : avec l'ancien code
// (page=1, page_size=50, sans pagination) elle était silencieusement ignorée.
const TARGET_DP = {
  NUM_DAU: "DP0370180022B0001",
  TYPE_DAU: "DP",
  ETAT_DAU: "3",
  SEC_CADASTRE1: "AB",
  NUM_CADASTRE1: "142",
  AN_DEPOT: 2022,
  DATE_REELLE_AUTORISATION: "2022-09-15",
  ADR_LIBVOIE_TER: "RUE PASTEUR",
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fetchSitadelHistory — pagination (DP au-delà de la 1re page)", () => {
  it("retrouve une DP située en page 2 grâce à la pagination", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const u = new URL(url);
      const page = Number(u.searchParams.get("page") ?? "1");
      // Seul le fichier "logements" renvoie des lignes ; les 3 autres sources
      // sont vides.
      if (!url.includes(LOGEMENTS_RID)) {
        return { ok: true, json: async () => ({ data: [] }) } as Response;
      }
      if (page === 1) {
        // Page pleine (50 lignes) sans la parcelle cible → force le passage
        // à la page suivante.
        return {
          ok: true,
          json: async () => ({ data: Array.from({ length: 50 }, (_, i) => fillerRow(i)) }),
        } as Response;
      }
      if (page === 2) {
        return { ok: true, json: async () => ({ data: [TARGET_DP] }) } as Response;
      }
      return { ok: true, json: async () => ({ data: [] }) } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await fetchSitadelHistory({
      insee_code: "37018",
      cadastre: [{ section: "AB", numero: "142" }],
      scope: "parcel",
      maxPerSource: 300,
    });

    expect(res.permits).toHaveLength(1);
    expect(res.permits[0]?.num_dau).toBe("DP0370180022B0001");
    expect(res.permits[0]?.type_dau).toBe("DP");
    expect(res.effective_scope).toBe("parcel");
    // La 1re page pleine doit avoir déclenché un appel page=2.
    const pagesQueried = fetchMock.mock.calls
      .map(([url]) => Number(new URL(url as string).searchParams.get("page")))
      .filter((p) => !Number.isNaN(p));
    expect(Math.max(...pagesQueried)).toBeGreaterThanOrEqual(2);
  });

  it("s'arrête dès qu'une page est incomplète (pas de sur-pagination)", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (!url.includes(LOGEMENTS_RID)) {
        return { ok: true, json: async () => ({ data: [] }) } as Response;
      }
      // 10 lignes (< PAGE_SIZE) en page 1 → dernière page, aucun appel page 2.
      return {
        ok: true,
        json: async () => ({ data: Array.from({ length: 10 }, (_, i) => fillerRow(i)) }),
      } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    await fetchSitadelHistory({ insee_code: "37018", scope: "commune", maxPerSource: 300 });

    const logementsCalls = fetchMock.mock.calls.filter(([url]) =>
      (url as string).includes(LOGEMENTS_RID),
    );
    expect(logementsCalls).toHaveLength(1);
  });

  it("marque la source indisponible si la 1re page échoue", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes(LOGEMENTS_RID)) {
        return { ok: false, json: async () => ({}) } as Response;
      }
      return { ok: true, json: async () => ({ data: [] }) } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await fetchSitadelHistory({ insee_code: "37018", scope: "commune" });
    expect(res.warnings.some((w) => w.includes("logements"))).toBe(true);
  });
});
