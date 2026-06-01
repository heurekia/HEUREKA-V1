import { useState, useEffect } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { api } from "../../lib/api";
import { Badge, statusLabels } from "../../components/ui/badge";
import { Card, CardContent } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { ArrowLeft, Send } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Dossier {
  id: string;
  numero: string;
  type: string;
  status: string;
  adresse?: string;
  commune?: string;
  surface_plancher?: string;
  description?: string;
  date_depot?: string;
  date_limite_instruction?: string;
  created_at: string;
}

interface Event {
  id: string;
  type: string;
  description?: string;
  created_at: string;
}

interface Message {
  id: string;
  content: string;
  from_role: string;
  created_at: string;
}

interface Piece {
  id: string;
  nom: string;
  code_piece: string | null;
  url: string;
  uploaded_at: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const TYPE_LABELS: Record<string, string> = {
  permis_de_construire: "Permis de construire",
  declaration_prealable: "Déclaration Préalable",
  permis_amenager: "Permis d'aménager",
  permis_demolir: "Permis de démolir",
  permis_lotir: "Permis de lotir",
  certificat_urbanisme: "Certificat d'urbanisme",
};

const STATUS_PIPELINE = [
  { key: "soumis", label: "Soumis" },
  { key: "pre_instruction", label: "Pré-instruction" },
  { key: "en_instruction", label: "Instruction" },
  { key: "decision_en_cours", label: "Décision" },
];

const TERMINAL_STATUS: Record<string, { label: string; color: string; bg: string; emoji: string }> = {
  accepte: { label: "Autorisé", color: "#15803D", bg: "#DCFCE7", emoji: "✅" },
  refuse: { label: "Refusé", color: "#DC2626", bg: "#FEE2E2", emoji: "❌" },
  accord_prescription: { label: "Autorisé avec prescriptions", color: "#92400E", bg: "#FEF3C7", emoji: "⚠️" },
  incomplet: { label: "Pièces manquantes", color: "#92400E", bg: "#FEF3C7", emoji: "📋" },
};

const EVENT_ICONS: Record<string, string> = {
  dossier_soumis: "📬",
  dossier_complet: "✅",
  dossier_incomplet: "⚠️",
  instruction_demarree: "🔍",
  decision_prise: "📌",
  message_instructeur: "💬",
  document_demande: "📄",
  default: "📝",
};

function eventIcon(type: string): string {
  return EVENT_ICONS[type] ?? EVENT_ICONS["default"] ?? "📝";
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

// ─── Stepper ──────────────────────────────────────────────────────────────────

function StatusStepper({ status }: { status: string }) {
  const terminal = TERMINAL_STATUS[status];
  const currentIdx = STATUS_PIPELINE.findIndex((s) => s.key === status);

  return (
    <div>
      {terminal ? (
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 10,
            background: terminal.bg,
            borderRadius: 12,
            padding: "12px 20px",
          }}
        >
          <span style={{ fontSize: 22 }}>{terminal.emoji}</span>
          <span style={{ fontSize: 16, fontWeight: 700, color: terminal.color }}>{terminal.label}</span>
        </div>
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: 0 }}>
          {STATUS_PIPELINE.map((s, i) => {
            const done = currentIdx > i;
            const active = currentIdx === i;
            return (
              <div key={s.key} style={{ display: "flex", alignItems: "center" }}>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                  <div
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: "50%",
                      background: done ? "#4F46E5" : active ? "#EEF2FF" : "#F1F5F9",
                      border: active ? "2px solid #4F46E5" : done ? "none" : "2px solid #E2E8F0",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 14,
                      fontWeight: 700,
                      color: done ? "white" : active ? "#4F46E5" : "#94a3b8",
                      flexShrink: 0,
                    }}
                  >
                    {done ? "✓" : i + 1}
                  </div>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: active ? 700 : 500,
                      color: active ? "#4F46E5" : done ? "#374151" : "#94a3b8",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {s.label}
                  </span>
                </div>
                {i < STATUS_PIPELINE.length - 1 && (
                  <div
                    style={{
                      width: 60,
                      height: 2,
                      background: done ? "#4F46E5" : "#E2E8F0",
                      margin: "0 4px",
                      marginBottom: 22,
                      transition: "background 0.3s",
                    }}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function DossierDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [dossier, setDossier] = useState<Dossier | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [pieces, setPieces] = useState<Piece[]>([]);
  const [loading, setLoading] = useState(true);
  const [newMessage, setNewMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [completude, setCompletude] = useState<{ complete: boolean; manquantes: { code: string; nom: string }[] } | null>(null);

  useEffect(() => {
    if (!id) return;
    Promise.all([
      api.get<Dossier>(`/dossiers/${id}`),
      api.get<Event[]>(`/dossiers/${id}/events`),
      api.get<Message[]>(`/dossiers/${id}/messages`),
      api.get<Piece[]>(`/dossiers/${id}/pieces`),
    ])
      .then(([d, e, m, p]) => {
        setDossier(d);
        setEvents([...e].reverse()); // chronological
        setMessages(m);
        setPieces(p);
        if (d.status === "brouillon") {
          api.get<{ complete: boolean; manquantes: { code: string; nom: string }[] }>(`/dossiers/${id}/completude`)
            .then(setCompletude)
            .catch(() => {});
        }
      })
      .catch(() => navigate("/citoyen/mes-demandes"))
      .finally(() => setLoading(false));
  }, [id, navigate]);

  const soumettreALaMairie = async () => {
    if (!id || !dossier) return;
    setSubmitting(true);
    try {
      const updated = await api.post<Dossier>(`/dossiers/${id}/soumettre`, {});
      setDossier(updated);
    } catch {
      alert("Ce dossier est incomplet. Veuillez ajouter toutes les pièces obligatoires avant de soumettre.");
    } finally {
      setSubmitting(false);
    }
  };

  const supprimerBrouillon = async () => {
    if (!id || !dossier) return;
    if (!window.confirm("Supprimer définitivement ce brouillon ? Cette action est irréversible.")) return;
    setDeleting(true);
    try {
      await api.delete(`/dossiers/${id}`);
      navigate("/citoyen/mes-demandes");
    } catch {
      alert("Erreur lors de la suppression. Veuillez réessayer.");
      setDeleting(false);
    }
  };

  const sendMessage = async () => {
    if (!newMessage.trim() || !id) return;
    setSending(true);
    try {
      const msg = await api.post<Message>(`/dossiers/${id}/messages`, { content: newMessage.trim() });
      setMessages((prev) => [...prev, msg]);
      setNewMessage("");
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return (
      <div style={{ minHeight: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center", color: "#94a3b8" }}>
          <div style={{ fontSize: 32, marginBottom: 12, animation: "spin 1s linear infinite" }}>⏳</div>
          Chargement…
          <style>{`@keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }`}</style>
        </div>
      </div>
    );
  }

  if (!dossier) return null;

  const statusMeta = statusLabels[dossier.status] ?? { label: dossier.status, variant: "default" as const };

  return (
    <div style={{ minHeight: "100%", background: "#F8FAFC", padding: "28px 24px" }}>
      <div style={{ maxWidth: 760, margin: "0 auto" }}>

        {/* Back */}
        <Link
          to="/citoyen/mes-demandes"
          style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: "#64748b", textDecoration: "none", marginBottom: 20 }}
        >
          <ArrowLeft size={14} /> Mes demandes
        </Link>

        {/* Bandeau brouillon */}
        {dossier.status === "brouillon" && (
          <div style={{ background: "#FFF7ED", border: "1.5px solid #FED7AA", borderRadius: 14, padding: "20px 24px", marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#92400E", marginBottom: 4 }}>
                  📋 Dossier en cours de préparation
                </div>
                <div style={{ fontSize: 13, color: "#78350F", lineHeight: 1.6 }}>
                  Ajoutez toutes vos pièces justificatives ci-dessous, puis soumettez votre dossier à la mairie pour démarrer l'instruction.
                </div>
                {completude && !completude.complete && (
                  <div style={{ marginTop: 10, fontSize: 12, color: "#B45309" }}>
                    <strong>Pièces manquantes :</strong>{" "}
                    {completude.manquantes.map((p) => p.nom).join(", ")}
                  </div>
                )}
              </div>
              <div style={{ display: "flex", gap: 10, flexShrink: 0, flexWrap: "wrap" }}>
                <button
                  onClick={() => void supprimerBrouillon()}
                  disabled={deleting}
                  style={{
                    padding: "11px 18px",
                    background: "white",
                    color: "#DC2626",
                    border: "1.5px solid #FECACA",
                    borderRadius: 10,
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: deleting ? "not-allowed" : "pointer",
                    whiteSpace: "nowrap",
                  }}
                >
                  {deleting ? "Suppression…" : "🗑 Supprimer"}
                </button>
                <button
                  onClick={() => void soumettreALaMairie()}
                  disabled={submitting || (completude !== null && !completude.complete)}
                  title={completude && !completude.complete ? `${completude.manquantes.length} pièce(s) manquante(s)` : undefined}
                  style={{
                    padding: "11px 24px",
                    background: (submitting || (completude !== null && !completude.complete)) ? "#C7D2FE" : "#4F46E5",
                    color: "white",
                    border: "none",
                    borderRadius: 10,
                    fontSize: 14,
                    fontWeight: 700,
                    cursor: (submitting || (completude !== null && !completude.complete)) ? "not-allowed" : "pointer",
                    whiteSpace: "nowrap",
                  }}
                >
                  {submitting ? "Envoi…" : "Soumettre à la mairie →"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Header */}
        <div style={{ background: "white", borderRadius: 16, border: "1px solid #E2E8F0", padding: 28, marginBottom: 16, boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
            <div>
              <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 4 }}>Numéro de dossier</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: "#0F172A", fontFamily: "monospace", letterSpacing: "0.04em" }}>
                {dossier.numero}
              </div>
            </div>
            <Badge variant={statusMeta.variant} className="text-sm px-3 py-1">
              {statusMeta.label}
            </Badge>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 16, marginBottom: 24 }}>
            {[
              ["📋 Procédure", TYPE_LABELS[dossier.type] ?? dossier.type],
              ["📍 Adresse", dossier.adresse ?? "—"],
              ["🏘️ Commune", dossier.commune ?? "—"],
              ["📐 Surface", dossier.surface_plancher ? `${dossier.surface_plancher} m²` : "—"],
              ["📅 Déposé le", formatDate(dossier.created_at)],
              ...(dossier.date_limite_instruction
                ? [["⏱ Délai limite", formatDate(dossier.date_limite_instruction)] as [string, string]]
                : []),
            ].map(([label, value]) => (
              <div key={label}>
                <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 3 }}>{label}</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#0F172A" }}>{value}</div>
              </div>
            ))}
          </div>

          {/* Stepper */}
          <div>
            <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 12 }}>Avancement</div>
            <StatusStepper status={dossier.status} />
          </div>

          {dossier.status === "incomplet" && (
            <div style={{ marginTop: 16, background: "#FFF7ED", border: "1px solid #FED7AA", borderRadius: 10, padding: "12px 16px", fontSize: 13, color: "#92400E" }}>
              ⚠️ <strong>Action requise</strong> — Des pièces manquent à votre dossier. Consultez les messages de l'instructeur ci-dessous et ajoutez les documents demandés.
            </div>
          )}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>

          {/* Timeline des événements */}
          <Card className="border-gray-200/80">
            <CardContent className="p-5">
              <h2 style={{ fontSize: 14, fontWeight: 700, color: "#0F172A", marginBottom: 16 }}>Historique</h2>
              {events.length === 0 ? (
                <div style={{ fontSize: 13, color: "#94a3b8", textAlign: "center", padding: "20px 0" }}>
                  Aucun événement pour l'instant.
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                  {events.map((ev, i) => (
                    <div key={ev.id} style={{ display: "flex", gap: 12 }}>
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                        <div style={{ width: 28, height: 28, borderRadius: "50%", background: "#EEF2FF", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, flexShrink: 0 }}>
                          {eventIcon(ev.type)}
                        </div>
                        {i < events.length - 1 && <div style={{ width: 1.5, flex: 1, background: "#E2E8F0", margin: "4px 0" }} />}
                      </div>
                      <div style={{ paddingBottom: 16, minWidth: 0 }}>
                        <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 2 }}>{formatDateTime(ev.created_at)}</div>
                        <div style={{ fontSize: 13, color: "#374151", lineHeight: 1.4 }}>
                          {ev.description ?? ev.type.replace(/_/g, " ")}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Pièces jointes */}
          <Card className="border-gray-200/80">
            <CardContent className="p-5">
              <h2 style={{ fontSize: 14, fontWeight: 700, color: "#0F172A", marginBottom: 16 }}>Documents joints</h2>
              {pieces.length === 0 ? (
                <div style={{ fontSize: 13, color: "#94a3b8", textAlign: "center", padding: "20px 0" }}>
                  <div style={{ fontSize: 28, marginBottom: 8 }}>📁</div>
                  Aucun document joint.<br />
                  <span style={{ fontSize: 12 }}>Vous pourrez en ajouter bientôt.</span>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {pieces.map((p) => (
                    <a key={p.id} href={p.url} target="_blank" rel="noopener noreferrer" style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: "#F8FAFC", borderRadius: 8, border: "1px solid #E2E8F0", textDecoration: "none" }}>
                      <span style={{ fontSize: 18 }}>📄</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: "#0F172A", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {p.nom}
                        </div>
                        <div style={{ fontSize: 11, color: "#94a3b8" }}>{formatDate(p.uploaded_at)}</div>
                      </div>
                    </a>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Messagerie */}
        <Card className="border-gray-200/80">
          <CardContent className="p-5">
            <h2 style={{ fontSize: 14, fontWeight: 700, color: "#0F172A", marginBottom: 16 }}>Messages avec la mairie</h2>

            {messages.length === 0 ? (
              <div style={{ fontSize: 13, color: "#94a3b8", textAlign: "center", padding: "20px 0", marginBottom: 16 }}>
                <div style={{ fontSize: 28, marginBottom: 8 }}>💬</div>
                Aucun message pour l'instant.<br />
                <span style={{ fontSize: 12 }}>Vous pouvez écrire à l'instructeur ci-dessous.</span>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16, maxHeight: 320, overflowY: "auto" }}>
                {messages.map((msg) => {
                  const isMine = msg.from_role === "citoyen";
                  return (
                    <div key={msg.id} style={{ display: "flex", justifyContent: isMine ? "flex-end" : "flex-start" }}>
                      <div
                        style={{
                          maxWidth: "75%",
                          padding: "10px 14px",
                          borderRadius: isMine ? "14px 14px 4px 14px" : "14px 14px 14px 4px",
                          background: isMine ? "#4F46E5" : "#F1F5F9",
                          color: isMine ? "white" : "#0F172A",
                        }}
                      >
                        {!isMine && (
                          <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", marginBottom: 4 }}>
                            Instructeur
                          </div>
                        )}
                        <p style={{ fontSize: 13, lineHeight: 1.5, margin: 0 }}>{msg.content}</p>
                        <div style={{ fontSize: 10, marginTop: 4, opacity: 0.7, textAlign: "right" }}>
                          {formatDateTime(msg.created_at)}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div style={{ display: "flex", gap: 10 }}>
              <textarea
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void sendMessage(); } }}
                placeholder="Écrivez un message à l'instructeur… (Entrée pour envoyer)"
                rows={2}
                style={{
                  flex: 1,
                  padding: "10px 14px",
                  border: "2px solid #E2E8F0",
                  borderRadius: 10,
                  fontSize: 13,
                  outline: "none",
                  fontFamily: "inherit",
                  resize: "none",
                  lineHeight: 1.5,
                }}
                onFocus={(e) => (e.target.style.borderColor = "#4F46E5")}
                onBlur={(e) => (e.target.style.borderColor = "#E2E8F0")}
              />
              <Button
                onClick={() => void sendMessage()}
                disabled={!newMessage.trim() || sending}
                size="sm"
                className="self-end gap-2 h-auto py-2.5 px-4"
              >
                <Send size={14} />
                Envoyer
              </Button>
            </div>
          </CardContent>
        </Card>

      </div>
    </div>
  );
}
