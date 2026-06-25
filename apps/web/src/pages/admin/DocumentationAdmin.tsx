import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import { RichArticleEditor } from "../../components/RichArticleEditor";
import { HelpArticleContent } from "../../components/HelpArticleContent";

// ─── Types ──────────────────────────────────────────────────────────────────
interface ArticleLite {
  id: string;
  theme_id: string;
  title: string;
  slug: string;
  status: "draft" | "published";
  sort_order: number;
  view_count: number;
  updated_at: string;
}
interface Theme {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  icon: string | null;
  sort_order: number;
  is_published: boolean;
  articles: ArticleLite[];
}
interface ArticleFull {
  id: string;
  theme_id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  content_html: string;
  cover_image: string | null;
  status: "draft" | "published";
  view_count: number;
  published_at: string | null;
  updated_at: string;
}

const C = {
  accent: "#4F46E5", bg: "#F8FAFC", card: "#FFFFFF", border: "#E2E8F0",
  text: "#0F172A", muted: "#64748B", light: "#94A3B8", green: "#10B981",
  greenBg: "#ECFDF5", red: "#EF4444", redBg: "#FEF2F2", amber: "#B45309", amberBg: "#FFFBEB",
};

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

function Toast({ msg, kind, onClose }: { msg: string; kind: "ok" | "err"; onClose: () => void }) {
  useEffect(() => { const t = setTimeout(onClose, 3500); return () => clearTimeout(t); }, [onClose]);
  return (
    <div style={{ position: "fixed", bottom: 24, right: 24, zIndex: 9999, background: kind === "ok" ? C.green : C.red, color: "white", borderRadius: 12, padding: "12px 18px", boxShadow: "0 8px 24px rgba(0,0,0,0.15)", fontSize: 14, fontWeight: 600 }}>
      {kind === "ok" ? "✓ " : "✕ "}{msg}
    </div>
  );
}

// ─── Modale thème (création / édition) ──────────────────────────────────────
function ThemeModal({ initial, onClose, onSaved, notify }: {
  initial: Theme | null;
  onClose: () => void;
  onSaved: () => void;
  notify: (m: string, k: "ok" | "err") => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [icon, setIcon] = useState(initial?.icon ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [isPublished, setIsPublished] = useState(initial?.is_published ?? true);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!title.trim()) { notify("Le titre du thème est requis.", "err"); return; }
    setSaving(true);
    try {
      const body = { title: title.trim(), icon: icon.trim() || null, description: description.trim() || null, is_published: isPublished };
      if (initial) await api.patch(`/admin/help/themes/${initial.id}`, body);
      else await api.post("/admin/help/themes", body);
      notify(initial ? "Thème mis à jour." : "Thème créé.", "ok");
      onSaved();
      onClose();
    } catch (e) {
      notify(e instanceof Error ? e.message : "Erreur", "err");
    } finally { setSaving(false); }
  };

  const lbl = { fontSize: 12, fontWeight: 600, color: C.muted, display: "block", marginBottom: 6 } as const;
  const inp = { width: "100%", padding: "9px 12px", border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 14, outline: "none", boxSizing: "border-box" as const };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 8000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={onClose}>
      <div style={{ background: "white", borderRadius: 16, width: "100%", maxWidth: 480, boxShadow: "0 20px 60px rgba(0,0,0,0.25)" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ padding: "18px 22px", borderBottom: `1px solid ${C.border}`, fontSize: 17, fontWeight: 700, color: C.text }}>
          {initial ? "Modifier le thème" : "Nouveau thème"}
        </div>
        <div style={{ padding: 22, display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "flex", gap: 12 }}>
            <div style={{ width: 90 }}>
              <label style={lbl}>Icône</label>
              <input value={icon} onChange={(e) => setIcon(e.target.value)} placeholder="📁" maxLength={4} style={{ ...inp, textAlign: "center", fontSize: 20 }} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={lbl}>Titre du thème</label>
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="ex : Gestion des dossiers" style={inp} autoFocus />
            </div>
          </div>
          <div>
            <label style={lbl}>Description (optionnelle)</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Courte description affichée dans le sommaire" rows={2} style={{ ...inp, resize: "vertical", fontFamily: "inherit" }} />
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", fontSize: 14, color: C.text }}>
            <input type="checkbox" checked={isPublished} onChange={(e) => setIsPublished(e.target.checked)} />
            Thème visible par les agents
          </label>
        </div>
        <div style={{ padding: "16px 22px", borderTop: `1px solid ${C.border}`, display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button onClick={onClose} style={{ padding: "9px 18px", borderRadius: 8, border: `1px solid ${C.border}`, background: "white", color: C.text, cursor: "pointer", fontSize: 14, fontWeight: 600 }}>Annuler</button>
          <button onClick={save} disabled={saving} style={{ padding: "9px 18px", borderRadius: 8, border: "none", background: C.accent, color: "white", cursor: saving ? "not-allowed" : "pointer", fontSize: 14, fontWeight: 700, opacity: saving ? 0.7 : 1 }}>
            {saving ? "Enregistrement…" : "Enregistrer"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Éditeur d'article (panneau de droite) ──────────────────────────────────
function ArticleEditorPanel({ articleId, onChanged, onDeleted, notify }: {
  articleId: string;
  onChanged: () => void;
  onDeleted: () => void;
  notify: (m: string, k: "ok" | "err") => void;
}) {
  const [article, setArticle] = useState<ArticleFull | null>(null);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState("");
  const [excerpt, setExcerpt] = useState("");
  const [content, setContent] = useState("");
  const [cover, setCover] = useState<string | null>(null);
  const [status, setStatus] = useState<"draft" | "published">("draft");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [preview, setPreview] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setPreview(false);
    api.get<ArticleFull>(`/admin/help/articles/${articleId}`)
      .then((a) => {
        if (cancelled) return;
        setArticle(a);
        setTitle(a.title); setExcerpt(a.excerpt ?? ""); setContent(a.content_html ?? "");
        setCover(a.cover_image); setStatus(a.status); setDirty(false);
      })
      .catch((e) => notify(e instanceof Error ? e.message : "Chargement impossible", "err"))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [articleId, notify]);

  const mark = <T,>(setter: (v: T) => void) => (v: T) => { setter(v); setDirty(true); };

  const save = async (nextStatus?: "draft" | "published") => {
    if (!title.trim()) { notify("Le titre de l'article est requis.", "err"); return; }
    setSaving(true);
    try {
      const st = nextStatus ?? status;
      const updated = await api.patch<ArticleFull>(`/admin/help/articles/${articleId}`, {
        title: title.trim(), excerpt: excerpt.trim() || null, content_html: content, cover_image: cover, status: st,
      });
      setArticle(updated); setStatus(updated.status); setDirty(false);
      notify(st === "published" ? "Article publié." : "Article enregistré.", "ok");
      onChanged();
    } catch (e) {
      notify(e instanceof Error ? e.message : "Erreur d'enregistrement", "err");
    } finally { setSaving(false); }
  };

  const remove = async () => {
    if (!window.confirm("Supprimer définitivement cet article ?")) return;
    try {
      await api.delete(`/admin/help/articles/${articleId}`);
      notify("Article supprimé.", "ok");
      onDeleted();
    } catch (e) { notify(e instanceof Error ? e.message : "Erreur", "err"); }
  };

  const pickCover = async (file: File) => { setCover(await fileToDataUrl(file)); setDirty(true); };

  if (loading) return <div style={{ padding: 60, textAlign: "center", color: C.light }}>Chargement…</div>;
  if (!article) return null;

  const lbl = { fontSize: 12, fontWeight: 600, color: C.muted, display: "block", marginBottom: 6 } as const;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Barre d'actions */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 20, background: status === "published" ? C.greenBg : C.amberBg, color: status === "published" ? C.green : C.amber }}>
          {status === "published" ? "● Publié" : "● Brouillon"}
        </span>
        <span style={{ fontSize: 12, color: C.light }}>{article.view_count} vue{article.view_count > 1 ? "s" : ""}</span>
        {dirty && <span style={{ fontSize: 12, color: C.amber }}>Modifications non enregistrées</span>}
        <div style={{ flex: 1 }} />
        <button onClick={() => setPreview((p) => !p)} style={{ padding: "8px 14px", borderRadius: 8, border: `1px solid ${C.border}`, background: preview ? "#EEF2FF" : "white", color: preview ? C.accent : C.text, cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
          {preview ? "← Éditer" : "Aperçu"}
        </button>
        <button onClick={remove} style={{ padding: "8px 14px", borderRadius: 8, border: `1px solid ${C.border}`, background: "white", color: C.red, cursor: "pointer", fontSize: 13, fontWeight: 600 }}>Supprimer</button>
        {status === "published" ? (
          <button onClick={() => save("draft")} disabled={saving} style={{ padding: "8px 14px", borderRadius: 8, border: `1px solid ${C.border}`, background: "white", color: C.text, cursor: "pointer", fontSize: 13, fontWeight: 600 }}>Dépublier</button>
        ) : (
          <button onClick={() => save("published")} disabled={saving} style={{ padding: "8px 14px", borderRadius: 8, border: "none", background: C.green, color: "white", cursor: "pointer", fontSize: 13, fontWeight: 700 }}>Publier</button>
        )}
        <button onClick={() => save()} disabled={saving} style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: C.accent, color: "white", cursor: saving ? "not-allowed" : "pointer", fontSize: 13, fontWeight: 700, opacity: saving ? 0.7 : 1 }}>
          {saving ? "…" : "Enregistrer"}
        </button>
      </div>

      {preview ? (
        <div style={{ background: "white", border: `1px solid ${C.border}`, borderRadius: 12, padding: "28px 32px" }}>
          {cover && <img src={cover} alt="" style={{ width: "100%", maxHeight: 260, objectFit: "cover", borderRadius: 10, marginBottom: 20 }} />}
          <h1 style={{ fontSize: 26, fontWeight: 800, color: C.text, margin: "0 0 8px" }}>{title || "Sans titre"}</h1>
          {excerpt && <p style={{ fontSize: 15, color: C.muted, margin: "0 0 20px" }}>{excerpt}</p>}
          <HelpArticleContent html={content} />
        </div>
      ) : (
        <>
          <div style={{ background: "white", border: `1px solid ${C.border}`, borderRadius: 12, padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <label style={lbl}>Titre de l'article</label>
              <input value={title} onChange={(e) => mark(setTitle)(e.target.value)} placeholder="Titre de l'article" style={{ width: "100%", padding: "10px 12px", border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 16, fontWeight: 600, outline: "none", boxSizing: "border-box" }} />
            </div>
            <div>
              <label style={lbl}>Chapô / résumé (optionnel)</label>
              <textarea value={excerpt} onChange={(e) => mark(setExcerpt)(e.target.value)} placeholder="Phrase d'introduction affichée dans le sommaire" rows={2} style={{ width: "100%", padding: "9px 12px", border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 14, outline: "none", resize: "vertical", fontFamily: "inherit", boxSizing: "border-box" }} />
            </div>
            <div>
              <label style={lbl}>Image de couverture (optionnelle)</label>
              {cover ? (
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <img src={cover} alt="" style={{ width: 120, height: 70, objectFit: "cover", borderRadius: 8, border: `1px solid ${C.border}` }} />
                  <button onClick={() => { setCover(null); setDirty(true); }} style={{ padding: "7px 12px", borderRadius: 8, border: `1px solid ${C.border}`, background: "white", color: C.red, cursor: "pointer", fontSize: 13 }}>Retirer</button>
                </div>
              ) : (
                <label style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "8px 14px", borderRadius: 8, border: `1px dashed ${C.border}`, background: C.bg, color: C.muted, cursor: "pointer", fontSize: 13 }}>
                  + Ajouter une image
                  <input type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) void pickCover(f); e.target.value = ""; }} />
                </label>
              )}
            </div>
          </div>

          <div>
            <label style={lbl}>Contenu</label>
            <RichArticleEditor content={content} onChange={mark(setContent)} placeholder="Rédigez l'article : titres, listes, images, vidéos…" />
          </div>
        </>
      )}
    </div>
  );
}

// ─── Écran principal ────────────────────────────────────────────────────────
export function DocumentationAdmin() {
  const [themes, setThemes] = useState<Theme[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedArticleId, setSelectedArticleId] = useState<string | null>(null);
  const [themeModal, setThemeModal] = useState<{ open: boolean; theme: Theme | null }>({ open: false, theme: null });
  const [toast, setToast] = useState<{ msg: string; kind: "ok" | "err" } | null>(null);
  const [busy, setBusy] = useState(false);

  const notify = (msg: string, kind: "ok" | "err") => setToast({ msg, kind });

  const load = useMemo(() => async () => {
    try {
      const data = await api.get<Theme[]>("/admin/help/themes");
      setThemes(data);
    } catch (e) {
      notify(e instanceof Error ? e.message : "Chargement impossible", "err");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const totalArticles = themes.reduce((n, t) => n + t.articles.length, 0);

  const addArticle = async (themeId: string) => {
    setBusy(true);
    try {
      const a = await api.post<ArticleFull>("/admin/help/articles", { theme_id: themeId, title: "Nouvel article" });
      await load();
      setSelectedArticleId(a.id);
    } catch (e) { notify(e instanceof Error ? e.message : "Erreur", "err"); }
    finally { setBusy(false); }
  };

  const deleteTheme = async (t: Theme) => {
    const extra = t.articles.length ? ` et ses ${t.articles.length} article(s)` : "";
    if (!window.confirm(`Supprimer le thème « ${t.title} »${extra} ?`)) return;
    try {
      await api.delete(`/admin/help/themes/${t.id}`);
      if (selectedArticleId && t.articles.some((a) => a.id === selectedArticleId)) setSelectedArticleId(null);
      notify("Thème supprimé.", "ok");
      await load();
    } catch (e) { notify(e instanceof Error ? e.message : "Erreur", "err"); }
  };

  const moveTheme = async (idx: number, dir: -1 | 1) => {
    const next = idx + dir;
    if (next < 0 || next >= themes.length) return;
    const ids = themes.map((t) => t.id);
    [ids[idx], ids[next]] = [ids[next] as string, ids[idx] as string];
    setThemes((prev) => { const c = [...prev]; [c[idx], c[next]] = [c[next] as Theme, c[idx] as Theme]; return c; });
    try { await api.put("/admin/help/themes/reorder", { ids }); } catch { void load(); }
  };

  const moveArticle = async (theme: Theme, idx: number, dir: -1 | 1) => {
    const next = idx + dir;
    if (next < 0 || next >= theme.articles.length) return;
    const ids = theme.articles.map((a) => a.id);
    [ids[idx], ids[next]] = [ids[next] as string, ids[idx] as string];
    try { await api.put("/admin/help/articles/reorder", { theme_id: theme.id, ids }); await load(); }
    catch (e) { notify(e instanceof Error ? e.message : "Erreur", "err"); }
  };

  return (
    <div style={{ marginLeft: 240, minHeight: "100vh", background: C.bg }}>
      <div style={{ maxWidth: 1320, margin: "0 auto", padding: "28px 32px" }}>
        <div style={{ marginBottom: 20 }}>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: C.text, margin: 0 }}>Centre d'aide — Documentation</h1>
          <p style={{ color: C.muted, fontSize: 13, marginTop: 4 }}>
            Rédigez les articles d'aide consultés par les agents. Organisez-les par thèmes (sommaire).
            {!loading && <> · {themes.length} thème{themes.length > 1 ? "s" : ""}, {totalArticles} article{totalArticles > 1 ? "s" : ""}</>}
          </p>
        </div>

        <div style={{ display: "flex", gap: 20, alignItems: "flex-start" }}>
          {/* Sommaire */}
          <div style={{ width: 320, flexShrink: 0 }}>
            <div style={{ background: "white", border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden" }}>
              <div style={{ padding: "14px 16px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: C.text, textTransform: "uppercase", letterSpacing: "0.04em" }}>Sommaire</span>
                <button onClick={() => setThemeModal({ open: true, theme: null })} style={{ padding: "5px 10px", borderRadius: 7, border: "none", background: C.accent, color: "white", cursor: "pointer", fontSize: 12, fontWeight: 700 }}>+ Thème</button>
              </div>
              <div style={{ maxHeight: "calc(100vh - 200px)", overflowY: "auto" }}>
                {loading ? (
                  <div style={{ padding: 24, textAlign: "center", color: C.light, fontSize: 13 }}>Chargement…</div>
                ) : themes.length === 0 ? (
                  <div style={{ padding: 24, textAlign: "center", color: C.light, fontSize: 13 }}>Aucun thème. Créez-en un pour commencer.</div>
                ) : themes.map((t, ti) => (
                  <div key={t.id} style={{ borderBottom: `1px solid ${C.bg}` }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 12px", background: "#FCFCFD" }}>
                      <span style={{ fontSize: 16, width: 22, textAlign: "center" }}>{t.icon || "📄"}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: C.text, display: "flex", alignItems: "center", gap: 6 }}>
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.title}</span>
                          {!t.is_published && <span title="Masqué des agents" style={{ fontSize: 9, color: C.amber, border: `1px solid ${C.amber}`, borderRadius: 4, padding: "0 4px" }}>masqué</span>}
                        </div>
                        <div style={{ fontSize: 11, color: C.light }}>{t.articles.length} article{t.articles.length > 1 ? "s" : ""}</div>
                      </div>
                      <button title="Monter" onClick={() => moveTheme(ti, -1)} style={iconBtn}>↑</button>
                      <button title="Descendre" onClick={() => moveTheme(ti, 1)} style={iconBtn}>↓</button>
                      <button title="Modifier le thème" onClick={() => setThemeModal({ open: true, theme: t })} style={iconBtn}>✎</button>
                      <button title="Supprimer le thème" onClick={() => deleteTheme(t)} style={{ ...iconBtn, color: C.red }}>🗑</button>
                    </div>
                    {t.articles.map((a, ai) => (
                      <div key={a.id} onClick={() => setSelectedArticleId(a.id)} style={{
                        display: "flex", alignItems: "center", gap: 6, padding: "8px 12px 8px 26px", cursor: "pointer",
                        background: selectedArticleId === a.id ? "#EEF2FF" : "transparent",
                        borderLeft: selectedArticleId === a.id ? `3px solid ${C.accent}` : "3px solid transparent",
                      }}>
                        <span style={{ width: 6, height: 6, borderRadius: "50%", flexShrink: 0, background: a.status === "published" ? C.green : C.amber }} />
                        <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: selectedArticleId === a.id ? C.accent : C.text, fontWeight: selectedArticleId === a.id ? 600 : 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.title}</span>
                        <button title="Monter" onClick={(e) => { e.stopPropagation(); void moveArticle(t, ai, -1); }} style={iconBtnSm}>↑</button>
                        <button title="Descendre" onClick={(e) => { e.stopPropagation(); void moveArticle(t, ai, 1); }} style={iconBtnSm}>↓</button>
                      </div>
                    ))}
                    <div style={{ padding: "6px 12px 10px 26px" }}>
                      <button onClick={() => addArticle(t.id)} disabled={busy} style={{ fontSize: 12, color: C.accent, background: "none", border: "none", cursor: "pointer", fontWeight: 600, padding: 0 }}>+ Ajouter un article</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Éditeur */}
          <div style={{ flex: 1, minWidth: 0 }}>
            {selectedArticleId ? (
              <ArticleEditorPanel
                key={selectedArticleId}
                articleId={selectedArticleId}
                onChanged={() => void load()}
                onDeleted={() => { setSelectedArticleId(null); void load(); }}
                notify={notify}
              />
            ) : (
              <div style={{ background: "white", border: `1px dashed ${C.border}`, borderRadius: 12, padding: "80px 24px", textAlign: "center", color: C.light }}>
                <div style={{ fontSize: 34, marginBottom: 10 }}>📖</div>
                <div style={{ fontSize: 15, fontWeight: 600, color: C.muted }}>Sélectionnez un article à modifier</div>
                <div style={{ fontSize: 13, marginTop: 4 }}>ou créez-en un nouveau depuis le sommaire.</div>
              </div>
            )}
          </div>
        </div>
      </div>

      {themeModal.open && (
        <ThemeModal initial={themeModal.theme} onClose={() => setThemeModal({ open: false, theme: null })} onSaved={() => void load()} notify={notify} />
      )}
      {toast && <Toast msg={toast.msg} kind={toast.kind} onClose={() => setToast(null)} />}
    </div>
  );
}

const iconBtn: React.CSSProperties = { width: 22, height: 22, border: "none", background: "transparent", borderRadius: 5, cursor: "pointer", color: "#94A3B8", fontSize: 12, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 };
const iconBtnSm: React.CSSProperties = { ...iconBtn, width: 18, height: 18, fontSize: 10 };
