import { useEffect, useRef, useState } from "react";
import { renderLegalHtml } from "../utils/renderLegalHtml";

// Référence d'article (sans suffixe code), ex. "R431-2" ; et clé code "CU"/"CCH"/"CE".
type Props = {
  codeKey: string;
  num: string;
  // Label affiché — typiquement la référence brute "art. R431-2 CU".
  label: string;
};

type ArticlePayload = {
  code: string;
  article_ref: string;
  title: string | null;
  html: string | null;
  legifrance_id: string | null;
  source_url: string;
  fetched_at: string;
  license: string;
};

// Cache module-level pour ne pas re-fetcher quand l'utilisateur réouvre le popover.
const cache = new Map<string, Promise<ArticlePayload | null>>();

async function fetchArticle(codeKey: string, num: string): Promise<ArticlePayload | null> {
  const key = `${codeKey}/${num}`;
  let p = cache.get(key);
  if (!p) {
    p = fetch(`/api/public/legal-articles/${encodeURIComponent(codeKey)}/${encodeURIComponent(num)}`)
      .then(async (r) => {
        if (!r.ok) return null;
        return (await r.json()) as ArticlePayload;
      })
      .catch(() => null);
    cache.set(key, p);
  }
  return p;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
  } catch {
    return iso;
  }
}

export function ArticleLink({ codeKey, num, label }: Props) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<ArticlePayload | null>(null);
  const [loading, setLoading] = useState(false);
  const triggered = useRef(false);

  useEffect(() => {
    if (!open || triggered.current) return;
    triggered.current = true;
    setLoading(true);
    fetchArticle(codeKey, num).then((res) => {
      setData(res);
      setLoading(false);
    });
  }, [open, codeKey, num]);

  // Échap pour fermer
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const fallbackUrl = `https://www.legifrance.gouv.fr/search/code?query=${encodeURIComponent(num)}`;

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
        style={{
          background: "transparent",
          border: "none",
          padding: 0,
          font: "inherit",
          color: "#4F46E5",
          textDecoration: "underline",
          textDecorationStyle: "dotted",
          cursor: "pointer",
        }}
        aria-label={`Voir le texte de ${label}`}
      >
        {label}
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15, 23, 42, 0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
            zIndex: 1000,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "white",
              borderRadius: 14,
              maxWidth: 720,
              width: "100%",
              maxHeight: "85vh",
              overflowY: "auto",
              boxShadow: "0 20px 60px rgba(15, 23, 42, 0.25)",
              padding: "22px 26px",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, marginBottom: 14 }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#6366F1", letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 4 }}>
                  Source officielle — Légifrance
                </div>
                <div style={{ fontSize: 18, fontWeight: 700, color: "#0F172A" }}>
                  Article {num} · {codeNameOf(codeKey)}
                </div>
                {data?.title && (
                  <div style={{ fontSize: 13, color: "#475569", marginTop: 4 }}>{data.title}</div>
                )}
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Fermer"
                style={{
                  background: "#F1F5F9",
                  border: "none",
                  borderRadius: 8,
                  width: 32,
                  height: 32,
                  cursor: "pointer",
                  fontSize: 18,
                  color: "#475569",
                  flexShrink: 0,
                }}
              >
                ×
              </button>
            </div>

            {loading && (
              <div style={{ fontSize: 13, color: "#64748B", padding: "18px 0" }}>
                Chargement du texte officiel…
              </div>
            )}

            {!loading && data?.html && (
              <div style={{ fontSize: 14, color: "#1F2937", lineHeight: 1.6 }}>
                {renderLegalHtml(data.html, codeKey)}
              </div>
            )}

            {!loading && !data && (
              <div style={{ fontSize: 13, color: "#7F1D1D", background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 10, padding: "12px 14px" }}>
                Texte non disponible pour le moment.{" "}
                <a href={fallbackUrl} target="_blank" rel="noopener noreferrer" style={{ color: "#4F46E5" }}>
                  Consulter sur Légifrance ↗
                </a>
              </div>
            )}

            <div style={{ marginTop: 18, paddingTop: 14, borderTop: "1px solid #E2E8F0", fontSize: 11, color: "#94A3B8", display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
              <span>
                {data?.fetched_at ? `Mis à jour le ${formatDate(data.fetched_at)} · ` : ""}
                Licence ouverte v2.0 — Source : Légifrance (DILA)
              </span>
              <a
                href={data?.source_url ?? fallbackUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "#4F46E5", textDecoration: "none", fontWeight: 600 }}
              >
                Voir sur Légifrance ↗
              </a>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function codeNameOf(codeKey: string): string {
  switch (codeKey.toUpperCase()) {
    case "CU":  return "Code de l'urbanisme";
    case "CCH": return "Code de la construction et de l'habitation";
    case "CE":  return "Code de l'environnement";
    default:    return codeKey;
  }
}
