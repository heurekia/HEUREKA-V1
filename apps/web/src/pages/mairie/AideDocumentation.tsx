import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import { HelpArticleContent } from "../../components/HelpArticleContent";

interface ArticleLite {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  cover_image: string | null;
}
interface ReaderTheme {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  icon: string | null;
  articles: ArticleLite[];
}
interface ArticleFull {
  id: string;
  theme_id: string;
  title: string;
  excerpt: string | null;
  content_html: string;
  cover_image: string | null;
  published_at: string | null;
  updated_at: string;
  author_prenom: string | null;
  author_nom: string | null;
}

const C = {
  accent: "#4F46E5", text: "#0F172A", muted: "#64748B", light: "#94A3B8", border: "#E2E8F0", bg: "#F8FAFC",
};

// Lecteur de documentation (Centre d'aide agent). Modale plein écran : sommaire
// à gauche, article à droite. Le contenu est assaini avant rendu.
export function AideDocumentation({ initialQuery = "", onClose }: { initialQuery?: string; onClose: () => void }) {
  const [themes, setThemes] = useState<ReaderTheme[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState(initialQuery);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [article, setArticle] = useState<ArticleFull | null>(null);
  const [articleLoading, setArticleLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.get<ReaderTheme[]>("/mairie/help/sommaire")
      .then((data) => {
        if (cancelled) return;
        setThemes(data);
        // Sélectionne d'emblée le premier article (sauf si on arrive via une
        // recherche : on laisse alors l'agent voir la liste filtrée).
        if (!initialQuery) {
          const first = data.find((t) => t.articles.length > 0)?.articles[0];
          if (first) setSelectedId(first.id);
        }
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Chargement impossible"))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [initialQuery]);

  useEffect(() => {
    if (!selectedId) { setArticle(null); return; }
    let cancelled = false;
    setArticleLoading(true);
    api.get<ArticleFull>(`/mairie/help/articles/${selectedId}`)
      .then((a) => !cancelled && setArticle(a))
      .catch(() => !cancelled && setArticle(null))
      .finally(() => !cancelled && setArticleLoading(false));
    return () => { cancelled = true; };
  }, [selectedId]);

  // Filtre par titre/résumé sur l'ensemble du sommaire.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return themes;
    return themes
      .map((t) => ({ ...t, articles: t.articles.filter((a) => `${a.title} ${a.excerpt ?? ""}`.toLowerCase().includes(q)) }))
      .filter((t) => t.articles.length > 0 || t.title.toLowerCase().includes(q));
  }, [themes, query]);

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.55)", zIndex: 9000, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "white", borderRadius: 16, width: "100%", maxWidth: 1040, height: "88vh", display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 24px 70px rgba(0,0,0,0.3)" }}>
        {/* En-tête */}
        <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "16px 20px", borderBottom: `1px solid ${C.border}` }}>
          <span style={{ fontSize: 20 }}>📖</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.text }}>Documentation</div>
            <div style={{ fontSize: 12, color: C.light }}>Guides et tutoriels sur toutes les fonctionnalités</div>
          </div>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher…"
            style={{ width: 240, padding: "8px 12px", border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 13, outline: "none" }}
          />
          <button onClick={onClose} style={{ border: "none", background: "transparent", fontSize: 22, color: C.muted, cursor: "pointer", lineHeight: 1, padding: 4 }}>×</button>
        </div>

        <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
          {/* Sommaire */}
          <div style={{ width: 300, flexShrink: 0, borderRight: `1px solid ${C.border}`, overflowY: "auto", background: "#FCFCFD" }}>
            {loading ? (
              <div style={{ padding: 24, color: C.light, fontSize: 13, textAlign: "center" }}>Chargement…</div>
            ) : error ? (
              <div style={{ padding: 24, color: "#DC2626", fontSize: 13 }}>{error}</div>
            ) : filtered.length === 0 ? (
              <div style={{ padding: 24, color: C.light, fontSize: 13, textAlign: "center" }}>
                {query ? "Aucun résultat." : "La documentation arrive prochainement."}
              </div>
            ) : filtered.map((t) => (
              <div key={t.id} style={{ padding: "10px 0", borderBottom: `1px solid ${C.bg}` }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "2px 16px 6px" }}>
                  <span style={{ fontSize: 14 }}>{t.icon || "📄"}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: "0.04em" }}>{t.title}</span>
                </div>
                {t.articles.map((a) => (
                  <button key={a.id} onClick={() => setSelectedId(a.id)} style={{
                    display: "block", width: "100%", textAlign: "left", padding: "8px 16px 8px 38px", border: "none", cursor: "pointer",
                    background: selectedId === a.id ? "#EEF2FF" : "transparent",
                    borderLeft: selectedId === a.id ? `3px solid ${C.accent}` : "3px solid transparent",
                    fontSize: 13, color: selectedId === a.id ? C.accent : C.text, fontWeight: selectedId === a.id ? 600 : 400,
                  }}>
                    {a.title}
                  </button>
                ))}
              </div>
            ))}
          </div>

          {/* Article */}
          <div style={{ flex: 1, overflowY: "auto", padding: "28px 36px", minWidth: 0 }}>
            {articleLoading ? (
              <div style={{ color: C.light, fontSize: 14, textAlign: "center", paddingTop: 60 }}>Chargement de l'article…</div>
            ) : article ? (
              <article>
                {article.cover_image && (
                  <img src={article.cover_image} alt="" style={{ width: "100%", maxHeight: 280, objectFit: "cover", borderRadius: 12, marginBottom: 22 }} />
                )}
                <h1 style={{ fontSize: 26, fontWeight: 800, color: C.text, margin: "0 0 6px" }}>{article.title}</h1>
                {article.excerpt && <p style={{ fontSize: 15, color: C.muted, margin: "0 0 8px", lineHeight: 1.6 }}>{article.excerpt}</p>}
                <div style={{ fontSize: 12, color: C.light, marginBottom: 22, paddingBottom: 16, borderBottom: `1px solid ${C.bg}` }}>
                  {article.author_prenom && <>Par {article.author_prenom} {article.author_nom ?? ""} · </>}
                  Mis à jour le {new Date(article.updated_at).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}
                </div>
                <HelpArticleContent html={article.content_html} />
              </article>
            ) : (
              <div style={{ color: C.light, fontSize: 14, textAlign: "center", paddingTop: 80 }}>
                <div style={{ fontSize: 34, marginBottom: 10 }}>👈</div>
                Sélectionnez un article dans le sommaire.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
