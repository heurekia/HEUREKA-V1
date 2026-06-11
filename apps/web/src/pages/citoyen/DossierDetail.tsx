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

interface PieceACompleter {
  code_piece: string | null;
  nom: string;
  raison: string | null;
  manquante: boolean;
  aide: string | null;
  deja_redeposee: boolean;
  redepot: { id: string; nom: string; url: string; uploaded_at: string } | null;
}

interface PiecesACompleterResponse {
  courrier_id: string | null;
  emis_le: string | null;
  subject?: string | null;
  pieces: PieceACompleter[];
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
  instructeur_assigned: "👤",
  decision_prise: "📌",
  message_instructeur: "💬",
  document_demande: "📄",
  pieces_complementaires_demandees: "📋",
  pieces_complementaires_recues: "📥",
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
        <div style={{ display: "flex", alignItems: "center", gap: 0, overflowX: "auto", paddingBottom: 4 }}>
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
  const [piecesACompleter, setPiecesACompleter] = useState<PiecesACompleterResponse | null>(null);
  const [uploadingCodes, setUploadingCodes] = useState<Set<string>>(new Set());
  const [resoumettant, setResoumettant] = useState(false);

  const refreshPiecesACompleter = async (dossierId: string) => {
    try {
      const data = await api.get<PiecesACompleterResponse>(`/dossiers/${dossierId}/pieces-a-completer`);
      setPiecesACompleter(data);
    } catch { /* silencieux : la section ne s'affiche pas */ }
  };

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
        if (d.status === "incomplet") {
          void refreshPiecesACompleter(d.id);
        }
      })
      .catch(() => navigate("/citoyen/mes-demandes"))
      .finally(() => setLoading(false));
  }, [id, navigate]);

  const uploadComplement = async (piece: PieceACompleter, slotKey: string, file: File) => {
    if (!id) return;
    setUploadingCodes((prev) => new Set(prev).add(slotKey));
    try {
      // Le nom déposé suit la convention "${nom du slot} - ${nom du fichier}",
      // que l'API utilise pour rattacher l'upload à l'emplacement attendu
      // (matching par préfixe). Le code_piece est conservé tel que demandé par
      // l'instructeur (chaîne vide pour les pièces libres sans code).
      const combinedName = `${piece.nom} - ${file.name}`;
      const formData = new FormData();
      formData.append("file", file);
      formData.append("code_piece", piece.code_piece ?? "");
      formData.append("nom_piece", combinedName);
      const res = await fetch(`/api/dossiers/${id}/pieces/upload`, {
        method: "POST",
        credentials: "include",
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error ?? `Erreur ${res.status}`);
      }
      // Le dépôt a réussi : on rafraîchit les listes en best-effort. Si l'une
      // des requêtes échoue (réseau intermittent), on garde le succès et la
      // prochaine action déclenchera le refresh — pas d'alerte d'erreur.
      try {
        const p = await api.get<Piece[]>(`/dossiers/${id}/pieces`);
        setPieces(p);
      } catch { /* refresh non bloquant */ }
      try {
        const pac = await api.get<PiecesACompleterResponse>(`/dossiers/${id}/pieces-a-completer`);
        setPiecesACompleter(pac);
      } catch { /* refresh non bloquant */ }
    } catch (e) {
      const msg = e instanceof Error && e.message ? e.message : "Erreur inconnue";
      alert(`Erreur lors du dépôt : ${msg}`);
    } finally {
      setUploadingCodes((prev) => {
        const next = new Set(prev);
        next.delete(slotKey);
        return next;
      });
    }
  };

  const transmettreComplements = async () => {
    if (!id) return;
    setResoumettant(true);
    try {
      const updated = await api.post<Dossier>(`/dossiers/${id}/resoumettre`, {});
      setDossier(updated);
      setPiecesACompleter(null);
      // Recharge l'historique pour faire apparaître l'event de transmission.
      const ev = await api.get<Event[]>(`/dossiers/${id}/events`);
      setEvents([...ev].reverse());
    } catch (e) {
      const msg = e instanceof Error && e.message ? e.message : "Erreur inconnue";
      alert(`Impossible de transmettre : ${msg}`);
    } finally {
      setResoumettant(false);
    }
  };

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
    <div style={{ minHeight: "100%", background: "#F8FAFC", padding: "clamp(16px, 4vw, 28px) clamp(12px, 4vw, 24px)" }}>
      <div style={{ maxWidth: 1280, margin: "0 auto" }}>

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
            <div style={{ marginBottom: 16 }}>
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
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "flex-end" }}>
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
                  onClick={() => navigate(`/citoyen/nouvelle-demande?dossier=${id}`)}
                  style={{
                    padding: "11px 18px",
                    background: "white",
                    color: "#4F46E5",
                    border: "1.5px solid #C7D2FE",
                    borderRadius: 10,
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                  }}
                >
                  📂 Reprendre la constitution
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
        )}

        {/* Header */}
        <div style={{ background: "white", borderRadius: 16, border: "1px solid #E2E8F0", padding: "clamp(18px, 4vw, 28px)", marginBottom: 16, boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}>
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
              ⚠️ <strong>Action requise</strong> — Des pièces manquent à votre dossier. Déposez les documents demandés dans la section <em>Dépôt complémentaire</em> ci-dessous.
            </div>
          )}
        </div>

        {/* Dépôt complémentaire — visible uniquement quand le dossier est en
            "incomplet" ET qu'un courrier "pieces_complementaires" a bien été
            émis avec au moins une pièce ciblée. */}
        {dossier.status === "incomplet" && piecesACompleter && piecesACompleter.pieces.length > 0 && (() => {
          const total = piecesACompleter.pieces.length;
          const fournies = piecesACompleter.pieces.filter((p) => p.deja_redeposee).length;
          const toutesFournies = fournies === total;
          return (
            <div style={{ background: "white", borderRadius: 16, border: "1.5px solid #FED7AA", padding: 28, marginBottom: 16, boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                <span style={{ fontSize: 22 }}>📥</span>
                <h2 style={{ fontSize: 18, fontWeight: 800, color: "#0F172A", margin: 0 }}>
                  Dépôt complémentaire
                </h2>
              </div>
              <p style={{ fontSize: 13, color: "#475569", lineHeight: 1.6, margin: "0 0 16px 0" }}>
                Votre instructeur a demandé les pièces ci-dessous. Déposez-les ici, puis transmettez-les à la mairie pour reprise de l'instruction.
              </p>

              <div
                style={{
                  background: toutesFournies ? "#F0FDF4" : "#EFF6FF",
                  border: `1px solid ${toutesFournies ? "#86EFAC" : "#BFDBFE"}`,
                  borderRadius: 10,
                  padding: "10px 16px",
                  marginBottom: 16,
                  fontSize: 13,
                  color: toutesFournies ? "#15803D" : "#1E40AF",
                  textAlign: "center",
                  fontWeight: 600,
                }}
              >
                {toutesFournies
                  ? "✓ Toutes les pièces demandées ont été redéposées."
                  : `${fournies} / ${total} pièce${total > 1 ? "s" : ""} redéposée${fournies > 1 ? "s" : ""}`}
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
                {piecesACompleter.pieces.map((piece, idx) => {
                  // Clé stable d'emplacement : index dans la liste du courrier.
                  // Deux entrées avec même nom restent distinctes.
                  const slotKey = `slot-${idx}`;
                  const isUploading = uploadingCodes.has(slotKey);
                  const hasFile = piece.deja_redeposee && piece.redepot;
                  return (
                    <div
                      key={slotKey}
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: 14,
                        padding: "14px 18px",
                        background: hasFile ? "#F0FDF4" : "#FFFBEB",
                        borderRadius: 12,
                        border: `1px solid ${hasFile ? "#86EFAC" : "#FCD34D"}`,
                      }}
                    >
                      <span style={{ fontSize: 22, marginTop: 1, flexShrink: 0 }}>
                        {hasFile ? "✅" : "📄"}
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
                          <span style={{ fontSize: 14, fontWeight: 700, color: "#0F172A" }}>
                            {piece.nom}
                          </span>
                          <span
                            style={{
                              padding: "2px 9px",
                              borderRadius: 20,
                              fontSize: 11,
                              fontWeight: 700,
                              background: piece.manquante ? "#FEF3C7" : "#E0F2FE",
                              color: piece.manquante ? "#92400E" : "#0284C7",
                            }}
                          >
                            {piece.manquante ? "À fournir" : "À compléter"}
                          </span>
                        </div>

                        {piece.raison && (
                          <div style={{ fontSize: 12.5, color: "#92400E", background: "#FEF3C7", borderRadius: 8, padding: "8px 10px", margin: "6px 0", lineHeight: 1.4 }}>
                            <strong>Demande de l'instructeur :</strong> {piece.raison}
                          </div>
                        )}

                        {piece.aide && (
                          <p style={{ fontSize: 12, color: "#64748b", margin: "4px 0 8px 0", lineHeight: 1.4 }}>
                            {piece.aide}
                          </p>
                        )}

                        {hasFile && piece.redepot && (
                          <a
                            href={piece.redepot.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12, color: "#15803D", textDecoration: "none", padding: "6px 10px", background: "white", borderRadius: 8, border: "1px solid #86EFAC", marginBottom: 8 }}
                          >
                            📄 {piece.redepot.nom}
                          </a>
                        )}

                        <div style={{ marginTop: 8 }}>
                          {isUploading ? (
                            <span style={{ fontSize: 12, color: "#4F46E5", fontStyle: "italic" }}>
                              ⏳ Envoi en cours…
                            </span>
                          ) : (
                            <label
                              style={{
                                cursor: "pointer",
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 6,
                                padding: "6px 14px",
                                background: "#EEF2FF",
                                color: "#4F46E5",
                                borderRadius: 8,
                                fontSize: 12,
                                fontWeight: 600,
                                border: "1px solid #C7D2FE",
                              }}
                            >
                              <input
                                type="file"
                                style={{ display: "none" }}
                                accept=".pdf,.jpg,.jpeg,.png,.gif,.webp,.tiff"
                                onChange={(e) => {
                                  const file = e.target.files?.[0];
                                  if (file) void uploadComplement(piece, slotKey, file);
                                  e.currentTarget.value = "";
                                }}
                              />
                              {hasFile ? "↻ Remplacer le document" : "+ Déposer le document"}
                            </label>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button
                  onClick={() => void transmettreComplements()}
                  disabled={!toutesFournies || resoumettant}
                  title={!toutesFournies ? "Déposez toutes les pièces demandées avant de transmettre" : undefined}
                  style={{
                    padding: "11px 24px",
                    background: (!toutesFournies || resoumettant) ? "#C7D2FE" : "#4F46E5",
                    color: "white",
                    border: "none",
                    borderRadius: 10,
                    fontSize: 14,
                    fontWeight: 700,
                    cursor: (!toutesFournies || resoumettant) ? "not-allowed" : "pointer",
                  }}
                >
                  {resoumettant ? "Transmission…" : "Transmettre les compléments à la mairie →"}
                </button>
              </div>
            </div>
          );
        })()}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16, marginBottom: 16 }}>

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
