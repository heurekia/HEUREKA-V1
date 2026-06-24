/**
 * Cœur de calcul du « mini compte de résultat » (onglet Facturation du
 * back-office super-admin). Toute l'arithmétique financière est isolée ici,
 * pure et testable (cf. billing.test.ts) : les routes Express se contentent de
 * charger les lignes depuis la base et de déléguer l'agrégation.
 *
 * Conventions :
 *   - tous les montants manipulés sont en euros HT, sauf mention TTC explicite ;
 *   - les dates `date` Postgres arrivent en chaîne "YYYY-MM-DD" → `toDate()` ;
 *   - une période est un intervalle [from, to] où `null` signifie « ouvert »
 *     (from=null → depuis l'origine, to=null → jusqu'à `now`).
 */

export type BillingCycle = "one_shot" | "monthly" | "quarterly" | "yearly" | "usage";
export type CostRecurrence = "one_shot" | "monthly" | "quarterly" | "yearly";

export interface Period {
  from: Date | null;
  to: Date | null;
}

export interface RevenueLine {
  quantity: number;
  unit_price_eur: number;
  vat_rate: number;
  billing_cycle: string;
  start_date: string | Date | null;
  end_date: string | Date | null;
  status?: string | null;
}

export interface CostLine {
  amount_eur: number;
  vat_rate?: number | null;
  recurrence: string;
  incurred_on: string | Date | null;
  end_date: string | Date | null;
}

export interface RevenueSummary {
  recurring_ht: number;
  one_shot_ht: number;
  total_ht: number;
  vat_collected: number;
  total_ttc: number;
  mrr: number;
  arr: number;
}

export interface CostSummary {
  total_ht: number;
  vat_deductible: number;
}

// ── Helpers dates ────────────────────────────────────────────────────────────

/** Parse une date Postgres ("YYYY-MM-DD") ou un Date en Date locale à minuit. */
export function toDate(v: string | Date | null | undefined): Date | null {
  if (v == null) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function daysInMonth(year: number, monthIdx: number): number {
  return new Date(year, monthIdx + 1, 0).getDate();
}

const MS_PER_DAY = 86_400_000;

/**
 * Nombre de mois calendaires (fractionnaires) dans l'intersection de
 * [aStart, aEnd] et [bStart, bEnd], bornes incluses au jour près.
 *
 * Un mois calendaire plein vaut exactement 1 ; un mois partiel vaut la
 * fraction de jours couverts (ex. 15 jours de juin = 15/30). Conséquence
 * voulue : un abonnement annuel couvrant une année civile pleine vaut 12,0 →
 * le CA reconnu = (montant annuel / 12) × 12 = montant annuel exact.
 */
export function monthsOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): number {
  const s = startOfDay(new Date(Math.max(aStart.getTime(), bStart.getTime())));
  const e = startOfDay(new Date(Math.min(aEnd.getTime(), bEnd.getTime())));
  if (e.getTime() < s.getTime()) return 0;

  let total = 0;
  let year = s.getFullYear();
  let month = s.getMonth();
  while (year < e.getFullYear() || (year === e.getFullYear() && month <= e.getMonth())) {
    const dim = daysInMonth(year, month);
    const monthStart = new Date(year, month, 1);
    const monthEnd = new Date(year, month, dim);
    const segStart = monthStart.getTime() < s.getTime() ? s : monthStart;
    const segEnd = monthEnd.getTime() > e.getTime() ? e : monthEnd;
    const days = Math.round((segEnd.getTime() - segStart.getTime()) / MS_PER_DAY) + 1; // inclusif
    total += days / dim;
    month++;
    if (month > 11) { month = 0; year++; }
  }
  return total;
}

// ── Revenus ──────────────────────────────────────────────────────────────────

function normalizeCycle(c: string): BillingCycle {
  return (["one_shot", "monthly", "quarterly", "yearly", "usage"].includes(c) ? c : "one_shot") as BillingCycle;
}

/** Total HT d'une occurrence (quantité × prix unitaire). */
export function lineTotalHt(it: { quantity: number; unit_price_eur: number }): number {
  return (it.quantity ?? 1) * (it.unit_price_eur ?? 0);
}

/** Équivalent mensuel HT (contribution au MRR). 0 pour one_shot / usage. */
export function monthlyHt(it: RevenueLine): number {
  const t = lineTotalHt(it);
  switch (normalizeCycle(it.billing_cycle)) {
    case "monthly": return t;
    case "quarterly": return t / 3;
    case "yearly": return t / 12;
    default: return 0;
  }
}

/** Une ligne récurrente est-elle active à la date `at` ? (start ≤ at ≤ end) */
export function isActiveAt(it: RevenueLine, at: Date): boolean {
  if ((it.status ?? "active") !== "active") return false;
  const start = toDate(it.start_date);
  if (start && startOfDay(start).getTime() > startOfDay(at).getTime()) return false;
  const end = toDate(it.end_date);
  if (end && startOfDay(end).getTime() < startOfDay(at).getTime()) return false;
  return true;
}

/** MRR = somme des équivalents mensuels des lignes récurrentes actives à `now`. */
export function computeMrr(items: RevenueLine[], now: Date): number {
  return items
    .filter((it) => isActiveAt(it, now))
    .reduce((sum, it) => sum + monthlyHt(it), 0);
}

/**
 * CA HT reconnu sur une période pour UNE ligne :
 *   - récurrent : équivalent mensuel × nombre de mois d'activité dans la
 *     période (proraté), borné par start/end de la ligne et par la période ;
 *   - one_shot / usage : total si start_date tombe dans la période, sinon 0.
 *
 * Les lignes 'cancelled' ne sont reconnues que jusqu'à leur end_date (si fixée).
 */
export function recognizedRevenueHt(it: RevenueLine, period: Period, now: Date): number {
  const cycle = normalizeCycle(it.billing_cycle);
  const start = toDate(it.start_date);

  if (cycle === "one_shot" || cycle === "usage") {
    const d = start;
    if (!d) return lineTotalHt(it); // pas de date → comptée quelle que soit la période
    if (period.from && startOfDay(d).getTime() < startOfDay(period.from).getTime()) return 0;
    if (period.to && startOfDay(d).getTime() > startOfDay(period.to).getTime()) return 0;
    return lineTotalHt(it);
  }

  // Récurrent.
  const effStart = start ?? now;
  const cancelled = (it.status ?? "active") !== "active";
  const end = toDate(it.end_date);
  // Horizon : borne haute de la période (`now` si période ouverte « tout »).
  // On reconnaît un abonnement actif sur TOUTE la période bornée demandée
  // (CA contracté), pas seulement jusqu'à aujourd'hui — sinon le mois/
  // trimestre/année en cours paraît artificiellement bas en milieu de période.
  const pTo = period.to ?? now;
  // Fin effective : end_date si fixée ; sinon l'horizon si actif ; sinon
  // (annulé sans date) on ne reconnaît rien au-delà du début.
  const effEnd = end ?? (cancelled ? effStart : pTo);
  const pFrom = period.from ?? effStart;
  return monthlyHt(it) * monthsOverlap(effStart, effEnd, pFrom, pTo);
}

/** Part récurrente uniquement (sert à ventiler récurrent vs ponctuel). */
function recognizedRecurringHt(it: RevenueLine, period: Period, now: Date): number {
  const cycle = normalizeCycle(it.billing_cycle);
  if (cycle === "one_shot" || cycle === "usage") return 0;
  return recognizedRevenueHt(it, period, now);
}

export function summarizeRevenue(items: RevenueLine[], period: Period, now: Date): RevenueSummary {
  let recurring_ht = 0;
  let one_shot_ht = 0;
  let vat_collected = 0;
  for (const it of items) {
    const ht = recognizedRevenueHt(it, period, now);
    if (ht === 0) continue;
    const rec = recognizedRecurringHt(it, period, now);
    recurring_ht += rec;
    one_shot_ht += ht - rec;
    vat_collected += ht * ((it.vat_rate ?? 0) / 100);
  }
  const total_ht = recurring_ht + one_shot_ht;
  const mrr = computeMrr(items, now);
  return {
    recurring_ht: round2(recurring_ht),
    one_shot_ht: round2(one_shot_ht),
    total_ht: round2(total_ht),
    vat_collected: round2(vat_collected),
    total_ttc: round2(total_ht + vat_collected),
    mrr: round2(mrr),
    arr: round2(mrr * 12),
  };
}

// ── Charges ──────────────────────────────────────────────────────────────────

export function recognizedCostHt(c: CostLine, period: Period, now: Date): number {
  const rec = (["one_shot", "monthly", "quarterly", "yearly"].includes(c.recurrence) ? c.recurrence : "one_shot") as CostRecurrence;
  const start = toDate(c.incurred_on);
  if (rec === "one_shot") {
    const d = start;
    if (!d) return c.amount_eur ?? 0;
    if (period.from && startOfDay(d).getTime() < startOfDay(period.from).getTime()) return 0;
    if (period.to && startOfDay(d).getTime() > startOfDay(period.to).getTime()) return 0;
    return c.amount_eur ?? 0;
  }
  const effStart = start ?? now;
  const end = toDate(c.end_date);
  const pTo = period.to ?? now;
  const effEnd = end ?? pTo;
  const pFrom = period.from ?? effStart;
  const monthly = rec === "monthly" ? (c.amount_eur ?? 0)
    : rec === "quarterly" ? (c.amount_eur ?? 0) / 3
    : (c.amount_eur ?? 0) / 12;
  return monthly * monthsOverlap(effStart, effEnd, pFrom, pTo);
}

export function summarizeCosts(costs: CostLine[], period: Period, now: Date): CostSummary {
  let total_ht = 0;
  let vat_deductible = 0;
  for (const c of costs) {
    const ht = recognizedCostHt(c, period, now);
    if (ht === 0) continue;
    total_ht += ht;
    vat_deductible += ht * ((c.vat_rate ?? 0) / 100);
  }
  return { total_ht: round2(total_ht), vat_deductible: round2(vat_deductible) };
}

// ── Période ──────────────────────────────────────────────────────────────────

/**
 * Résout un descripteur de période en intervalle [from, to].
 * `preset` ∈ {month, quarter, year, 12m, all} (calendaires, sauf 12m glissant).
 * Une plage custom (fromStr/toStr "YYYY-MM-DD") l'emporte sur le preset.
 */
export function resolvePeriod(
  preset: string,
  now: Date,
  fromStr?: string | null,
  toStr?: string | null,
): Period {
  const parse = (s: string): Date | null => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
    return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
  };
  if ((fromStr && fromStr.trim()) || (toStr && toStr.trim())) {
    return {
      from: fromStr && fromStr.trim() ? parse(fromStr) : null,
      to: toStr && toStr.trim() ? parse(toStr) : null,
    };
  }
  const y = now.getFullYear();
  const m = now.getMonth();
  switch (preset) {
    case "month":
      return { from: new Date(y, m, 1), to: new Date(y, m + 1, 0) };
    case "quarter": {
      const q = Math.floor(m / 3);
      return { from: new Date(y, q * 3, 1), to: new Date(y, q * 3 + 3, 0) };
    }
    case "12m": {
      const from = new Date(y, m - 11, 1);
      return { from, to: new Date(y, m + 1, 0) };
    }
    case "all":
      return { from: null, to: null };
    case "year":
    default:
      return { from: new Date(y, 0, 1), to: new Date(y, 11, 31) };
  }
}

function round2(v: number): number {
  return Math.round((v + Number.EPSILON) * 100) / 100;
}
