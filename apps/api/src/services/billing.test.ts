import { describe, it, expect } from "vitest";
import {
  monthsOverlap,
  monthlyHt,
  computeMrr,
  isActiveAt,
  recognizedRevenueHt,
  summarizeRevenue,
  recognizedCostHt,
  summarizeCosts,
  resolvePeriod,
  type RevenueLine,
  type CostLine,
} from "./billing.js";

// Verrouille l'arithmétique du « mini compte de résultat » : proration des
// abonnements récurrents sur une période, ventilation récurrent/ponctuel,
// MRR/ARR, TVA collectée/déductible, et résolution des presets de période.

const D = (s: string) => new Date(`${s}T00:00:00`);

describe("monthsOverlap — mois calendaires fractionnaires", () => {
  it("une année civile pleine = 12 mois exacts", () => {
    expect(monthsOverlap(D("2026-01-01"), D("2026-12-31"), D("2026-01-01"), D("2026-12-31"))).toBeCloseTo(12, 6);
  });

  it("un mois civil plein = 1", () => {
    expect(monthsOverlap(D("2026-06-01"), D("2026-06-30"), D("2026-06-01"), D("2026-06-30"))).toBeCloseTo(1, 6);
  });

  it("février 2026 (28 j) plein = 1", () => {
    expect(monthsOverlap(D("2026-02-01"), D("2026-02-28"), D("2026-02-01"), D("2026-02-28"))).toBeCloseTo(1, 6);
  });

  it("demi-mois = fraction de jours (15/30 en juin)", () => {
    expect(monthsOverlap(D("2026-06-01"), D("2026-06-15"), D("2026-06-01"), D("2026-06-30"))).toBeCloseTo(15 / 30, 6);
  });

  it("aucune intersection = 0", () => {
    expect(monthsOverlap(D("2026-01-01"), D("2026-03-31"), D("2026-06-01"), D("2026-06-30"))).toBe(0);
  });

  it("intersection partielle bornée par la période", () => {
    // Abonnement depuis le 1er mars, période = T2 (avril→juin) → 3 mois.
    expect(monthsOverlap(D("2026-03-01"), D("2030-01-01"), D("2026-04-01"), D("2026-06-30"))).toBeCloseTo(3, 6);
  });
});

describe("monthlyHt — équivalent mensuel", () => {
  const base = { vat_rate: 20, start_date: "2026-01-01", end_date: null };
  it("annuel 1200 → 100/mois", () => {
    expect(monthlyHt({ ...base, quantity: 1, unit_price_eur: 1200, billing_cycle: "yearly" })).toBe(100);
  });
  it("trimestriel 300 → 100/mois", () => {
    expect(monthlyHt({ ...base, quantity: 1, unit_price_eur: 300, billing_cycle: "quarterly" })).toBe(100);
  });
  it("mensuel 100 → 100/mois", () => {
    expect(monthlyHt({ ...base, quantity: 1, unit_price_eur: 100, billing_cycle: "monthly" })).toBe(100);
  });
  it("one_shot / usage → 0", () => {
    expect(monthlyHt({ ...base, quantity: 1, unit_price_eur: 1500, billing_cycle: "one_shot" })).toBe(0);
    expect(monthlyHt({ ...base, quantity: 50, unit_price_eur: 12, billing_cycle: "usage" })).toBe(0);
  });
  it("quantité prise en compte", () => {
    expect(monthlyHt({ ...base, quantity: 3, unit_price_eur: 1200, billing_cycle: "yearly" })).toBe(300);
  });
});

describe("isActiveAt / computeMrr", () => {
  const now = D("2026-06-15");
  it("MRR somme les abonnements actifs, ignore ponctuels et annulés", () => {
    const items: RevenueLine[] = [
      { quantity: 1, unit_price_eur: 1200, vat_rate: 20, billing_cycle: "yearly", start_date: "2026-01-01", end_date: null }, // 100/mois
      { quantity: 1, unit_price_eur: 220, vat_rate: 20, billing_cycle: "monthly", start_date: "2026-05-01", end_date: null }, // 220/mois
      { quantity: 1, unit_price_eur: 1500, vat_rate: 20, billing_cycle: "one_shot", start_date: "2026-06-01", end_date: null }, // 0
      { quantity: 1, unit_price_eur: 999, vat_rate: 20, billing_cycle: "monthly", start_date: "2026-01-01", end_date: null, status: "cancelled" }, // 0
    ];
    expect(computeMrr(items, now)).toBe(320);
  });

  it("un abonnement non encore démarré n'est pas actif", () => {
    expect(isActiveAt({ quantity: 1, unit_price_eur: 100, vat_rate: 20, billing_cycle: "monthly", start_date: "2026-07-01", end_date: null }, now)).toBe(false);
  });

  it("un abonnement terminé n'est pas actif", () => {
    expect(isActiveAt({ quantity: 1, unit_price_eur: 100, vat_rate: 20, billing_cycle: "monthly", start_date: "2026-01-01", end_date: "2026-05-31" }, now)).toBe(false);
  });
});

describe("recognizedRevenueHt — reconnaissance sur période", () => {
  const now = D("2026-06-15");
  it("abonnement annuel 1200 sur l'année civile = 1200", () => {
    const it: RevenueLine = { quantity: 1, unit_price_eur: 1200, vat_rate: 20, billing_cycle: "yearly", start_date: "2026-01-01", end_date: null };
    const ht = recognizedRevenueHt(it, { from: D("2026-01-01"), to: D("2026-12-31") }, now);
    expect(ht).toBeCloseTo(1200, 4);
  });

  it("one_shot compté seulement si la date tombe dans la période", () => {
    const it: RevenueLine = { quantity: 1, unit_price_eur: 1500, vat_rate: 20, billing_cycle: "one_shot", start_date: "2026-03-10", end_date: null };
    expect(recognizedRevenueHt(it, { from: D("2026-01-01"), to: D("2026-03-31") }, now)).toBe(1500);
    expect(recognizedRevenueHt(it, { from: D("2026-04-01"), to: D("2026-06-30") }, now)).toBe(0);
  });

  it("usage compté comme un ponctuel daté", () => {
    const it: RevenueLine = { quantity: 40, unit_price_eur: 12, vat_rate: 20, billing_cycle: "usage", start_date: "2026-05-31", end_date: null };
    expect(recognizedRevenueHt(it, { from: D("2026-05-01"), to: D("2026-05-31") }, now)).toBe(480);
  });

  it("mensuel proraté sur un trimestre = 3 mensualités", () => {
    const it: RevenueLine = { quantity: 1, unit_price_eur: 220, vat_rate: 20, billing_cycle: "monthly", start_date: "2026-01-01", end_date: null };
    const ht = recognizedRevenueHt(it, { from: D("2026-04-01"), to: D("2026-06-30") }, now);
    expect(ht).toBeCloseTo(660, 4);
  });
});

describe("summarizeRevenue — totaux + TVA + MRR/ARR", () => {
  const now = D("2026-06-15");
  const items: RevenueLine[] = [
    { quantity: 1, unit_price_eur: 1200, vat_rate: 20, billing_cycle: "yearly", start_date: "2026-01-01", end_date: null },
    { quantity: 1, unit_price_eur: 1500, vat_rate: 20, billing_cycle: "one_shot", start_date: "2026-02-15", end_date: null },
  ];
  const s = summarizeRevenue(items, { from: D("2026-01-01"), to: D("2026-12-31") }, now);

  it("ventile récurrent vs ponctuel", () => {
    expect(s.recurring_ht).toBeCloseTo(1200, 2);
    expect(s.one_shot_ht).toBeCloseTo(1500, 2);
    expect(s.total_ht).toBeCloseTo(2700, 2);
  });

  it("TVA collectée à 20 % et TTC", () => {
    expect(s.vat_collected).toBeCloseTo(540, 2);
    expect(s.total_ttc).toBeCloseTo(3240, 2);
  });

  it("MRR / ARR depuis les récurrents actifs", () => {
    expect(s.mrr).toBeCloseTo(100, 2);
    expect(s.arr).toBeCloseTo(1200, 2);
  });
});

describe("charges — recognizedCostHt / summarizeCosts", () => {
  const now = D("2026-06-15");
  it("charge récurrente mensuelle proratée + TVA déductible", () => {
    const costs: CostLine[] = [
      { amount_eur: 90, vat_rate: 20, recurrence: "monthly", incurred_on: "2026-01-01", end_date: null },
    ];
    const c = summarizeCosts(costs, { from: D("2026-01-01"), to: D("2026-03-31") }, now);
    expect(c.total_ht).toBeCloseTo(270, 2); // 3 × 90
    expect(c.vat_deductible).toBeCloseTo(54, 2);
  });

  it("charge ponctuelle hors période = 0", () => {
    const costs: CostLine[] = [
      { amount_eur: 5000, vat_rate: 0, recurrence: "one_shot", incurred_on: "2025-12-01", end_date: null },
    ];
    expect(recognizedCostHt(costs[0]!, { from: D("2026-01-01"), to: D("2026-12-31") }, now)).toBe(0);
  });
});

describe("resolvePeriod — presets", () => {
  const now = D("2026-06-15");
  it("month = mois civil courant", () => {
    expect(resolvePeriod("month", now)).toEqual({ from: D("2026-06-01"), to: D("2026-06-30") });
  });
  it("quarter = trimestre civil (T2)", () => {
    expect(resolvePeriod("quarter", now)).toEqual({ from: D("2026-04-01"), to: D("2026-06-30") });
  });
  it("year = année civile", () => {
    expect(resolvePeriod("year", now)).toEqual({ from: D("2026-01-01"), to: D("2026-12-31") });
  });
  it("12m = 12 mois glissants jusqu'à fin du mois courant", () => {
    expect(resolvePeriod("12m", now)).toEqual({ from: D("2025-07-01"), to: D("2026-06-30") });
  });
  it("all = intervalle ouvert", () => {
    expect(resolvePeriod("all", now)).toEqual({ from: null, to: null });
  });
  it("une plage custom l'emporte sur le preset", () => {
    expect(resolvePeriod("year", now, "2026-03-01", "2026-03-31")).toEqual({ from: D("2026-03-01"), to: D("2026-03-31") });
  });
});
