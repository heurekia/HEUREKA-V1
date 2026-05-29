/**
 * Shared, pure matching helpers used by adapters. No I/O, fully unit-testable.
 */
import type { Override, CrossRef } from "../adapters/interface.ts";

export interface LineMatch {
  lineIndex: number;
  groups: string[]; // capture groups 1..n (group 0 omitted)
}

/** Find every line matching `regex`, returning its index and capture groups. */
export function findMatches(lines: string[], regex: RegExp): LineMatch[] {
  const out: LineMatch[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = (lines[i] ?? "").match(regex);
    if (m) out.push({ lineIndex: i, groups: m.slice(1).map((g) => g ?? "") });
  }
  return out;
}

/**
 * Extract secteur-specific overrides from free text.
 * Each pattern's first capture group holds one or more comma-separated secteurs.
 */
export function extractSecteurOverrides(text: string, patterns: RegExp[]): Override[] {
  const out: Override[] = [];
  const seen = new Set<string>();
  for (const pattern of patterns) {
    const re = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g");
    const isException = /exception/i.test(pattern.source);
    for (const m of text.matchAll(re)) {
      const captured = m[1] ?? "";
      const scope = captured
        .split(/,\s*|\s+et\s+/)
        .map((s) => s.trim())
        .filter(Boolean);
      if (!scope.length) continue;
      const key = `${isException ? "x" : "s"}:${scope.join("|")}:${m.index}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ scope, kind: isException ? "exception" : "secteur", raw: m[0].trim() });
    }
  }
  return out;
}

const CROSSREF_KIND: Array<{ test: RegExp; kind: CrossRef["kind"] }> = [
  { test: /article\s+L/i, kind: "code_urbanisme" },
  { test: /article/i, kind: "article" },
  { test: /sch[ée]ma/i, kind: "schema" },
  { test: /annexe/i, kind: "annexe" },
];

/** Extract cross-references; the first capture group is the reference id. */
export function extractCrossRefs(text: string, patterns: RegExp[]): CrossRef[] {
  const out: CrossRef[] = [];
  const seen = new Set<string>();
  for (const pattern of patterns) {
    const re = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g");
    for (const m of text.matchAll(re)) {
      const ref = (m[1] ?? "").trim();
      if (!ref) continue;
      const kind = CROSSREF_KIND.find((k) => k.test.test(m[0]))?.kind ?? "document";
      const key = `${kind}:${ref}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ kind, ref, raw: m[0].trim() });
    }
  }
  return out;
}
