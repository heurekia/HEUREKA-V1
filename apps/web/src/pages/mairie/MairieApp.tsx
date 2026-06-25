import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { Routes, Route, Navigate, useNavigate, useLocation, useParams, useSearchParams } from "react-router-dom";
import { api, ApiError } from "../../lib/api";
import { normalizeForSearch } from "../../lib/utils";
import { useAuth } from "../../hooks/useAuth";
import { TemplateManagerPanel, CommuneLetterheadPanel } from "./MairieCourrierScreen";
import { ROLE_LABELS, STATUS_LABEL, TYPE_LABEL, fmtDate, stringToColor, nameInitials, fmtConvTime, COMMUNE_INSEE, DOSSIER_TYPE_OPTIONS, type ApiDossier, type NouveauDossierType, type DossierInfo, type WorkflowMeta, type DelaiBreakdown } from "./shared";
import {
  StatusBadge,
  HomeIcon, FolderIcon, CalendarIcon, MessageIcon, MapIcon, ChartIcon, SettingsIcon,
  BellIcon, SearchIcon, PlusIcon, HelpIcon, BuildingIcon, ChevronDownIcon, DotsIcon,
  PenIcon, SendIcon,
} from "./ui";
import { DashboardScreen } from "./DashboardScreen";
import { DossiersScreen } from "./DossiersScreen";
import { MessageScreen } from "./MessageScreen";
import { CarteScreen } from "./CarteScreen";
import { ReglementationScreen } from "./ReglementationScreen";
import { DossierDetailScreen } from "./DossierDetailScreen";
import { CalendrierScreen } from "./CalendrierScreen";
import { StatistiquesScreen } from "./StatistiquesScreen";
import BundleSplitModal from "./BundleSplitModal";
import {
  STATUS_LABELS as DOSSIER_STATUS_LABELS,
  primaryNextAction as primaryNextActionFor,
  type DossierStatus,
  describeSeismicZone,
  describeFloodRisk,
  describeClayRisk,
  describeRadonLevel,
  seismicShortLabel,
  supConsequence,
  prescriptionConsequence,
} from "@heureka-v1/shared";

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

function Sidebar({ active, setActive, commune, setCommune, messageBadge = 0, signaturesBadge = 0, isSignataire = false, communes = [] }: { active: string; setActive: (s: string) => void; commune: string; setCommune: (c: string) => void; messageBadge?: number; signaturesBadge?: number; isSignataire?: boolean; communes?: string[] }) {
  const [showDrop, setShowDrop] = useState(false);
  const [search, setSearch] = useState("");
  const { logout, user } = useAuth();
  const manyCommunes = communes.length > 5;
  const normalizedSearch = normalizeForSearch(search);
  const filtered = manyCommunes
    ? communes.filter(c => normalizeForSearch(c).includes(normalizedSearch))
    : communes;
  const visibleNavItems = NAV_ITEMS.filter(item => item.label !== "Signatures" || isSignataire);
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

type ApiNotif = { id: string; type: string; title: string; message: string; is_read: boolean; dossier_id: string | null; created_at: string };

function notifIcon(type: string) {
  if (type.includes("message")) return "💬";
  if (type.includes("delai") || type.includes("echeance") || type.includes("incomplet")) return "⏰";
  if (type.includes("decision") || type.includes("accepte") || type.includes("refuse")) return "✅";
  if (type.includes("dossier") || type.includes("nouveau")) return "📁";
  return "🔔";
}
function notifColor(type: string) {
  if (type.includes("delai") || type.includes("echeance") || type.includes("incomplet") || type.includes("refuse")) return "#EF4444";
  if (type.includes("message")) return "#3B82F6";
  return "#4F46E5";
}
function relTime(d: string) {
  const ms = Date.now() - new Date(d).getTime();
  if (ms < 60_000) return "À l'instant";
  if (ms < 3_600_000) return `Il y a ${Math.floor(ms / 60_000)} min`;
  if (ms < 86_400_000) return `Il y a ${Math.floor(ms / 3_600_000)}h`;
  if (ms < 172_800_000) return "Hier";
  return `Il y a ${Math.floor(ms / 86_400_000)}j`;
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

function Topbar({ buttonLabel = "Nouveau dossier", onNewDossier, navigate, onDossierClick, commune = "", onViewAllNotifications }: { title?: string; buttonLabel?: string; onNewDossier?: () => void; navigate?: (s: string) => void; onDossierClick?: (d: DossierInfo) => void; commune?: string; onViewAllNotifications?: () => void }) {
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
                ) : apiNotifs.slice(0, 8).map(n => (
                  <div key={n.id} onClick={() => handleNotifClick(n)}
                    style={{ padding: "10px 16px", display: "flex", alignItems: "flex-start", gap: 10, borderBottom: "1px solid #F8FAFC", cursor: "pointer", background: n.is_read ? "white" : "#F8F7FF", transition: "background 0.15s" }}>
                    <div style={{ width: 32, height: 32, borderRadius: 8, background: notifColor(n.type) + "18", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, flexShrink: 0 }}>{notifIcon(n.type)}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, color: "#0F172A", fontWeight: n.is_read ? 400 : 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{n.title}</div>
                      <div style={{ fontSize: 11, color: "#64748b", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{n.message}</div>
                      <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 2 }}>{relTime(n.created_at)}</div>
                    </div>
                    {!n.is_read && <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#4F46E5", flexShrink: 0, marginTop: 4 }} />}
                  </div>
                ))}
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




function communeCode(c: string): string {
  const l = c.toLowerCase();
  if (l.includes("ballan")) return "BM";
  if (l.includes("joué") || l.includes("joue")) return "JT";
  if (l.includes("tours")) return "TR";
  if (l.includes("avertin")) return "SA";
  if (l.includes("riche")) return "LR";
  return c.replace(/\s+/g, "").slice(0, 3).toUpperCase();
}

// Numéros de dossiers existants dans la DB par commune, à utiliser dans les consultations services
const COMMUNE_DOSSIERS: Record<string, { d1: string; d2: string; d3: string; d4: string; d5: string }> = {
  "Ballan-Miré":    { d1: "PC-BM-2024-001", d2: "PC-BM-2024-022", d3: "PC-BM-2024-001", d4: "DP-BM-2024-015", d5: "DP-BM-2024-008" },
  "Tours":          { d1: "PC-2024-001",     d2: "PC-TR-2024-004", d3: "PC-TR-2024-011", d4: "DP-2024-042",     d5: "DP-TR-2024-007" },
  "Saint-Avertin":  { d1: "PC-SA-2024-001",  d2: "PC-SA-2024-009", d3: "PC-SA-2024-001", d4: "PC-SA-2024-009",  d5: "DP-SA-2024-005" },
  "Joué-lès-Tours": { d1: "PC-JT-2024-003",  d2: "PC-JT-2024-018", d3: "PC-JT-2024-031", d4: "PC-JT-2024-018",  d5: "DP-JT-2024-011" },
  "La Riche":       { d1: "PC-LR-2024-002",  d2: "PC-LR-2024-027", d3: "PC-LR-2024-002", d4: "PC-LR-2024-027",  d5: "PC-LR-2024-014" },
};

function IngestPluSection() {
  const [communeName, setCommuneName] = useState("");
  const [inseeCode, setInseeCode] = useState("");
  const [zipCode, setZipCode] = useState("");
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<string | null>(null);
  const [result, setResult] = useState<{ ok: boolean; commune: string; zones: number; rules: number; needs_review: number; detail: Array<{ zone: string; rules: number; vision: number }> } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleSubmit = async () => {
    if (!communeName.trim() || !inseeCode.trim() || !pdfFile) {
      setError("Tous les champs sont requis.");
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    setStep("Lecture du PDF…");
    try {
      const buf = await pdfFile.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let binary = "";
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
      const pdf_base64 = btoa(binary);

      setStep("Analyse des zones par IA (peut prendre 30-60s)…");
      const r = await api.post<{ ok: boolean; commune: string; zones: number; rules: number; needs_review: number; detail: Array<{ zone: string; rules: number; vision: number }> }>(
        "/mairie/admin/ingest-plu-pdf",
        { commune_name: communeName.trim(), insee_code: inseeCode.trim(), zip_code: zipCode.trim() || undefined, pdf_base64 },
      );
      setResult(r);
      setStep(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur serveur");
      setStep(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: 640 }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: "#0F172A", marginBottom: 4 }}>Ajouter une nouvelle commune</div>
      <div style={{ fontSize: 13, color: "#64748b", marginBottom: 20 }}>
        Importez le règlement PLU (PDF) d'une commune. L'IA extrait les zones et règles automatiquement.
        Les règles sont stockées en statut <strong>brouillon</strong> — elles nécessitent une validation humaine avant d'être utilisées.
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", gap: 12 }}>
          <div style={{ flex: 2 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#64748b", marginBottom: 4 }}>Nom de la commune *</div>
            <input
              value={communeName}
              onChange={e => setCommuneName(e.target.value)}
              placeholder="ex : Rochecorbon"
              style={{ width: "100%", padding: "8px 12px", border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 13, outline: "none", boxSizing: "border-box" }}
            />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#64748b", marginBottom: 4 }}>Code INSEE *</div>
            <input
              value={inseeCode}
              onChange={e => setInseeCode(e.target.value)}
              placeholder="ex : 37194"
              style={{ width: "100%", padding: "8px 12px", border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 13, outline: "none", boxSizing: "border-box" }}
            />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#64748b", marginBottom: 4 }}>Code postal</div>
            <input
              value={zipCode}
              onChange={e => setZipCode(e.target.value)}
              placeholder="ex : 37210"
              style={{ width: "100%", padding: "8px 12px", border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 13, outline: "none", boxSizing: "border-box" }}
            />
          </div>
        </div>
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: "#64748b", marginBottom: 4 }}>Règlement PLU (PDF) *</div>
          <div
            onClick={() => fileRef.current?.click()}
            style={{ border: "2px dashed #CBD5E1", borderRadius: 10, padding: "20px 16px", textAlign: "center", cursor: "pointer", background: pdfFile ? "#F0FDF4" : "#F8FAFC", transition: "background 0.15s" }}
          >
            {pdfFile ? (
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#16a34a" }}>{pdfFile.name}</div>
                <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>{(pdfFile.size / 1024 / 1024).toFixed(1)} Mo — cliquez pour changer</div>
              </div>
            ) : (
              <div>
                <div style={{ fontSize: 13, color: "#64748b" }}>Cliquez pour sélectionner un PDF</div>
                <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>Règlement PLU uniquement (pas le RI) — max ~35 Mo</div>
              </div>
            )}
            <input ref={fileRef} type="file" accept="application/pdf" style={{ display: "none" }} onChange={e => { setPdfFile(e.target.files?.[0] ?? null); setResult(null); setError(null); }} />
          </div>
        </div>
        {error && (
          <div style={{ background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#DC2626" }}>{error}</div>
        )}
        {step && (
          <div style={{ background: "#EEF2FF", border: "1px solid #C7D2FE", borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#4F46E5", display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 14, height: 14, border: "2px solid #4F46E5", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.8s linear infinite", flexShrink: 0 }} />
            {step}
          </div>
        )}
        {result && (
          <div style={{ background: "#F0FDF4", border: "1px solid #86EFAC", borderRadius: 8, padding: "14px 16px" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#16a34a", marginBottom: 8 }}>
              Ingestion terminée — {result.commune}
            </div>
            <div style={{ fontSize: 13, color: "#15803d", marginBottom: 10 }}>
              {result.zones} zone{result.zones > 1 ? "s" : ""} · {result.rules} règle{result.rules > 1 ? "s" : ""} extraites
              {result.needs_review > 0 && ` · ${result.needs_review} à vérifier (schéma)`}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {result.detail.map(d => (
                <span key={d.zone} style={{ background: "#DCFCE7", color: "#166534", borderRadius: 6, padding: "3px 8px", fontSize: 12, fontWeight: 600 }}>
                  {d.zone} ({d.rules}){d.vision > 0 ? " ⚠" : ""}
                </span>
              ))}
            </div>
            <div style={{ fontSize: 11, color: "#64748b", marginTop: 10 }}>
              Statut : brouillon — rendez-vous dans l'onglet Réglementation pour valider les règles.
            </div>
          </div>
        )}
        <button
          onClick={handleSubmit}
          disabled={loading || !communeName || !inseeCode || !pdfFile}
          style={{ alignSelf: "flex-start", background: loading ? "#A5B4FC" : "#4F46E5", color: "white", border: "none", borderRadius: 8, padding: "10px 22px", fontSize: 13, fontWeight: 600, cursor: loading ? "not-allowed" : "pointer" }}
        >
          {loading ? "Traitement en cours…" : "Lancer l'ingestion"}
        </button>
      </div>
    </div>
  );
}

type CommuneData = {
  id: string; name: string; insee_code: string; zip_code: string | null;
  email: string | null; telephone: string | null; logo_url: string | null;
  population: string | null; surface: string | null;
  departement: string | null; region: string | null; description: string | null;
};

type StaffUser = {
  id: string; email: string; prenom: string; nom: string;
  role: string; commune: string | null; telephone: string | null; created_at: string;
  role_config_id: string | null;
};

type RoleConfig = {
  id: string; label: string; base_role: string; color: string; permissions: string[];
};

type InseeCandidate = { nom: string; insee: string; zip: string | null; departement: string | null; region: string | null };

function CommuneGeneralTab({ commune, isAdmin, onInseeUpdated }: { commune: string; isAdmin: boolean; onInseeUpdated?: () => void }) {
  const [data, setData] = useState<CommuneData | null>(null);
  const [form, setForm] = useState<Partial<CommuneData>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [inseeSearch, setInseeSearch] = useState("");
  const [inseeCandidates, setInseeCandidates] = useState<InseeCandidate[]>([]);
  const [inseeSearching, setInseeSearching] = useState(false);

  useEffect(() => {
    setLoading(true);
    api.get<CommuneData>(`/mairie/admin/commune-details?commune=${encodeURIComponent(commune)}`)
      .then(d => { setData(d); setForm(d); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [commune]);

  const searchInsee = async () => {
    if (inseeSearch.length < 2) return;
    setInseeSearching(true);
    try {
      const results = await api.get<InseeCandidate[]>(`/mairie/admin/insee-lookup?nom=${encodeURIComponent(inseeSearch)}`);
      setInseeCandidates(results);
    } catch { /* ignore */ }
    finally { setInseeSearching(false); }
  };

  const applyCandidate = (c: InseeCandidate) => {
    setForm(f => ({ ...f, insee_code: c.insee, zip_code: c.zip ?? f.zip_code, departement: c.departement ?? f.departement, region: c.region ?? f.region }));
    setInseeCandidates([]);
    setInseeSearch("");
  };

  const save = async () => {
    setSaving(true);
    try {
      const updated = await api.patch<CommuneData>(`/mairie/admin/commune-details?commune=${encodeURIComponent(commune)}`, form);
      setData(updated); setForm(updated); setSaved(true);
      setTimeout(() => setSaved(false), 3000);
      onInseeUpdated?.();
    } catch { /* ignore */ }
    finally { setSaving(false); }
  };

  if (loading) return <div style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>Chargement…</div>;

  const validateInp = (type: string, val: string): "valid" | "invalid" | null => {
    if (!val) return null;
    if (type === "email") return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(val) ? "valid" : "invalid";
    if (type === "tel") return /^(0[1-9]\d{8}|(\+33|0033)[1-9]\d{8})$/.test(val.replace(/[\s.()-]/g, "")) ? "valid" : "invalid";
    return null;
  };
  const formatTelInp = (raw: string) => {
    const d = raw.replace(/[^\d+]/g, "");
    if (d.startsWith("0") && d.length <= 10) return d.replace(/(\d{2})(?=\d)/g, "$1 ").trim();
    return raw;
  };

  const inp = (label: string, field: keyof CommuneData, readOnly = false, type = "text") => {
    const raw = (form[field] as string) ?? "";
    const val = type === "tel" ? formatTelInp(raw) : raw;
    const editable = isAdmin && !readOnly;
    const status = editable ? validateInp(type, val) : null;
    const borderColor = status === "valid" ? "#10B981" : status === "invalid" ? "#EF4444" : "#E2E8F0";
    return (
      <div key={field}>
        <div style={{ fontSize: 11, color: "#94a3b8", textTransform: "uppercase" as const, letterSpacing: "0.06em", marginBottom: 4 }}>{label}</div>
        <div style={{ position: "relative" as const }}>
          <input
            type={type === "tel" ? "tel" : type}
            value={val}
            onChange={e => editable && setForm(f => ({ ...f, [field]: type === "tel" ? formatTelInp(e.target.value) : e.target.value }))}
            readOnly={!editable}
            placeholder={type === "email" ? "mairie@commune.fr" : type === "tel" ? "06 12 34 56 78" : undefined}
            style={{ width: "100%", boxSizing: "border-box" as const, padding: "8px 12px", paddingRight: status ? 28 : 12, border: `1px solid ${borderColor}`, borderRadius: 8, fontSize: 13, color: "#374151", outline: "none", background: !editable ? "#F8FAFC" : "white", cursor: !editable ? "default" : "text", transition: "border-color 0.15s" }}
            onFocus={e => { if (editable) e.target.style.borderColor = status === "invalid" ? "#EF4444" : "#4F46E5"; }}
            onBlur={e => { e.target.style.borderColor = borderColor; }}
          />
          {status && (
            <span style={{ position: "absolute" as const, right: 8, top: "50%", transform: "translateY(-50%)", fontSize: 13, color: status === "valid" ? "#10B981" : "#EF4444", pointerEvents: "none" as const }}>
              {status === "valid" ? "✓" : "✕"}
            </span>
          )}
        </div>
        {status === "invalid" && (
          <div style={{ fontSize: 11, color: "#EF4444", marginTop: 3 }}>
            {type === "email" ? "Format invalide — ex : mairie@commune.fr" : "Format invalide — ex : 06 12 34 56 78"}
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", padding: 20, display: "flex", gap: 20, alignItems: "flex-start" }}>
        <div style={{ width: 80, height: 80, borderRadius: 12, border: "1px solid #E2E8F0", overflow: "hidden", flexShrink: 0, background: "#F8FAFC", display: "flex", alignItems: "center", justifyContent: "center" }}>
          {form.logo_url
            ? <img src={form.logo_url} alt="logo" style={{ width: "100%", height: "100%", objectFit: "contain" }} onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
            : <span style={{ fontSize: 28, color: "#CBD5E1" }}>🏛</span>}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: "#0F172A", marginBottom: 4 }}>Logo de la commune</div>
          <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 8 }}>URL d'un fichier PNG ou SVG (logo officiel de la commune).</div>
          {isAdmin && (
            <input
              value={form.logo_url ?? ""}
              onChange={e => setForm(f => ({ ...f, logo_url: e.target.value }))}
              placeholder="https://..."
              style={{ width: "100%", boxSizing: "border-box" as const, padding: "7px 12px", border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 12, color: "#374151", outline: "none" }}
            />
          )}
        </div>
      </div>
      <div style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", padding: 24 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: "#0F172A", marginBottom: 16 }}>Informations générales</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          {inp("Nom de la commune", "name", true)}
          <div>
            <div style={{ fontSize: 11, color: "#94a3b8", textTransform: "uppercase" as const, letterSpacing: "0.06em", marginBottom: 4 }}>Code INSEE</div>
            <div style={{ display: "flex", gap: 6 }}>
              <input
                value={(form.insee_code as string) ?? ""}
                readOnly
                style={{ flex: 1, padding: "8px 12px", border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 13, color: "#374151", outline: "none", background: "#F8FAFC" }}
              />
              {isAdmin && (
                <div style={{ position: "relative" }}>
                  <div style={{ display: "flex", gap: 4 }}>
                    <input
                      value={inseeSearch}
                      onChange={e => setInseeSearch(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && searchInsee()}
                      placeholder="Chercher…"
                      style={{ width: 120, padding: "8px 10px", border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 12, outline: "none" }}
                    />
                    <button onClick={searchInsee} disabled={inseeSearching} style={{ padding: "8px 12px", background: "#4F46E5", color: "white", border: "none", borderRadius: 8, fontSize: 12, cursor: "pointer", whiteSpace: "nowrap" }}>
                      {inseeSearching ? "…" : "Trouver"}
                    </button>
                  </div>
                  {inseeCandidates.length > 0 && (
                    <div style={{ position: "absolute", top: "100%", right: 0, zIndex: 50, background: "white", border: "1px solid #E2E8F0", borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.12)", minWidth: 280, marginTop: 4 }}>
                      {inseeCandidates.map(c => (
                        <div key={c.insee} onClick={() => applyCandidate(c)}
                          style={{ padding: "10px 14px", cursor: "pointer", borderBottom: "1px solid #F8FAFC" }}
                          onMouseEnter={e => (e.currentTarget.style.background = "#F8FAFC")}
                          onMouseLeave={e => (e.currentTarget.style.background = "white")}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: "#0F172A" }}>{c.nom}</div>
                          <div style={{ fontSize: 11, color: "#94a3b8" }}>INSEE {c.insee} · {c.zip ?? "—"} · {c.departement ?? "—"}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
          {inp("Département", "departement")}
          {inp("Région", "region")}
          {inp("Code postal", "zip_code")}
          {inp("Population", "population")}
          {inp("Surface", "surface")}
          {inp("Email contact urbanisme", "email", false, "email")}
          {inp("Téléphone", "telephone", false, "tel")}
        </div>
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 11, color: "#94a3b8", textTransform: "uppercase" as const, letterSpacing: "0.06em", marginBottom: 4 }}>Description / Contexte</div>
          <textarea
            value={(form.description as string) ?? ""}
            onChange={e => isAdmin && setForm(f => ({ ...f, description: e.target.value }))}
            readOnly={!isAdmin}
            rows={3}
            style={{ width: "100%", boxSizing: "border-box" as const, padding: "8px 12px", border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 13, color: "#374151", outline: "none", resize: "vertical", background: !isAdmin ? "#F8FAFC" : "white" }}
          />
        </div>
        {!isAdmin && (
          <div style={{ marginTop: 12, padding: "10px 14px", background: "#FFF7ED", border: "1px solid #FED7AA", borderRadius: 8, fontSize: 12, color: "#92400E" }}>
            Seuls les administrateurs peuvent modifier les informations de la commune.
          </div>
        )}
        {isAdmin && (
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 20, gap: 8, alignItems: "center" }}>
            {saved && <span style={{ fontSize: 12, color: "#22C55E", fontWeight: 600 }}>Enregistré ✓</span>}
            <button onClick={() => setForm(data ?? {})} style={{ border: "1px solid #E2E8F0", background: "white", borderRadius: 8, padding: "8px 16px", fontSize: 13, color: "#64748b", cursor: "pointer" }}>Annuler</button>
            <button onClick={save} disabled={saving} style={{ background: "linear-gradient(135deg,#4F46E5,#6366F1)", color: "white", border: "none", borderRadius: 8, padding: "8px 20px", fontSize: 13, fontWeight: 600, cursor: saving ? "not-allowed" : "pointer" }}>
              {saving ? "Enregistrement…" : "Enregistrer"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function CommuneUsersTab({ commune, isAdmin, currentUserId }: { commune: string; isAdmin: boolean; currentUserId?: string }) {
  const [userList, setUserList] = useState<StaffUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showAddModal, setShowAddModal] = useState(false);
  const [addForm, setAddForm] = useState({ prenom: "", nom: "", email: "", role: "instructeur", telephone: "", role_config_id: "" });
  const [addError, setAddError] = useState("");
  const [addLoading, setAddLoading] = useState(false);
  const [addedPw, setAddedPw] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editRoleConfigId, setEditRoleConfigId] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [roleConfigs, setRoleConfigs] = useState<RoleConfig[]>([]);
  const [communeSigs, setCommuneSigs] = useState<{ id: string; user_id: string; role: string; delegation_arrete: string | null }[]>([]);
  const [sigModal, setSigModal] = useState<{ userId: string; name: string } | null>(null);
  const [sigRole, setSigRole] = useState("maire");
  const [sigDelegation, setSigDelegation] = useState("");
  const [sigSaving, setSigSaving] = useState(false);

  const load = () => {
    setLoading(true);
    api.get<StaffUser[]>(`/mairie/admin/users?commune=${encodeURIComponent(commune)}`)
      .then(setUserList)
      .catch(() => setUserList([]))
      .finally(() => setLoading(false));
  };
  const loadSigs = () => {
    api.get<{ id: string; user_id: string; role: string; delegation_arrete: string | null }[]>(
      `/decisions/communes/${encodeURIComponent(commune)}/signataires`
    ).then(setCommuneSigs).catch(() => {});
  };
  useEffect(() => { load(); loadSigs(); }, [commune]);

  useEffect(() => {
    api.get<RoleConfig[]>("/admin/roles").then(setRoleConfigs).catch(() => {});
  }, []);

  const filtered = userList.filter(u => `${u.prenom} ${u.nom} ${u.email}`.toLowerCase().includes(search.toLowerCase()));

  const addUser = async () => {
    setAddError("");
    if (!addForm.prenom || !addForm.nom || !addForm.email) { setAddError("Prénom, nom et email sont requis."); return; }
    if (!addForm.role_config_id && !addForm.role) { setAddError("Sélectionnez un rôle."); return; }
    setAddLoading(true);
    try {
      const selectedConfig = roleConfigs.find(rc => rc.id === addForm.role_config_id);
      const role = selectedConfig ? selectedConfig.base_role : addForm.role;
      await api.post(`/mairie/admin/users?commune=${encodeURIComponent(commune)}`, {
        prenom: addForm.prenom,
        nom: addForm.nom,
        email: addForm.email,
        telephone: addForm.telephone,
        role,
        role_config_id: addForm.role_config_id || null,
      });
      setAddedPw("invitation_sent");
      load();
    } catch (e: unknown) {
      setAddError(e instanceof Error ? e.message : "Erreur lors de la création.");
    } finally { setAddLoading(false); }
  };

  const saveRole = async (id: string) => {
    const selectedConfig = roleConfigs.find(rc => rc.id === editRoleConfigId);
    const role = selectedConfig ? selectedConfig.base_role : "instructeur";
    await api.patch(`/mairie/admin/users/${id}`, { role, role_config_id: editRoleConfigId || null });
    setEditingId(null);
    load();
  };

  const deleteUser = async (id: string) => {
    await api.delete(`/mairie/admin/users/${id}`);
    setDeleteId(null);
    load();
  };

  const ROLE_LABELS: Record<string, string> = { admin: "Admin", mairie: "Mairie", instructeur: "Instructeur" };
  const ROLE_COLORS: Record<string, string> = { admin: "#DC2626", mairie: "#4F46E5", instructeur: "#0891B2" };

  const getUserRoleLabel = (u: StaffUser) => {
    if (u.role_config_id) {
      const config = roleConfigs.find(rc => rc.id === u.role_config_id);
      if (config) return config.label;
    }
    return ROLE_LABELS[u.role] ?? u.role;
  };

  const getUserRoleColor = (u: StaffUser) => {
    if (u.role_config_id) {
      const config = roleConfigs.find(rc => rc.id === u.role_config_id);
      if (config) return config.color;
    }
    return ROLE_COLORS[u.role] ?? "#94a3b8";
  };

  const initials = (u: StaffUser) => `${u.prenom[0] ?? ""}${u.nom[0] ?? ""}`.toUpperCase();
  const getSig = (userId: string) => communeSigs.find(s => s.user_id === userId);
  const SIG_ROLES = [
    { key: "maire", label: "Maire" },
    { key: "adjoint", label: "Adjoint au Maire" },
    { key: "dgs", label: "Dir. Général des Services" },
    { key: "responsable_ads", label: "Responsable ADS" },
    { key: "directeur", label: "Directeur de service" },
  ];
  const SIG_LABELS: Record<string, string> = Object.fromEntries(SIG_ROLES.map(r => [r.key, r.label]));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12 }}>
        {[
          ["Agents", String(userList.length), "#4F46E5"],
          ["Instructeurs", String(userList.filter(u => u.role === "instructeur").length), "#0891B2"],
          ["Admins", String(userList.filter(u => u.role === "admin").length), "#DC2626"],
        ].map(([l, v, c]) => (
          <div key={l} style={{ background: "white", border: "1px solid #E2E8F0", borderRadius: 10, padding: "14px 16px", display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 22, fontWeight: 700, color: c }}>{v}</span>
            <span style={{ fontSize: 12, color: "#64748b" }}>{l}</span>
          </div>
        ))}
      </div>
      <div style={{ background: "white", border: "1px solid #E2E8F0", borderRadius: 12, padding: 16, display: "flex", gap: 10, alignItems: "center" }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Rechercher un utilisateur…"
          style={{ flex: 1, padding: "8px 12px", border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 13, outline: "none" }} />
        {isAdmin && (
          <button onClick={() => { setShowAddModal(true); setAddedPw(""); setAddError(""); setAddForm({ prenom: "", nom: "", email: "", role: "instructeur", telephone: "", role_config_id: "" }); }}
            style={{ background: "linear-gradient(135deg,#4F46E5,#6366F1)", color: "white", border: "none", borderRadius: 8, padding: "8px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>
            + Ajouter un agent
          </button>
        )}
      </div>
      <div style={{ background: "white", border: "1px solid #E2E8F0", borderRadius: 12, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "#F8FAFC" }}>
              {["Agent", "Email", "Rôle", "Téléphone", ...(isAdmin ? ["Actions"] : [])].map(h => (
                <th key={h} style={{ padding: "10px 16px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "#64748b", textTransform: "uppercase" as const, letterSpacing: "0.06em" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={isAdmin ? 5 : 4} style={{ padding: 32, textAlign: "center", color: "#94a3b8" }}>Chargement…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={isAdmin ? 5 : 4} style={{ padding: 32, textAlign: "center", color: "#94a3b8" }}>Aucun utilisateur trouvé.</td></tr>
            ) : filtered.map(u => (
              <tr key={u.id} style={{ borderTop: "1px solid #F1F5F9" }}>
                <td style={{ padding: "12px 16px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ width: 32, height: 32, borderRadius: "50%", background: "linear-gradient(135deg,#4F46E5,#7C3AED)", color: "white", fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{initials(u)}</div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 500, color: "#0F172A" }}>{u.prenom} {u.nom}</div>
                      {u.id === currentUserId && <span style={{ fontSize: 10, background: "#EEF2FF", color: "#4F46E5", borderRadius: 4, padding: "1px 5px", fontWeight: 600 }}>Vous</span>}
                    </div>
                  </div>
                </td>
                <td style={{ padding: "12px 16px", fontSize: 12, color: "#64748b" }}>{u.email}</td>
                <td style={{ padding: "12px 16px" }}>
                  {isAdmin && editingId === u.id ? (
                    <div style={{ display: "flex", gap: 4 }}>
                      <select value={editRoleConfigId} onChange={e => setEditRoleConfigId(e.target.value)}
                        style={{ padding: "4px 8px", border: "1px solid #E2E8F0", borderRadius: 6, fontSize: 12, maxWidth: 160 }}>
                        <option value="">— Sélectionner —</option>
                        {roleConfigs.map(rc => <option key={rc.id} value={rc.id}>{rc.label}</option>)}
                      </select>
                      <button onClick={() => saveRole(u.id)} style={{ padding: "4px 8px", background: "#4F46E5", color: "white", border: "none", borderRadius: 6, fontSize: 11, cursor: "pointer" }}>✓</button>
                      <button onClick={() => setEditingId(null)} style={{ padding: "4px 8px", background: "#F1F5F9", color: "#64748b", border: "none", borderRadius: 6, fontSize: 11, cursor: "pointer" }}>✕</button>
                    </div>
                  ) : (
                    <div style={{ display: "flex", flexWrap: "wrap" as const, gap: 4, alignItems: "center" }}>
                      <span style={{ background: `${getUserRoleColor(u)}18`, color: getUserRoleColor(u), fontSize: 11, fontWeight: 600, borderRadius: 6, padding: "3px 8px", border: `1px solid ${getUserRoleColor(u)}33` }}>{getUserRoleLabel(u)}</span>
                      {getSig(u.id) && (
                        <span style={{ background: "#FEF9C3", color: "#92400E", fontSize: 10, fontWeight: 600, borderRadius: 5, padding: "2px 6px", border: "1px solid #FDE68A" }}>
                          ✍️ {SIG_LABELS[getSig(u.id)!.role] ?? getSig(u.id)!.role}
                        </span>
                      )}
                    </div>
                  )}
                </td>
                <td style={{ padding: "12px 16px", fontSize: 12, color: "#64748b" }}>{u.telephone ?? "—"}</td>
                {isAdmin && (
                  <td style={{ padding: "12px 16px" }}>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button onClick={() => { setEditingId(u.id); setEditRoleConfigId(u.role_config_id ?? ""); }}
                        style={{ border: "1px solid #E2E8F0", background: "white", borderRadius: 6, padding: "4px 10px", fontSize: 11, color: "#4F46E5", cursor: "pointer" }}>Rôle</button>
                      <button onClick={() => { const s = getSig(u.id); setSigModal({ userId: u.id, name: `${u.prenom} ${u.nom}` }); setSigRole(s?.role ?? "maire"); setSigDelegation(s?.delegation_arrete ?? ""); }}
                        title="Habilitation signature ADS"
                        style={{ border: `1px solid ${getSig(u.id) ? "#FDE68A" : "#E2E8F0"}`, background: getSig(u.id) ? "#FEF9C3" : "white", borderRadius: 6, padding: "4px 8px", fontSize: 11, color: getSig(u.id) ? "#92400E" : "#64748b", cursor: "pointer" }}>✍️</button>
                      {u.id !== currentUserId && (
                        <button onClick={() => setDeleteId(u.id)}
                          style={{ border: "1px solid #FEE2E2", background: "#FFF5F5", borderRadius: 6, padding: "4px 10px", fontSize: 11, color: "#EF4444", cursor: "pointer" }}>Retirer</button>
                      )}
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {showAddModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "white", borderRadius: 16, padding: 28, width: 480, boxShadow: "0 24px 64px rgba(0,0,0,0.2)" }}>
            {addedPw ? (
              <>
                <div style={{ fontSize: 36, textAlign: "center", marginBottom: 12 }}>✉️</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: "#0F172A", marginBottom: 8, textAlign: "center" }}>Invitation envoyée !</div>
                <div style={{ background: "#F0FDF4", border: "1px solid #BBF7D0", borderRadius: 8, padding: 16, marginBottom: 20, fontSize: 13, color: "#166534", lineHeight: 1.6 }}>
                  Un email d'invitation a été envoyé à <strong>{addForm.email}</strong>.<br />
                  L'agent recevra un lien pour définir son mot de passe, valable <strong>7 jours</strong>.
                </div>
                <button onClick={() => setShowAddModal(false)} style={{ width: "100%", background: "linear-gradient(135deg,#4F46E5,#6366F1)", color: "white", border: "none", borderRadius: 8, padding: "10px 0", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>Fermer</button>
              </>
            ) : (
              <>
                <div style={{ fontSize: 16, fontWeight: 700, color: "#0F172A", marginBottom: 4 }}>Ajouter un agent</div>
                <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 20 }}>Un email d'invitation sera envoyé à l'agent pour qu'il définisse son propre mot de passe.</div>
                {addError && <div style={{ background: "#FFF5F5", border: "1px solid #FECACA", borderRadius: 8, padding: "10px 14px", fontSize: 12, color: "#DC2626", marginBottom: 14 }}>{addError}</div>}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
                  {[["Prénom", "prenom"], ["Nom", "nom"]].map(([l, k]) => (
                    <div key={k ?? ""}>
                      <div style={{ fontSize: 11, color: "#94a3b8", textTransform: "uppercase" as const, letterSpacing: "0.06em", marginBottom: 4 }}>{l}</div>
                      <input value={(addForm as Record<string, string>)[k ?? ""] ?? ""} onChange={e => setAddForm(f => ({ ...f, [k ?? ""]: e.target.value }))}
                        style={{ width: "100%", boxSizing: "border-box" as const, padding: "8px 12px", border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 13, outline: "none" }} />
                    </div>
                  ))}
                </div>
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 11, color: "#94a3b8", textTransform: "uppercase" as const, letterSpacing: "0.06em", marginBottom: 4 }}>Email</div>
                  <div style={{ position: "relative" as const }}>
                    <input type="email" value={addForm.email} onChange={e => setAddForm(f => ({ ...f, email: e.target.value }))}
                      placeholder="agent@commune.fr"
                      style={{ width: "100%", boxSizing: "border-box" as const, padding: "8px 12px", paddingRight: addForm.email ? 28 : 12, border: `1px solid ${addForm.email ? (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(addForm.email) ? "#10B981" : "#EF4444") : "#E2E8F0"}`, borderRadius: 8, fontSize: 13, outline: "none" }}
                      onFocus={e => { e.target.style.borderColor = addForm.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(addForm.email) ? "#EF4444" : "#4F46E5"; }}
                      onBlur={e => { e.target.style.borderColor = addForm.email ? (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(addForm.email) ? "#10B981" : "#EF4444") : "#E2E8F0"; }} />
                    {addForm.email && <span style={{ position: "absolute" as const, right: 8, top: "50%", transform: "translateY(-50%)", fontSize: 13, color: /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(addForm.email) ? "#10B981" : "#EF4444" }}>{/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(addForm.email) ? "✓" : "✕"}</span>}
                  </div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 20 }}>
                  <div>
                    <div style={{ fontSize: 11, color: "#94a3b8", textTransform: "uppercase" as const, letterSpacing: "0.06em", marginBottom: 4 }}>Rôle</div>
                    <select value={addForm.role_config_id} onChange={e => {
                      const rc = roleConfigs.find(r => r.id === e.target.value);
                      setAddForm(f => ({ ...f, role_config_id: e.target.value, role: rc ? rc.base_role : "instructeur" }));
                    }}
                      style={{ width: "100%", padding: "8px 12px", border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 13, outline: "none", background: "white" }}>
                      <option value="">— Sélectionner —</option>
                      {roleConfigs.map(rc => <option key={rc.id} value={rc.id}>{rc.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: "#94a3b8", textTransform: "uppercase" as const, letterSpacing: "0.06em", marginBottom: 4 }}>Téléphone</div>
                    <input type="tel" value={addForm.telephone}
                      placeholder="06 12 34 56 78"
                      onChange={e => { const d = e.target.value.replace(/[^\d+]/g, ""); const fmt = d.startsWith("0") && d.length <= 10 ? d.replace(/(\d{2})(?=\d)/g, "$1 ").trim() : e.target.value; setAddForm(f => ({ ...f, telephone: fmt })); }}
                      style={{ width: "100%", boxSizing: "border-box" as const, padding: "8px 12px", border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 13, outline: "none" }} />
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                  <button onClick={() => setShowAddModal(false)} style={{ border: "1px solid #E2E8F0", background: "white", borderRadius: 8, padding: "8px 16px", fontSize: 13, color: "#64748b", cursor: "pointer" }}>Annuler</button>
                  <button onClick={addUser} disabled={addLoading} style={{ background: "linear-gradient(135deg,#4F46E5,#6366F1)", color: "white", border: "none", borderRadius: 8, padding: "8px 20px", fontSize: 13, fontWeight: 600, cursor: addLoading ? "not-allowed" : "pointer" }}>
                    {addLoading ? "Création…" : "Créer le compte"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
      {deleteId && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "white", borderRadius: 16, padding: 28, width: 380, boxShadow: "0 24px 64px rgba(0,0,0,0.2)" }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#0F172A", marginBottom: 8 }}>Retirer cet utilisateur ?</div>
            <div style={{ fontSize: 13, color: "#64748b", marginBottom: 20 }}>Cette action est irréversible. L'utilisateur perdra immédiatement l'accès à la plateforme.</div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => setDeleteId(null)} style={{ border: "1px solid #E2E8F0", background: "white", borderRadius: 8, padding: "8px 16px", fontSize: 13, color: "#64748b", cursor: "pointer" }}>Annuler</button>
              <button onClick={() => deleteUser(deleteId)} style={{ background: "#EF4444", color: "white", border: "none", borderRadius: 8, padding: "8px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Confirmer la suppression</button>
            </div>
          </div>
        </div>
      )}
      {/* ── Modal habilitation signature ADS ── */}
      {sigModal && (() => {
        const currentSig = getSig(sigModal.userId);
        return (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => setSigModal(null)}>
            <div style={{ background: "white", borderRadius: 14, padding: 24, width: 460, boxShadow: "0 24px 64px rgba(0,0,0,0.2)" }} onClick={e => e.stopPropagation()}>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#0F172A", marginBottom: 3 }}>Signature ADS — {sigModal.name}</div>
              <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 18 }}>Habilitation à signer les arrêtés pour <strong>{commune}</strong>.</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 600, color: "#64748b", display: "block", marginBottom: 5 }}>Titre / Fonction</label>
                  <select value={sigRole} onChange={e => setSigRole(e.target.value)} style={{ width: "100%", padding: "8px 10px", border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 12.5, outline: "none", background: "white" }}>
                    {SIG_ROLES.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 600, color: "#64748b", display: "block", marginBottom: 5 }}>N° arrêté de délégation</label>
                  <input value={sigDelegation} onChange={e => setSigDelegation(e.target.value)} placeholder="2024-DEL-001 (facultatif)" style={{ width: "100%", padding: "8px 10px", border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 12.5, outline: "none", boxSizing: "border-box" as const }} />
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, justifyContent: currentSig ? "space-between" : "flex-end" }}>
                {currentSig && (
                  <button onClick={() => {
                    setSigSaving(true);
                    api.delete(`/decisions/communes/${encodeURIComponent(commune)}/signataires/${currentSig.id}`)
                      .then(() => { loadSigs(); setSigModal(null); })
                      .catch(() => {})
                      .finally(() => setSigSaving(false));
                  }} disabled={sigSaving} style={{ border: "1px solid #FECACA", background: "#FFF5F5", borderRadius: 8, padding: "8px 14px", fontSize: 12, color: "#EF4444", cursor: "pointer" }}>
                    Retirer l'habilitation
                  </button>
                )}
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => setSigModal(null)} style={{ border: "1px solid #E2E8F0", background: "white", borderRadius: 8, padding: "8px 14px", fontSize: 12, color: "#64748b", cursor: "pointer" }}>Annuler</button>
                  <button onClick={() => {
                    setSigSaving(true);
                    const p = currentSig
                      ? api.put(`/decisions/communes/${encodeURIComponent(commune)}/signataires/${currentSig.id}`, { role: sigRole, delegation_arrete: sigDelegation || null })
                      : api.post(`/decisions/communes/${encodeURIComponent(commune)}/signataires`, { user_id: sigModal.userId, role: sigRole, delegation_arrete: sigDelegation || null });
                    p.then(() => { loadSigs(); setSigModal(null); })
                      .catch(() => {})
                      .finally(() => setSigSaving(false));
                  }} disabled={sigSaving} style={{ background: "linear-gradient(135deg,#4F46E5,#6366F1)", color: "white", border: "none", borderRadius: 8, padding: "8px 16px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                    {sigSaving ? "…" : currentSig ? "Mettre à jour" : "Accorder l'habilitation"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

function SignatairesPanel({ commune }: { commune: string }) {
  type SignRow = { id: string; user_id: string; commune: string; role: string; delegation_arrete: string | null; active: boolean; user: { id: string; prenom: string; nom: string; email: string } | null };
  const [rows, setRows] = useState<SignRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [communeUsers, setCommuneUsers] = useState<{ id: string; prenom: string; nom: string; email: string }[]>([]);
  const [newUserId, setNewUserId] = useState("");
  const [newRole, setNewRole] = useState("maire");
  const [newDelegation, setNewDelegation] = useState("");
  const [saving, setSaving] = useState(false);

  const ROLES = [
    { key: "maire", label: "Maire" },
    { key: "adjoint", label: "Adjoint au Maire" },
    { key: "dgs", label: "Directeur Général des Services" },
    { key: "responsable_ads", label: "Responsable ADS" },
    { key: "directeur", label: "Directeur de service" },
  ];

  const load = () => {
    api.get<SignRow[]>(`/decisions/communes/${encodeURIComponent(commune)}/signataires`)
      .then(data => setRows(data))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [commune]);

  useEffect(() => {
    if (!showAdd) return;
    api.get<{ id: string; prenom: string; nom: string; email: string }[]>(`/mairie/commune-users?commune=${encodeURIComponent(commune)}`)
      .then(data => setCommuneUsers(data))
      .catch(() => {});
  }, [showAdd, commune]);

  const handleAdd = async () => {
    if (!newUserId || !newRole) return;
    setSaving(true);
    try {
      await api.post(`/decisions/communes/${encodeURIComponent(commune)}/signataires`, {
        user_id: newUserId,
        role: newRole,
        delegation_arrete: newDelegation || null,
      });
      setShowAdd(false);
      setNewUserId(""); setNewRole("maire"); setNewDelegation("");
      load();
    } catch { /* ignore */ } finally { setSaving(false); }
  };

  const handleRemove = async (id: string) => {
    await api.delete(`/decisions/communes/${encodeURIComponent(commune)}/signataires/${id}`);
    load();
  };

  return (
    <div style={{ maxWidth: 680 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#0F172A", marginBottom: 2 }}>Signataires autorisés</div>
          <div style={{ fontSize: 12, color: "#94a3b8" }}>Personnes habilitées à signer les arrêtés ADS pour {commune}.</div>
        </div>
        <button onClick={() => setShowAdd(!showAdd)} style={{ background: "linear-gradient(135deg,#4F46E5,#6366F1)", color: "white", border: "none", borderRadius: 9, padding: "9px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
          + Ajouter un signataire
        </button>
      </div>

      {showAdd && (
        <div style={{ background: "#F8FAFC", borderRadius: 12, border: "1px solid #E2E8F0", padding: 16, marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#0F172A", marginBottom: 12 }}>Nouveau signataire</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: "#64748b", display: "block", marginBottom: 5 }}>Utilisateur</label>
              <select value={newUserId} onChange={e => setNewUserId(e.target.value)} style={{ width: "100%", padding: "8px 10px", border: "1px solid #E2E8F0", borderRadius: 7, fontSize: 12.5, outline: "none" }}>
                <option value="">Sélectionner…</option>
                {communeUsers.map(u => (
                  <option key={u.id} value={u.id}>{u.prenom} {u.nom} ({u.email})</option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: "#64748b", display: "block", marginBottom: 5 }}>Rôle / Titre</label>
              <select value={newRole} onChange={e => setNewRole(e.target.value)} style={{ width: "100%", padding: "8px 10px", border: "1px solid #E2E8F0", borderRadius: 7, fontSize: 12.5, outline: "none" }}>
                {ROLES.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}
              </select>
            </div>
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 11, fontWeight: 700, color: "#64748b", display: "block", marginBottom: 5 }}>N° arrêté de délégation (facultatif)</label>
            <input value={newDelegation} onChange={e => setNewDelegation(e.target.value)} placeholder="Ex : 2024-DEL-001" style={{ width: "100%", padding: "8px 10px", border: "1px solid #E2E8F0", borderRadius: 7, fontSize: 12.5, outline: "none", boxSizing: "border-box" as const }} />
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button onClick={() => setShowAdd(false)} style={{ border: "1px solid #E2E8F0", background: "white", borderRadius: 7, padding: "7px 14px", fontSize: 12.5, cursor: "pointer" }}>Annuler</button>
            <button onClick={handleAdd} disabled={!newUserId || saving} style={{ background: "#4F46E5", color: "white", border: "none", borderRadius: 7, padding: "7px 14px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>
              {saving ? "Enregistrement…" : "Ajouter"}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div style={{ color: "#94a3b8", fontSize: 13 }}>Chargement…</div>
      ) : rows.length === 0 ? (
        <div style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", padding: "32px 24px", textAlign: "center" as const }}>
          <div style={{ fontSize: 32, marginBottom: 10 }}>✍️</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: "#0F172A", marginBottom: 4 }}>Aucun signataire configuré</div>
          <div style={{ fontSize: 12, color: "#94a3b8" }}>Ajoutez les personnes habilitées à signer les arrêtés ADS.</div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column" as const, gap: 10 }}>
          {rows.map(row => (
            <div key={row.id} style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", padding: "14px 18px", display: "flex", alignItems: "center", gap: 14 }}>
              <div style={{ width: 38, height: 38, borderRadius: "50%", background: "linear-gradient(135deg,#4F46E5,#6366F1)", color: "white", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 800, flexShrink: 0 }}>
                {row.user ? `${row.user.prenom[0] ?? ""}${row.user.nom[0] ?? ""}`.toUpperCase() : "?"}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: "#0F172A" }}>{row.user ? `${row.user.prenom} ${row.user.nom}` : "—"}</div>
                <div style={{ fontSize: 11.5, color: "#64748b" }}>{ROLE_LABELS[row.role] ?? row.role}{row.delegation_arrete ? ` · Délég. ${row.delegation_arrete}` : ""}</div>
              </div>
              <span style={{ fontSize: 11, fontWeight: 600, color: "#15803D", background: "#DCFCE7", borderRadius: 6, padding: "2px 8px", border: "1px solid #BBF7D0" }}>Actif</span>
              <button onClick={() => handleRemove(row.id)} style={{ border: "1px solid #FECACA", background: "white", borderRadius: 7, padding: "5px 10px", fontSize: 11.5, color: "#EF4444", cursor: "pointer" }}>Retirer</button>
            </div>
          ))}
        </div>
      )}

    </div>
  );
}

function ParametresScreen({ commune = "", isAdmin = false, canManageUsers = false, communeInseeMap = COMMUNE_INSEE, onInseeUpdated }: { commune?: string; isAdmin?: boolean; canManageUsers?: boolean; communeInseeMap?: Record<string, string>; onInseeUpdated?: () => void }) {
  const { user } = useAuth();
  const settingsTabs = ["Général", "Utilisateurs", "Réglementation", "Documents", "Workflow & Délais", "Notifications", "Courriers", "Intégrations"];
  const TAB_SLUGS: Record<string, string> = {
    "Général": "general",
    "Utilisateurs": "utilisateurs",
    "Réglementation": "reglementation",
    "Documents": "documents",
    "Workflow & Délais": "workflow",
    "Notifications": "notifications",
    "Courriers": "courriers",
    "Intégrations": "integrations",
  };
  const SLUG_TO_TAB: Record<string, string> = Object.fromEntries(Object.entries(TAB_SLUGS).map(([tab, slug]) => [slug, tab]));
  const NOTIF_SUBS = ["historique", "evenements", "canaux"] as const;
  type NotifSub = (typeof NOTIF_SUBS)[number];
  const [searchParams, setSearchParams] = useSearchParams();
  const [stab, setStab] = useState(() => SLUG_TO_TAB[searchParams.get("tab") ?? ""] ?? "Réglementation");
  const selectTab = (t: string) => {
    setStab(t);
    const sp = new URLSearchParams(searchParams);
    sp.set("tab", TAB_SLUGS[t] ?? "reglementation");
    if (t !== "Notifications") sp.delete("sub");
    setSearchParams(sp);
  };
  // Garde l'onglet synchronisé avec l'URL (liens directs, navigation arrière/avant)
  useEffect(() => {
    const t = SLUG_TO_TAB[searchParams.get("tab") ?? ""];
    if (t && t !== stab) setStab(t);
  }, [searchParams]);
  const [events, setEvents] = useState([
    { label: "Nouveau dossier déposé", sub: "Lorsqu'un nouveau dossier est déposé par un pétitionnaire.", icon: "📋", active: true },
    { label: "Dossier assigné", sub: "Lorsqu'un dossier vous est assigné.", icon: "👤", active: true },
    { label: "Demande de pièces", sub: "Lorsqu'une demande de pièces complémentaires est envoyée.", icon: "📎", active: true },
    { label: "Pièce complémentaire reçue", sub: "Lorsqu'une pièce complémentaire est déposée.", icon: "⬇️", active: true },
    { label: "Avis émis", sub: "Lorsqu'un avis est émis sur un dossier.", icon: "💬", active: true },
    { label: "Décision prise", sub: "Lorsqu'une décision est prise sur un dossier.", icon: "✅", active: true },
    { label: "Délai dépassé", sub: "Lorsqu'un délai de traitement est dépassé.", icon: "⚠️", active: true },
    { label: "Commentaire sur un dossier", sub: "Lorsqu'un commentaire est ajouté sur un dossier.", icon: "💭", active: true },
  ]);
  const toggleEvent = (label: string) => setEvents(es => es.map(e => e.label === label ? { ...e, active: !e.active } : e));
  const [channels, setChannels] = useState([
    { icon: "✉️", label: "Email", sub: "Recevoir les notifications par email.", active: true },
    { icon: "🔔", label: "Plateforme", sub: "Notifications dans la plateforme.", active: true },
    { icon: "💬", label: "SMS", sub: "Recevoir les notifications par SMS.", active: false },
  ]);
  const toggleChannel = (label: string) => setChannels(cs => cs.map(c => c.label === label ? { ...c, active: !c.active } : c));
  const [recipientMode, setRecipientMode] = useState(0);
  const [notifSubTab, setNotifSubTab] = useState<NotifSub>(() => {
    const s = searchParams.get("sub");
    return NOTIF_SUBS.includes(s as NotifSub) ? (s as NotifSub) : "historique";
  });
  const selectNotifSubTab = (val: NotifSub) => {
    setNotifSubTab(val);
    const sp = new URLSearchParams(searchParams);
    sp.set("tab", "notifications");
    sp.set("sub", val);
    setSearchParams(sp);
  };
  // Synchronise le sous-onglet Notifications avec l'URL (?sub=)
  useEffect(() => {
    const s = searchParams.get("sub");
    if (NOTIF_SUBS.includes(s as NotifSub) && s !== notifSubTab) setNotifSubTab(s as NotifSub);
  }, [searchParams]);
  const [histNotifs, setHistNotifs] = useState<ApiNotif[]>([]);
  const [histLoading, setHistLoading] = useState(false);
  const loadHistNotifs = () => {
    setHistLoading(true);
    api.get<ApiNotif[]>("/notifications").then(setHistNotifs).catch(() => {}).finally(() => setHistLoading(false));
  };
  useEffect(() => { if (stab === "Notifications") loadHistNotifs(); }, [stab]);
  const markAllHistRead = async () => {
    await api.patch("/notifications/read-all").catch(() => {});
    setHistNotifs(ns => ns.map(n => ({ ...n, is_read: true })));
  };
  const markOneRead = (n: ApiNotif) => {
    if (!n.is_read) {
      api.patch(`/notifications/${n.id}/read`).catch(() => {});
      setHistNotifs(ns => ns.map(x => x.id === n.id ? { ...x, is_read: true } : x));
    }
  };
  return (
    <div style={{ padding: 24 }}>
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "#0F172A", marginBottom: 2 }}>Paramètres</h1>
        <p style={{ color: "#64748b", fontSize: 13 }}>Gérez les paramètres de votre commune, les utilisateurs, les documents et les préférences.</p>
      </div>
      <div style={{ display: "flex", gap: 0, borderBottom: "2px solid #E2E8F0", marginBottom: 24 }}>
        {settingsTabs.map(t => (
          <button key={t} onClick={() => selectTab(t)} style={{ border: "none", background: "none", padding: "8px 16px", fontSize: 13, fontWeight: stab === t ? 600 : 400, color: stab === t ? "#4F46E5" : "#64748b", borderBottom: stab === t ? "2px solid #4F46E5" : "2px solid transparent", marginBottom: -2, cursor: "pointer" }}>{t}</button>
        ))}
      </div>
      {stab === "Général" && <CommuneGeneralTab commune={commune} isAdmin={isAdmin} onInseeUpdated={onInseeUpdated} />}
      {stab === "Utilisateurs" && <CommuneUsersTab commune={commune} isAdmin={canManageUsers} currentUserId={user?.id} />}

      {stab === "Réglementation" && (
        <div style={{ minHeight: 400, margin: "0 -24px" }}>
          <ReglementationScreen commune={commune} inseeCode={communeInseeMap[commune]} />
        </div>
      )}
      {stab === "Documents" && (
        <div style={{ minHeight: 400, margin: "0 -24px" }}>
          <DocumentsPanel commune={commune} />
        </div>
      )}
      {stab === "Notifications" && (
        <div>
          {/* Sub-tabs */}
          <div style={{ display: "flex", gap: 0, borderBottom: "1px solid #E2E8F0", marginBottom: 20 }}>
            {([["historique", "Historique"], ["evenements", "Par événement"], ["canaux", "Canaux & Préférences"]] as const).map(([val, label]) => (
              <button key={val} onClick={() => selectNotifSubTab(val)}
                style={{ border: "none", background: "none", padding: "8px 16px", fontSize: 13, cursor: "pointer",
                  fontWeight: notifSubTab === val ? 600 : 400, color: notifSubTab === val ? "#4F46E5" : "#64748b",
                  borderBottom: notifSubTab === val ? "2px solid #4F46E5" : "2px solid transparent", marginBottom: -1 }}>
                {label}
                {val === "historique" && histNotifs.filter(n => !n.is_read).length > 0 && (
                  <span style={{ background: "#EF4444", color: "white", borderRadius: 6, fontSize: 10, fontWeight: 700, padding: "1px 5px", marginLeft: 6 }}>
                    {histNotifs.filter(n => !n.is_read).length}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Historique */}
          {notifSubTab === "historique" && (
            <div style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", overflow: "hidden" }}>
              <div style={{ padding: "14px 20px", borderBottom: "1px solid #F1F5F9", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: "#0F172A" }}>
                  Toutes les notifications
                  {histNotifs.filter(n => !n.is_read).length > 0 && (
                    <span style={{ background: "#EF4444", color: "white", borderRadius: 6, fontSize: 10, fontWeight: 700, padding: "1px 6px", marginLeft: 8 }}>
                      {histNotifs.filter(n => !n.is_read).length} non lues
                    </span>
                  )}
                </span>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={loadHistNotifs} style={{ border: "1px solid #E2E8F0", background: "white", borderRadius: 7, padding: "5px 12px", fontSize: 12, color: "#64748b", cursor: "pointer" }}>↻ Actualiser</button>
                  {histNotifs.some(n => !n.is_read) && (
                    <button onClick={markAllHistRead} style={{ border: "1px solid #4F46E5", background: "white", borderRadius: 7, padding: "5px 12px", fontSize: 12, color: "#4F46E5", fontWeight: 600, cursor: "pointer" }}>Tout marquer lu</button>
                  )}
                </div>
              </div>
              {histLoading ? (
                <div style={{ padding: 40, textAlign: "center", fontSize: 13, color: "#94a3b8" }}>Chargement…</div>
              ) : histNotifs.length === 0 ? (
                <div style={{ padding: 48, textAlign: "center" }}>
                  <div style={{ fontSize: 32, marginBottom: 8 }}>🔔</div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "#374151", marginBottom: 4 }}>Aucune notification</div>
                  <div style={{ fontSize: 12, color: "#94a3b8" }}>Vous êtes à jour !</div>
                </div>
              ) : histNotifs.map(n => (
                <div key={n.id} onClick={() => markOneRead(n)}
                  style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "14px 20px", borderBottom: "1px solid #F8FAFC", background: n.is_read ? "white" : "#F8F7FF", cursor: "pointer", transition: "background 0.15s" }}>
                  <div style={{ width: 36, height: 36, borderRadius: 10, background: notifColor(n.type) + "18", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0 }}>{notifIcon(n.type)}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                      <span style={{ fontSize: 13, fontWeight: n.is_read ? 500 : 700, color: "#0F172A" }}>{n.title}</span>
                      <span style={{ fontSize: 11, color: "#94a3b8", flexShrink: 0 }}>{relTime(n.created_at)}</span>
                    </div>
                    <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>{n.message}</div>
                  </div>
                  {!n.is_read && <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#4F46E5", flexShrink: 0, marginTop: 6 }} />}
                </div>
              ))}
            </div>
          )}

          {/* Par événement */}
          {notifSubTab === "evenements" && (
            <div style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", padding: 20 }}>
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#0F172A", marginBottom: 2 }}>Événements déclencheurs</div>
                <div style={{ fontSize: 12, color: "#94a3b8" }}>Activez les événements pour lesquels vous souhaitez recevoir une notification.</div>
              </div>
              <div style={{ fontSize: 11, color: "#94a3b8", textTransform: "uppercase" as const, letterSpacing: "0.06em", marginBottom: 8, display: "flex", justifyContent: "space-between" }}>
                <span>ÉVÉNEMENT</span><span>ACTIVÉ</span>
              </div>
              {events.map(ev => (
                <div key={ev.label} onClick={() => toggleEvent(ev.label)}
                  style={{ display: "flex", alignItems: "center", padding: "10px 0", borderBottom: "1px solid #F8FAFC", cursor: "pointer" }}>
                  <span style={{ fontSize: 18, marginRight: 10 }}>{ev.icon}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: "#0F172A" }}>{ev.label}</div>
                    <div style={{ fontSize: 11, color: "#94a3b8" }}>{ev.sub}</div>
                  </div>
                  <div onClick={e => { e.stopPropagation(); toggleEvent(ev.label); }}
                    style={{ width: 36, height: 20, borderRadius: 10, background: ev.active ? "#4F46E5" : "#E2E8F0", position: "relative", cursor: "pointer", flexShrink: 0, transition: "background 0.2s" }}>
                    <div style={{ width: 16, height: 16, borderRadius: "50%", background: "white", position: "absolute", top: 2, left: ev.active ? 18 : 2, transition: "left 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.2)" }} />
                  </div>
                </div>
              ))}
              <div style={{ marginTop: 12, fontSize: 12, color: "#94a3b8" }}>{events.filter(e => e.active).length}/{events.length} événements activés</div>
            </div>
          )}

          {/* Canaux & Préférences */}
          {notifSubTab === "canaux" && (
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap" as const }}>
              <div style={{ flex: 1, minWidth: 260, background: "white", borderRadius: 12, border: "1px solid #E2E8F0", padding: 20 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#0F172A", marginBottom: 4 }}>Canaux de notification</div>
                <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 14 }}>Sélectionnez les canaux actifs.</div>
                {channels.map(c => (
                  <div key={c.label} onClick={() => toggleChannel(c.label)}
                    style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, padding: 10, background: "#F8FAFC", borderRadius: 8, cursor: "pointer" }}>
                    <span style={{ fontSize: 16 }}>{c.icon}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: "#0F172A" }}>{c.label}</div>
                      <div style={{ fontSize: 11, color: "#94a3b8" }}>{c.sub}</div>
                    </div>
                    <div style={{ width: 32, height: 18, borderRadius: 9, background: c.active ? "#4F46E5" : "#E2E8F0", position: "relative", transition: "background 0.2s", flexShrink: 0 }}>
                      <div style={{ width: 14, height: 14, borderRadius: "50%", background: "white", position: "absolute", top: 2, left: c.active ? 16 : 2, transition: "left 0.2s", boxShadow: "0 1px 2px rgba(0,0,0,0.2)" }} />
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ flex: 1, minWidth: 260, display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", padding: 20 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "#0F172A", marginBottom: 4 }}>Destinataires</div>
                  <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 12 }}>Choisissez qui reçoit les notifications.</div>
                  {[
                    { label: "Utilisateurs concernés uniquement", sub: "Seuls les utilisateurs liés au dossier." },
                    { label: "Tous les instructeurs", sub: "Tous les instructeurs de la commune." },
                    { label: "Personnaliser", sub: "Choisir manuellement les destinataires." },
                  ].map((d, i) => (
                    <div key={d.label} onClick={() => setRecipientMode(i)}
                      style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 10, cursor: "pointer" }}>
                      <div style={{ width: 16, height: 16, borderRadius: "50%", flexShrink: 0, marginTop: 1, border: recipientMode === i ? "5px solid #4F46E5" : "2px solid #CBD5E1", background: "white", transition: "border 0.15s" }} />
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 500, color: "#0F172A" }}>{d.label}</div>
                        <div style={{ fontSize: 11, color: "#94a3b8" }}>{d.sub}</div>
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", padding: 20 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "#0F172A", marginBottom: 4 }}>Plages horaires</div>
                  <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 12 }}>Horaires d'envoi des notifications.</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 12, color: "#64748b" }}>De</span>
                    <select style={{ padding: "5px 8px", border: "1px solid #E2E8F0", borderRadius: 6, fontSize: 12 }}><option>08:00</option><option>09:00</option></select>
                    <span style={{ fontSize: 12, color: "#64748b" }}>à</span>
                    <select style={{ padding: "5px 8px", border: "1px solid #E2E8F0", borderRadius: 6, fontSize: 12 }}><option>18:00</option><option>19:00</option></select>
                  </div>
                  <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 8 }}>Les notifications hors plage seront envoyées le jour ouvré suivant.</div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
      {stab === "Workflow & Délais" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", padding: 20 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#0F172A", marginBottom: 4 }}>Délais légaux par type de dossier</div>
            <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 16 }}>Configurez les délais d'instruction pour chaque type de dossier.</div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "#F8FAFC" }}>
                  {["Type de dossier","Délai légal","Délai alerte","Délai maxi","Actions"].map(h => (
                    <th key={h} style={{ padding: "9px 12px", textAlign: "left", fontSize: 12, fontWeight: 600, color: "#64748b", borderBottom: "1px solid #E2E8F0" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[
                  { type: "Permis de construire (PC)", legal: "90j", alert: "75j", max: "120j" },
                  { type: "Déclaration préalable (DP)", legal: "30j", alert: "25j", max: "60j" },
                  { type: "Permis d'aménager (PA)", legal: "90j", alert: "75j", max: "120j" },
                  { type: "Certificat d'urbanisme (CU)", legal: "30j", alert: "25j", max: "45j" },
                  { type: "Permis de démolir (PD)", legal: "60j", alert: "50j", max: "90j" },
                ].map((r, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid #F8FAFC" }}>
                    <td style={{ padding: "10px 12px", fontSize: 13, color: "#374151", fontWeight: 500 }}>{r.type}</td>
                    {[r.legal, r.alert, r.max].map((v, j) => (
                      <td key={j} style={{ padding: "10px 12px" }}>
                        <input defaultValue={v} style={{ width: 70, padding: "5px 8px", border: "1px solid #E2E8F0", borderRadius: 6, fontSize: 12, color: "#374151", textAlign: "center" }} />
                      </td>
                    ))}
                    <td style={{ padding: "10px 12px" }}>
                      <button style={{ border: "none", background: "none", cursor: "pointer", color: "#94a3b8", padding: 4 }}><DotsIcon /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16, gap: 8 }}>
              <button style={{ border: "1px solid #E2E8F0", background: "white", borderRadius: 8, padding: "8px 16px", fontSize: 13, color: "#64748b", cursor: "pointer" }}>Réinitialiser</button>
              <button style={{ background: "linear-gradient(135deg,#4F46E5,#6366F1)", color: "white", border: "none", borderRadius: 8, padding: "8px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Enregistrer</button>
            </div>
          </div>
          <div style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", padding: 20 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#0F172A", marginBottom: 12 }}>Étapes du workflow</div>
            {[
              { step: "1", label: "Réception & Enregistrement", desc: "Accusé de réception automatique + création du dossier", auto: true },
              { step: "2", label: "Vérification de complétude", desc: "Vérification des pièces dans les 15 premiers jours", auto: false },
              { step: "3", label: "Consultation des services", desc: "Envoi aux organismes consultés selon le type", auto: false },
              { step: "4", label: "Instruction", desc: "Analyse et rédaction de la décision", auto: false },
              { step: "5", label: "Décision & Notification", desc: "Signature et envoi de la décision au pétitionnaire", auto: false },
            ].map((w) => (
              <div key={w.step} style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 12, padding: "10px 12px", background: "#F8FAFC", borderRadius: 8 }}>
                <div style={{ width: 28, height: 28, borderRadius: "50%", background: "#4F46E5", color: "white", fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{w.step}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#0F172A" }}>{w.label}</div>
                  <div style={{ fontSize: 11, color: "#94a3b8" }}>{w.desc}</div>
                </div>
                {w.auto && <span style={{ background: "#EEF2FF", color: "#4F46E5", fontSize: 10, fontWeight: 700, borderRadius: 4, padding: "2px 6px", flexShrink: 0 }}>AUTO</span>}
              </div>
            ))}
          </div>
        </div>
      )}
      {stab === "Courriers" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
          <CommuneLetterheadPanel inseeCode={communeInseeMap[commune]} />
          <div style={{ borderTop: "1px solid #E2E8F0", paddingTop: 28 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#0F172A", marginBottom: 4 }}>Modèles de courrier</div>
            <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 16 }}>Créez et gérez vos modèles de courrier avec variables dynamiques.</div>
            <TemplateManagerPanel inseeCode={communeInseeMap[commune]} />
          </div>
        </div>
      )}
      {stab === "Intégrations" && (
        <div style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", padding: 20 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#0F172A", marginBottom: 4 }}>Intégrations et services connectés</div>
          <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 20 }}>Gérez les connexions avec les services tiers.</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {[
              { name: "Portail ADS / PLAT'AU", desc: "Plateforme nationale de dépôt des autorisations d'urbanisme", status: "Actif", icon: "🏛" },
              { name: "DGFIP – Données foncières", desc: "Accès aux données cadastrales et fiscales", status: "Actif", icon: "🗺" },
              { name: "Géoportail de l'Urbanisme", desc: "Consultation des documents d'urbanisme (PLU, POS...)", status: "Actif", icon: "📍" },
              { name: "Chorus Pro", desc: "Facturation et paiement des actes d'urbanisme", status: "En attente", icon: "💳" },
              { name: "DocuSign", desc: "Signature électronique des arrêtés et courriers", status: "Désactivé", icon: "✍️" },
              { name: "Mailjet / SendGrid", desc: "Envoi des notifications par e-mail", status: "Actif", icon: "✉️" },
            ].map((int) => (
              <div key={int.name} style={{ border: "1px solid #E2E8F0", borderRadius: 12, padding: 16, display: "flex", gap: 12, alignItems: "flex-start" }}>
                <span style={{ fontSize: 24, flexShrink: 0 }}>{int.icon}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#0F172A", marginBottom: 2 }}>{int.name}</div>
                  <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 8 }}>{int.desc}</div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <StatusBadge status={int.status} />
                    <button style={{ border: "1px solid #E2E8F0", background: "white", borderRadius: 6, padding: "4px 10px", fontSize: 11, color: "#4F46E5", cursor: "pointer" }}>{int.status === "Désactivé" ? "Activer" : "Configurer"}</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Référentiel documentaire ───────────────────────────────────────────────────

const DOC_TYPES: { value: string; label: string; color: string }[] = [
  { value: "plu",   label: "PLU",   color: "#1E40AF" },
  { value: "ppri",  label: "PPRI",  color: "#EF4444" },
  { value: "oap",   label: "OAP",   color: "#8B5CF6" },
  { value: "peb",   label: "PEB",   color: "#F59E0B" },
  { value: "pprt",  label: "PPRT",  color: "#EC4899" },
  { value: "plh",   label: "PLH",   color: "#10B981" },
  { value: "zac",   label: "ZAC",   color: "#3B82F6" },
  { value: "plan_hauteurs", label: "Plan des hauteurs", color: "#0EA5E9" },
  { value: "autre", label: "Autre", color: "#64748B" },
];

type CommuneDoc = {
  id: string; type: string; name: string; original_filename: string;
  file_size: number | null; synthese: string | null; status: string; created_at: string;
  validation_status?: "valide" | "brouillon" | "rejete";
  validated_at?: string | null;
};

type Annotation = {
  id: string;
  segment_id: string;
  kind: "correction" | "precision" | "jurisprudence" | "warning";
  note: string;
  validation_status: "brouillon" | "valide" | "rejete";
  validated_at: string | null;
};

type Segment = {
  id: string;
  segment_code: string;
  raw_text: string;
  metadata: { page?: number; char_count?: number; [k: string]: unknown };
  char_count: number | null;
  annotations: Annotation[];
};

const KIND_META: Record<Annotation["kind"], { label: string; color: string; bg: string }> = {
  correction:    { label: "Correction",    color: "#B91C1C", bg: "#FEE2E2" },
  precision:     { label: "Précision",     color: "#1E40AF", bg: "#DBEAFE" },
  jurisprudence: { label: "Jurisprudence", color: "#9A3412", bg: "#FED7AA" },
  warning:       { label: "Attention",     color: "#92400E", bg: "#FEF3C7" },
};

function SegmentsModal({ docId, docName, onClose }: { docId: string; docName: string; onClose: () => void }) {
  const [segments, setSegments] = useState<Segment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ segmentId: string; annotationId?: string } | null>(null);
  const [draft, setDraft] = useState<{ kind: Annotation["kind"]; note: string }>({ kind: "precision", note: "" });
  const [saving, setSaving] = useState(false);

  const reload = () => {
    api.get<Segment[]>(`/mairie/documents/${docId}/segments`)
      .then(setSegments)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Erreur de chargement"));
  };
  useEffect(reload, [docId]);

  const startCreate = (segmentId: string) => { setEditing({ segmentId }); setDraft({ kind: "precision", note: "" }); };
  const startEdit = (segmentId: string, a: Annotation) => { setEditing({ segmentId, annotationId: a.id }); setDraft({ kind: a.kind, note: a.note }); };
  const cancel = () => setEditing(null);

  const save = async () => {
    if (!editing || !draft.note.trim()) return;
    setSaving(true);
    try {
      if (editing.annotationId) {
        await api.patch(`/mairie/annotations/${editing.annotationId}`, { kind: draft.kind, note: draft.note });
      } else {
        await api.post(`/mairie/segments/${editing.segmentId}/annotations`, { kind: draft.kind, note: draft.note });
      }
      setEditing(null);
      reload();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Échec de l'enregistrement");
    } finally { setSaving(false); }
  };

  const setStatus = async (annotationId: string, status: "valide" | "brouillon" | "rejete") => {
    try {
      await api.patch(`/mairie/annotations/${annotationId}`, { validation_status: status });
      reload();
    } catch (e) { alert(e instanceof Error ? e.message : "Échec"); }
  };

  const remove = async (annotationId: string) => {
    if (!confirm("Supprimer cette annotation ?")) return;
    try { await api.delete(`/mairie/annotations/${annotationId}`); reload(); }
    catch (e) { alert(e instanceof Error ? e.message : "Échec"); }
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.5)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "white", borderRadius: 14, maxWidth: 900, width: "100%", maxHeight: "90vh", display: "flex", flexDirection: "column", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
        <div style={{ padding: "18px 24px", borderBottom: "1px solid #E2E8F0", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#0F172A" }}>Passages indexés — {docName}</div>
            <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>Annotez un passage pour préciser la jurisprudence locale ou corriger une erreur d'édition.</div>
          </div>
          <button onClick={onClose} style={{ border: "none", background: "none", fontSize: 22, cursor: "pointer", color: "#94a3b8" }}>✕</button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
          {error && <div style={{ color: "#DC2626", padding: 16 }}>{error}</div>}
          {!segments && !error && <div style={{ textAlign: "center", color: "#94a3b8", padding: 40 }}>Chargement…</div>}
          {segments && segments.length === 0 && (
            <div style={{ textAlign: "center", color: "#94a3b8", padding: 40 }}>Aucun passage indexé. L'indexation a peut-être échoué.</div>
          )}
          {segments && segments.map((s) => {
            const page = s.metadata?.page;
            const isEditingThis = editing?.segmentId === s.id;
            return (
              <div key={s.id} style={{ background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 10, padding: 14, marginBottom: 14 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", letterSpacing: "0.05em" }}>
                    {s.segment_code}{page != null ? ` · Page ${page}` : ""}
                  </div>
                  {!isEditingThis && (
                    <button onClick={() => startCreate(s.id)} style={{ border: "1px solid #C7D2FE", background: "white", color: "#4F46E5", borderRadius: 6, padding: "3px 10px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>+ Annoter</button>
                  )}
                </div>
                <div style={{ fontSize: 13, color: "#334155", lineHeight: 1.55, whiteSpace: "pre-wrap" as const }}>{s.raw_text}</div>

                {s.annotations.length > 0 && (
                  <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
                    {s.annotations.map((a) => {
                      const meta = KIND_META[a.kind];
                      const isEditingThisAnn = isEditingThis && editing?.annotationId === a.id;
                      const validated = a.validation_status === "valide";
                      const rejected = a.validation_status === "rejete";
                      return (
                        <div key={a.id} style={{ background: "white", border: `1px solid ${validated ? "#A7F3D0" : rejected ? "#FECACA" : "#FDE68A"}`, borderRadius: 8, padding: 10 }}>
                          {isEditingThisAnn ? (
                            <div>
                              <select value={draft.kind} onChange={(e) => setDraft((d) => ({ ...d, kind: e.target.value as Annotation["kind"] }))} style={{ border: "1px solid #CBD5E1", borderRadius: 5, padding: "4px 8px", fontSize: 12, marginBottom: 6 }}>
                                {Object.entries(KIND_META).map(([v, m]) => <option key={v} value={v}>{m.label}</option>)}
                              </select>
                              <textarea value={draft.note} onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))} rows={3} style={{ width: "100%", border: "1px solid #CBD5E1", borderRadius: 5, padding: 8, fontSize: 12.5, fontFamily: "inherit", boxSizing: "border-box" }} />
                              <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, marginTop: 6 }}>
                                <button onClick={cancel} style={{ border: "1px solid #E2E8F0", background: "white", borderRadius: 5, padding: "4px 12px", fontSize: 11, cursor: "pointer" }}>Annuler</button>
                                <button onClick={() => void save()} disabled={saving || !draft.note.trim()} style={{ border: "none", background: saving ? "#A5B4FC" : "#4F46E5", color: "white", borderRadius: 5, padding: "4px 14px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>{saving ? "…" : "Enregistrer"}</button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                                <span style={{ fontSize: 10, fontWeight: 700, color: meta.color, background: meta.bg, padding: "2px 8px", borderRadius: 4, letterSpacing: "0.04em" }}>{meta.label.toUpperCase()}</span>
                                <span style={{ fontSize: 10, fontWeight: 700, color: validated ? "#047857" : rejected ? "#B91C1C" : "#B45309" }}>
                                  {validated ? `✓ Validé${a.validated_at ? ` ${new Date(a.validated_at).toLocaleDateString("fr-FR")}` : ""}` : rejected ? "✗ Rejeté" : "Brouillon"}
                                </span>
                                <div style={{ flex: 1 }} />
                                <button onClick={() => startEdit(s.id, a)} style={{ border: "none", background: "none", color: "#4F46E5", fontSize: 11, cursor: "pointer", fontWeight: 600 }}>Modifier</button>
                                <button onClick={() => void remove(a.id)} style={{ border: "none", background: "none", color: "#94a3b8", fontSize: 11, cursor: "pointer" }}>Supprimer</button>
                              </div>
                              <div style={{ fontSize: 12.5, color: "#334155", lineHeight: 1.5, whiteSpace: "pre-wrap" as const }}>{a.note}</div>
                              <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                                {!validated && <button onClick={() => void setStatus(a.id, "valide")} style={{ border: "none", background: "#047857", color: "white", borderRadius: 5, padding: "3px 10px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>Valider</button>}
                                {!rejected && <button onClick={() => void setStatus(a.id, "rejete")} style={{ border: "1px solid #FECACA", background: "white", color: "#B91C1C", borderRadius: 5, padding: "3px 10px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>Rejeter</button>}
                                {(validated || rejected) && <button onClick={() => void setStatus(a.id, "brouillon")} style={{ border: "1px solid #E2E8F0", background: "white", color: "#475569", borderRadius: 5, padding: "3px 10px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>Repasser en brouillon</button>}
                              </div>
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {isEditingThis && !editing?.annotationId && (
                  <div style={{ marginTop: 10, background: "white", border: "1px dashed #C7D2FE", borderRadius: 8, padding: 10 }}>
                    <select value={draft.kind} onChange={(e) => setDraft((d) => ({ ...d, kind: e.target.value as Annotation["kind"] }))} style={{ border: "1px solid #CBD5E1", borderRadius: 5, padding: "4px 8px", fontSize: 12, marginBottom: 6 }}>
                      {Object.entries(KIND_META).map(([v, m]) => <option key={v} value={v}>{m.label}</option>)}
                    </select>
                    <textarea value={draft.note} onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))} rows={3} placeholder="Ex: La cote NGF de référence est celle de 1997, pas celle reprise par erreur dans cette édition." style={{ width: "100%", border: "1px solid #CBD5E1", borderRadius: 5, padding: 8, fontSize: 12.5, fontFamily: "inherit", boxSizing: "border-box" }} />
                    <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, marginTop: 6 }}>
                      <button onClick={cancel} style={{ border: "1px solid #E2E8F0", background: "white", borderRadius: 5, padding: "4px 12px", fontSize: 11, cursor: "pointer" }}>Annuler</button>
                      <button onClick={() => void save()} disabled={saving || !draft.note.trim()} style={{ border: "none", background: saving ? "#A5B4FC" : "#4F46E5", color: "white", borderRadius: 5, padding: "4px 14px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>{saving ? "…" : "Créer en brouillon"}</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function DocumentsPanel({ commune }: { commune: string }) {
  const [docs, setDocs] = useState<CommuneDoc[]>([]);
  const [viewingSegments, setViewingSegments] = useState<{ id: string; name: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [form, setForm] = useState({ type: "ppri", name: "", synthese: "", file: null as File | null });
  const [dragOver, setDragOver] = useState(false);
  const [editingSynthese, setEditingSynthese] = useState<string | null>(null);
  const [syntheseDraft, setSyntheseDraft] = useState("");
  const [savingSynthese, setSavingSynthese] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    api.get<CommuneDoc[]>(`/mairie/documents?commune=${encodeURIComponent(commune)}`)
      .then(setDocs)
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [commune]);

  const handleFile = (file: File) => {
    if (file.type !== "application/pdf") return;
    setForm(f => ({ ...f, file, name: f.name || file.name.replace(/\.pdf$/i, "") }));
  };

  const upload = async () => {
    if (!form.file || !form.name.trim()) return;
    setUploading(true);
    setUploadError(null);
    try {
      const b64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          resolve(result.split(",")[1] ?? "");
        };
        reader.onerror = reject;
        reader.readAsDataURL(form.file!);
      });
      await api.post("/mairie/documents", {
        commune_name: commune,
        type: form.type,
        name: form.name.trim(),
        original_filename: form.file.name,
        file_size: form.file.size,
        pdf_base64: b64,
        synthese: form.synthese.trim() || undefined,
      });
      setShowForm(false);
      setForm({ type: "ppri", name: "", synthese: "", file: null });
      load();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erreur d'enregistrement";
      setUploadError(/payload|too large|413/i.test(msg)
        ? "Fichier trop volumineux pour être enregistré. La limite est de 60 Mo."
        : msg);
    } finally {
      setUploading(false);
    }
  };

  const deleteDoc = async (id: string) => {
    await api.delete(`/mairie/documents/${id}`).catch(() => {});
    setDocs(d => d.filter(x => x.id !== id));
  };

  const grouped = DOC_TYPES.map(t => ({
    ...t,
    items: docs.filter(d => d.type === t.value),
  })).filter(g => g.items.length > 0);

  const fmt = (bytes: number | null) => {
    if (!bytes) return "";
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} Ko`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
  };

  return (
    <div style={{ padding: 24 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#0F172A" }}>Documents réglementaires</div>
          <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>
            PLU, PPRI, OAP, PEB, PLH, ZAC et autres plans réglementaires de {commune}
          </div>
        </div>
        {!showForm && (
          <button onClick={() => setShowForm(true)} style={{
            display: "flex", alignItems: "center", gap: 6, background: "#4F46E5", color: "white",
            border: "none", borderRadius: 8, padding: "8px 16px", fontSize: 13, fontWeight: 600,
            cursor: "pointer",
          }}>
            + Ajouter un document
          </button>
        )}
      </div>

      {/* Upload form */}
      {showForm && (
        <div style={{ background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 12, padding: 20, marginBottom: 20 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: "#0F172A", marginBottom: 16 }}>Nouveau document</div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 12, marginBottom: 16 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 4 }}>Type</label>
              <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
                style={{ width: "100%", border: "1px solid #D1D5DB", borderRadius: 8, padding: "8px 10px", fontSize: 13, background: "white" }}>
                {DOC_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 4 }}>Nom</label>
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Ex. PPRI Vallée de l'Indre 2023"
                style={{ width: "100%", border: "1px solid #D1D5DB", borderRadius: 8, padding: "8px 10px", fontSize: 13, boxSizing: "border-box" }} />
            </div>
          </div>

          {/* Drop zone */}
          <div
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
            onClick={() => { const inp = document.createElement("input"); inp.type = "file"; inp.accept = "application/pdf"; inp.onchange = () => { if (inp.files?.[0]) handleFile(inp.files[0]); }; inp.click(); }}
            style={{
              border: `2px dashed ${dragOver ? "#4F46E5" : "#CBD5E1"}`,
              borderRadius: 10, padding: "20px 16px", textAlign: "center", cursor: "pointer",
              background: dragOver ? "#EEF2FF" : "white", marginBottom: 16, transition: "all 0.15s",
            }}
          >
            {form.file ? (
              <div style={{ fontSize: 13, color: "#374151" }}>
                <span style={{ fontWeight: 600 }}>📄 {form.file.name}</span>
                <span style={{ color: "#64748b", marginLeft: 8 }}>({fmt(form.file.size)})</span>
              </div>
            ) : (
              <div style={{ fontSize: 13, color: "#64748b" }}>
                Glissez un PDF ici ou <span style={{ color: "#4F46E5", fontWeight: 600 }}>cliquez pour parcourir</span>
              </div>
            )}
          </div>

          {/* Synthèse */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 4 }}>
              Synthèse <span style={{ color: "#94a3b8", fontWeight: 400 }}>— sur quoi l'outil doit s'appuyer pour instruire</span>
            </label>
            <textarea
              value={form.synthese}
              onChange={(e) => setForm((f) => ({ ...f, synthese: e.target.value }))}
              rows={4}
              placeholder="Résumé en quelques phrases : règles à appliquer, périmètre concerné, articles clés, points de vigilance pour l'instructeur…"
              style={{ width: "100%", border: "1px solid #D1D5DB", borderRadius: 8, padding: "10px 12px", fontSize: 13, fontFamily: "inherit", boxSizing: "border-box", lineHeight: 1.5, resize: "vertical" }}
            />
          </div>

          {uploadError && (
            <div style={{ background: "#FEF2F2", border: "1px solid #FCA5A5", color: "#B91C1C", borderRadius: 8, padding: "10px 14px", fontSize: 13, marginBottom: 12 }}>
              {uploadError}
            </div>
          )}

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button onClick={() => { setShowForm(false); setForm({ type: "ppri", name: "", synthese: "", file: null }); setUploadError(null); }}
              style={{ border: "1px solid #E2E8F0", borderRadius: 8, background: "white", padding: "8px 16px", fontSize: 13, cursor: "pointer", color: "#374151" }}>
              Annuler
            </button>
            <button onClick={upload} disabled={uploading || !form.file || !form.name.trim()}
              style={{ border: "none", borderRadius: 8, background: uploading || !form.file || !form.name.trim() ? "#A5B4FC" : "#4F46E5", color: "white", padding: "8px 18px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
              {uploading ? "Envoi en cours…" : "Enregistrer"}
            </button>
          </div>
        </div>
      )}

      {/* Document list */}
      {loading ? (
        <div style={{ textAlign: "center", color: "#94a3b8", padding: 40, fontSize: 13 }}>Chargement…</div>
      ) : docs.length === 0 && !showForm ? (
        <div style={{ textAlign: "center", padding: 48, color: "#94a3b8" }}>
          <div style={{ fontSize: 36, marginBottom: 8 }}>📂</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: "#374151", marginBottom: 4 }}>Aucun document pour le moment</div>
          <div style={{ fontSize: 12 }}>Ajoutez les plans réglementaires de votre commune (PPRI, OAP…)</div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          {grouped.map(group => (
            <div key={group.value}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <span style={{ background: group.color, color: "white", borderRadius: 6, padding: "2px 10px", fontSize: 11, fontWeight: 700 }}>{group.label}</span>
                <span style={{ fontSize: 12, color: "#94a3b8" }}>{group.items.length} document{group.items.length > 1 ? "s" : ""}</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {group.items.map(doc => {
                  const isEditing = editingSynthese === doc.id;
                  // Toute édition de synthèse rebascule le statut en "brouillon" côté
                  // serveur — la synthèse n'alimente plus l'instruction tant que
                  // l'instructeur n'a pas explicitement re-validé.
                  const saveSynthese = async () => {
                    setSavingSynthese(true);
                    try {
                      const updated = await api.patch<CommuneDoc>(`/mairie/documents/${doc.id}`, { synthese: syntheseDraft });
                      setDocs((arr) => arr.map((d) => d.id === doc.id ? { ...d, ...updated } : d));
                      setEditingSynthese(null);
                    } catch { /* ignore */ } finally { setSavingSynthese(false); }
                  };
                  const setStatus = async (next: "valide" | "rejete" | "brouillon") => {
                    try {
                      const updated = await api.patch<CommuneDoc>(`/mairie/documents/${doc.id}`, { validation_status: next });
                      setDocs((arr) => arr.map((d) => d.id === doc.id ? { ...d, ...updated } : d));
                    } catch { /* ignore */ }
                  };
                  const vStatus = doc.validation_status ?? "brouillon";
                  const vBadge =
                    vStatus === "valide" ? { label: "Validé", color: "#047857", bg: "#D1FAE5" } :
                    vStatus === "rejete" ? { label: "Rejeté", color: "#B91C1C", bg: "#FEE2E2" } :
                    { label: "Brouillon", color: "#B45309", bg: "#FEF3C7" };
                  return (
                    <div key={doc.id} style={{
                      background: "white", border: "1px solid #E2E8F0", borderRadius: 10, padding: "12px 16px",
                    }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <span style={{ fontSize: 20 }}>📄</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: "#0F172A", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{doc.name}</div>
                          <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>
                            {doc.original_filename}
                            {doc.file_size && <span style={{ marginLeft: 8 }}>{fmt(doc.file_size)}</span>}
                            <span style={{ marginLeft: 8 }}>· {new Date(doc.created_at).toLocaleDateString("fr-FR")}</span>
                          </div>
                        </div>
                        {doc.synthese && (
                          <span title={vStatus === "valide" && doc.validated_at ? `Validée le ${new Date(doc.validated_at).toLocaleDateString("fr-FR")}` : "La synthèse ne sera utilisée par l'instructeur qu'une fois validée"} style={{
                            fontSize: 11, fontWeight: 700,
                            color: vBadge.color, background: vBadge.bg,
                            borderRadius: 6, padding: "2px 8px",
                          }}>
                            {vBadge.label}
                          </span>
                        )}
                        {(() => {
                          const indexBadge =
                            doc.status === "indexed" ? { label: "Indexé", color: "#0E7490", bg: "#CFFAFE" } :
                            doc.status === "indexing" ? { label: "Indexation…", color: "#5B21B6", bg: "#EDE9FE" } :
                            doc.status === "indexing_error" ? { label: "Erreur indexation", color: "#B91C1C", bg: "#FEE2E2" } :
                            doc.status === "indexing_empty" ? { label: "Index vide", color: "#92400E", bg: "#FEF3C7" } :
                            doc.status === "ingested" ? { label: "Ingéré", color: "#10B981", bg: "#D1FAE5" } :
                            { label: "Importé", color: "#94a3b8", bg: "#F1F5F9" };
                          return (
                            <span style={{ fontSize: 11, fontWeight: 600, color: indexBadge.color, background: indexBadge.bg, borderRadius: 6, padding: "2px 8px" }}>
                              {indexBadge.label}
                            </span>
                          );
                        })()}
                        {doc.status === "indexed" && (
                          <button onClick={() => setViewingSegments({ id: doc.id, name: doc.name })}
                            title="Voir les passages indexés et les annoter"
                            style={{ border: "1px solid #C7D2FE", background: "white", color: "#4F46E5", borderRadius: 6, padding: "3px 8px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
                            📑 Passages
                          </button>
                        )}
                        <button onClick={() => deleteDoc(doc.id)}
                          style={{ border: "none", background: "none", color: "#94a3b8", cursor: "pointer", padding: 4, fontSize: 16, lineHeight: 1 }}
                          title="Supprimer">✕</button>
                      </div>

                      {/* Synthèse — affichage / édition */}
                      <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px dashed #E2E8F0" }}>
                        {isEditing ? (
                          <div>
                            <textarea
                              value={syntheseDraft}
                              onChange={(e) => setSyntheseDraft(e.target.value)}
                              rows={4}
                              placeholder="Résumé en quelques phrases : règles à appliquer, périmètre concerné, articles clés…"
                              style={{ width: "100%", border: "1px solid #D1D5DB", borderRadius: 6, padding: "8px 10px", fontSize: 12.5, fontFamily: "inherit", boxSizing: "border-box", lineHeight: 1.5, resize: "vertical" }}
                            />
                            <div style={{ fontSize: 11, color: "#B45309", marginTop: 6 }}>
                              ⓘ La synthèse repassera en brouillon après enregistrement — elle ne sera plus utilisée par l'instructeur tant que vous ne l'aurez pas re-validée.
                            </div>
                            <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, marginTop: 6 }}>
                              <button onClick={() => setEditingSynthese(null)}
                                style={{ border: "1px solid #E2E8F0", background: "white", borderRadius: 6, padding: "5px 12px", fontSize: 12, cursor: "pointer", color: "#374151" }}>
                                Annuler
                              </button>
                              <button onClick={() => void saveSynthese()} disabled={savingSynthese}
                                style={{ border: "none", background: savingSynthese ? "#A5B4FC" : "#4F46E5", color: "white", borderRadius: 6, padding: "5px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                                {savingSynthese ? "Enregistrement…" : "Enregistrer la synthèse"}
                              </button>
                            </div>
                          </div>
                        ) : doc.synthese ? (
                          <div>
                            <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                              <span style={{ fontSize: 10, fontWeight: 700, color: "#4F46E5", letterSpacing: "0.06em", marginTop: 2 }}>SYNTHÈSE</span>
                              <div style={{ flex: 1, fontSize: 12.5, color: "#374151", lineHeight: 1.55, whiteSpace: "pre-wrap" as const }}>{doc.synthese}</div>
                              <button onClick={() => { setEditingSynthese(doc.id); setSyntheseDraft(doc.synthese ?? ""); }}
                                style={{ border: "1px solid #E2E8F0", background: "white", borderRadius: 6, padding: "3px 10px", fontSize: 11, cursor: "pointer", color: "#4F46E5", fontWeight: 600, flexShrink: 0 }}>
                                Modifier
                              </button>
                            </div>
                            {/* Bandeau de validation : seule la synthèse "valide" est consommée par le moteur d'instruction. */}
                            {vStatus !== "valide" ? (
                              <div style={{ marginTop: 10, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, background: vStatus === "rejete" ? "#FEF2F2" : "#FFFBEB", border: `1px solid ${vStatus === "rejete" ? "#FECACA" : "#FDE68A"}`, borderRadius: 6, padding: "6px 10px" }}>
                                <div style={{ fontSize: 11.5, color: vStatus === "rejete" ? "#991B1B" : "#92400E" }}>
                                  {vStatus === "rejete"
                                    ? "Synthèse rejetée — non utilisée pour l'instruction."
                                    : "Synthèse en brouillon — non utilisée pour l'instruction tant qu'elle n'est pas validée."}
                                </div>
                                <div style={{ display: "flex", gap: 6 }}>
                                  {vStatus !== "rejete" && (
                                    <button onClick={() => void setStatus("rejete")}
                                      style={{ border: "1px solid #FECACA", background: "white", color: "#B91C1C", borderRadius: 5, padding: "3px 10px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
                                      Rejeter
                                    </button>
                                  )}
                                  <button onClick={() => void setStatus("valide")}
                                    style={{ border: "none", background: "#047857", color: "white", borderRadius: 5, padding: "3px 12px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                                    Valider
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <div style={{ marginTop: 10, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, background: "#ECFDF5", border: "1px solid #A7F3D0", borderRadius: 6, padding: "6px 10px" }}>
                                <div style={{ fontSize: 11.5, color: "#065F46" }}>
                                  ✓ Synthèse validée{doc.validated_at ? ` le ${new Date(doc.validated_at).toLocaleDateString("fr-FR")}` : ""} — utilisée par le moteur d'instruction.
                                </div>
                                <button onClick={() => void setStatus("brouillon")}
                                  style={{ border: "1px solid #A7F3D0", background: "white", color: "#047857", borderRadius: 5, padding: "3px 10px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
                                  Repasser en brouillon
                                </button>
                              </div>
                            )}
                          </div>
                        ) : (
                          <button onClick={() => { setEditingSynthese(doc.id); setSyntheseDraft(""); }}
                            style={{ border: "1px dashed #C7D2FE", background: "#F8FAFC", borderRadius: 6, padding: "6px 12px", fontSize: 12, cursor: "pointer", color: "#4F46E5", fontWeight: 600, width: "100%", textAlign: "left" as const }}>
                            + Ajouter une synthèse pour l'instruction
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
      {viewingSegments && (
        <SegmentsModal docId={viewingSegments.id} docName={viewingSegments.name} onClose={() => setViewingSegments(null)} />
      )}
    </div>
  );
}

// ── PLU upload panel (état vide Réglementation) ────────────────────────────────
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
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "#0F172A" }}>Double authentification (2FA)</div>
                  <div style={{ width: 36, height: 20, borderRadius: 10, background: "#E2E8F0", position: "relative", cursor: "not-allowed" }}>
                    <div style={{ width: 16, height: 16, borderRadius: "50%", background: "white", position: "absolute", top: 2, left: 2, boxShadow: "0 1px 3px rgba(0,0,0,0.2)" }} />
                  </div>
                </div>
                <div style={{ fontSize: 12, color: "#94a3b8" }}>Fonctionnalité à venir — authentification double facteur par application TOTP.</div>
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
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 20 }}>
                {[{ icon: "📖", title: "Documentation", sub: "Guides complets sur toutes les fonctionnalités" }, { icon: "🎥", title: "Tutoriels vidéo", sub: "Apprenez avec nos tutoriels pas à pas" }, { icon: "💬", title: "Chat support", sub: "Discutez avec notre équipe de support" }, { icon: "📧", title: "Contacter le support", sub: "Envoyez-nous un message" }].map(c => (
                  <button key={c.title} style={{ border: "1px solid #E2E8F0", background: "white", borderRadius: 12, padding: 16, cursor: "pointer", textAlign: "left" }}>
                    <div style={{ fontSize: 24, marginBottom: 8 }}>{c.icon}</div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#0F172A", marginBottom: 4 }}>{c.title}</div>
                    <div style={{ fontSize: 11, color: "#94a3b8" }}>{c.sub}</div>
                  </button>
                ))}
              </div>
              <div style={{ background: "#F8FAFC", borderRadius: 10, padding: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#0F172A", marginBottom: 10 }}>Questions fréquentes</div>
                {["Comment créer un nouveau dossier ?","Comment assigner un dossier à un instructeur ?","Comment envoyer une demande de pièce complémentaire ?","Comment consulter les statistiques de ma commune ?"].map(q => (
                  <div key={q} style={{ padding: "8px 0", borderBottom: "1px solid #E2E8F0", fontSize: 13, color: "#4F46E5", cursor: "pointer" }}>→ {q}</div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}



type NouveauDossierForm = {
  type: NouveauDossierType;
  petitionnaire_prenom: string;
  petitionnaire_nom: string;
  petitionnaire_email: string;
  adresse: string;
  code_postal: string;
  commune: string;
  parcelle: string;
  surface_plancher: string;
  description: string;
  date_depot: string;
  instructeur_id: string;
  invite_petitionnaire: boolean;
};


type OcrExtraction = {
  type: NouveauDossierType | null;
  numero_cerfa: string | null;
  petitionnaire_prenom: string | null;
  petitionnaire_nom: string | null;
  petitionnaire_email: string | null;
  siret: string | null;
  adresse: string | null;
  code_postal: string | null;
  commune: string | null;
  parcelle: string | null;
  surface_plancher: string | null;
  description: string | null;
  confidence: number;
};

// Heuristique : à quel code_piece (DP/PC*) correspond le fichier d'après son nom ?
// Permet de pré-coder la pièce avant upload pour que l'extracteur côté serveur
// reçoive un hint pertinent (plan_masse, plan_facade, etc.).
function guessCodePieceFromName(name: string): string {
  const n = name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (/cerfa|13406|13703|13409|13405|13410/.test(n)) return "CERFA";
  if (/situation|dp1\b|pc1\b/.test(n)) return "DP1";
  if (/masse|dp2\b|pc2\b/.test(n)) return "DP2";
  if (/coupe|dp3\b|pc3\b/.test(n)) return "DP3";
  if (/notice|dp4\b|pc4\b/.test(n)) return "DP4";
  if (/facade|dp5\b|pc5\b/.test(n)) return "DP5";
  if (/insertion|paysag|pc6\b/.test(n)) return "PC6";
  if (/photo.*proche|dp7\b|pc7\b/.test(n)) return "PC7";
  if (/photo.*lointain|dp8\b|pc8\b/.test(n)) return "PC8";
  return "";
}

type StagedFile = {
  id: string;
  file: File;
  isCerfa: boolean;
  status: "queued" | "uploading" | "done" | "error";
  error?: string | null;
};

// Hoistés hors du composant : redéfinis à chaque render, React voyait un nouveau
// type → unmount/remount complet du sous-arbre à chaque setState, ce qui faisait
// "fermer" la modale (clic accidentel sur le backdrop pendant la reconstruction
// du DOM, perte du focus, flickering).
function NouveauDossierOverlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={onClose}>
      <div style={{ background: "white", borderRadius: 16, width: 580, maxWidth: "92vw", boxShadow: "0 20px 60px rgba(0,0,0,0.22)", maxHeight: "90vh", overflowY: "auto" }} onClick={e => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

function NouveauDossierModalHeader({ title, back, onClose }: { title: string; back?: () => void; onClose: () => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "18px 24px", borderBottom: "1px solid #E2E8F0" }}>
      {back && <button onClick={back} style={{ border: "none", background: "none", cursor: "pointer", color: "#94a3b8", fontSize: 18, lineHeight: 1, padding: 0 }}>←</button>}
      <div style={{ fontSize: 16, fontWeight: 700, color: "#0F172A", flex: 1 }}>{title}</div>
      <button onClick={onClose} style={{ border: "none", background: "none", cursor: "pointer", fontSize: 20, color: "#94a3b8", lineHeight: 1 }}>×</button>
    </div>
  );
}

function NouveauDossierModal({ onClose, commune }: { onClose: () => void; commune: string }) {
  const [mode, setMode] = useState<"choose" | "manual" | "ocr">("choose");
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const emptyForm: NouveauDossierForm = {
    type: "permis_de_construire",
    petitionnaire_prenom: "",
    petitionnaire_nom: "",
    petitionnaire_email: "",
    adresse: "",
    code_postal: "",
    commune,
    parcelle: "",
    surface_plancher: "",
    description: "",
    date_depot: today,
    instructeur_id: "",
    invite_petitionnaire: true,
  };
  const [form, setForm] = useState<NouveauDossierForm>(emptyForm);
  const [instructeurs, setInstructeurs] = useState<{ id: string; prenom: string; nom: string }[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null);
  // Une fois le dossier créé et les pièces déposées, on reste sur cet écran
  // de confirmation : l'OCR/IA tourne en arrière-plan et la cloche notifiera
  // l'instructeur quand tout sera prêt. On ne redirige plus immédiatement
  // vers le détail du dossier pour ne pas laisser croire qu'il est déjà
  // analysable.
  const [createdSummary, setCreatedSummary] = useState<{ id: string; numero: string; piecesCount: number } | null>(null);
  // Dépôt groupé : quand l'agent dépose UN SEUL PDF, on confie le découpage en
  // pièces à la modale de segmentation (ouverte juste après la création du
  // dossier) au lieu d'attacher le PDF comme une pièce unique.
  const [bundleSplit, setBundleSplit] = useState<{ dossierId: string; numero: string; file: File } | null>(null);

  // OCR state — multi-fichiers : le CERFA pré-remplit le formulaire, les
  // autres pièces sont mises en attente et uploadées après création du dossier.
  const [stagedFiles, setStagedFiles] = useState<StagedFile[]>([]);
  const [cerfaScanning, setCerfaScanning] = useState(false);
  const [cerfaDone, setCerfaDone] = useState(false);
  // Dépôt multi-fichiers sans CERFA séparé (formulaire saisi à la main) : on
  // n'auto-désigne alors aucun fichier comme CERFA et le pré-remplissage est sauté.
  const [noCerfa, setNoCerfa] = useState(false);
  const [ocrError, setOcrError] = useState<string | null>(null);
  const [ocrNumero, setOcrNumero] = useState<string | null>(null);

  useEffect(() => {
    api.get<{ id: string; prenom: string; nom: string }[]>("/mairie/instructeurs")
      .then(setInstructeurs)
      .catch(() => setInstructeurs([]));
  }, []);

  // Garde le champ "commune" du formulaire en phase avec la commune active
  // si l'opérateur change de commune dans la sidebar tant que la modale est ouverte.
  useEffect(() => {
    setForm(prev => prev.commune ? prev : { ...prev, commune });
  }, [commune]);

  const setField = <K extends keyof NouveauDossierForm>(key: K, value: NouveauDossierForm[K]) =>
    setForm(prev => ({ ...prev, [key]: value }));

  // Lance l'extraction CERFA sur le fichier marqué comme CERFA. Appelé soit
  // au moment où l'utilisateur ajoute des fichiers (le premier CERFA détecté
  // est extrait), soit quand l'utilisateur change le fichier désigné CERFA.
  const runCerfaExtract = async (file: File) => {
    setOcrError(null);
    setCerfaScanning(true);
    setCerfaDone(false);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/mairie/ocr-cerfa", {
        method: "POST",
        credentials: "include",
        body: formData,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        // 413 = Payload Too Large (proxy ou multer 60 Mo). Inutile d'afficher
        // un code HTTP brut au déposant : on traduit en message actionnable.
        if (res.status === 413) {
          throw new Error("Fichier trop volumineux pour l'extraction (limite ~60 Mo).");
        }
        throw new Error(body.error ?? `Erreur ${res.status}`);
      }
      const data = await res.json() as OcrExtraction;
      setForm(prev => ({
        ...prev,
        type: data.type ?? prev.type,
        petitionnaire_prenom: data.petitionnaire_prenom ?? prev.petitionnaire_prenom,
        petitionnaire_nom: data.petitionnaire_nom ?? prev.petitionnaire_nom,
        petitionnaire_email: data.petitionnaire_email ?? prev.petitionnaire_email,
        adresse: data.adresse ?? prev.adresse,
        code_postal: data.code_postal ?? prev.code_postal,
        commune: data.commune ?? prev.commune,
        parcelle: data.parcelle ?? prev.parcelle,
        surface_plancher: data.surface_plancher ?? prev.surface_plancher,
        description: data.description ?? prev.description,
      }));
      setOcrNumero(data.numero_cerfa);
      setCerfaDone(true);
    } catch (err) {
      setOcrError(err instanceof Error ? err.message : "Échec de l'extraction OCR");
    } finally {
      setCerfaScanning(false);
    }
  };

  const addFiles = (files: FileList | File[]) => {
    const arr = Array.from(files);
    if (arr.length === 0) return;
    setStagedFiles(prev => {
      const next = [...prev];
      const hasCerfa = next.some(f => f.isCerfa);
      for (const file of arr) {
        // Évite les doublons exacts (nom + taille) si l'opérateur ré-importe.
        if (next.some(f => f.file.name === file.name && f.file.size === file.size)) continue;
        const guessed = guessCodePieceFromName(file.name);
        const looksLikeCerfa = guessed === "CERFA";
        next.push({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          file,
          // Premier CERFA détecté → marqué CERFA ; sinon si on n'a encore rien
          // de désigné CERFA et que c'est un PDF, on prend le 1er PDF par défaut.
          isCerfa: !noCerfa && looksLikeCerfa && !hasCerfa,
          status: "queued",
        });
      }
      // Si toujours pas de CERFA désigné (hors mode « aucun CERFA »), prend le
      // premier PDF (fallback).
      if (!noCerfa && !next.some(f => f.isCerfa)) {
        const firstPdf = next.find(f => /\.pdf$/i.test(f.file.name));
        if (firstPdf) firstPdf.isCerfa = true;
      }
      return next;
    });
  };

  // Quand le CERFA désigné change, déclenche l'extraction. On lit la liste
  // mise à jour via la callback de setStagedFiles pour ne pas dépendre de
  // l'état périmé.
  useEffect(() => {
    const cerfa = stagedFiles.find(f => f.isCerfa);
    if (!cerfa) {
      setCerfaDone(false);
      setOcrNumero(null);
      return;
    }
    // Re-extraction uniquement quand la cible change.
    void runCerfaExtract(cerfa.file);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stagedFiles.find(f => f.isCerfa)?.id]);

  const setCerfa = (id: string) => {
    setNoCerfa(false);
    setStagedFiles(prev => prev.map(f => ({ ...f, isCerfa: f.id === id })));
  };
  const chooseNoCerfa = () => {
    setNoCerfa(true);
    setStagedFiles(prev => prev.map(f => ({ ...f, isCerfa: false })));
  };
  const removeFile = (id: string) => {
    setStagedFiles(prev => {
      const next = prev.filter(f => f.id !== id);
      // Si on a retiré le CERFA (hors mode « aucun CERFA »), promeut le 1er restant.
      if (!noCerfa && !next.some(f => f.isCerfa) && next.length > 0) next[0]!.isCerfa = true;
      return next;
    });
  };

  const submit = async () => {
    if (submitting) return;
    setSubmitError(null);
    if (!form.petitionnaire_nom.trim()) {
      setSubmitError("Le nom du pétitionnaire est obligatoire.");
      return;
    }
    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = {
        type: form.type,
        petitionnaire_nom: form.petitionnaire_nom.trim(),
        petitionnaire_prenom: form.petitionnaire_prenom.trim() || undefined,
        petitionnaire_email: form.petitionnaire_email.trim() || undefined,
        adresse: form.adresse.trim() || undefined,
        code_postal: form.code_postal.trim() || undefined,
        commune: form.commune.trim() || undefined,
        parcelle: form.parcelle.trim() || undefined,
        surface_plancher: form.surface_plancher.trim() || undefined,
        description: form.description.trim() || undefined,
        date_depot: form.date_depot || undefined,
        instructeur_id: form.instructeur_id || undefined,
        // N'a d'effet côté API que si un email est renseigné.
        invite_petitionnaire: form.petitionnaire_email.trim() ? form.invite_petitionnaire : false,
      };
      // created_via pilote la génération du CERFA prérempli côté API : en OCR
      // (dossier scanné), la mairie a déjà le vrai CERFA signé dans les pièces
      // numérisées → aucun CERFA prérempli n'est généré.
      const meta: Record<string, unknown> = { created_via: mode === "manual" ? "manual" : "ocr" };
      if (ocrNumero) meta["numero_cerfa"] = ocrNumero;
      payload["metadata"] = meta;
      const created = await api.post<{ id: string; numero: string }>("/mairie/dossiers", payload);

      // Dépôt groupé : un SEUL PDF déposé = très probablement le dossier complet.
      // Plutôt que de l'attacher comme une pièce CERFA unique, on confie ce PDF
      // à la modale de segmentation (découpage en pièces, validé par l'agent) —
      // le découpage se fait ainsi pendant la phase de dépôt. Si c'était en
      // réalité un simple CERFA, la modale proposera une seule pièce à confirmer.
      const lone = stagedFiles.length === 1 ? stagedFiles[0] : null;
      if (lone && (/pdf/i.test(lone.file.type) || /\.pdf$/i.test(lone.file.name))) {
        setBundleSplit({ dossierId: created.id, numero: created.numero, file: lone.file });
        return; // la suite (confirmation) se fait à la fermeture de la modale ; finally remet submitting à false
      }

      // Upload séquentiel des pièces : on évite de saturer la bande passante
      // côté navigateur (CERFAs scannés à 15 Mo par fichier × N pièces) et on
      // garde un feedback de progression simple. Une erreur sur une pièce
      // n'empêche pas les suivantes : le dossier est déjà créé, l'opérateur
      // pourra rejouer l'ajout depuis l'écran du dossier.
      //
      // Note : depuis le passage de l'OCR en asynchrone côté back, chaque
      // upload retourne en quelques centaines de ms (le temps d'écrire le
      // fichier en stockage et la ligne en DB). L'analyse IA tourne ensuite
      // en arrière-plan et l'instructeur est notifié quand toutes les pièces
      // sont analysées — voir finalize-upload-session ci-dessous.
      if (stagedFiles.length > 0) {
        setUploadProgress({ done: 0, total: stagedFiles.length });
        let done = 0;
        const errors: string[] = [];
        for (const f of stagedFiles) {
          try {
            const fd = new FormData();
            fd.append("file", f.file);
            const code = f.isCerfa ? "CERFA" : guessCodePieceFromName(f.file.name);
            if (code) fd.append("code_piece", code);
            fd.append("nom_piece", f.file.name);
            const res = await fetch(`/api/mairie/dossiers/${created.id}/pieces/upload`, {
              method: "POST",
              credentials: "include",
              body: fd,
            });
            if (!res.ok) {
              const body = await res.json().catch(() => ({})) as { error?: string };
              errors.push(`${f.file.name} : ${body.error ?? `Erreur ${res.status}`}`);
            }
          } catch (err) {
            errors.push(`${f.file.name} : ${err instanceof Error ? err.message : "échec"}`);
          } finally {
            done += 1;
            setUploadProgress({ done, total: stagedFiles.length });
          }
        }
        if (errors.length > 0) {
          // Best-effort : on prévient mais on continue vers le détail du dossier
          // pour que l'opérateur voie l'état réel et rejoue les uploads ratés.
          console.warn("[NouveauDossier] uploads en échec :", errors);
        }

        // Signale au back que l'agent a fini de déposer les pièces. Tant que
        // cet appel n'a pas eu lieu, la notification "dossier prêt" reste
        // bloquée — ça évite le faux positif quand l'OCR de la pièce 1 finit
        // avant que la pièce 2 ne soit uploadée.
        try {
          await api.post(`/mairie/dossiers/${created.id}/pieces/finalize-upload-session`, {});
        } catch (err) {
          // Best-effort : l'instructeur recevra quand même la notification au
          // prochain événement sur le dossier, et l'agent voit l'état réel
          // sur l'écran du dossier.
          console.warn("[NouveauDossier] finalize-upload-session:", err);
        }
      }

      // On NE redirige PAS vers le détail du dossier : l'OCR/IA des pièces
      // tourne en arrière-plan et l'instructeur recevra une notification
      // « Dossier prêt à instruire » dès que toutes les pièces seront
      // analysées (cf. pieceOcrQueue.maybeNotifyDossierReady côté API).
      // L'agent au comptoir voit une confirmation et peut fermer la modale.
      setCreatedSummary({ id: created.id, numero: created.numero, piecesCount: stagedFiles.length });
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Erreur lors de la création");
    } finally {
      setSubmitting(false);
      setUploadProgress(null);
    }
  };


  const inputStyle = { width: "100%", padding: "9px 12px", border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 13, color: "#374151", outline: "none", boxSizing: "border-box" as const, background: "white" };

  // Dépôt groupé en cours de découpage : la modale de segmentation remplace le
  // wizard. À sa fermeture, on bascule sur l'écran de confirmation. Si l'agent
  // annule le découpage, on rattache quand même le PDF en pièce unique pour ne
  // pas laisser le dossier sans pièce.
  if (bundleSplit) {
    const bs = bundleSplit;
    return (
      <BundleSplitModal
        dossierId={bs.dossierId}
        file={bs.file}
        onClose={(applied, createdCount) => {
          setBundleSplit(null);
          setCreatedSummary({ id: bs.dossierId, numero: bs.numero, piecesCount: applied ? (createdCount ?? 0) : 1 });
          void (async () => {
            if (!applied) {
              try {
                const fd = new FormData();
                fd.append("file", bs.file);
                fd.append("code_piece", "CERFA");
                fd.append("nom_piece", bs.file.name);
                await fetch(`/api/mairie/dossiers/${bs.dossierId}/pieces/upload`, { method: "POST", credentials: "include", body: fd });
              } catch (err) {
                console.warn("[NouveauDossier] rattachement PDF après annulation du découpage:", err);
              }
            }
            await api.post(`/mairie/dossiers/${bs.dossierId}/pieces/finalize-upload-session`, {}).catch(() => {});
          })();
        }}
      />
    );
  }

  // Confirmation post-création : dossier persisté, pièces uploadées, OCR/IA
  // en cours côté worker. On reste sur la modale pour rappeler à l'agent que
  // la suite arrive via la cloche de notification.
  if (createdSummary) return (
    <NouveauDossierOverlay onClose={onClose}>
      <NouveauDossierModalHeader title="Dossier enregistré" onClose={onClose} />
      <div style={{ padding: "24px", display: "flex", flexDirection: "column" as const, gap: 16 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "flex-start", background: "#ECFDF5", border: "1px solid #A7F3D0", borderRadius: 10, padding: "14px 16px" }}>
          <span style={{ fontSize: 22, lineHeight: 1 }}>✅</span>
          <div style={{ fontSize: 13, color: "#065F46", lineHeight: 1.55 }}>
            Dossier <strong>{createdSummary.numero}</strong> enregistré
            {createdSummary.piecesCount > 0 && (
              <> avec {createdSummary.piecesCount} pièce{createdSummary.piecesCount > 1 ? "s" : ""}</>
            )}.
          </div>
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "flex-start", background: "#F0F9FF", border: "1px solid #BAE6FD", borderRadius: 10, padding: "14px 16px" }}>
          <span style={{ fontSize: 18, lineHeight: 1 }}>⏳</span>
          <div style={{ fontSize: 13, color: "#075985", lineHeight: 1.6 }}>
            L'analyse OCR et IA des pièces tourne en arrière-plan.
            <strong> Vous (ou l'instructeur assigné) recevrez une notification dans la cloche dès que le dossier sera prêt à instruire.</strong>
            <div style={{ marginTop: 6, fontSize: 12, color: "#0C4A6E" }}>
              Inutile d'ouvrir le dossier maintenant : tant que la notification n'est pas arrivée, les analyses ne sont pas finalisées.
            </div>
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", paddingTop: 4 }}>
          <button onClick={onClose}
            style={{ background: "#4F46E5", color: "white", border: "none", borderRadius: 8, padding: "10px 20px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
            Fermer
          </button>
        </div>
      </div>
    </NouveauDossierOverlay>
  );

  if (mode === "choose") return (
    <NouveauDossierOverlay onClose={onClose}>
      <NouveauDossierModalHeader title="Nouveau dossier" onClose={onClose} />
      <div style={{ padding: "24px", display: "flex", flexDirection: "column" as const, gap: 12 }}>
        <p style={{ fontSize: 13, color: "#64748b", margin: 0 }}>Choisissez le mode de saisie du dossier.</p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginTop: 4 }}>
          <button onClick={() => setMode("manual")} style={{ border: "2px solid #E2E8F0", borderRadius: 14, padding: "24px 20px", cursor: "pointer", background: "white", textAlign: "left", transition: "border-color 0.15s" }}
            onMouseEnter={e => (e.currentTarget.style.borderColor = "#4F46E5")} onMouseLeave={e => (e.currentTarget.style.borderColor = "#E2E8F0")}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>📝</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#0F172A", marginBottom: 4 }}>Saisie manuelle</div>
            <div style={{ fontSize: 12, color: "#64748b", lineHeight: 1.5 }}>Remplissez le formulaire CERFA et les pièces complémentaires manuellement.</div>
          </button>
          <button onClick={() => setMode("ocr")} style={{ border: "2px solid #E2E8F0", borderRadius: 14, padding: "24px 20px", cursor: "pointer", background: "white", textAlign: "left", transition: "border-color 0.15s" }}
            onMouseEnter={e => (e.currentTarget.style.borderColor = "#4F46E5")} onMouseLeave={e => (e.currentTarget.style.borderColor = "#E2E8F0")}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>📷</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#0F172A", marginBottom: 4 }}>Reconnaissance OCR</div>
            <div style={{ fontSize: 12, color: "#64748b", lineHeight: 1.5 }}>Importez un CERFA scanné ou des pièces complémentaires — les données seront extraites automatiquement.</div>
          </button>
        </div>
      </div>
    </NouveauDossierOverlay>
  );

  const formFields = (
    <div style={{ display: "flex", flexDirection: "column" as const, gap: 14 }}>
      <div>
        <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 5 }}>Type de dossier</label>
        <select value={form.type} onChange={e => setField("type", e.target.value as NouveauDossierType)} style={inputStyle}>
          {DOSSIER_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div>
          <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 5 }}>Prénom du pétitionnaire</label>
          <input value={form.petitionnaire_prenom} onChange={e => setField("petitionnaire_prenom", e.target.value)} placeholder="Jean" style={inputStyle} />
        </div>
        <div>
          <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 5 }}>Nom du pétitionnaire *</label>
          <input value={form.petitionnaire_nom} onChange={e => setField("petitionnaire_nom", e.target.value)} placeholder="DUPONT" style={inputStyle} />
        </div>
      </div>
      <div>
        <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 5 }}>Email du pétitionnaire</label>
        <input type="email" value={form.petitionnaire_email} onChange={e => setField("petitionnaire_email", e.target.value)} placeholder="jean.dupont@example.com" style={inputStyle} />
        {form.petitionnaire_email.trim() ? (
          <label style={{ display: "flex", alignItems: "flex-start", gap: 8, marginTop: 8, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={form.invite_petitionnaire}
              onChange={e => setField("invite_petitionnaire", e.target.checked)}
              style={{ marginTop: 2, cursor: "pointer" }}
            />
            <span style={{ fontSize: 12, color: "#6B7280", lineHeight: 1.5 }}>
              Inviter le pétitionnaire à suivre son dossier en ligne — un email d'activation de son espace citoyen lui sera envoyé (ou une notification s'il a déjà un compte).
            </span>
          </label>
        ) : (
          <p style={{ fontSize: 12, color: "#9CA3AF", margin: "8px 0 0", lineHeight: 1.5 }}>
            Sans email, aucun espace citoyen n'est créé : le dossier est rattaché à un compte interne non utilisable par le pétitionnaire.
          </p>
        )}
      </div>
      <div>
        <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 5 }}>Adresse du projet</label>
        <input value={form.adresse} onChange={e => setField("adresse", e.target.value)} placeholder="12 rue des Lilas" style={inputStyle} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 10 }}>
        <div>
          <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 5 }}>Code postal</label>
          <input value={form.code_postal} onChange={e => setField("code_postal", e.target.value)} placeholder="37510" style={inputStyle} />
        </div>
        <div>
          <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 5 }}>Commune</label>
          <input value={form.commune} onChange={e => setField("commune", e.target.value)} placeholder={commune || "Ballan-Miré"} style={inputStyle} />
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 140px", gap: 10 }}>
        <div>
          <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 5 }}>Références cadastrales</label>
          <input value={form.parcelle} onChange={e => setField("parcelle", e.target.value)} placeholder="AB 142" style={inputStyle} />
        </div>
        <div>
          <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 5 }}>Surface plancher (m²)</label>
          <input value={form.surface_plancher} onChange={e => setField("surface_plancher", e.target.value)} placeholder="95" style={inputStyle} />
        </div>
      </div>
      <div>
        <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 5 }}>Description du projet</label>
        <textarea value={form.description} onChange={e => setField("description", e.target.value)} rows={2} placeholder="Construction d'une maison individuelle de 95 m²…" style={{ ...inputStyle, resize: "vertical" as const, fontFamily: "inherit" }} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "150px 1fr", gap: 10 }}>
        <div>
          <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 5 }}>Date de dépôt</label>
          <input type="date" value={form.date_depot} onChange={e => setField("date_depot", e.target.value)} style={inputStyle} />
        </div>
        <div>
          <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 5 }}>Instructeur assigné</label>
          <select value={form.instructeur_id} onChange={e => setField("instructeur_id", e.target.value)} style={inputStyle}>
            <option value="">— Non assigné —</option>
            {instructeurs.map(i => <option key={i.id} value={i.id}>{i.prenom} {i.nom}</option>)}
          </select>
        </div>
      </div>
    </div>
  );

  const submitLabel = submitting
    ? (uploadProgress ? `Dépôt ${uploadProgress.done}/${uploadProgress.total}…` : "Création…")
    : (mode === "ocr" && stagedFiles.length > 0 ? `Créer le dossier (${stagedFiles.length} pièce${stagedFiles.length > 1 ? "s" : ""})` : "Créer le dossier");

  const footer = (
    <div style={{ padding: "14px 24px", borderTop: "1px solid #E2E8F0" }}>
      {submitError && (
        <div style={{ background: "#FEF2F2", color: "#B91C1C", fontSize: 12, padding: "8px 12px", borderRadius: 6, marginBottom: 10, border: "1px solid #FECACA" }}>{submitError}</div>
      )}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
        <button onClick={onClose} disabled={submitting} style={{ border: "1px solid #E2E8F0", background: "white", borderRadius: 8, padding: "9px 18px", fontSize: 13, color: "#374151", cursor: submitting ? "not-allowed" : "pointer", fontWeight: 500, opacity: submitting ? 0.6 : 1 }}>Annuler</button>
        <button onClick={submit} disabled={submitting} style={{ background: "linear-gradient(135deg, #4F46E5, #6366F1)", color: "white", border: "none", borderRadius: 8, padding: "9px 18px", fontSize: 13, fontWeight: 600, cursor: submitting ? "not-allowed" : "pointer", opacity: submitting ? 0.7 : 1 }}>
          {submitLabel}
        </button>
      </div>
    </div>
  );

  // Un seul fichier déposé = dossier complet : on n'oblige pas à désigner « le
  // CERFA » (trompeur — le PDF contient le CERFA, qui sera détecté au découpage).
  const singleFile = stagedFiles.length === 1;
  const fileList = stagedFiles.length > 0 && (
    <div style={{ border: "1px solid #E2E8F0", borderRadius: 10, overflow: "hidden" }}>
      <div style={{ padding: "8px 12px", background: "#F8FAFC", fontSize: 11, fontWeight: 600, color: "#64748b", textTransform: "uppercase" as const, letterSpacing: 0.4, display: "flex", justifyContent: "space-between" }}>
        <span>{stagedFiles.length} fichier{stagedFiles.length > 1 ? "s" : ""}</span>
        <span style={{ textTransform: "none" as const, letterSpacing: 0, fontWeight: 500 }}>{singleFile ? "Découpage automatique" : "Choisissez le CERFA"}</span>
      </div>
      {stagedFiles.map(f => {
        const code = f.isCerfa ? "CERFA" : guessCodePieceFromName(f.file.name);
        return (
          <div key={f.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderTop: "1px solid #F1F5F9", fontSize: 13 }}>
            {!singleFile && <input type="radio" checked={f.isCerfa} onChange={() => setCerfa(f.id)} title="Désigner comme CERFA" />}
            <span style={{ fontSize: 16 }}>{/\.pdf$/i.test(f.file.name) ? "📄" : "🖼️"}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ color: "#0F172A", whiteSpace: "nowrap" as const, overflow: "hidden", textOverflow: "ellipsis" as const }}>{f.file.name}</div>
              <div style={{ fontSize: 11, color: "#94a3b8" }}>
                {(f.file.size / 1024).toFixed(0)} Ko
                {singleFile
                  ? <> · <span style={{ color: "#4F46E5", fontWeight: 600 }}>dossier complet</span></>
                  : code && <> · <span style={{ color: f.isCerfa ? "#4F46E5" : "#64748b", fontWeight: 600 }}>{code}</span></>}
              </div>
            </div>
            <button onClick={() => removeFile(f.id)} title="Retirer" style={{ border: "none", background: "none", cursor: "pointer", color: "#94a3b8", fontSize: 16, padding: 4 }}>×</button>
          </div>
        );
      })}
      {singleFile && (
        <div style={{ padding: "8px 12px", borderTop: "1px solid #F1F5F9", fontSize: 11.5, color: "#475569", background: "#FAFAFF", lineHeight: 1.5 }}>
          📦 Un seul PDF = dossier complet : ses données pré-remplissent le formulaire, et il sera <strong>découpé en pièces</strong> (CERFA, plans, notice…) à la création.
        </div>
      )}
      {!singleFile && (
        <label style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderTop: "1px solid #F1F5F9", fontSize: 12.5, color: "#475569", cursor: "pointer" }}>
          <input type="radio" checked={noCerfa} onChange={chooseNoCerfa} title="Aucun CERFA dans ce dépôt" />
          Aucun CERFA dans ce dépôt (je remplis le formulaire à la main)
        </label>
      )}
      <label style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "8px 12px", borderTop: "1px solid #F1F5F9", background: "#F8FAFC", cursor: "pointer", fontSize: 12, color: "#4F46E5", fontWeight: 600 }}>
        ＋ Ajouter d'autres fichiers
        <input type="file" multiple accept=".pdf,.jpg,.jpeg,.png" onChange={e => { if (e.target.files) { addFiles(e.target.files); e.target.value = ""; } }} style={{ display: "none" }} />
      </label>
    </div>
  );

  if (mode === "ocr") return (
    <NouveauDossierOverlay onClose={onClose}>
      <NouveauDossierModalHeader title="Reconnaissance OCR" onClose={onClose} back={() => { setMode("choose"); setStagedFiles([]); setCerfaDone(false); setOcrError(null); setOcrNumero(null); }} />
      <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column" as const, gap: 16 }}>
        {stagedFiles.length > 0 && !submitting && (
          <div style={{ display: "flex", gap: 10, alignItems: "flex-start", background: "#F0F9FF", border: "1px solid #BAE6FD", borderRadius: 8, padding: "10px 14px" }}>
            <span style={{ fontSize: 16 }}>⚡</span>
            <div style={{ fontSize: 12.5, color: "#075985", lineHeight: 1.5 }}>
              Le dépôt prend quelques secondes — l'analyse OCR des pièces tourne ensuite en arrière-plan.
              <strong> L'instructeur reçoit une notification dès que le dossier est entièrement constitué.</strong>
            </div>
          </div>
        )}
        {submitting && uploadProgress && uploadProgress.done >= uploadProgress.total && uploadProgress.total > 0 && (
          <div style={{ display: "flex", gap: 10, alignItems: "flex-start", background: "#ECFDF5", border: "1px solid #A7F3D0", borderRadius: 8, padding: "10px 14px" }}>
            <span style={{ fontSize: 16 }}>✅</span>
            <div style={{ fontSize: 12.5, color: "#065F46", lineHeight: 1.5 }}>
              Pièces déposées. L'analyse OCR se poursuit en arrière-plan — vous (ou l'instructeur assigné) recevrez une notification dès que tout est prêt.
            </div>
          </div>
        )}
        {stagedFiles.length === 0 ? (
          <>
            <label style={{ display: "flex", flexDirection: "column" as const, alignItems: "center", justifyContent: "center", border: "2px dashed #CBD5E1", borderRadius: 12, padding: "40px 24px", cursor: "pointer", gap: 10, background: "#F8FAFC" }}>
              <span style={{ fontSize: 36 }}>📂</span>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#374151" }}>Déposez vos fichiers ici</div>
              <div style={{ fontSize: 12, color: "#94a3b8" }}>CERFA + plans + photos — PDF, JPG, PNG (max 25 Mo / fichier)</div>
              <div style={{ background: "#4F46E5", color: "white", borderRadius: 8, padding: "7px 16px", fontSize: 13, fontWeight: 600 }}>Choisir des fichiers</div>
              <input type="file" multiple accept=".pdf,.jpg,.jpeg,.png" onChange={e => { if (e.target.files) addFiles(e.target.files); }} style={{ display: "none" }} />
            </label>
            {ocrError && (
              <div style={{ background: "#FEF2F2", color: "#B91C1C", fontSize: 13, padding: "12px 14px", borderRadius: 8, border: "1px solid #FECACA" }}>
                <strong>Échec de l'extraction.</strong> {ocrError}
              </div>
            )}
          </>
        ) : (
          <>
            {fileList}
            {cerfaScanning ? (
              <div style={{ display: "flex", alignItems: "center", gap: 10, background: "#EEF2FF", borderRadius: 8, padding: "10px 14px", border: "1px solid #C7D2FE" }}>
                <span style={{ fontSize: 18 }}>🔍</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#3730A3" }}>Analyse des documents en cours…</div>
                  <div style={{ marginTop: 6, height: 4, background: "#E0E7FF", borderRadius: 2, overflow: "hidden" }}>
                    <div style={{ height: "100%", background: "linear-gradient(90deg,#4F46E5,#6366F1)", borderRadius: 2, width: "60%" }} />
                  </div>
                </div>
              </div>
            ) : ocrError ? (
              <div style={{ background: "#FEF2F2", color: "#B91C1C", fontSize: 13, padding: "12px 14px", borderRadius: 8, border: "1px solid #FECACA" }}>
                <strong>L'extraction du CERFA a échoué.</strong> {ocrError} Vous pouvez quand même remplir le formulaire à la main et créer le dossier — toutes les pièces seront jointes.
              </div>
            ) : cerfaDone ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#F0FDF4", borderRadius: 8, padding: "10px 14px", border: "1px solid #BBF7D0" }}>
                <span style={{ fontSize: 18 }}>✅</span>
                <div style={{ fontSize: 13, color: "#15803D", fontWeight: 500 }}>
                  Données extraites du CERFA{ocrNumero ? ` n° ${ocrNumero}` : ""}. Vérifiez et corrigez si besoin.
                </div>
              </div>
            ) : null}
            {formFields}
          </>
        )}
      </div>
      {stagedFiles.length > 0 && footer}
    </NouveauDossierOverlay>
  );

  return (
    <NouveauDossierOverlay onClose={onClose}>
      <NouveauDossierModalHeader title="Nouveau dossier — Saisie manuelle" onClose={onClose} back={() => setMode("choose")} />
      <div style={{ padding: "20px 24px" }}>{formFields}</div>
      {footer}
    </NouveauDossierOverlay>
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

function DossierDetailRoute({ navigate }: { navigate: (s: string) => void }) {
  const { id } = useParams<{ id: string }>();
  const routerNavigate = useNavigate();
  const [dossier, setDossier] = useState<DossierInfo | null>(null);
  const [loading, setLoading] = useState(true);

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
  return <DossierDetailScreen dossier={dossier} onBack={() => routerNavigate(-1 as never)} navigate={navigate} />;
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
  const canManageUsers = user?.role === "admin" || user?.role === "mairie";
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
          <Topbar onNewDossier={active === "Dossiers" ? () => setShowNouveauDossier(true) : undefined} navigate={setActive} onDossierClick={handleDossierClick} commune={commune} onViewAllNotifications={() => routerNavigate("/mairie/parametres?tab=notifications")} />
        )}
        <div style={{ flex: 1, overflowY: "auto" }}>
          <Routes>
            <Route index element={<DashboardScreen navigate={setActive} navigateDossiers={navigateDossiers} commune={commune} inseeCode={communeInseeMap[commune]} onDossierClick={handleDossierClick} />} />
            <Route path="dossiers" element={<DossiersScreen commune={commune} onDossierClick={handleDossierClick} />} />
            <Route path="dossiers/:id" element={<DossierDetailRoute navigate={setActive} />} />
            <Route path="messagerie" element={<MessageScreen commune={commune} onDossierClick={handleDossierClick} onUnreadChange={setMessageBadge} />} />
            <Route path="calendrier" element={<CalendrierScreen commune={commune} />} />
            <Route path="carte" element={<CarteScreen commune={commune} setCommune={setCommune} communeInseeMap={communeInseeMap} />} />
            <Route path="statistiques" element={<StatistiquesScreen commune={commune} />} />
            <Route path="parametres" element={<ParametresScreen commune={commune} isAdmin={isAdmin} canManageUsers={canManageUsers} communeInseeMap={communeInseeMap} onInseeUpdated={refreshCommuneInseeMap} />} />
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
