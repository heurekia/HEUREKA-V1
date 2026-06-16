import { useEffect, useMemo, useRef, useState } from "react";
import { Input } from "../../components/ui/input";
import { Search, Send, MessageSquare, ArrowLeft } from "lucide-react";
import { Avatar } from "../../components/ui/avatar";
import { Button } from "../../components/ui/button";
import { api } from "../../lib/api";

interface Conversation {
  dossier_id: string;
  numero: string;
  type: string;
  status: string;
  commune: string | null;
  last_content: string | null;
  last_from_role: string | null;
  last_at: string | null;
  unread_count: number;
}

interface Message {
  id: string;
  content: string;
  from_role: string;
  created_at: string;
  read_at: string | null;
}

const TYPE_LABELS: Record<string, string> = {
  permis_de_construire: "Permis de construire",
  permis_de_construire_mi: "Permis de construire (MI)",
  declaration_prealable: "Déclaration préalable",
  permis_amenager: "Permis d'aménager",
  permis_demolir: "Permis de démolir",
  permis_lotir: "Permis de lotir",
  certificat_urbanisme: "Certificat d'urbanisme",
  certificat_urbanisme_a: "Certificat d'urbanisme (informatif)",
  certificat_urbanisme_b: "Certificat d'urbanisme (opérationnel)",
};

function formatTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) {
    return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  }
  const diff = (today.getTime() - d.getTime()) / 86400000;
  if (diff < 7) return d.toLocaleDateString("fr-FR", { weekday: "short" });
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" });
}

function conversationTitle(conv: Conversation): string {
  const t = TYPE_LABELS[conv.type] ?? conv.type;
  return conv.commune ? `${t} – ${conv.commune}` : t;
}

export function MessagerieCitoyen() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [messageText, setMessageText] = useState("");
  const [search, setSearch] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const threadRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const list = await api.get<Conversation[]>("/dossiers/conversations");
        if (cancelled) return;
        setConversations(list);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Erreur");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!activeId) return;
    let cancelled = false;
    (async () => {
      try {
        const msgs = await api.get<Message[]>(`/dossiers/${activeId}/messages`);
        if (cancelled) return;
        setMessages(msgs);
        await api.post(`/dossiers/${activeId}/messages/read`).catch(() => undefined);
        if (cancelled) return;
        setConversations((prev) => prev.map((c) =>
          c.dossier_id === activeId ? { ...c, unread_count: 0 } : c,
        ));
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Erreur");
      }
    })();
    return () => { cancelled = true; };
  }, [activeId]);

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight });
  }, [messages]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter((c) =>
      c.numero.toLowerCase().includes(q) ||
      conversationTitle(c).toLowerCase().includes(q) ||
      (c.last_content ?? "").toLowerCase().includes(q),
    );
  }, [conversations, search]);

  const activeConv = conversations.find((c) => c.dossier_id === activeId) ?? null;

  const sendMessage = async () => {
    if (!messageText.trim() || !activeId || sending) return;
    setSending(true);
    try {
      const msg = await api.post<Message>(`/dossiers/${activeId}/messages`, { content: messageText.trim() });
      setMessages((prev) => [...prev, msg]);
      setMessageText("");
      setConversations((prev) => prev.map((c) =>
        c.dossier_id === activeId
          ? { ...c, last_content: msg.content, last_from_role: msg.from_role, last_at: msg.created_at }
          : c,
      ));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Envoi impossible");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 sm:py-8 h-[calc(100vh-3rem)] lg:h-[calc(100vh-4rem)]">
      <div className="mb-4 sm:mb-6 hidden sm:block">
        <h1 className="text-xl sm:text-2xl font-bold text-[#000020]">Messagerie</h1>
        <p className="text-gray-500 text-sm">Échangez avec les services instructeurs</p>
      </div>

      {error && (
        <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="flex h-full sm:h-[calc(100%-4rem)] gap-0 rounded-xl overflow-hidden border border-gray-200/80 bg-white shadow-sm">
        {/* Conversation list — masquée sur mobile quand un thread est ouvert */}
        <div
          className={`${activeConv ? "hidden md:flex" : "flex"} w-full md:w-80 border-r border-gray-200 flex-col shrink-0`}
        >
          <div className="p-4 border-b border-gray-100">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input
                placeholder="Rechercher..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 bg-gray-50 border-gray-200"
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto divide-y divide-gray-100">
            {loading ? (
              <div className="p-6 text-sm text-gray-400 text-center">Chargement…</div>
            ) : filtered.length === 0 ? (
              <div className="p-6 text-sm text-gray-400 text-center">
                {conversations.length === 0
                  ? "Aucune conversation pour l'instant."
                  : "Aucun résultat."}
              </div>
            ) : filtered.map((conv) => {
              const title = conversationTitle(conv);
              const isActive = activeId === conv.dossier_id;
              return (
                <button
                  key={conv.dossier_id}
                  onClick={() => setActiveId(conv.dossier_id)}
                  className={`w-full text-left p-4 hover:bg-gray-50 transition-colors flex items-start gap-3 ${
                    isActive ? "bg-heureka-50" : ""
                  }`}
                >
                  <Avatar fallback={title} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium text-[#000020] truncate">{title}</p>
                      <span className="text-xs text-gray-400 shrink-0">{formatTime(conv.last_at)}</span>
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5">{conv.numero}</div>
                    <p className="text-xs text-gray-500 truncate mt-0.5">
                      {conv.last_content ?? "Pas encore de message"}
                    </p>
                  </div>
                  {conv.unread_count > 0 && (
                    <span className="w-5 h-5 rounded-full bg-heureka-500 text-white text-[10px] font-bold flex items-center justify-center shrink-0">
                      {conv.unread_count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Thread — masqué sur mobile quand aucun thread n'est ouvert */}
        <div className={`${activeConv ? "flex" : "hidden md:flex"} flex-1 flex-col`}>
          {activeConv ? (
            <>
              <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-gray-100 flex items-center gap-3">
                <button
                  onClick={() => setActiveId(null)}
                  aria-label="Retour"
                  className="md:hidden -ml-1 p-1 text-gray-500 hover:text-gray-700"
                >
                  <ArrowLeft className="w-5 h-5" />
                </button>
                <Avatar fallback={conversationTitle(activeConv)} />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-[#000020] truncate">{conversationTitle(activeConv)}</p>
                  <p className="text-xs text-gray-500">{activeConv.numero}</p>
                </div>
              </div>
              <div ref={threadRef} className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
                {messages.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-center text-gray-400 text-sm">
                    Aucun message. Écrivez le premier message à votre instructeur.
                  </div>
                ) : messages.map((msg) => {
                  const isMe = msg.from_role === "citoyen";
                  return (
                    <div key={msg.id} className={`flex ${isMe ? "justify-end" : "justify-start"}`}>
                      <div
                        className={`max-w-[85%] sm:max-w-[70%] rounded-2xl px-4 py-2.5 text-sm ${
                          isMe
                            ? "bg-heureka-500 text-white rounded-br-md"
                            : "bg-gray-100 text-gray-800 rounded-bl-md"
                        }`}
                      >
                        <p className="whitespace-pre-wrap">{msg.content}</p>
                        <p className={`text-[10px] mt-1 ${isMe ? "text-white/60" : "text-gray-400"}`}>
                          {new Date(msg.created_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="px-4 sm:px-6 py-3 sm:py-4 border-t border-gray-100">
                <div className="flex gap-2 sm:gap-3">
                  <Input
                    placeholder="Écrivez votre message..."
                    value={messageText}
                    onChange={(e) => setMessageText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        void sendMessage();
                      }
                    }}
                    className="flex-1"
                    disabled={sending}
                  />
                  <Button
                    size="icon"
                    onClick={() => void sendMessage()}
                    disabled={!messageText.trim() || sending}
                    className="shrink-0"
                  >
                    <Send className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-gray-400">
              <div className="text-center">
                <MessageSquare className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                <p>Sélectionnez une conversation</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
