import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { Routes, Route, Navigate, useNavigate, useLocation, useParams, useSearchParams } from "react-router-dom";
import { api, ApiError } from "../../lib/api";
import { normalizeForSearch } from "../../lib/utils";
import { useAuth, hasPermission } from "../../hooks/useAuth";
import { MfaSettings } from "../../components/MfaSettings";
import { TemplateManagerPanel, CommuneLetterheadPanel } from "./MairieCourrierScreen";
import { fmtDate, COMMUNE_INSEE, notifIcon, notifColor, relTime, resolveCommune, type ApiNotif, type ApiDossier, type DossierInfo, type WorkflowMeta, type DelaiBreakdown } from "./shared";
import {
  HomeIcon, FolderIcon, CalendarIcon, MessageIcon, MapIcon, ChartIcon, SettingsIcon,
  BellIcon, SearchIcon, PlusIcon, HelpIcon, BuildingIcon, ChevronDownIcon,
  PenIcon,
} from "./ui";
import { DashboardScreen } from "./DashboardScreen";
import { DossiersScreen } from "./DossiersScreen";
import { MessageScreen } from "./MessageScreen";
import { CarteScreen } from "./CarteScreen";
import { ReglementationScreen } from "./ReglementationScreen";
import { DossierDetailScreen } from "./DossierDetailScreen";
import { CalendrierScreen } from "./CalendrierScreen";
import { StatistiquesScreen } from "./StatistiquesScreen";
import { NouveauDossierModal } from "./NouveauDossierModal";
import { ParametresScreen } from "./ParametresScreen";
import { AideDocumentation } from "./AideDocumentation";

// Adresse de l'équipe support (boutons « Chat support » / « Contacter le support »).
const SUPPORT_EMAIL = "support@heurekia.com";

const NAV_ITEMS = [
  { label: "Tableau de bord", icon: HomeIcon, path: "/mairie" },
  { label: "Dossiers", icon: FolderIcon, path: "/mairie/dossiers" },
  { label: "Calendrier", icon: CalendarIcon, path: "/mairie/calendrier" },
  { label: "Messagerie", icon: MessageIcon, path: "/mairie/messagerie" },
  { label: "Carte", icon: MapIcon, path: "/mairie/carte" },
  { label: "Statistiques", icon: ChartIcon, path: "/mairie/statistiques" },
  { label: "Signatures", icon: PenIcon, path: "/mairie/signatures" },
  { label: "Paramètres", icon: SettingsIcon, path: "/mairie/parametres" },
];

const LABEL_TO_PATH: Record<string, string> = Object.fromEntries(NAV_ITEMS.map(n => [n.label, n.path]));
LABEL_TO_PATH["Infos Perso"] = "/mairie/profil";

// Permissions requises pour accéder à chaque section (au moins une suffit). Les
// sections absentes (Signatures, Infos Perso) ne sont pas gérées par
// permission : « Signatures » dépend de l'habilitation signataire, « Infos
// Perso » est toujours accessible. Un agent sans rôle personnalisé a
// `permissions === null` → hasPermission renvoie toujours true (accès complet).
const NAV_PERMS: Record<string, string[]> = {
  "/mairie": ["dashboard"],
  "/mairie/dossiers": ["dossiers.read"],
  "/mairie/calendrier": ["calendrier.read"],
  "/mairie/messagerie": ["messagerie.read"],
  "/mairie/carte": ["zones.read"],
  "/mairie/statistiques": ["stats"],
  "/mairie/parametres": ["parametres", "utilisateurs.read", "utilisateurs.manage", "signataires.read", "signataires.manage"],
};

function navAllowed(path: string, user: Parameters<typeof hasPermission>[0]): boolean {
  const req = NAV_PERMS[path];
  if (!req) return true;
  return req.some(p => hasPermission(user, p));
}

// Garde-fou de route : protège un écran derrière ses permissions. En cas
// d'accès direct (deep-link) à une section interdite, redirige vers le premier
// onglet autorisé — ou « Infos Perso » en dernier recours.
function RequirePerm({ perms, children }: { perms: string[]; children: React.ReactElement }) {
  const { user } = useAuth();
  if (perms.some(p => hasPermission(user, p))) return children;
  const fallback = NAV_ITEMS.find(n => NAV_PERMS[n.path]?.some(p => hasPermission(user, p)))?.path ?? "/mairie/profil";
  return <Navigate to={fallback} replace />;
}

function Sidebar({ active, setActive, commune, setCommune, messageBadge = 0, signaturesBadge = 0, isSignataire = false, communes = [] }: { active: string; setActive: (s: string) => void; commune: string; setCommune: (c: string) => void; messageBadge?: number; signaturesBadge?: number; isSignataire?: boolean; communes?: string[] }) {
  const [showDrop, setShowDrop] = useState(false);
  const [search, setSearch] = useState("");
  const { logout, user } = useAuth();
  const manyCommunes = communes.length > 5;
  const normalizedSearch = normalizeForSearch(search);
  const filtered = manyCommunes
    ? communes.filter(c => normalizeForSearch(c).includes(normalizedSearch))
    : communes;
  const visibleNavItems = NAV_ITEMS.filter(item => {
    // « Signatures » dépend de l'habilitation signataire, pas d'une permission.
    if (item.label === "Signatures") return isSignataire;
    // Les autres sections sont masquées si le rôle personnalisé ne les autorise pas.
    return navAllowed(item.path, user);
  });
  return (
    <aside style={{
      width: 200, minWidth: 200, background: "#0f1629",
      display: "flex", flexDirection: "column",
      height: "100vh", position: "fixed", left: 0, top: 0, zIndex: 50,
    }}>
      {/* Logo */}
      <div style={{ padding: "20px 16px 16px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
          <div style={{ width: 34, height: 34, flexShrink: 0 }}>
            <svg viewBox="0 0 34 34" fill="none">
              <polygon points="17,2 31,9.5 31,24.5 17,32 3,24.5 3,9.5" fill="#4F46E5" opacity="0.15" stroke="#4F46E5" strokeWidth="1.5"/>
              <polygon points="17,7 27,12.5 27,23.5 17,29 7,23.5 7,12.5" fill="#4F46E5" opacity="0.3"/>
              <polygon points="17,11 23,14.5 23,21.5 17,25 11,21.5 11,14.5" fill="#4F46E5"/>
              <text x="17" y="21" textAnchor="middle" fontSize="9" fontWeight="800" fill="white" fontFamily="sans-serif">H</text>
            </svg>
          </div>
          <span style={{ color: "white", fontWeight: 800, fontSize: 15, letterSpacing: "0.04em" }}>HEUREKIA</span>
        </div>
        {/* Commune selector */}
        {communes.length > 0 && (
          <div style={{ position: "relative" }}>
            <div onClick={() => { setShowDrop(!showDrop); setSearch(""); }} style={{ background: "rgba(255,255,255,0.06)", borderRadius: 8, padding: "8px 10px", cursor: communes.length > 1 ? "pointer" : "default", display: "flex", alignItems: "center", gap: 8 }}>
              <BuildingIcon size={14} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 10, color: "#64748b", lineHeight: 1 }}>Commune</div>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#e2e8f0", lineHeight: 1.4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{commune || "—"}</div>
              </div>
              {communes.length > 1 && <ChevronDownIcon size={12} />}
            </div>
            {showDrop && communes.length > 1 && (
              <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, background: "#1a2540", borderRadius: 8, border: "1px solid rgba(255,255,255,0.1)", boxShadow: "0 8px 24px rgba(0,0,0,0.3)", zIndex: 200, overflow: "hidden" }}>
                {manyCommunes && (
                  <div style={{ padding: "8px 10px", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
                    <input
                      autoFocus
                      value={search}
                      onChange={e => setSearch(e.target.value)}
                      placeholder="Rechercher…"
                      style={{ width: "100%", background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 6, padding: "5px 8px", color: "#e2e8f0", fontSize: 12, outline: "none", boxSizing: "border-box" as const }}
                    />
                  </div>
                )}
                <div style={{ maxHeight: 220, overflowY: "auto" }}>
                  {filtered.length === 0 && (
                    <div style={{ padding: "10px 12px", fontSize: 12, color: "#64748b" }}>Aucun résultat</div>
                  )}
                  {filtered.map(c => (
                    <button key={c} onClick={() => { const changed = c !== commune; setCommune(c); setShowDrop(false); setSearch(""); if (changed) setActive("Tableau de bord"); }} style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", width: "100%", border: "none", background: "none", cursor: "pointer", textAlign: "left" as const, fontSize: 12, color: c === commune ? "#818cf8" : "#94a3b8", fontWeight: c === commune ? 600 : 400 }}>
                      <BuildingIcon size={12} />
                      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c}</span>
                      {c === commune && <span style={{ color: "#818cf8", flexShrink: 0 }}>✓</span>}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <nav style={{ flex: 1, padding: "4px 10px", overflowY: "auto" }}>
        {visibleNavItems.map(({ label, icon: Icon }) => {
          const isActive = active === label;
          const badge = label === "Messagerie" ? messageBadge : label === "Signatures" ? signaturesBadge : 0;
          return (
            <button key={label} onClick={() => setActive(label)} style={{
              width: "100%", border: "none",
              background: isActive ? "#4F46E5" : "transparent",
              display: "flex", alignItems: "center", gap: 10,
              padding: "9px 12px", borderRadius: 8, marginBottom: 2,
              color: isActive ? "white" : "#94a3b8",
              fontSize: 13, fontWeight: isActive ? 600 : 400,
              cursor: "pointer", transition: "all 0.12s", textAlign: "left",
            }}
              onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = "rgba(255,255,255,0.05)"; }}
              onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = "transparent"; }}
            >
              <Icon size={16} />
              <span style={{ flex: 1 }}>{label}</span>
              {badge > 0 && (
                <span style={{ background: isActive ? "rgba(255,255,255,0.25)" : "#4F46E5", color: "white", fontSize: 10, fontWeight: 700, borderRadius: 10, padding: "1px 6px", minWidth: 18, textAlign: "center" }}>
                  {badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <div style={{ borderTop: "1px solid rgba(255,255,255,0.07)", padding: "12px 16px", display: "flex", alignItems: "center", gap: 10 }}>
        <div onClick={() => setActive("Infos Perso")} style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 0, cursor: "pointer" }}>
          <div style={{ width: 34, height: 34, background: "linear-gradient(135deg, #4F46E5, #7C3AED)", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, color: "white", flexShrink: 0 }}>
            {user ? `${user.prenom[0] ?? ""}${user.nom[0] ?? ""}`.toUpperCase() : "?"}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ color: "white", fontSize: 12, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user ? `${user.prenom} ${user.nom[0]}.` : "—"}</div>
            <div style={{ color: "#64748b", fontSize: 11 }}>{user?.role === "instructeur" ? "Instructeur" : user?.role === "admin" ? "Admin" : "Mairie"}</div>
          </div>
        </div>
        <button
          onClick={logout}
          title="Déconnexion"
          style={{ background: "none", border: "none", cursor: "pointer", color: "#64748b", padding: 4, borderRadius: 6, display: "flex", alignItems: "center", flexShrink: 0 }}
          onMouseEnter={e => (e.currentTarget.style.color = "#EF4444")}
          onMouseLeave={e => (e.currentTarget.style.color = "#64748b")}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
          </svg>
        </button>
      </div>
    </aside>
  );
}


// ── Assistant d'aide (« ? » de la barre du haut) ──────────────────────────────
// Chat connecté à POST /api/mairie/assistant (SSE). Usage prioritaire :
// « Comment faire… » sur l'utilisation de l'espace mairie ; secondairement,
// questions techniques. Remplace l'ancien placeholder « Assistant FAQ ».

function faqRenderInline(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("**")) parts.push(<strong key={key++}>{tok.slice(2, -2)}</strong>);
    else parts.push(<code key={key++} style={{ background: "#F1F5F9", borderRadius: 4, padding: "1px 5px", fontSize: 11.5, fontFamily: "ui-monospace, monospace" }}>{tok.slice(1, -1)}</code>);
    last = m.index + tok.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

function FaqRichText({ text }: { text: string }) {
  const lines = text.split("\n");
  const blocks: React.ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (!list) return;
    const items = list.items.map((it, i) => <li key={i} style={{ marginBottom: 3 }}>{faqRenderInline(it)}</li>);
    blocks.push(
      list.ordered
        ? <ol key={`b${blocks.length}`} style={{ margin: "4px 0", paddingLeft: 18 }}>{items}</ol>
        : <ul key={`b${blocks.length}`} style={{ margin: "4px 0", paddingLeft: 18 }}>{items}</ul>,
    );
    list = null;
  };
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    const ul = /^\s*[-*•]\s+(.*)$/.exec(line);
    if (ol) { if (!list || !list.ordered) { flush(); list = { ordered: true, items: [] }; } list.items.push(ol[1] ?? ""); continue; }
    if (ul) { if (!list || list.ordered) { flush(); list = { ordered: false, items: [] }; } list.items.push(ul[1] ?? ""); continue; }
    flush();
    if (line.trim() === "") continue;
    blocks.push(<p key={`b${blocks.length}`} style={{ margin: "0 0 6px" }}>{faqRenderInline(line)}</p>);
  }
  flush();
  return <>{blocks}</>;
}

type FaqTurn = { role: "user" | "assistant"; content: string };

function faqSetLastAssistant(list: FaqTurn[], content: string): FaqTurn[] {
  const copy = list.slice();
  for (let i = copy.length - 1; i >= 0; i--) {
    const item = copy[i];
    if (item && item.role === "assistant") { copy[i] = { ...item, content }; break; }
  }
  return copy;
}

function FaqAssistant() {
  const [messages, setMessages] = useState<FaqTurn[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const messagesRef = useRef<FaqTurn[]>(messages);
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  useEffect(() => {
    api.get<{ suggestions: string[] }>("/mairie/assistant/suggestions")
      .then((d) => setSuggestions(d.suggestions ?? []))
      .catch(() => { /* l'UI fonctionne sans suggestions */ });
  }, []);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  const send = useCallback(async (raw: string) => {
    const question = raw.trim();
    if (!question || streaming) return;
    setError(null);
    setInput("");
    const history = messagesRef.current.map((m) => ({ role: m.role, content: m.content }));
    setMessages((prev) => [...prev, { role: "user", content: question }, { role: "assistant", content: "" }]);
    setStreaming(true);
    const controller = new AbortController();
    abortRef.current = controller;
    let acc = "";
    let streamErr: string | null = null;

    try {
      const res = await fetch("/api/mairie/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ question, history }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? `Erreur ${res.status}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buf.indexOf("\n\n")) >= 0) {
          const chunk = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          for (const ln of chunk.split("\n")) {
            if (!ln.startsWith("data:")) continue;
            const data = ln.slice(5).trim();
            if (!data) continue;
            let evt: { type?: string; text?: string; message?: string };
            try { evt = JSON.parse(data); } catch { continue; }
            if (evt.type === "delta" && typeof evt.text === "string") {
              acc += evt.text;
              setMessages((prev) => faqSetLastAssistant(prev, acc));
            } else if (evt.type === "error") {
              streamErr = evt.message ?? "Erreur de l'assistant.";
            }
          }
        }
      }
      if (streamErr && !acc) throw new Error(streamErr);
    } catch (err) {
      const aborted = err instanceof DOMException && err.name === "AbortError";
      if (!aborted) setError(err instanceof Error ? err.message : "Échec de l'assistant — réessayez.");
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        return last && last.role === "assistant" && last.content === "" ? prev.slice(0, -1) : prev;
      });
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }, [streaming]);

  const lastTurn = messages[messages.length - 1];
  const showTyping = streaming && lastTurn?.role === "assistant" && lastTurn.content === "";

  return (
    <div style={{ display: "flex", flexDirection: "column", maxHeight: 520 }}>
      <style>{`@keyframes faqDots { 0%, 80%, 100% { opacity: 0.25; } 40% { opacity: 1; } }`}</style>
      {/* Header */}
      <div style={{ padding: "12px 16px", borderBottom: "1px solid #F1F5F9", display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#0F172A", marginBottom: 2 }}>Assistant d'aide ✨</div>
          <div style={{ fontSize: 11, color: "#94a3b8" }}>Comment faire ? · Questions techniques</div>
        </div>
        {messages.length > 0 && (
          <button onClick={() => { abortRef.current?.abort(); setMessages([]); setError(null); }} title="Nouvelle conversation"
            style={{ border: "1px solid #E2E8F0", background: "white", color: "#64748b", cursor: "pointer", fontSize: 11, fontWeight: 600, borderRadius: 6, padding: "4px 8px" }}>
            Effacer
          </button>
        )}
      </div>

      {/* Messages */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: 12, minHeight: 120, maxHeight: 360 }}>
        {messages.length === 0 && (
          <div>
            <div style={{ fontSize: 12, color: "#64748b", lineHeight: 1.6, marginBottom: 12 }}>
              Posez une question sur l'utilisation de l'espace mairie (<strong>« Comment faire… »</strong>) ou une question technique.
            </div>
            {suggestions.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {suggestions.map((s) => (
                  <button key={s} onClick={() => send(s)}
                    style={{ textAlign: "left", border: "1px solid #E2E8F0", background: "white", borderRadius: 9, padding: "8px 10px", fontSize: 12, color: "#374151", cursor: "pointer", lineHeight: 1.4 }}>
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} style={{ display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start", marginBottom: 9 }}>
            <div style={{
              maxWidth: "88%", padding: "8px 11px", borderRadius: 11, fontSize: 12.5, lineHeight: 1.55,
              background: m.role === "user" ? "#4F46E5" : "#F8FAFC",
              color: m.role === "user" ? "white" : "#1e293b",
              border: m.role === "user" ? "none" : "1px solid #EEF1F5",
              borderBottomRightRadius: m.role === "user" ? 3 : 11,
              borderBottomLeftRadius: m.role === "user" ? 11 : 3,
              wordBreak: "break-word",
            }}>
              {m.role === "assistant" ? <FaqRichText text={m.content} /> : m.content}
            </div>
          </div>
        ))}

        {showTyping && (
          <div style={{ display: "flex", justifyContent: "flex-start" }}>
            <div style={{ background: "#F8FAFC", border: "1px solid #EEF1F5", borderRadius: 11, borderBottomLeftRadius: 3, padding: "10px 13px", display: "flex", gap: 4 }}>
              {[0, 1, 2].map((d) => (
                <span key={d} style={{ width: 6, height: 6, borderRadius: "50%", background: "#94a3b8", animation: `faqDots 1.2s infinite ${d * 0.2}s` }} />
              ))}
            </div>
          </div>
        )}

        {error && (
          <div style={{ background: "#FEF2F2", color: "#DC2626", border: "1px solid #FCA5A5", borderRadius: 9, padding: "8px 11px", fontSize: 11.5, marginTop: 4 }}>{error}</div>
        )}
      </div>

      {/* Saisie */}
      <div style={{ borderTop: "1px solid #F1F5F9", padding: 10 }}>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 6 }}>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }}
            placeholder="Ex : Comment demander des pièces ?"
            rows={1}
            autoFocus
            style={{ flex: 1, resize: "none", maxHeight: 88, minHeight: 36, padding: "8px 10px", border: "1px solid #E2E8F0", borderRadius: 9, fontSize: 12.5, fontFamily: "inherit", outline: "none", color: "#374151", lineHeight: 1.4 }}
            onFocus={(e) => { e.target.style.borderColor = "#4F46E5"; }}
            onBlur={(e) => { e.target.style.borderColor = "#E2E8F0"; }}
          />
          {streaming ? (
            <button onClick={() => abortRef.current?.abort()} title="Arrêter" style={{ flexShrink: 0, width: 36, height: 36, borderRadius: 9, border: "none", background: "#F1F5F9", color: "#64748b", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span style={{ width: 10, height: 10, background: "#64748b", borderRadius: 2, display: "block" }} />
            </button>
          ) : (
            <button onClick={() => send(input)} disabled={!input.trim()} title="Envoyer"
              style={{ flexShrink: 0, width: 36, height: 36, borderRadius: 9, border: "none", background: input.trim() ? "linear-gradient(135deg,#4F46E5,#6366F1)" : "#E2E8F0", color: "white", cursor: input.trim() ? "pointer" : "default", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15 }}>
              →
            </button>
          )}
        </div>
        <div style={{ fontSize: 9.5, color: "#cbd5e1", marginTop: 5, textAlign: "center" }}>Réponses générées par IA — vérifiez les actions sensibles.</div>
      </div>
    </div>
  );
}

function Topbar({ buttonLabel = "Nouveau dossier", onNewDossier, navigate, onDossierClick, commune = "", communes = [], setCommune, onViewAllNotifications }: { title?: string; buttonLabel?: string; onNewDossier?: () => void; navigate?: (s: string) => void; onDossierClick?: (d: DossierInfo) => void; commune?: string; communes?: string[]; setCommune?: (c: string) => void; onViewAllNotifications?: () => void }) {
  const routerNav = useNavigate();
  const [showNotifs, setShowNotifs] = useState(false);
  const [showFAQ, setShowFAQ] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchResults, setSearchResults] = useState<ApiDossier[]>([]);
  const [apiNotifs, setApiNotifs] = useState<ApiNotif[]>([]);

  const loadNotifs = () => {
    api.get<ApiNotif[]>("/notifications").then(setApiNotifs).catch(() => {});
  };

  useEffect(() => { loadNotifs(); }, []);

  const unreadCount = apiNotifs.filter(n => !n.is_read).length;

  const markAllRead = async () => {
    await api.patch("/notifications/read-all").catch(() => {});
    setApiNotifs(ns => ns.map(n => ({ ...n, is_read: true })));
  };

  const handleNotifClick = async (n: ApiNotif) => {
    if (!n.is_read) {
      api.patch(`/notifications/${n.id}/read`).catch(() => {});
      setApiNotifs(ns => ns.map(x => x.id === n.id ? { ...x, is_read: true } : x));
    }
    setShowNotifs(false);
    // Bascule la commune active sur celle du dossier visé : un agent
    // multi-communes peut cliquer une notif d'une autre ville que celle
    // actuellement sélectionnée. On résout le nom canonique (la commune du
    // dossier est saisie librement) avant de naviguer.
    const target = resolveCommune(n.commune, communes);
    if (target && target !== commune) setCommune?.(target);
    if (n.dossier_id) routerNav(`/mairie/dossiers/${n.dossier_id}`);
  };

  useEffect(() => {
    if (searchQuery.length <= 1) { setSearchResults([]); return; }
    const timer = setTimeout(() => {
      const qs = commune ? `search=${encodeURIComponent(searchQuery)}&commune=${encodeURIComponent(commune)}&limit=8` : `search=${encodeURIComponent(searchQuery)}&limit=8`;
      api.get<ApiDossier[]>(`/mairie/dossiers?${qs}`)
        .then(data => setSearchResults(data.slice(0, 8)))
        .catch(() => setSearchResults([]));
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const closeAll = () => { setShowNotifs(false); setShowFAQ(false); };

  return (
    <div style={{ position: "sticky", top: 0, zIndex: 40 }}>
      <div style={{ height: 56, background: "white", borderBottom: "1px solid #e2e8f0", display: "flex", alignItems: "center", padding: "0 24px", gap: 16 }}>
        {/* Search */}
        <div style={{ flex: 1, maxWidth: 440, position: "relative" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#F1F5F9", borderRadius: 8, padding: "7px 12px", border: `1px solid ${searchFocused ? "#4F46E5" : "#E2E8F0"}` }}>
            <SearchIcon size={15} />
            <input
              style={{ border: "none", background: "transparent", outline: "none", fontSize: 13, color: "#374151", flex: 1 }}
              placeholder="Rechercher un dossier, une adresse, un pétitionnaire..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setTimeout(() => setSearchFocused(false), 150)}
            />
            {searchQuery && <button onClick={() => setSearchQuery("")} style={{ border: "none", background: "none", cursor: "pointer", color: "#94a3b8", fontSize: 16, lineHeight: 1, padding: 0 }}>×</button>}
          </div>
          {searchFocused && searchQuery.length > 1 && (
            <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, background: "white", borderRadius: 10, border: "1px solid #E2E8F0", boxShadow: "0 8px 24px rgba(0,0,0,0.12)", zIndex: 200, overflow: "hidden" }}>
              {searchResults.length > 0 ? searchResults.map(r => (
                <button key={r.id} onMouseDown={() => { onDossierClick?.({ id: r.id, numero: r.numero, type: r.type, petitionnaire: r.demandeur, adresse: r.adresse ?? "—", status: r.status, echeance: r.date_limite_instruction ? new Date(r.date_limite_instruction).toLocaleDateString("fr-FR") : "—", date_depot: r.date_depot ?? undefined }); setSearchQuery(""); }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", width: "100%", border: "none", background: "none", cursor: "pointer", textAlign: "left" }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "#4F46E5", minWidth: 110 }}>{r.numero}</span>
                  <span style={{ fontSize: 12, color: "#64748b" }}>{r.adresse ?? "—"} — {r.demandeur}</span>
                </button>
              )) : (
                <div style={{ padding: "12px 14px", fontSize: 13, color: "#94a3b8" }}>Aucun résultat pour « {searchQuery} »</div>
              )}
            </div>
          )}
        </div>

        <div style={{ flex: 1 }} />

        {/* Bell */}
        <div style={{ position: "relative" }}>
          <button onClick={() => { setShowNotifs(!showNotifs); setShowFAQ(false); if (!showNotifs) loadNotifs(); }} style={{ border: "none", background: showNotifs ? "#F1F5F9" : "none", cursor: "pointer", color: "#64748b", display: "flex", alignItems: "center", padding: 6, borderRadius: 6 }}>
            <BellIcon size={20} />
          </button>
          {unreadCount > 0 && (
            <span style={{ position: "absolute", top: 2, right: 2, minWidth: 16, height: 16, background: "#EF4444", borderRadius: 8, fontSize: 9, fontWeight: 700, color: "white", display: "flex", alignItems: "center", justifyContent: "center", padding: "0 3px", pointerEvents: "none" }}>
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
          {showNotifs && (
            <div style={{ position: "absolute", top: "calc(100% + 8px)", right: 0, width: 340, background: "white", borderRadius: 12, border: "1px solid #E2E8F0", boxShadow: "0 8px 24px rgba(0,0,0,0.14)", zIndex: 200 }}>
              <div style={{ padding: "12px 16px", borderBottom: "1px solid #F1F5F9", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: "#0F172A" }}>
                  Notifications {unreadCount > 0 && <span style={{ background: "#EF4444", color: "white", borderRadius: 6, fontSize: 10, fontWeight: 700, padding: "1px 6px", marginLeft: 4 }}>{unreadCount}</span>}
                </span>
                {unreadCount > 0 && (
                  <button onClick={markAllRead} style={{ border: "none", background: "none", fontSize: 11, color: "#4F46E5", cursor: "pointer", fontWeight: 500 }}>Tout marquer lu</button>
                )}
              </div>
              <div style={{ maxHeight: 320, overflowY: "auto" }}>
                {apiNotifs.length === 0 ? (
                  <div style={{ padding: "24px 16px", textAlign: "center", fontSize: 12, color: "#94a3b8" }}>Aucune notification</div>
                ) : apiNotifs.slice(0, 8).map(n => {
                  // Agent multi-communes : on préfixe la notif du nom de la ville
                  // concernée pour lever l'ambiguïté entre communes.
                  const communeLabel = communes.length > 1 ? (resolveCommune(n.commune, communes) ?? n.commune) : null;
                  return (
                  <div key={n.id} onClick={() => handleNotifClick(n)}
                    style={{ padding: "10px 16px", display: "flex", alignItems: "flex-start", gap: 10, borderBottom: "1px solid #F8FAFC", cursor: "pointer", background: n.is_read ? "white" : "#F8F7FF", transition: "background 0.15s" }}>
                    <div style={{ width: 32, height: 32, borderRadius: 8, background: notifColor(n.type) + "18", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, flexShrink: 0 }}>{notifIcon(n.type)}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {communeLabel && <div style={{ display: "inline-block", maxWidth: "100%", fontSize: 9.5, fontWeight: 700, color: "#4F46E5", background: "#EEF2FF", borderRadius: 4, padding: "1px 6px", marginBottom: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{communeLabel}</div>}
                      <div style={{ fontSize: 12, color: "#0F172A", fontWeight: n.is_read ? 400 : 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{n.title}</div>
                      <div style={{ fontSize: 11, color: "#64748b", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{n.message}</div>
                      <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 2 }}>{relTime(n.created_at)}</div>
                    </div>
                    {!n.is_read && <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#4F46E5", flexShrink: 0, marginTop: 4 }} />}
                  </div>
                  );
                })}
              </div>
              <div style={{ padding: "10px 16px", textAlign: "center", borderTop: "1px solid #F1F5F9" }}>
                <button onClick={() => { setShowNotifs(false); onViewAllNotifications?.(); }} style={{ border: "none", background: "none", fontSize: 12, color: "#4F46E5", cursor: "pointer", fontWeight: 500 }}>
                  Voir toutes les notifications →
                </button>
              </div>
            </div>
          )}
        </div>

        {/* FAQ / Help */}
        <div style={{ position: "relative" }}>
          <button onClick={() => { setShowFAQ(!showFAQ); setShowNotifs(false); }} style={{ border: "none", background: showFAQ ? "#F1F5F9" : "none", cursor: "pointer", color: "#64748b", display: "flex", alignItems: "center", padding: 6, borderRadius: 6 }}>
            <HelpIcon size={20} />
          </button>
          {showFAQ && (
            <div style={{ position: "absolute", top: "calc(100% + 8px)", right: 0, width: 360, background: "white", borderRadius: 12, border: "1px solid #E2E8F0", boxShadow: "0 8px 24px rgba(0,0,0,0.14)", zIndex: 200, overflow: "hidden" }}>
              <FaqAssistant />
            </div>
          )}
        </div>

        {/* New dossier */}
        {onNewDossier && (
          <button onClick={onNewDossier} style={{ background: "linear-gradient(135deg, #4F46E5, #6366F1)", color: "white", border: "none", borderRadius: 8, padding: "7px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 6, boxShadow: "0 1px 3px rgba(79,70,229,0.3)" }}>
            <PlusIcon size={14} />{buttonLabel}
          </button>
        )}
      </div>
    </div>
  );
}




const TIME_SLOTS = Array.from({ length: 32 }, (_, i) => {
  const h = Math.floor(i / 2) + 6;
  const m = i % 2 === 0 ? "00" : "30";
  return `${String(h).padStart(2, "0")}:${m}`;
});

const REASON_LABELS: Record<string, string> = {
  conges: "Congés", maladie: "Maladie", formation: "Formation", autre: "Autre",
};

type Absence = { id: string; start_date: string; end_date: string; reason: string; note: string | null; delegate_user_id: string | null; delegate_prenom: string | null; delegate_nom: string | null };

function DisponibilitesPanel() {
  const [workingDays, setWorkingDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [startTime, setStartTime] = useState("08:30");
  const [endTime, setEndTime] = useState("17:30");
  const [absences, setAbsences] = useState<Absence[]>([]);
  const [loadingAvail, setLoadingAvail] = useState(true);
  const [savingAvail, setSavingAvail] = useState(false);
  const [availMsg, setAvailMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [showNewAbsence, setShowNewAbsence] = useState(false);
  const [absStart, setAbsStart] = useState("");
  const [absEnd, setAbsEnd] = useState("");
  const [absReason, setAbsReason] = useState("conges");
  const [absNote, setAbsNote] = useState("");
  const [savingAbs, setSavingAbs] = useState(false);
  const [absMsg, setAbsMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    api.get<{ working_days: number[]; start_time: string; end_time: string; absences: Absence[] }>("/mairie/my-availability")
      .then(d => { setWorkingDays(d.working_days); setStartTime(d.start_time); setEndTime(d.end_time); setAbsences(d.absences); })
      .catch(() => {})
      .finally(() => setLoadingAvail(false));
  }, []);

  const toggleDay = (day: number) => setWorkingDays(prev => prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day].sort());

  const saveAvail = async () => {
    setSavingAvail(true); setAvailMsg(null);
    try {
      await api.put("/mairie/my-availability", { working_days: workingDays, start_time: startTime, end_time: endTime });
      setAvailMsg({ ok: true, text: "Disponibilités enregistrées." });
    } catch (e) { setAvailMsg({ ok: false, text: e instanceof Error ? e.message : "Erreur" }); }
    finally { setSavingAvail(false); }
  };

  const addAbsence = async () => {
    if (!absStart || !absEnd) { setAbsMsg({ ok: false, text: "Dates requises." }); return; }
    if (absStart > absEnd) { setAbsMsg({ ok: false, text: "La date de début doit être avant la date de fin." }); return; }
    setSavingAbs(true); setAbsMsg(null);
    try {
      const row = await api.post<Absence>("/mairie/my-absences", { start_date: absStart, end_date: absEnd, reason: absReason, note: absNote || undefined });
      setAbsences(prev => [...prev, row]);
      setShowNewAbsence(false); setAbsStart(""); setAbsEnd(""); setAbsReason("conges"); setAbsNote("");
    } catch (e) { setAbsMsg({ ok: false, text: e instanceof Error ? e.message : "Erreur" }); }
    finally { setSavingAbs(false); }
  };

  const deleteAbsence = async (id: string) => {
    try {
      await api.delete(`/mairie/my-absences/${id}`);
      setAbsences(prev => prev.filter(a => a.id !== id));
    } catch { /* ignore */ }
  };

  if (loadingAvail) return <div style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>Chargement…</div>;

  const today = new Date().toISOString().slice(0, 10);
  const upcoming = absences.filter(a => a.end_date >= today);
  const past = absences.filter(a => a.end_date < today);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Horaires */}
      <div style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", padding: 24 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: "#0F172A", marginBottom: 4 }}>Disponibilités</div>
        <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 20 }}>Définissez vos plages de disponibilité pour le traitement des dossiers.</div>

        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#0F172A", marginBottom: 10 }}>Jours travaillés</div>
          <div style={{ display: "flex", gap: 8 }}>
            {[["Lun",1],["Mar",2],["Mer",3],["Jeu",4],["Ven",5],["Sam",6],["Dim",0]].map(([label, day]) => {
              const active = workingDays.includes(day as number);
              return (
                <button key={String(day)} onClick={() => toggleDay(day as number)} style={{ width: 40, height: 40, borderRadius: 8, border: active ? "2px solid #4F46E5" : "1px solid #E2E8F0", background: active ? "#EEF2FF" : "white", color: active ? "#4F46E5" : "#94a3b8", fontSize: 12, fontWeight: active ? 600 : 400, cursor: "pointer" }}>
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#0F172A", marginBottom: 10 }}>Horaires</div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div>
              <div style={{ fontSize: 11, color: "#64748b", marginBottom: 4 }}>Début</div>
              <select value={startTime} onChange={e => setStartTime(e.target.value)} style={{ padding: "7px 12px", border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 13, outline: "none" }}>
                {TIME_SLOTS.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <span style={{ color: "#94a3b8", marginTop: 16 }}>—</span>
            <div>
              <div style={{ fontSize: 11, color: "#64748b", marginBottom: 4 }}>Fin</div>
              <select value={endTime} onChange={e => setEndTime(e.target.value)} style={{ padding: "7px 12px", border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 13, outline: "none" }}>
                {TIME_SLOTS.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>
        </div>

        {availMsg && <div style={{ background: availMsg.ok ? "#F0FDF4" : "#FEF2F2", border: `1px solid ${availMsg.ok ? "#86EFAC" : "#FECACA"}`, borderRadius: 8, padding: "8px 12px", fontSize: 13, color: availMsg.ok ? "#15803d" : "#DC2626", marginBottom: 14 }}>{availMsg.text}</div>}
        <button onClick={saveAvail} disabled={savingAvail} style={{ background: savingAvail ? "#A5B4FC" : "linear-gradient(135deg,#4F46E5,#6366F1)", color: "white", border: "none", borderRadius: 8, padding: "8px 18px", fontSize: 13, fontWeight: 600, cursor: savingAvail ? "not-allowed" : "pointer" }}>
          {savingAvail ? "Enregistrement…" : "Enregistrer"}
        </button>
      </div>

      {/* Absences */}
      <div style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", padding: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#0F172A", marginBottom: 2 }}>Absences et congés</div>
            <div style={{ fontSize: 12, color: "#94a3b8" }}>Planifiez vos absences pour informer l'équipe.</div>
          </div>
          <button onClick={() => { setShowNewAbsence(true); setAbsMsg(null); }} style={{ background: "linear-gradient(135deg,#4F46E5,#6366F1)", color: "white", border: "none", borderRadius: 8, padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>+ Nouvelle absence</button>
        </div>

        {showNewAbsence && (
          <div style={{ background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 10, padding: 16, marginBottom: 16 }}>
            <div style={{ display: "flex", gap: 10, marginBottom: 10, flexWrap: "wrap" as const }}>
              <div>
                <div style={{ fontSize: 11, color: "#64748b", marginBottom: 4 }}>Du</div>
                <input type="date" value={absStart} onChange={e => setAbsStart(e.target.value)} style={{ padding: "7px 10px", border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 13, outline: "none" }} />
              </div>
              <div>
                <div style={{ fontSize: 11, color: "#64748b", marginBottom: 4 }}>Au</div>
                <input type="date" value={absEnd} onChange={e => setAbsEnd(e.target.value)} style={{ padding: "7px 10px", border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 13, outline: "none" }} />
              </div>
              <div>
                <div style={{ fontSize: 11, color: "#64748b", marginBottom: 4 }}>Motif</div>
                <select value={absReason} onChange={e => setAbsReason(e.target.value)} style={{ padding: "7px 10px", border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 13, outline: "none" }}>
                  {Object.entries(REASON_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div style={{ flex: 1, minWidth: 160 }}>
                <div style={{ fontSize: 11, color: "#64748b", marginBottom: 4 }}>Note (optionnel)</div>
                <input value={absNote} onChange={e => setAbsNote(e.target.value)} placeholder="ex : dossiers redirigés vers…" style={{ width: "100%", padding: "7px 10px", border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 13, outline: "none", boxSizing: "border-box" as const }} />
              </div>
            </div>
            {absMsg && <div style={{ background: absMsg.ok ? "#F0FDF4" : "#FEF2F2", border: `1px solid ${absMsg.ok ? "#86EFAC" : "#FECACA"}`, borderRadius: 8, padding: "8px 12px", fontSize: 13, color: absMsg.ok ? "#15803d" : "#DC2626", marginBottom: 10 }}>{absMsg.text}</div>}
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={addAbsence} disabled={savingAbs} style={{ background: savingAbs ? "#A5B4FC" : "#4F46E5", color: "white", border: "none", borderRadius: 8, padding: "7px 16px", fontSize: 13, fontWeight: 600, cursor: savingAbs ? "not-allowed" : "pointer" }}>{savingAbs ? "Ajout…" : "Ajouter"}</button>
              <button onClick={() => setShowNewAbsence(false)} style={{ background: "white", border: "1px solid #E2E8F0", borderRadius: 8, padding: "7px 14px", fontSize: 13, color: "#64748b", cursor: "pointer" }}>Annuler</button>
            </div>
          </div>
        )}

        {upcoming.length === 0 && past.length === 0 && <div style={{ color: "#94a3b8", fontSize: 13, padding: "8px 0" }}>Aucune absence enregistrée.</div>}

        {upcoming.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#64748b", marginBottom: 8, textTransform: "uppercase" as const, letterSpacing: "0.05em" }}>À venir / En cours</div>
            {upcoming.map(a => (
              <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", background: "#FFF7ED", border: "1px solid #FED7AA", borderRadius: 8, marginBottom: 8 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: "#C2410C" }}>
                    {REASON_LABELS[a.reason] ?? a.reason} — {new Date(a.start_date).toLocaleDateString("fr-FR")} au {new Date(a.end_date).toLocaleDateString("fr-FR")}
                  </div>
                  {a.note && <div style={{ fontSize: 11, color: "#92400E", marginTop: 2 }}>{a.note}</div>}
                </div>
                <button onClick={() => deleteAbsence(a.id)} title="Supprimer" style={{ background: "none", border: "none", cursor: "pointer", color: "#9CA3AF", fontSize: 16, padding: 4, lineHeight: 1 }}>✕</button>
              </div>
            ))}
          </div>
        )}

        {past.length > 0 && (
          <details style={{ marginTop: 8 }}>
            <summary style={{ fontSize: 12, color: "#94a3b8", cursor: "pointer", userSelect: "none" as const }}>Absences passées ({past.length})</summary>
            <div style={{ marginTop: 8 }}>
              {past.map(a => (
                <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 12px", background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 8, marginBottom: 6 }}>
                  <div style={{ flex: 1, fontSize: 12, color: "#64748b" }}>
                    {REASON_LABELS[a.reason] ?? a.reason} — {new Date(a.start_date).toLocaleDateString("fr-FR")} au {new Date(a.end_date).toLocaleDateString("fr-FR")}
                    {a.note && <span style={{ marginLeft: 8, fontStyle: "italic" }}>{a.note}</span>}
                  </div>
                  <button onClick={() => deleteAbsence(a.id)} style={{ background: "none", border: "none", cursor: "pointer", color: "#CBD5E1", fontSize: 14, padding: 4 }}>✕</button>
                </div>
              ))}
            </div>
          </details>
        )}
      </div>
    </div>
  );
}

function DelegationsPanel() {
  type DelegationRow = {
    id: string;
    delegate_user_id: string;
    priority: number;
    prenom: string | null;
    nom: string | null;
    email: string | null;
  };
  type InstructeurOption = { id: string; prenom: string; nom: string; email: string };

  const [instructeurs, setInstructeurs] = useState<InstructeurOption[]>([]);
  const [delegates, setDelegates] = useState<string[]>([]);
  const [initial, setInitial] = useState<string[]>([]);
  const [absences, setAbsences] = useState<Absence[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    Promise.all([
      api.get<InstructeurOption[]>("/mairie/instructeurs").catch(() => []),
      api.get<DelegationRow[]>("/mairie/my-delegations").catch(() => []),
      api.get<{ absences: Absence[] }>("/mairie/my-availability").catch(() => ({ absences: [] as Absence[] })),
    ]).then(([list, delegs, avail]) => {
      setInstructeurs(list);
      const ordered = [...delegs].sort((a, b) => a.priority - b.priority).map((d) => d.delegate_user_id);
      setDelegates(ordered);
      setInitial(ordered);
      setAbsences(avail.absences ?? []);
    }).finally(() => setLoading(false));
  }, []);

  const usersById = useMemo(() => {
    const m = new Map<string, InstructeurOption>();
    instructeurs.forEach((u) => m.set(u.id, u));
    return m;
  }, [instructeurs]);

  const dirty = useMemo(() => {
    if (delegates.length !== initial.length) return true;
    return delegates.some((id, i) => id !== initial[i]);
  }, [delegates, initial]);

  const available = instructeurs.filter((u) => !delegates.includes(u.id));
  const todayIso = new Date().toISOString().slice(0, 10);
  const activeAbsence = absences.find((a) => a.start_date <= todayIso && a.end_date >= todayIso);
  const upcomingAbsence = absences
    .filter((a) => a.start_date > todayIso)
    .sort((a, b) => a.start_date.localeCompare(b.start_date))[0];

  const addDelegate = (id: string) => {
    if (!id || delegates.includes(id)) return;
    setDelegates((prev) => [...prev, id]);
    setMsg(null);
  };
  const removeDelegate = (id: string) => setDelegates((prev) => prev.filter((d) => d !== id));
  const move = (idx: number, dir: -1 | 1) => {
    setDelegates((prev) => {
      const next = [...prev];
      const j = idx + dir;
      if (j < 0 || j >= next.length) return prev;
      const a = next[idx]!;
      const b = next[j]!;
      next[idx] = b;
      next[j] = a;
      return next;
    });
  };

  const save = async () => {
    setSaving(true); setMsg(null);
    try {
      await api.put("/mairie/my-delegations", { delegates });
      setInitial(delegates);
      setMsg({ ok: true, text: "Délégation enregistrée." });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Erreur" });
    } finally {
      setSaving(false);
    }
  };

  const fullName = (u: { prenom?: string | null; nom?: string | null; email?: string | null }) =>
    [u.prenom, u.nom].filter(Boolean).join(" ").trim() || u.email || "—";

  if (loading) return <div style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>Chargement…</div>;

  return (
    <div style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", padding: 24 }}>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: "#0F172A", marginBottom: 2 }}>Délégations</div>
        <div style={{ fontSize: 12, color: "#94a3b8" }}>
          Désignez les instructeurs qui prendront le relais pendant vos absences.
        </div>
      </div>

      {(activeAbsence || upcomingAbsence) && (
        <div style={{
          marginBottom: 16,
          padding: "10px 14px",
          borderRadius: 8,
          border: `1px solid ${activeAbsence ? "#FED7AA" : "#BFDBFE"}`,
          background: activeAbsence ? "#FFF7ED" : "#EFF6FF",
          color: activeAbsence ? "#9A3412" : "#1E40AF",
          fontSize: 12.5,
        }}>
          {activeAbsence ? (
            <>Vous êtes en absence jusqu'au <strong>{new Date(activeAbsence.end_date).toLocaleDateString("fr-FR")}</strong>. Vos nouveaux dossiers et ceux dont l'échéance tombe d'ici là sont redirigés vers la chaîne ci-dessous.</>
          ) : (
            <>Prochaine absence prévue du <strong>{new Date(upcomingAbsence!.start_date).toLocaleDateString("fr-FR")}</strong> au <strong>{new Date(upcomingAbsence!.end_date).toLocaleDateString("fr-FR")}</strong>.</>
          )}
        </div>
      )}

      <div style={{ marginBottom: 12, fontSize: 12, color: "#64748b" }}>
        Le 1er instructeur est sollicité en priorité. Si lui-même est absent, le système passe au suivant, et ainsi de suite.
      </div>

      {delegates.length === 0 ? (
        <div style={{
          padding: "24px 16px",
          textAlign: "center",
          border: "1px dashed #E2E8F0",
          borderRadius: 8,
          color: "#94a3b8",
          fontSize: 13,
        }}>
          Aucun délégué configuré. En cas d'absence, vos dossiers resteront sur votre nom.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {delegates.map((id, idx) => {
            const u = usersById.get(id);
            return (
              <div key={id} style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "12px 14px",
                border: "1px solid #E2E8F0",
                borderRadius: 8,
                background: "white",
              }}>
                <span style={{
                  background: "#EEF2FF",
                  color: "#4F46E5",
                  fontSize: 11,
                  fontWeight: 700,
                  borderRadius: 6,
                  padding: "3px 8px",
                  flexShrink: 0,
                }}>
                  Priorité {idx + 1}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#0F172A" }}>
                    {u ? fullName(u) : "Utilisateur introuvable"}
                  </div>
                  {u?.email && <div style={{ fontSize: 11, color: "#64748b" }}>{u.email}</div>}
                </div>
                <button onClick={() => move(idx, -1)} disabled={idx === 0} title="Monter"
                  style={{ border: "1px solid #E2E8F0", background: "white", borderRadius: 6, padding: "4px 8px", fontSize: 12, color: "#64748b", cursor: idx === 0 ? "not-allowed" : "pointer", opacity: idx === 0 ? 0.4 : 1 }}>↑</button>
                <button onClick={() => move(idx, 1)} disabled={idx === delegates.length - 1} title="Descendre"
                  style={{ border: "1px solid #E2E8F0", background: "white", borderRadius: 6, padding: "4px 8px", fontSize: 12, color: "#64748b", cursor: idx === delegates.length - 1 ? "not-allowed" : "pointer", opacity: idx === delegates.length - 1 ? 0.4 : 1 }}>↓</button>
                <button onClick={() => removeDelegate(id)} title="Retirer"
                  style={{ border: "1px solid #FECACA", background: "white", borderRadius: 6, padding: "4px 8px", fontSize: 12, color: "#EF4444", cursor: "pointer" }}>Retirer</button>
              </div>
            );
          })}
        </div>
      )}

      {available.length > 0 && (
        <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
          <select
            onChange={(e) => {
              if (e.target.value) addDelegate(e.target.value);
              e.currentTarget.selectedIndex = 0;
            }}
            defaultValue=""
            style={{ flex: 1, padding: "8px 10px", border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 13, color: "#374151" }}
          >
            <option value="" disabled>Ajouter un délégué…</option>
            {available.map((u) => (
              <option key={u.id} value={u.id}>
                {fullName(u)} {u.email ? `(${u.email})` : ""}
              </option>
            ))}
          </select>
        </div>
      )}

      {msg && (
        <div style={{
          marginTop: 12,
          padding: "8px 12px",
          borderRadius: 8,
          border: `1px solid ${msg.ok ? "#86EFAC" : "#FECACA"}`,
          background: msg.ok ? "#F0FDF4" : "#FEF2F2",
          color: msg.ok ? "#15803d" : "#DC2626",
          fontSize: 13,
        }}>
          {msg.text}
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
        <button
          onClick={save}
          disabled={!dirty || saving}
          style={{
            background: !dirty || saving ? "#A5B4FC" : "linear-gradient(135deg,#4F46E5,#6366F1)",
            color: "white",
            border: "none",
            borderRadius: 8,
            padding: "8px 16px",
            fontSize: 13,
            fontWeight: 600,
            cursor: !dirty || saving ? "not-allowed" : "pointer",
          }}
        >
          {saving ? "Enregistrement…" : "Enregistrer"}
        </button>
      </div>
    </div>
  );
}

function InfosPersoScreen() {
  const { user, refreshUser } = useAuth();
  const [stab, setStab] = useState("À propos");
  const [profilParams, setProfilParams] = useSearchParams();

  // Centre d'aide : lecteur de documentation (ouvert depuis la carte
  // « Documentation » ou une question fréquente, avec recherche pré-remplie).
  const [docReader, setDocReader] = useState<{ open: boolean; query: string }>({ open: false, query: "" });

  // ── À propos state ──
  const [prenom, setPrenom] = useState(user?.prenom ?? "");
  const [nom, setNom] = useState(user?.nom ?? "");
  const [telephone, setTelephone] = useState(user?.telephone ?? "");
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileMsg, setProfileMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (user) { setPrenom(user.prenom); setNom(user.nom); setTelephone(user.telephone ?? ""); }
  }, [user?.id]);

  const saveProfile = async () => {
    setSavingProfile(true); setProfileMsg(null);
    try {
      await api.patch("/auth/me", { prenom, nom, telephone });
      await refreshUser();
      setProfileMsg({ ok: true, text: "Profil mis à jour." });
    } catch (e) {
      setProfileMsg({ ok: false, text: e instanceof Error ? e.message : "Erreur serveur" });
    } finally { setSavingProfile(false); }
  };

  // ── Communes state ──
  const [myCommunes, setMyCommunes] = useState<{ name: string; insee_code: string | null }[]>([]);
  useEffect(() => {
    api.get<{ name: string; insee_code: string | null }[]>("/mairie/my-communes")
      .then(setMyCommunes).catch(() => {});
  }, []);

  // ── Password state ──
  const [pwCurrent, setPwCurrent] = useState("");
  const [pwNew, setPwNew] = useState("");
  const [pwConfirm, setPwConfirm] = useState("");
  const [savingPw, setSavingPw] = useState(false);
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const changePassword = async () => {
    if (pwNew !== pwConfirm) { setPwMsg({ ok: false, text: "Les mots de passe ne correspondent pas." }); return; }
    if (pwNew.length < 8) { setPwMsg({ ok: false, text: "Le mot de passe doit faire au moins 8 caractères." }); return; }
    setSavingPw(true); setPwMsg(null);
    try {
      await api.patch("/auth/me/password", { current_password: pwCurrent, new_password: pwNew });
      setPwMsg({ ok: true, text: "Mot de passe modifié." });
      setPwCurrent(""); setPwNew(""); setPwConfirm("");
    } catch (e) {
      setPwMsg({ ok: false, text: e instanceof Error ? e.message : "Erreur serveur" });
    } finally { setSavingPw(false); }
  };

  const navItems = [
    { label: "À propos", icon: "👤" },
    { label: "Communes & Rôles", icon: "🏛" },
    { label: "Disponibilités", icon: "📅" },
    { label: "Délégations", icon: "🤝" },
    { label: "Mes Signatures", icon: "✍️" },
    { label: "Notifications", icon: "🔔" },
    { label: "Préférences", icon: "⚙️" },
    { label: "Sécurité / Connexion", icon: "🔒" },
    { label: "Centre d'aide", icon: "❓" },
  ];

  const initials = user ? `${user.prenom[0] ?? ""}${user.nom[0] ?? ""}`.toUpperCase() : "?";
  const fullName = user ? `${user.prenom} ${user.nom}` : "—";
  const roleLabel = user?.role === "instructeur" ? "Instructeur" : user?.role === "admin" ? "Administrateur" : "Mairie";

  return (
    <div style={{ padding: 24 }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "#0F172A", marginBottom: 2 }}>Informations personnelles</h1>
        <p style={{ color: "#64748b", fontSize: 13 }}>Gérez votre profil, vos préférences et vos paramètres de sécurité.</p>
      </div>

      {/* Profile header */}
      <div style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", padding: 24, marginBottom: 20, display: "flex", alignItems: "center", gap: 20 }}>
        <div style={{ width: 72, height: 72, borderRadius: "50%", background: "linear-gradient(135deg, #4F46E5, #7C3AED)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, fontWeight: 700, color: "white", flexShrink: 0 }}>{initials}</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: "#0F172A", marginBottom: 2 }}>{fullName}</div>
          <div style={{ fontSize: 13, color: "#64748b", marginBottom: 6 }}>{user?.email}{user?.commune ? ` — Commune de ${user.commune}` : ""}</div>
          <div style={{ display: "flex", gap: 8 }}>
            <span style={{ background: "#EEF2FF", color: "#4F46E5", fontSize: 11, fontWeight: 600, borderRadius: 6, padding: "3px 10px" }}>{roleLabel}</span>
            <span style={{ background: "#F0FDF4", color: "#15803D", fontSize: 11, fontWeight: 600, borderRadius: 6, padding: "3px 10px" }}>Actif</span>
          </div>
        </div>
        <button onClick={() => setStab("À propos")} style={{ border: "1px solid #E2E8F0", background: "white", borderRadius: 8, padding: "8px 16px", fontSize: 13, color: "#374151", cursor: "pointer" }}>Modifier le profil</button>
      </div>

      <div style={{ display: "flex", gap: 20 }}>
        {/* Left nav */}
        <div style={{ width: 220, flexShrink: 0 }}>
          <div style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", overflow: "hidden" }}>
            {navItems.map((item) => (
              <button key={item.label} onClick={() => setStab(item.label)} style={{
                width: "100%", border: "none", background: stab === item.label ? "#EEF2FF" : "transparent",
                display: "flex", alignItems: "center", gap: 10, padding: "10px 16px",
                fontSize: 13, fontWeight: stab === item.label ? 600 : 400,
                color: stab === item.label ? "#4F46E5" : "#374151",
                cursor: "pointer", textAlign: "left",
                borderLeft: stab === item.label ? "3px solid #4F46E5" : "3px solid transparent",
                borderBottom: "1px solid #F1F5F9",
              }}>
                <span style={{ fontSize: 14 }}>{item.icon}</span>
                {item.label}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div style={{ flex: 1 }}>
          {stab === "À propos" && (
            <div style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", padding: 24 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#0F172A", marginBottom: 20 }}>À propos</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>
                {([["Prénom", prenom, setPrenom], ["Nom", nom, setNom]] as [string, string, (v: string) => void][]).map(([label, val, setter]) => (
                  <div key={label}>
                    <div style={{ fontSize: 11, color: "#94a3b8", textTransform: "uppercase" as const, letterSpacing: "0.06em", marginBottom: 4 }}>{label}</div>
                    <input value={val} onChange={e => setter(e.target.value)} style={{ width: "100%", padding: "8px 10px", border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 13, outline: "none", boxSizing: "border-box" as const }} />
                  </div>
                ))}
                <div>
                  <div style={{ fontSize: 11, color: "#94a3b8", textTransform: "uppercase" as const, letterSpacing: "0.06em", marginBottom: 4 }}>E-mail</div>
                  <div style={{ padding: "8px 10px", border: "1px solid #F1F5F9", borderRadius: 8, fontSize: 13, color: "#94a3b8", background: "#F8FAFC" }}>{user?.email}</div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: "#94a3b8", textTransform: "uppercase" as const, letterSpacing: "0.06em", marginBottom: 4 }}>Téléphone</div>
                  <input value={telephone} onChange={e => setTelephone(e.target.value)} placeholder="ex : 02 47 00 00 00" style={{ width: "100%", padding: "8px 10px", border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 13, outline: "none", boxSizing: "border-box" as const }} />
                </div>
              </div>
              {profileMsg && (
                <div style={{ background: profileMsg.ok ? "#F0FDF4" : "#FEF2F2", border: `1px solid ${profileMsg.ok ? "#86EFAC" : "#FECACA"}`, borderRadius: 8, padding: "8px 12px", fontSize: 13, color: profileMsg.ok ? "#15803d" : "#DC2626", marginBottom: 12 }}>
                  {profileMsg.text}
                </div>
              )}
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <button onClick={() => { setPrenom(user?.prenom ?? ""); setNom(user?.nom ?? ""); setTelephone(user?.telephone ?? ""); setProfileMsg(null); }} style={{ border: "1px solid #E2E8F0", background: "white", borderRadius: 8, padding: "8px 16px", fontSize: 13, color: "#64748b", cursor: "pointer" }}>Annuler</button>
                <button onClick={saveProfile} disabled={savingProfile} style={{ background: savingProfile ? "#A5B4FC" : "linear-gradient(135deg,#4F46E5,#6366F1)", color: "white", border: "none", borderRadius: 8, padding: "8px 16px", fontSize: 13, fontWeight: 600, cursor: savingProfile ? "not-allowed" : "pointer" }}>
                  {savingProfile ? "Enregistrement…" : "Enregistrer"}
                </button>
              </div>
            </div>
          )}

          {stab === "Communes & Rôles" && (
            <div style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", padding: 24 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#0F172A", marginBottom: 4 }}>Communes & Rôles</div>
              <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 20 }}>Communes auxquelles vous avez accès et rôles associés.</div>
              {myCommunes.length === 0 ? (
                <div style={{ color: "#94a3b8", fontSize: 13, padding: "12px 0" }}>Aucune commune assignée. Contactez un administrateur.</div>
              ) : myCommunes.map((c, i) => (
                <div key={c.name} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 0", borderBottom: "1px solid #F1F5F9" }}>
                  <div style={{ width: 36, height: 36, borderRadius: 8, background: i === 0 ? "#EEF2FF" : "#F8FAFC", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>🏛</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#0F172A" }}>{c.name}</div>
                    {c.insee_code && <div style={{ fontSize: 11, color: "#64748b" }}>INSEE : {c.insee_code}</div>}
                  </div>
                  <span style={{ background: i === 0 ? "#EEF2FF" : "#F8FAFC", color: i === 0 ? "#4F46E5" : "#64748b", fontSize: 11, fontWeight: 600, borderRadius: 6, padding: "3px 10px" }}>{roleLabel}</span>
                  <span style={{ fontSize: 11, color: "#94a3b8" }}>{i === 0 ? "Principal" : "Secondaire"}</span>
                </div>
              ))}
            </div>
          )}

          {stab === "Disponibilités" && <DisponibilitesPanel />}

          {stab === "Délégations" && <DelegationsPanel />}

          {stab === "Mes Signatures" && (
            <div style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", padding: 24 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#0F172A", marginBottom: 4 }}>Mes Signatures</div>
              <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 20 }}>Signatures électroniques utilisées dans vos courriers et arrêtés.</div>
              <div style={{ display: "flex", gap: 16, marginBottom: 20 }}>
                <div style={{ flex: 1, border: "2px solid #4F46E5", borderRadius: 12, padding: 20, position: "relative" }}>
                  <span style={{ position: "absolute", top: 10, right: 10, background: "#EEF2FF", color: "#4F46E5", fontSize: 10, fontWeight: 700, borderRadius: 4, padding: "2px 6px" }}>Par défaut</span>
                  <div style={{ height: 60, background: "#F8FAFC", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 10 }}>
                    <span style={{ fontFamily: "cursive", fontSize: 22, color: "#0F172A" }}>Marie Lecomte</span>
                  </div>
                  <div style={{ fontSize: 12, color: "#64748b" }}>Signature principale — utilisée par défaut</div>
                </div>
                <div style={{ flex: 1, border: "1px solid #E2E8F0", borderRadius: 12, padding: 20, cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, color: "#94a3b8" }}>
                  <span style={{ fontSize: 28 }}>+</span>
                  <span style={{ fontSize: 12 }}>Ajouter une signature</span>
                </div>
              </div>
            </div>
          )}

          {stab === "Notifications" && (
            <div style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", padding: 24 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#0F172A", marginBottom: 4 }}>Notifications personnelles</div>
              <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 20 }}>Préférences de notification pour votre compte uniquement.</div>
              {[
                { label: "Dossier assigné", sub: "Quand un dossier m'est assigné", active: true },
                { label: "Message reçu", sub: "Quand je reçois un nouveau message", active: true },
                { label: "Délai proche", sub: "48h avant une échéance", active: true },
                { label: "Délai dépassé", sub: "Quand un délai est dépassé sur mes dossiers", active: true },
                { label: "Avis reçu", sub: "Quand un service rend son avis", active: false },
                { label: "Mises à jour plateforme", sub: "Nouvelles fonctionnalités et correctifs", active: false },
              ].map(n => (
                <div key={n.label} style={{ display: "flex", alignItems: "center", padding: "10px 0", borderBottom: "1px solid #F8FAFC" }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: "#0F172A" }}>{n.label}</div>
                    <div style={{ fontSize: 11, color: "#94a3b8" }}>{n.sub}</div>
                  </div>
                  <div style={{ width: 36, height: 20, borderRadius: 10, background: n.active ? "#4F46E5" : "#E2E8F0", position: "relative", cursor: "pointer" }}>
                    <div style={{ width: 16, height: 16, borderRadius: "50%", background: "white", position: "absolute", top: 2, left: n.active ? 18 : 2, boxShadow: "0 1px 3px rgba(0,0,0,0.2)" }} />
                  </div>
                </div>
              ))}
            </div>
          )}

          {stab === "Préférences" && (
            <div style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", padding: 24 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#0F172A", marginBottom: 20 }}>Préférences d'affichage</div>
              {[
                { label: "Langue", value: "Français" },
                { label: "Fuseau horaire", value: "Europe/Paris (UTC+2)" },
                { label: "Format de date", value: "DD/MM/YYYY" },
                { label: "Dossiers par page", value: "20" },
              ].map(p => (
                <div key={p.label} style={{ display: "flex", alignItems: "center", marginBottom: 14, gap: 16 }}>
                  <div style={{ width: 180, fontSize: 13, color: "#374151", fontWeight: 500 }}>{p.label}</div>
                  <select style={{ flex: 1, padding: "7px 12px", border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 13, color: "#374151" }}><option>{p.value}</option></select>
                </div>
              ))}
              <div style={{ borderTop: "1px solid #F1F5F9", paddingTop: 16, marginTop: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#0F172A", marginBottom: 12 }}>Thème</div>
                <div style={{ display: "flex", gap: 10 }}>
                  {[["Clair","☀️",true],["Sombre","🌙",false],["Système","💻",false]].map(([l,ic,active]) => (
                    <button key={String(l)} style={{ flex: 1, border: active ? "2px solid #4F46E5" : "1px solid #E2E8F0", background: active ? "#EEF2FF" : "white", borderRadius: 10, padding: "12px 8px", cursor: "pointer", textAlign: "center" }}>
                      <div style={{ fontSize: 20, marginBottom: 4 }}>{ic as string}</div>
                      <div style={{ fontSize: 12, color: active ? "#4F46E5" : "#374151", fontWeight: active ? 600 : 400 }}>{l as string}</div>
                    </button>
                  ))}
                </div>
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 20, gap: 8 }}>
                <button style={{ border: "1px solid #E2E8F0", background: "white", borderRadius: 8, padding: "8px 16px", fontSize: 13, color: "#64748b", cursor: "pointer" }}>Annuler</button>
                <button style={{ background: "linear-gradient(135deg,#4F46E5,#6366F1)", color: "white", border: "none", borderRadius: 8, padding: "8px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Enregistrer</button>
              </div>
            </div>
          )}

          {stab === "Sécurité / Connexion" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", padding: 24 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#0F172A", marginBottom: 16 }}>Mot de passe</div>
                {([["Mot de passe actuel", pwCurrent, setPwCurrent], ["Nouveau mot de passe", pwNew, setPwNew], ["Confirmer le nouveau mot de passe", pwConfirm, setPwConfirm]] as [string, string, (v: string) => void][]).map(([label, val, setter]) => (
                  <div key={label} style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 12, color: "#64748b", marginBottom: 4 }}>{label}</div>
                    <input type="password" value={val} onChange={e => setter(e.target.value)} style={{ width: "100%", padding: "8px 12px", border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 13, outline: "none", boxSizing: "border-box" as const }} placeholder="••••••••" />
                  </div>
                ))}
                {pwMsg && (
                  <div style={{ background: pwMsg.ok ? "#F0FDF4" : "#FEF2F2", border: `1px solid ${pwMsg.ok ? "#86EFAC" : "#FECACA"}`, borderRadius: 8, padding: "8px 12px", fontSize: 13, color: pwMsg.ok ? "#15803d" : "#DC2626", marginBottom: 12 }}>
                    {pwMsg.text}
                  </div>
                )}
                <button onClick={changePassword} disabled={savingPw || !pwCurrent || !pwNew || !pwConfirm} style={{ background: savingPw || !pwCurrent || !pwNew || !pwConfirm ? "#A5B4FC" : "linear-gradient(135deg,#4F46E5,#6366F1)", color: "white", border: "none", borderRadius: 8, padding: "8px 16px", fontSize: 13, fontWeight: 600, cursor: savingPw ? "not-allowed" : "pointer", marginTop: 4 }}>
                  {savingPw ? "Modification…" : "Modifier le mot de passe"}
                </button>
              </div>
              <div style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", padding: 24 }}>
                <MfaSettings />
              </div>
            </div>
          )}

          {stab === "Centre d'aide" && (
            <div style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", padding: 24 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#0F172A", marginBottom: 4 }}>Centre d'aide</div>
              <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 20 }}>Documentation, tutoriels et support.</div>
              <button
                onClick={() => { const sp = new URLSearchParams(profilParams); sp.set("guide", "1"); setProfilParams(sp); }}
                style={{ display: "inline-flex", alignItems: "center", gap: 8, border: "1px solid #C7D2FE", background: "#EEF2FF", color: "#4F46E5", borderRadius: 10, padding: "10px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer", marginBottom: 20 }}
              >
                ✨ Revoir le guide d'accueil
              </button>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 20 }}>
                {([
                  { icon: "📖", title: "Documentation", sub: "Guides complets sur toutes les fonctionnalités", onClick: () => setDocReader({ open: true, query: "" }) },
                  { icon: "💬", title: "Chat support", sub: "Discutez avec notre équipe de support", onClick: () => { window.location.href = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent("Assistance Heurekia")}`; } },
                  { icon: "📧", title: "Contacter le support", sub: "Envoyez-nous un message", onClick: () => { window.location.href = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent("Contact support Heurekia")}`; } },
                ]).map(c => (
                  <button key={c.title} onClick={c.onClick} style={{ border: "1px solid #E2E8F0", background: "white", borderRadius: 12, padding: 16, cursor: "pointer", textAlign: "left", transition: "border-color 0.15s, box-shadow 0.15s" }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = "#C7D2FE"; e.currentTarget.style.boxShadow = "0 4px 12px rgba(79,70,229,0.08)"; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = "#E2E8F0"; e.currentTarget.style.boxShadow = "none"; }}>
                    <div style={{ fontSize: 24, marginBottom: 8 }}>{c.icon}</div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#0F172A", marginBottom: 4 }}>{c.title}</div>
                    <div style={{ fontSize: 11, color: "#94a3b8" }}>{c.sub}</div>
                  </button>
                ))}
              </div>
              <div style={{ background: "#F8FAFC", borderRadius: 10, padding: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#0F172A", marginBottom: 10 }}>Questions fréquentes</div>
                {["Comment créer un nouveau dossier ?","Comment assigner un dossier à un instructeur ?","Comment envoyer une demande de pièce complémentaire ?","Comment consulter les statistiques de ma commune ?"].map(q => (
                  <div key={q} onClick={() => setDocReader({ open: true, query: q })} style={{ padding: "8px 0", borderBottom: "1px solid #E2E8F0", fontSize: 13, color: "#4F46E5", cursor: "pointer" }}>→ {q}</div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {docReader.open && (
        <AideDocumentation initialQuery={docReader.query} onClose={() => setDocReader({ open: false, query: "" })} />
      )}
    </div>
  );
}



function SignaturesPendantesScreen() {
  type PendingRow = {
    id: string;
    status: string;
    type: string;
    commune: string;
    created_at: string;
    dossier: { id: string; numero: string; type: string; commune: string | null; adresse: string | null } | null;
    instructeur: { prenom: string | null; nom: string | null } | null;
  };
  const [rows, setRows] = useState<PendingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [signing, setSigning] = useState<string | null>(null);
  const [refusing, setRefusing] = useState<string | null>(null);
  const [refuseMotif, setRefuseMotif] = useState("");
  const routerNavigate = useNavigate();

  const load = () => {
    api.get<PendingRow[]>("/decisions/pending")
      .then(data => setRows(data))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const DECISION_LABEL: Record<string, string> = {
    accord: "Accord", accord_prescription: "Accord avec prescriptions", refus: "Refus",
    sursis_a_statuer: "Sursis à statuer", non_opposition: "Non-opposition",
    non_opposition_prescription: "Non-opposition avec prescriptions", opposition: "Opposition",
    pieces_complementaires: "Demande de pièces", cu_positif: "CU positif", cu_negatif: "CU négatif",
  };

  return (
    <div style={{ padding: 24 }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "#0F172A", marginBottom: 2 }}>Signatures en attente</h1>
        <p style={{ color: "#64748b", fontSize: 13 }}>Projets d'arrêtés soumis pour votre signature.</p>
      </div>

      {loading ? (
        <div style={{ padding: 48, textAlign: "center", color: "#94a3b8" }}>Chargement…</div>
      ) : rows.length === 0 ? (
        <div style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", padding: "48px 24px", textAlign: "center" as const }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>✓</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: "#0F172A", marginBottom: 6 }}>Aucune signature en attente</div>
          <div style={{ fontSize: 13, color: "#94a3b8" }}>Tous les projets d'arrêtés ont été traités.</div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column" as const, gap: 12 }}>
          {rows.map(row => (
            <div key={row.id} style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", padding: 18, display: "flex", alignItems: "center", gap: 16 }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: "#4F46E5" }}>{row.dossier?.numero ?? "—"}</span>
                  <span style={{ fontSize: 11, background: "#EEF2FF", color: "#4F46E5", borderRadius: 6, padding: "2px 8px", fontWeight: 600 }}>{DECISION_LABEL[row.type] ?? row.type}</span>
                </div>
                <div style={{ fontSize: 12.5, color: "#374151", marginBottom: 2 }}>
                  {row.dossier?.adresse ?? "—"} — {row.dossier?.commune ?? row.commune}
                </div>
                <div style={{ fontSize: 11, color: "#94a3b8" }}>
                  Préparé par {row.instructeur?.prenom} {row.instructeur?.nom} · {new Date(row.created_at).toLocaleDateString("fr-FR")}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                <button onClick={() => row.dossier?.id && routerNavigate(`/mairie/dossiers/${row.dossier.id}`)} style={{ border: "1px solid #E2E8F0", background: "white", borderRadius: 8, padding: "7px 14px", fontSize: 12, cursor: "pointer", color: "#374151" }}>
                  Voir le dossier
                </button>
                <button onClick={async () => {
                  setSigning(row.id);
                  try {
                    await api.post(`/decisions/${row.id}/sign`, {});
                    load();
                  } catch { /* ignore */ } finally { setSigning(null); }
                }} disabled={signing === row.id} style={{ background: "linear-gradient(135deg,#059669,#10B981)", color: "white", border: "none", borderRadius: 8, padding: "7px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                  {signing === row.id ? "…" : "Signer"}
                </button>
                <button onClick={() => setRefusing(row.id)} style={{ background: "white", color: "#EF4444", border: "1px solid #FECACA", borderRadius: 8, padding: "7px 12px", fontSize: 12, cursor: "pointer" }}>
                  Refuser
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Refuse modal */}
      {refusing && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => { setRefusing(null); setRefuseMotif(""); }}>
          <div style={{ background: "white", borderRadius: 14, width: 460, padding: 24 }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#0F172A", marginBottom: 12 }}>Motif du refus</div>
            <textarea value={refuseMotif} onChange={e => setRefuseMotif(e.target.value)} rows={4} placeholder="Précisez la raison du refus…" style={{ width: "100%", border: "1.5px solid #E2E8F0", borderRadius: 9, padding: "10px 12px", fontSize: 12.5, outline: "none", resize: "vertical" as const, fontFamily: "inherit", boxSizing: "border-box" as const, marginBottom: 16 }} />
            <div style={{ display: "flex", gap: 9, justifyContent: "flex-end" }}>
              <button onClick={() => { setRefusing(null); setRefuseMotif(""); }} style={{ border: "1px solid #E2E8F0", background: "white", borderRadius: 8, padding: "9px 18px", fontSize: 13, cursor: "pointer" }}>Annuler</button>
              <button onClick={async () => {
                if (!refuseMotif.trim()) return;
                try { await api.post(`/decisions/${refusing}/refuse-signature`, { motif: refuseMotif }); load(); }
                catch { /* ignore */ }
                setRefusing(null); setRefuseMotif("");
              }} disabled={!refuseMotif.trim()} style={{ background: "#EF4444", color: "white", border: "none", borderRadius: 8, padding: "9px 18px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                Confirmer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DossierDetailRoute({ navigate, commune, communes, setCommune, communeInseeMap }: { navigate: (s: string) => void; commune: string; communes: string[]; setCommune: (c: string) => void; communeInseeMap: Record<string, string> }) {
  const { id } = useParams<{ id: string }>();
  const routerNavigate = useNavigate();
  const [dossier, setDossier] = useState<DossierInfo | null>(null);
  const [loading, setLoading] = useState(true);

  // On peut arriver sur ce dossier via la liste, la recherche, une notification
  // (cloche) ou un lien direct — potentiellement vers un dossier d'une autre
  // commune que celle sélectionnée. On aligne alors la commune active (sidebar,
  // badges, écrans) sur celle du dossier ouvert. Réf pour appliquer la dernière
  // logique sans relancer le fetch quand la commune sélectionnée change.
  const syncCommuneRef = useRef<(c: string | null | undefined) => void>(() => {});
  syncCommuneRef.current = (c) => {
    // `c` vient de `dossiers.commune` (texte libre) : on résout le nom canonique
    // du sélecteur avant de comparer/basculer, sinon une simple différence de
    // casse/accent empêchait le changement de commune.
    const target = resolveCommune(c, communes);
    if (target && target !== commune) setCommune(target);
  };

  useEffect(() => {
    if (!id) return;
    type ApiDetail = {
      id: string; numero: string; type: string; status: string;
      adresse: string | null; commune: string | null; code_postal: string | null;
      description: string | null; parcelle: string | null; surface_plancher: string | null;
      date_limite_instruction: string | null; date_depot: string | null;
      date_completude: string | null;
      metadata: Record<string, unknown> | null;
      instructeur_id: string | null;
      demandeur: { prenom?: string; nom?: string; email?: string | null; email_verified?: boolean; is_placeholder?: boolean; can_invite?: boolean } | null;
      instructeur: { prenom?: string; nom?: string } | null;
      workflow?: WorkflowMeta;
    };
    api.get<ApiDetail>(`/mairie/dossiers/${id}`)
      .then(data => {
        // Synchronise la commune sélectionnée sur celle du dossier ouvert.
        syncCommuneRef.current(data.commune);
        const meta = (data.metadata ?? {}) as Record<string, unknown>;
        const lat = parseFloat(String(meta["lat"] ?? ""));
        const lng = parseFloat(String(meta["lng"] ?? ""));
        setDossier({
          id: data.id,
          numero: data.numero,
          type: data.type,
          petitionnaire: data.demandeur ? ([data.demandeur.prenom, data.demandeur.nom].filter(Boolean).join(" ") || "—") : "—",
          petitionnaire_email: data.demandeur?.email ?? null,
          petitionnaire_is_placeholder: data.demandeur?.is_placeholder ?? false,
          petitionnaire_can_invite: data.demandeur?.can_invite ?? false,
          adresse: data.adresse ?? "—",
          status: data.status,
          echeance: fmtDate(data.date_limite_instruction),
          date_depot: data.date_depot ?? undefined,
          date_completude: data.date_completude ?? undefined,
          delai: (meta["delai"] as DelaiBreakdown | undefined) ?? null,
          description: data.description ?? undefined,
          parcelle: data.parcelle ?? undefined,
          surface_plancher: data.surface_plancher ?? undefined,
          commune: data.commune ?? undefined,
          code_postal: data.code_postal ?? undefined,
          instructeur: data.instructeur ? ([data.instructeur.prenom, data.instructeur.nom].filter(Boolean).join(" ") || undefined) : undefined,
          instructeur_id: data.instructeur_id ?? undefined,
          workflow: data.workflow,
          lat: isNaN(lat) ? undefined : lat,
          lng: isNaN(lng) ? undefined : lng,
          cachedParcelAnalysis: (meta["parcel_analysis"] && typeof meta["parcel_analysis"] === "object")
            ? (meta["parcel_analysis"] as Record<string, unknown>)
            : null,
        });
      })
      .catch((err) => {
        // 423 = dossier verrouillé tant que l'OCR/IA des pièces n'est pas
        // terminée (dépôt comptoir mairie). On renvoie l'instructeur sur la
        // liste avec un message explicite : il sera notifié dans la cloche
        // quand le dossier sera consultable.
        if (err instanceof ApiError && err.status === 423) {
          const body = (err.body ?? {}) as { numero?: string; ocr_remaining?: number; ocr_total?: number };
          const piecesInfo = (body.ocr_remaining != null && body.ocr_total != null)
            ? ` (${body.ocr_total - body.ocr_remaining}/${body.ocr_total} pièces analysées)`
            : "";
          const ref = body.numero ? `Dossier ${body.numero}` : "Ce dossier";
          alert(`${ref} : analyse OCR/IA en cours${piecesInfo}.\nVous recevrez une notification dès qu'il sera prêt à instruire.`);
        }
        routerNavigate("/mairie/dossiers", { replace: true });
      })
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div style={{ padding: 48, textAlign: "center", color: "#94a3b8", fontSize: 14 }}>Chargement…</div>;
  if (!dossier) return null;
  // INSEE de la commune du dossier (cf. communeInseeMap, même source que l'écran
  // Paramètres) — pour que la modale courrier lise les modèles de cette commune.
  return <DossierDetailScreen dossier={dossier} onBack={() => routerNavigate(-1 as never)} navigate={navigate} inseeCode={dossier.commune ? communeInseeMap[dossier.commune] : undefined} />;
}

const COMMUNE_STORAGE_KEY = (userId?: string) => `heureka_commune_${userId ?? "anon"}`;

function NoCommuneAssignedScreen({ prenom }: { prenom: string }) {
  const { logout } = useAuth();
  return (
    <div style={{ fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", background: "#F8F9FC", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ width: "100%", maxWidth: 480, background: "white", borderRadius: 16, border: "1px solid #E2E8F0", padding: 40, boxShadow: "0 4px 20px rgba(0,0,0,0.06)", textAlign: "center" }}>
        <div style={{ width: 56, height: 56, borderRadius: 14, background: "linear-gradient(135deg, #EEF2FF, #E0E7FF)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px" }}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#4F46E5" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" /><circle cx="12" cy="10" r="3" />
          </svg>
        </div>
        <h1 style={{ margin: "0 0 12px", fontSize: 20, fontWeight: 700, color: "#0F172A" }}>
          Bienvenue{prenom ? `, ${prenom}` : ""}
        </h1>
        <p style={{ margin: "0 0 8px", fontSize: 14, color: "#475569", lineHeight: 1.6 }}>
          Votre compte Heurekia est bien activé.
        </p>
        <p style={{ margin: "0 0 28px", fontSize: 14, color: "#475569", lineHeight: 1.6 }}>
          L'accès à votre espace sera disponible dès qu'un administrateur vous aura rattaché à une commune. Cette étape ne prend généralement que quelques instants — n'hésitez pas à contacter votre référent si l'attente se prolonge.
        </p>
        <button
          onClick={() => { logout(); }}
          style={{ background: "white", border: "1px solid #E2E8F0", borderRadius: 10, padding: "10px 20px", fontSize: 13, fontWeight: 600, color: "#475569", cursor: "pointer" }}
        >
          Se déconnecter
        </button>
      </div>
    </div>
  );
}

// ── Onboarding (pop-up de bienvenue, 1re connexion d'un agent) ────────────────
// Écran 1 : présentation des modules. Écran 2 : mise en avant du bouton d'aide
// « ? ». À la fin (ou « Passer »), on marque l'onboarding comme vu en base.

const ONBOARDING_MODULES: { icon: React.ComponentType<{ size?: number; className?: string }>; label: string; desc: string }[] = [
  { icon: HomeIcon, label: "Tableau de bord", desc: "Vue d'ensemble de votre activité et accès rapide aux dossiers." },
  { icon: FolderIcon, label: "Dossiers", desc: "Instruisez les demandes : pièces, conformité au PLU, décision." },
  { icon: CalendarIcon, label: "Calendrier", desc: "Suivez les échéances et les délais légaux d'instruction." },
  { icon: MessageIcon, label: "Messagerie", desc: "Échangez avec les pétitionnaires et les services consultés." },
  { icon: MapIcon, label: "Carte", desc: "Visualisez les dossiers géolocalisés et consultez le zonage PLU." },
  { icon: ChartIcon, label: "Statistiques", desc: "Vos indicateurs : délais moyens, taux d'acceptation, retards." },
  { icon: PenIcon, label: "Signatures", desc: "Signez électroniquement les arrêtés qui vous sont soumis." },
  { icon: SettingsIcon, label: "Paramètres", desc: "Réglementation (PLU), modèles de courrier, notifications." },
];

function OnboardingModal({ prenom, onComplete }: { prenom: string; onComplete: () => void }) {
  const [step, setStep] = useState(0);
  const [closing, setClosing] = useState(false);

  const finish = () => {
    if (closing) return;
    setClosing(true);
    // Best-effort : si l'appel échoue, on ferme quand même (la modale ne doit
    // pas bloquer l'agent). Le flag sera retenté au prochain /auth/me.
    api.post("/auth/onboarding/complete").catch(() => {}).finally(onComplete);
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.55)", zIndex: 9000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div style={{ background: "white", borderRadius: 18, width: "100%", maxWidth: 560, maxHeight: "92vh", overflow: "hidden", display: "flex", flexDirection: "column", boxShadow: "0 24px 70px rgba(15,23,42,0.35)" }}>
        {/* Header dégradé */}
        <div style={{ background: "linear-gradient(135deg, #4F46E5, #6366F1)", color: "white", padding: "22px 26px" }}>
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "rgba(255,255,255,0.8)", marginBottom: 6 }}>Bienvenue sur HEUREKIA ✨</div>
          <div style={{ fontSize: 21, fontWeight: 800, lineHeight: 1.25 }}>
            {step === 0
              ? `Bonjour${prenom ? ` ${prenom}` : ""}, voici votre espace d'instruction`
              : "Une question ? L'assistant est là pour vous"}
          </div>
        </div>

        {/* Corps */}
        <div style={{ padding: "20px 26px", overflowY: "auto" }}>
          {step === 0 ? (
            <>
              <div style={{ fontSize: 13.5, color: "#64748b", lineHeight: 1.6, marginBottom: 16 }}>
                Tout se pilote depuis le menu de gauche. Voici les modules à votre disposition :
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                {ONBOARDING_MODULES.map(({ icon: Icon, label, desc }) => (
                  <div key={label} style={{ display: "flex", gap: 11, padding: "11px 12px", border: "1px solid #EEF1F5", borderRadius: 11, background: "#F8FAFC" }}>
                    <div style={{ width: 32, height: 32, borderRadius: 9, background: "#EEF2FF", color: "#4F46E5", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <Icon size={17} />
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 700, color: "#0F172A" }}>{label}</div>
                      <div style={{ fontSize: 11, color: "#64748b", lineHeight: 1.4, marginTop: 2 }}>{desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div style={{ textAlign: "center", padding: "8px 4px 4px" }}>
              <div style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 64, height: 64, borderRadius: "50%", background: "#EEF2FF", color: "#4F46E5", marginBottom: 16 }}>
                <HelpIcon size={32} />
              </div>
              <div style={{ fontSize: 14, color: "#374151", lineHeight: 1.65, maxWidth: 420, margin: "0 auto" }}>
                À tout moment, cliquez sur le bouton <span style={{ display: "inline-flex", verticalAlign: "middle", width: 22, height: 22, borderRadius: "50%", border: "1.5px solid #4F46E5", color: "#4F46E5", alignItems: "center", justifyContent: "center", margin: "0 3px" }}><HelpIcon size={13} /></span> en haut à droite pour poser une question à l'assistant.
              </div>
              <div style={{ background: "#F0F4FF", borderLeft: "3px solid #4F46E5", borderRadius: 8, padding: "12px 14px", marginTop: 18, textAlign: "left", maxWidth: 420, marginLeft: "auto", marginRight: "auto" }}>
                <div style={{ fontSize: 11.5, fontWeight: 700, color: "#4F46E5", marginBottom: 6 }}>Par exemple :</div>
                {["Comment prendre en charge un nouveau dossier ?", "Comment demander des pièces complémentaires ?", "Comment faire signer une décision ?"].map((q) => (
                  <div key={q} style={{ fontSize: 12, color: "#475569", lineHeight: 1.5, paddingLeft: 14, position: "relative" }}>
                    <span style={{ position: "absolute", left: 0, color: "#818cf8" }}>›</span>{q}
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 16 }}>
                L'assistant répond aussi aux questions techniques et au « comment faire… » sur l'outil.
              </div>
            </div>
          )}
        </div>

        {/* Pied : étapes + actions */}
        <div style={{ borderTop: "1px solid #F1F5F9", padding: "14px 26px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div style={{ display: "flex", gap: 6 }}>
            {[0, 1].map((d) => (
              <span key={d} style={{ width: d === step ? 18 : 7, height: 7, borderRadius: 4, background: d === step ? "#4F46E5" : "#CBD5E1", transition: "all 0.2s" }} />
            ))}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {step === 0 ? (
              <button onClick={finish} disabled={closing} style={{ border: "none", background: "none", color: "#94a3b8", fontSize: 13, fontWeight: 600, cursor: "pointer", padding: "8px 6px" }}>Passer</button>
            ) : (
              <button onClick={() => setStep(0)} disabled={closing} style={{ border: "1px solid #E2E8F0", background: "white", color: "#475569", fontSize: 13, fontWeight: 600, cursor: "pointer", padding: "9px 16px", borderRadius: 9 }}>← Précédent</button>
            )}
            {step === 0 ? (
              <button onClick={() => setStep(1)} style={{ border: "none", background: "linear-gradient(135deg,#4F46E5,#6366F1)", color: "white", fontSize: 13, fontWeight: 700, cursor: "pointer", padding: "9px 20px", borderRadius: 9, boxShadow: "0 2px 8px rgba(79,70,229,0.35)" }}>Suivant →</button>
            ) : (
              <button onClick={finish} disabled={closing} style={{ border: "none", background: "linear-gradient(135deg,#4F46E5,#6366F1)", color: "white", fontSize: 13, fontWeight: 700, cursor: closing ? "default" : "pointer", padding: "9px 20px", borderRadius: 9, boxShadow: "0 2px 8px rgba(79,70,229,0.35)", opacity: closing ? 0.7 : 1 }}>C'est parti ✓</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function MairieApp() {
  const { user, refreshUser } = useAuth();
  const isAdmin = user?.role === "admin";
  // Gestion des agents : réservée aux responsables (mairie) / super admins ET
  // conditionnée à la permission « utilisateurs.manage » du rôle personnalisé éventuel.
  const canManageUsers = (user?.role === "admin" || user?.role === "mairie") && hasPermission(user, "utilisateurs.manage");
  const [commune, setCommuteRaw] = useState(user?.commune ?? "");
  const [userCommunes, setUserCommunes] = useState<string[]>([]);
  const [communesLoaded, setCommunesLoaded] = useState(false);
  const [showNouveauDossier, setShowNouveauDossier] = useState(false);
  const [onboardingDismissed, setOnboardingDismissed] = useState(false);
  const [onboardingParams, setOnboardingParams] = useSearchParams();
  const [messageBadge, setMessageBadge] = useState(0);
  const [signaturesBadge, setSignaturesBadge] = useState(0);
  const [isSignataire, setIsSignataire] = useState(false);
  const [communeInseeMap, setCommuneInseeMap] = useState<Record<string, string>>(COMMUNE_INSEE);
  const routerNavigate = useNavigate();
  const location = useLocation();

  const setCommune = (c: string) => {
    setCommuteRaw(c);
    try { localStorage.setItem(COMMUNE_STORAGE_KEY(user?.id), c); } catch { /* ignore */ }
  };

  // Load communes accessible to this user
  useEffect(() => {
    api.get<{ name: string; insee_code: string | null }[]>("/mairie/my-communes")
      .then(data => {
        const names = data.map(c => c.name).filter(Boolean);
        setUserCommunes(names);
        // Mettre à jour l'INSEE map
        const map: Record<string, string> = { ...COMMUNE_INSEE };
        for (const c of data) { if (c.name && c.insee_code) map[c.name] = c.insee_code; }
        setCommuneInseeMap(map);
        // Restaurer depuis localStorage, sinon première commune de la liste
        setCommuteRaw(prev => {
          try {
            const stored = localStorage.getItem(COMMUNE_STORAGE_KEY(user?.id));
            if (stored && names.includes(stored)) return stored;
          } catch { /* ignore */ }
          if (prev && names.includes(prev)) return prev;
          return names[0] ?? prev;
        });
      })
      .catch(() => {})
      .finally(() => setCommunesLoaded(true));
  }, [user?.id]);

  // Load commune list from DB to get correct INSEE codes
  const refreshCommuneInseeMap = useCallback(() => {
    api.get<{ name: string; insee_code: string }[]>("/mairie/commune-list")
      .then(data => {
        if (!data.length) return;
        const map: Record<string, string> = { ...COMMUNE_INSEE };
        for (const c of data) { if (c.name && c.insee_code) map[c.name] = c.insee_code; }
        setCommuneInseeMap(map);
      })
      .catch(() => {});
  }, []);
  useEffect(() => { refreshCommuneInseeMap(); }, [refreshCommuneInseeMap]);

  // Charge le badge initial quand la commune change ; MessageScreen maintient ensuite le total en temps réel
  useEffect(() => {
    api.get<{ count: number }>(`/mairie/conversations/unread-count?commune=${encodeURIComponent(commune)}`)
      .then(d => setMessageBadge(Number(d.count)))
      .catch(() => {});
  }, [commune]);

  const checkSignataireStatus = useCallback(() => {
    api.get<{ isSignataire: boolean }>("/decisions/is-signataire")
      .then(d => {
        setIsSignataire(d.isSignataire);
        if (d.isSignataire) {
          api.get<{ count: number }>("/decisions/pending-count")
            .then(d2 => setSignaturesBadge(d2.count))
            .catch(() => {});
        } else {
          setSignaturesBadge(0);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    checkSignataireStatus();
    const onFocus = () => checkSignataireStatus();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [checkSignataireStatus]);

  const pathname = location.pathname;
  const active = pathname.startsWith("/mairie/dossiers") ? "Dossiers"
    : pathname.startsWith("/mairie/messagerie") ? "Messagerie"
    : pathname.startsWith("/mairie/calendrier") ? "Calendrier"
    : pathname.startsWith("/mairie/carte") ? "Carte"
    : pathname.startsWith("/mairie/statistiques") ? "Statistiques"
    : pathname.startsWith("/mairie/signatures") ? "Signatures"
    : pathname.startsWith("/mairie/parametres") ? "Paramètres"
    : pathname.startsWith("/mairie/profil") ? "Infos Perso"
    : "Tableau de bord";

  const setActive = (s: string) => routerNavigate(LABEL_TO_PATH[s] ?? "/mairie");

  const handleDossierClick = (dossier: DossierInfo) => {
    routerNavigate(`/mairie/dossiers/${dossier.id}`, { state: { dossier } });
  };

  const navigateDossiers = (filter: string) => {
    routerNavigate(`/mairie/dossiers?filter=${encodeURIComponent(filter)}`);
  };

  if (communesLoaded && userCommunes.length === 0) {
    return <NoCommuneAssignedScreen prenom={user?.prenom ?? ""} />;
  }

  // Tant que la liste des communes accessibles n'est pas chargée, on n'affiche
  // rien — sinon les écrans rendent avec `commune=""` ou la commune principale
  // par défaut, ce qui provoque un flash de carte centrée sur Ballan-Miré
  // avant que localStorage restaure la dernière commune sélectionnée.
  if (!communesLoaded) {
    return (
      <div style={{ fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", background: "#F8F9FC", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: "#64748b", fontSize: 13 }}>
        Chargement…
      </div>
    );
  }

  return (
    <div style={{ fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", background: "#F8F9FC", minHeight: "100vh", display: "flex" }}>
      <Sidebar active={active} setActive={setActive} commune={commune} setCommune={setCommune} messageBadge={messageBadge} signaturesBadge={signaturesBadge} isSignataire={isSignataire} communes={userCommunes} />
      <div style={{ marginLeft: 200, flex: 1, minHeight: "100vh", display: "flex", flexDirection: "column" }}>
        {active !== "Messagerie" && (
          <Topbar onNewDossier={active === "Dossiers" && hasPermission(user, "dossiers.create") ? () => setShowNouveauDossier(true) : undefined} navigate={setActive} onDossierClick={handleDossierClick} commune={commune} communes={userCommunes} setCommune={setCommune} onViewAllNotifications={() => routerNavigate("/mairie/parametres?tab=notifications")} />
        )}
        <div style={{ flex: 1, overflowY: "auto" }}>
          <Routes>
            <Route index element={<RequirePerm perms={NAV_PERMS["/mairie"]!}><DashboardScreen navigate={setActive} navigateDossiers={navigateDossiers} commune={commune} inseeCode={communeInseeMap[commune]} onDossierClick={handleDossierClick} /></RequirePerm>} />
            <Route path="dossiers" element={<RequirePerm perms={NAV_PERMS["/mairie/dossiers"]!}><DossiersScreen commune={commune} onDossierClick={handleDossierClick} /></RequirePerm>} />
            <Route path="dossiers/:id" element={<RequirePerm perms={NAV_PERMS["/mairie/dossiers"]!}><DossierDetailRoute navigate={setActive} commune={commune} communes={userCommunes} setCommune={setCommune} communeInseeMap={communeInseeMap} /></RequirePerm>} />
            <Route path="messagerie" element={<RequirePerm perms={NAV_PERMS["/mairie/messagerie"]!}><MessageScreen commune={commune} onDossierClick={handleDossierClick} onUnreadChange={setMessageBadge} /></RequirePerm>} />
            <Route path="calendrier" element={<RequirePerm perms={NAV_PERMS["/mairie/calendrier"]!}><CalendrierScreen commune={commune} /></RequirePerm>} />
            <Route path="carte" element={<RequirePerm perms={NAV_PERMS["/mairie/carte"]!}><CarteScreen commune={commune} setCommune={setCommune} communeInseeMap={communeInseeMap} /></RequirePerm>} />
            <Route path="statistiques" element={<RequirePerm perms={NAV_PERMS["/mairie/statistiques"]!}><StatistiquesScreen commune={commune} /></RequirePerm>} />
            <Route path="parametres" element={<RequirePerm perms={NAV_PERMS["/mairie/parametres"]!}><ParametresScreen commune={commune} communes={userCommunes} isAdmin={isAdmin} canManageUsers={canManageUsers} communeInseeMap={communeInseeMap} onInseeUpdated={refreshCommuneInseeMap} /></RequirePerm>} />
            <Route path="signatures" element={<SignaturesPendantesScreen />} />
            <Route path="profil" element={<InfosPersoScreen />} />
            <Route path="*" element={<Navigate to="/mairie" replace />} />
          </Routes>
        </div>
      </div>
      {showNouveauDossier && <NouveauDossierModal onClose={() => setShowNouveauDossier(false)} commune={commune} />}
      {(() => {
        // Affiché à la 1re connexion d'un agent (flag onboarding non posé), ou
        // sur demande explicite via ?guide=1 (bouton « Revoir le guide »).
        const replay = onboardingParams.get("guide") === "1";
        const isAgent = user?.role === "instructeur" || user?.role === "mairie";
        const firstLogin = !!isAgent && user?.onboarding_completed === false && !onboardingDismissed;
        if (!replay && !firstLogin) return null;
        return (
          <OnboardingModal
            prenom={user?.prenom ?? ""}
            onComplete={() => {
              setOnboardingDismissed(true);
              if (replay) {
                const sp = new URLSearchParams(onboardingParams);
                sp.delete("guide");
                setOnboardingParams(sp, { replace: true });
              }
              refreshUser().catch(() => {});
            }}
          />
        );
      })()}
    </div>
  );
}
