/**
 * ParcelSynthese — rendu de la synthèse réglementaire thématique.
 *
 * Une même donnée (produite par le back `buildParcelSynthesis`), deux lectures :
 *  - audience="citizen"    : chiffre clé en clair, sources repliées pour la transparence.
 *  - audience="instructor" : éléments tracés (article / document) regroupés par
 *                            thème, avec les sources TRANSVERSALES en tête de carte.
 *
 * Composant purement présentationnel — aucun fetch, aucun état métier.
 */
import { useState } from "react";

export type SynthTone = "favorable" | "neutre" | "info" | "attention" | "interdit";

export interface SynthSource {
  kind: string;
  label: string;
  ref?: string;
  url?: string;
  rule_id?: string;
}

export interface SynthItem {
  label: string;
  value: string | null;
  detail: string | null;
  /** Extrait verbatim de la règle (texte fidèle du PLU), citable tel quel. */
  quote?: string | null;
  source: SynthSource;
  applies_if?: string[];
  exceptions?: string | null;
  relevance?: "general" | "applicable" | "conditional" | "excluded";
  tone: SynthTone;
}

export interface SynthTheme {
  key: string;
  icon: string;
  title: string;
  citizen: { headline: string; points: string[]; tone: SynthTone };
  instructor: { items: SynthItem[]; sources: SynthSource[] };
}

export interface ParcelSynthesisData {
  schema_version: number;
  zone_code: string | null;
  zone_label: string | null;
  themes: SynthTheme[];
  counts: { themes: number; attention: number; interdit: number; conditionnel: number };
}

const TONE: Record<SynthTone, { fg: string; bg: string; border: string; label: string }> = {
  favorable: { fg: "#15803D", bg: "#F0FDF4", border: "#BBF7D0", label: "Favorable" },
  neutre: { fg: "#475569", bg: "#F8FAFC", border: "#E2E8F0", label: "" },
  info: { fg: "#4338CA", bg: "#EEF2FF", border: "#C7D2FE", label: "À noter" },
  attention: { fg: "#92400E", bg: "#FEF3C7", border: "#FDE68A", label: "Point d'attention" },
  interdit: { fg: "#991B1B", bg: "#FEE2E2", border: "#FECACA", label: "Interdiction" },
};

const REL_BADGE: Record<string, { label: string; fg: string; bg: string }> = {
  conditional: { label: "selon le projet", fg: "#92400E", bg: "#FEF3C7" },
  excluded: { label: "écartée pour cette parcelle", fg: "#64748B", bg: "#F1F5F9" },
  applicable: { label: "applicable", fg: "#15803D", bg: "#F0FDF4" },
};

function clipText(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function ToneChip({ tone }: { tone: SynthTone }) {
  const t = TONE[tone];
  if (!t.label) return null;
  return (
    <span style={{ fontSize: 10.5, fontWeight: 700, color: t.fg, background: t.bg, border: `1px solid ${t.border}`, borderRadius: 999, padding: "2px 9px", whiteSpace: "nowrap" }}>
      {t.label}
    </span>
  );
}

function SourceChip({ s }: { s: SynthSource }) {
  const inner = <>{s.label}</>;
  const style = { fontSize: 10.5, fontWeight: 600, color: "#3730A3", background: "#EEF2FF", border: "1px solid #C7D2FE", borderRadius: 6, padding: "2px 8px", textDecoration: "none", whiteSpace: "nowrap" as const };
  return s.url
    ? <a href={s.url} target="_blank" rel="noreferrer" style={style}>{inner} ↗</a>
    : <span style={style}>{inner}</span>;
}

// ── Vue citoyen ─────────────────────────────────────────────────────────────────
function CitizenTheme({ theme }: { theme: SynthTheme }) {
  const t = TONE[theme.citizen.tone];
  const points = theme.citizen.points;
  if (points.length === 0) return null;
  return (
    <div style={{ border: `1px solid ${t.border}`, borderRadius: 12, overflow: "hidden", background: "white" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 14px", background: t.bg, borderBottom: `1px solid ${t.border}` }}>
        <span style={{ fontSize: 20 }}>{theme.icon}</span>
        <span style={{ flex: 1, fontSize: 13.5, fontWeight: 800, color: "#1E1B4B" }}>{theme.title}</span>
        <ToneChip tone={theme.citizen.tone} />
      </div>
      <div style={{ padding: "10px 14px" }}>
        <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 6 }}>
          {points.map((p, i) => (
            <li key={i} style={{ display: "flex", gap: 8, fontSize: 13, color: "#111827", lineHeight: 1.5 }}>
              <span style={{ color: t.fg, flexShrink: 0 }}>•</span><span>{p}</span>
            </li>
          ))}
        </ul>
        {theme.instructor.sources.length > 0 && (() => {
          // Texte exact derrière les puces : on liste les règles pertinentes pour le
          // citoyen (on écarte celles explicitement non applicables à la parcelle),
          // chacune avec sa référence d'article et son extrait fidèle du PLU.
          const cited = theme.instructor.items.filter((it) => it.relevance !== "excluded" && (it.quote || it.detail));
          return (
            <details style={{ marginTop: 9 }}>
              <summary style={{ fontSize: 11, color: "#6366F1", cursor: "pointer", fontWeight: 600, listStyle: "none" }}>
                D'où vient cette règle ? ({theme.instructor.sources.length}) ›
              </summary>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 7 }}>
                {theme.instructor.sources.map((s, i) => <SourceChip key={i} s={s} />)}
              </div>
              {cited.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 9, marginTop: 10 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    Texte exact
                  </span>
                  {cited.map((it, i) => (
                    <div key={i} style={{ borderLeft: "2px solid #C7D2FE", paddingLeft: 10 }}>
                      <div style={{ fontSize: 10.5, fontWeight: 700, color: "#4338CA" }}>
                        {it.source.label}{it.value ? ` · ${it.value}` : ""}
                      </div>
                      <p style={{ fontSize: 11.5, color: "#475569", margin: "2px 0 0", lineHeight: 1.5, fontStyle: "italic" }}>
                        «&nbsp;{clipText(it.quote || it.detail || "", 360)}&nbsp;»
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </details>
          );
        })()}
      </div>
    </div>
  );
}

// ── Vue instructeur ───────────────────────────────────────────────────────────
function InstructorTheme({ theme }: { theme: SynthTheme }) {
  if (theme.instructor.items.length === 0) return null;
  return (
    <div style={{ border: "1px solid #E2E8F0", borderRadius: 12, overflow: "hidden", background: "white" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "10px 14px", background: "#F8FAFC", borderBottom: "1px solid #E2E8F0", flexWrap: "wrap" }}>
        <span style={{ fontSize: 17 }}>{theme.icon}</span>
        <span style={{ fontSize: 13, fontWeight: 800, color: "#0F172A" }}>{theme.title}</span>
        <span style={{ flex: 1 }} />
        {theme.instructor.sources.map((s, i) => <SourceChip key={i} s={s} />)}
      </div>
      <div style={{ display: "flex", flexDirection: "column" }}>
        {theme.instructor.items.map((it, i) => {
          const t = TONE[it.tone];
          const rel = it.relevance && it.relevance !== "general" ? REL_BADGE[it.relevance] : undefined;
          return (
            <div key={i} style={{ padding: "10px 14px", borderTop: i === 0 ? "none" : "1px solid #F1F5F9", display: "flex", gap: 10, opacity: it.relevance === "excluded" ? 0.6 : 1 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: t.fg, marginTop: 6, flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: "#0F172A" }}>{it.label}</span>
                  {it.value && <span style={{ fontSize: 12.5, fontWeight: 800, color: "#4F46E5" }}>{it.value}</span>}
                  {rel && <span style={{ fontSize: 10, fontWeight: 700, color: rel.fg, background: rel.bg, borderRadius: 999, padding: "1px 7px" }}>{rel.label}</span>}
                </div>
                {it.detail && <div style={{ fontSize: 12, color: "#475569", marginTop: 2, lineHeight: 1.5 }}>{it.detail}</div>}
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 10.5, color: "#94A3B8", fontWeight: 600 }}>{it.source.label}</span>
                  {it.applies_if && it.applies_if.length > 0 && (
                    <span style={{ fontSize: 10, color: "#7C3AED", background: "#F5F3FF", borderRadius: 5, padding: "1px 6px" }}>si&nbsp;{it.applies_if.join(", ")}</span>
                  )}
                </div>
                {it.exceptions && (
                  <details style={{ marginTop: 4 }}>
                    <summary style={{ fontSize: 11, color: "#B45309", cursor: "pointer", fontWeight: 600, listStyle: "none" }}>Exceptions ›</summary>
                    <div style={{ fontSize: 11.5, color: "#92400E", marginTop: 3, lineHeight: 1.5 }}>{it.exceptions}</div>
                  </details>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function ParcelSynthese({ synthesis, audience }: { synthesis: ParcelSynthesisData; audience: "citizen" | "instructor" }) {
  const [open, setOpen] = useState(true);
  const themes = synthesis.themes.filter((t) =>
    audience === "citizen" ? t.citizen.points.length > 0 : t.instructor.items.length > 0,
  );
  if (themes.length === 0) return null;

  const c = synthesis.counts;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left", border: "none", background: "transparent", cursor: "pointer", padding: 0 }}
      >
        <span style={{ fontSize: 14, fontWeight: 800, color: "#1E1B4B" }}>
          {audience === "citizen" ? "En clair sur votre parcelle" : "Synthèse réglementaire par thème"}
        </span>
        {c.attention > 0 && <span style={{ fontSize: 10.5, fontWeight: 700, color: TONE.attention.fg, background: TONE.attention.bg, border: `1px solid ${TONE.attention.border}`, borderRadius: 999, padding: "1px 8px" }}>{c.attention} point{c.attention > 1 ? "s" : ""} d'attention</span>}
        {c.interdit > 0 && <span style={{ fontSize: 10.5, fontWeight: 700, color: TONE.interdit.fg, background: TONE.interdit.bg, border: `1px solid ${TONE.interdit.border}`, borderRadius: 999, padding: "1px 8px" }}>{c.interdit} interdiction{c.interdit > 1 ? "s" : ""}</span>}
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: "#6366F1", fontWeight: 700 }}>{open ? "Réduire" : "Déployer"} {open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {themes.map((t) =>
            audience === "citizen"
              ? <CitizenTheme key={t.key} theme={t} />
              : <InstructorTheme key={t.key} theme={t} />,
          )}
        </div>
      )}
    </div>
  );
}
