import { useState, useEffect } from "react";
import { api } from "../../lib/api";
import { DotsIcon, SendIcon, StatusBadge } from "./ui";
import { STATUS_LABEL, TYPE_LABEL, stringToColor, nameInitials, fmtConvTime, type DossierInfo } from "./shared";

// Écran "Messagerie" : conversations citoyens/services par dossier.

export function MessageScreen({ commune, onDossierClick, onUnreadChange }: { commune: string; onDossierClick: (d: DossierInfo) => void; onUnreadChange?: (n: number) => void }) {
  type Conv = { dossier_id: string; numero: string; type: string; status: string; petitionnaire: string; last_content: string; last_from_role: string; last_at: string; unread_count: number };
  type MsgAttachment = { document_id: string; nom: string; url: string; type: string };
  type Msg = { id: string; content: string; from_role: string; created_at: string; prenom: string | null; nom: string | null; attachments?: MsgAttachment[] | null };
  type ServiceConv = {
    consultation_id: string;
    dossier_id: string;
    numero: string;
    type: string;
    status: string;
    service_name: string;
    service_type: string;
    service_full_name: string | null;
    service_email: string | null;
    consultation_status: string;
    favorable: boolean | null;
    last_content: string | null;
    last_from_role: string | null;
    last_at: string | null;
    unread_count: number;
  };

  const [tab, setTab] = useState("Citoyens");
  const [convs, setConvs] = useState<Conv[]>([]);
  const [selected, setSelected] = useState<Conv | null>(null);
  const [serviceConvs, setServiceConvs] = useState<ServiceConv[]>([]);
  const [selectedService, setSelectedService] = useState<ServiceConv | null>(null);
  const [thread, setThread] = useState<Msg[]>([]);
  const [serviceThread, setServiceThread] = useState<Msg[]>([]);
  const [citizenDraft, setCitizenDraft] = useState("");
  const [serviceDraft, setServiceDraft] = useState("");
  const [sending, setSending] = useState(false);

  const refreshConvs = () =>
    api.get<Conv[]>(`/mairie/conversations?commune=${encodeURIComponent(commune)}`).then(data => setConvs(data)).catch(() => {});
  const refreshServiceConvs = () =>
    api.get<ServiceConv[]>(`/mairie/service-conversations?commune=${encodeURIComponent(commune)}`).then(setServiceConvs).catch(() => {});

  // Badge sidebar = citoyens non lus + services non lus (réactif)
  useEffect(() => {
    const citizenCount = convs.reduce((s, c) => s + c.unread_count, 0);
    const svcCount = serviceConvs.reduce((s, c) => s + c.unread_count, 0);
    onUnreadChange?.(citizenCount + svcCount);
  }, [convs, serviceConvs]);

  useEffect(() => {
    setSelected(null);
    setSelectedService(null);
    setThread([]);
    setServiceThread([]);
    refreshConvs();
    refreshServiceConvs();
  }, [commune]);

  // Quand on sélectionne une conversation citoyen, charger le thread et marquer comme lu
  useEffect(() => {
    if (!selected) return;
    api.get<Msg[]>(`/mairie/conversations/${selected.dossier_id}`).then(setThread).catch(() => {});
    api.post(`/mairie/conversations/${selected.dossier_id}/read`)
      .then(() => {
        setConvs(prev => prev.map(c =>
          c.dossier_id === selected.dossier_id ? { ...c, unread_count: 0 } : c
        ));
        setSelected(prev => prev ? { ...prev, unread_count: 0 } : prev);
      })
      .catch(() => {});
  }, [selected?.dossier_id]);

  // Quand on sélectionne une consultation service, charger le thread + mark read
  useEffect(() => {
    if (!selectedService) return;
    const cid = selectedService.consultation_id;
    api.get<Msg[]>(`/mairie/service-conversations/${cid}`).then(setServiceThread).catch(() => setServiceThread([]));
    api.post(`/mairie/service-conversations/${cid}/read`)
      .then(() => {
        setServiceConvs(prev => prev.map(c =>
          c.consultation_id === cid ? { ...c, unread_count: 0 } : c
        ));
        setSelectedService(prev => prev && prev.consultation_id === cid ? { ...prev, unread_count: 0 } : prev);
      })
      .catch(() => {});
  }, [selectedService?.consultation_id]);

  const sendCitizenMessage = async () => {
    if (!selected || !citizenDraft.trim() || sending) return;
    const draft = citizenDraft.trim();
    setSending(true);
    try {
      const msg = await api.post<Msg>(`/mairie/conversations/${selected.dossier_id}`, { content: draft });
      setThread(prev => [...prev, msg]);
      setCitizenDraft("");
      setConvs(prev => prev.map(c => c.dossier_id === selected.dossier_id
        ? { ...c, last_content: msg.content, last_from_role: msg.from_role, last_at: msg.created_at }
        : c));
    } catch (err) {
      console.error(err);
    } finally {
      setSending(false);
    }
  };

  const sendServiceMessage = async () => {
    if (!selectedService || !serviceDraft.trim() || sending) return;
    const draft = serviceDraft.trim();
    const cid = selectedService.consultation_id;
    setSending(true);
    try {
      const msg = await api.post<Msg>(`/mairie/service-conversations/${cid}`, { content: draft });
      setServiceThread(prev => [...prev, msg]);
      setServiceDraft("");
      setServiceConvs(prev => prev.map(c => c.consultation_id === cid
        ? { ...c, last_content: msg.content, last_from_role: msg.from_role, last_at: msg.created_at }
        : c));
    } catch (err) {
      console.error(err);
    } finally {
      setSending(false);
    }
  };

  const markUnread = () => {
    if (!selected) return;
    api.post(`/mairie/conversations/${selected.dossier_id}/unread`)
      .then(() => {
        setConvs(prev => prev.map(c =>
          c.dossier_id === selected.dossier_id ? { ...c, unread_count: 1 } : c
        ));
        setSelected(prev => prev ? { ...prev, unread_count: 1 } : prev);
      })
      .catch(() => {});
  };

  const totalCitizenUnread = convs.reduce((s, c) => s + c.unread_count, 0);
  const totalServiceUnread = serviceConvs.reduce((s, c) => s + c.unread_count, 0);

  return (
    <div style={{ padding: 0, display: "flex", height: "calc(100vh - 56px)" }}>
      {/* ── Liste conversations ── */}
      <div style={{ width: 320, borderRight: "1px solid #E2E8F0", display: "flex", flexDirection: "column", background: "white" }}>
        <div style={{ padding: "20px 16px 0" }}>
          <h1 style={{ fontSize: 18, fontWeight: 700, color: "#0F172A", marginBottom: 2 }}>Messagerie</h1>
          <p style={{ color: "#94A3B8", fontSize: 12, marginBottom: 12 }}>Échangez avec les pétitionnaires et les services consultés.</p>
          <div style={{ display: "flex", gap: 0, marginBottom: 12 }}>
            {([
              { key: "Citoyens", label: "Citoyens", count: totalCitizenUnread },
              { key: "Services", label: "Services / Consultations", count: totalServiceUnread },
            ] as { key: string; label: string; count: number }[]).map(({ key, label, count }) => (
              <button key={key} onClick={() => setTab(key)} style={{ flex: 1, border: "none", background: "none", padding: "7px 6px", fontSize: 12, fontWeight: tab === key ? 600 : 400, color: tab === key ? "#4F46E5" : "#64748b", borderBottom: tab === key ? "2px solid #4F46E5" : "2px solid #E2E8F0", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 5, whiteSpace: "nowrap" }}>
                {label}
                {count > 0 && (
                  <span style={{ background: tab === key ? "#4F46E5" : "#E2E8F0", color: tab === key ? "white" : "#64748b", borderRadius: 10, padding: "1px 6px", fontSize: 10, fontWeight: 700, minWidth: 16, textAlign: "center" }}>{count}</span>
                )}
              </button>
            ))}
          </div>
          <div style={{ position: "relative", marginBottom: 8 }}>
            <input placeholder="Rechercher une conversation" style={{ width: "100%", padding: "7px 12px 7px 28px", border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 12, outline: "none" }} />
          </div>
        </div>
        <div style={{ flex: 1, overflowY: "auto" }}>
          {tab === "Citoyens" ? convs.map((c) => {
            const isActive = selected?.dossier_id === c.dossier_id && !selectedService;
            const color = stringToColor(c.petitionnaire);
            return (
              <div key={c.dossier_id} onClick={() => { setSelected(c); setSelectedService(null); }} style={{ padding: "12px 16px", cursor: "pointer", borderBottom: "1px solid #F8FAFC", background: isActive ? "#F0F4FF" : "white" }}
                onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLDivElement).style.background = "#F8FAFC"; }}
                onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLDivElement).style.background = "white"; }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                  <div style={{ width: 36, height: 36, borderRadius: "50%", background: color, color: "white", fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{nameInitials(c.petitionnaire)}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 2 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: "#0F172A" }}>{c.petitionnaire}</span>
                      <span style={{ fontSize: 11, color: "#94a3b8" }}>{fmtConvTime(c.last_at)}</span>
                    </div>
                    <div style={{ fontSize: 11, color: "#64748b", marginBottom: 2 }}>{c.numero}</div>
                    <div style={{ fontSize: 12, color: "#94a3b8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.last_content}</div>
                  </div>
                  {c.unread_count > 0 && <span style={{ background: "#4F46E5", color: "white", borderRadius: "50%", width: 18, height: 18, fontSize: 10, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{c.unread_count}</span>}
                </div>
              </div>
            );
          }) : serviceConvs.length === 0 ? (
            <div style={{ padding: "20px 16px", fontSize: 12, color: "#94a3b8", textAlign: "center" }}>
              Aucune consultation de service pour cette commune.
            </div>
          ) : serviceConvs.map((c) => {
            const isActive = selectedService?.consultation_id === c.consultation_id;
            const displayName = c.service_full_name ?? c.service_name;
            const color = stringToColor(displayName);
            return (
            <div key={c.consultation_id} onClick={() => {
              setSelectedService(c);
              setSelected(null);
            }} style={{ padding: "12px 16px", cursor: "pointer", borderBottom: "1px solid #F8FAFC", background: isActive ? "#F0F4FF" : "white" }}
              onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLDivElement).style.background = "#F8FAFC"; }}
              onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLDivElement).style.background = "white"; }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                <div style={{ width: 36, height: 36, borderRadius: "50%", background: color, color: "white", fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{nameInitials(displayName)}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 2 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "#0F172A" }}>{displayName}</span>
                    <span style={{ fontSize: 11, color: "#94a3b8" }}>{c.last_at ? fmtConvTime(c.last_at) : ""}</span>
                  </div>
                  <div style={{ fontSize: 11, color: "#64748b", marginBottom: 2 }}>{c.numero}</div>
                  <div style={{ fontSize: 12, color: "#94a3b8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {c.last_content ?? "Aucun message envoyé"}
                  </div>
                </div>
                {c.unread_count > 0 && <span style={{ background: "#4F46E5", color: "white", borderRadius: "50%", width: 18, height: 18, fontSize: 10, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{c.unread_count}</span>}
              </div>
            </div>
            );
          })}
        </div>
      </div>

      {/* ── Thread ── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", background: "#FAFBFD" }}>
        {selectedService ? (() => {
          const svcName = selectedService.service_full_name ?? selectedService.service_name;
          const svcColor = stringToColor(svcName);
          const svcInitials = nameInitials(svcName);
          return (<>
          {/* Service thread */}
          <div style={{ padding: "14px 20px", borderBottom: "1px solid #E2E8F0", background: "white", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 32, height: 32, borderRadius: "50%", background: svcColor, color: "white", fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{svcInitials}</div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#0F172A" }}>{svcName}</div>
                <div style={{ fontSize: 12, color: "#94a3b8" }}>
                  Consultation —{" "}
                  <button
                    onClick={() => onDossierClick({ id: selectedService.dossier_id, numero: selectedService.numero, type: selectedService.type, petitionnaire: "—", adresse: "—", status: selectedService.status, echeance: "—" })}
                    style={{ background: "none", border: "none", padding: 0, color: "#4F46E5", fontWeight: 600, fontSize: 12, cursor: "pointer", textDecoration: "underline" }}
                  >
                    {selectedService.numero}
                  </button>
                </div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button style={{ border: "none", background: "none", cursor: "pointer", color: "#94a3b8" }}><DotsIcon /></button>
            </div>
          </div>
          <div style={{ flex: 1, padding: 20, overflowY: "auto" }}>
            {serviceThread.length === 0 ? (
              <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#94a3b8", fontSize: 13 }}>
                Aucun message — envoyez le premier message au service consulté.
              </div>
            ) : serviceThread.map((msg) => {
              const isMairie = !msg.from_role.startsWith("service_externe");
              const time = new Date(msg.created_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
              return (
                <div key={msg.id} style={{ display: "flex", gap: 10, marginBottom: 16, justifyContent: isMairie ? "flex-end" : "flex-start" }}>
                  {!isMairie && <div style={{ width: 32, height: 32, borderRadius: "50%", background: svcColor, color: "white", fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{svcInitials}</div>}
                  <div style={{ maxWidth: "60%" }}>
                    {isMairie ? (
                      <div style={{ background: "linear-gradient(135deg, #4F46E5, #6366F1)", borderRadius: "12px 4px 12px 12px", padding: "12px 14px" }}>
                        <p style={{ margin: 0, fontSize: 13, color: "white", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{msg.content}</p>
                      </div>
                    ) : (
                      <div style={{ background: "white", borderRadius: "4px 12px 12px 12px", padding: "12px 14px", border: "1px solid #E2E8F0", boxShadow: "0 1px 2px rgba(0,0,0,0.04)" }}>
                        <p style={{ margin: 0, fontSize: 13, color: "#374151", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{msg.content}</p>
                      </div>
                    )}
                    <span style={{ fontSize: 11, color: "#94a3b8", marginTop: 4, display: "block", textAlign: isMairie ? "right" : "left" }}>{time}</span>
                  </div>
                  {isMairie && <div style={{ width: 32, height: 32, borderRadius: "50%", background: "linear-gradient(135deg,#4F46E5,#7C3AED)", color: "white", fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{nameInitials([msg.prenom, msg.nom].filter(Boolean).join(" ") || "Mairie")}</div>}
                </div>
              );
            })}
          </div>
          <div style={{ padding: "12px 16px", borderTop: "1px solid #E2E8F0", background: "white", display: "flex", alignItems: "center", gap: 10 }}>
            <input
              placeholder="Écrire un message..."
              value={serviceDraft}
              onChange={e => setServiceDraft(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void sendServiceMessage(); } }}
              disabled={sending}
              style={{ flex: 1, border: "1px solid #E2E8F0", borderRadius: 8, padding: "9px 14px", fontSize: 13, outline: "none" }}
            />
            <button
              onClick={() => void sendServiceMessage()}
              disabled={!serviceDraft.trim() || sending}
              style={{ width: 36, height: 36, borderRadius: "50%", background: "linear-gradient(135deg, #4F46E5, #6366F1)", border: "none", cursor: serviceDraft.trim() && !sending ? "pointer" : "not-allowed", opacity: serviceDraft.trim() && !sending ? 1 : 0.5, color: "white", display: "flex", alignItems: "center", justifyContent: "center" }}
            >
              <SendIcon size={14} />
            </button>
          </div>
          </>);
        })() : selected ? (<>
          {/* Citizen thread */}
          <div style={{ padding: "14px 20px", borderBottom: "1px solid #E2E8F0", background: "white", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#0F172A" }}>{selected.petitionnaire}</div>
              <div style={{ fontSize: 12, color: "#94a3b8" }}>
                <button
                  onClick={() => onDossierClick({ id: selected.dossier_id, numero: selected.numero, type: selected.type, petitionnaire: selected.petitionnaire, adresse: "—", status: selected.status, echeance: "—" })}
                  style={{ background: "none", border: "none", padding: 0, color: "#4F46E5", fontWeight: 600, fontSize: 12, cursor: "pointer", textDecoration: "underline" }}
                >
                  {selected.numero}
                </button>
                {" "}– {TYPE_LABEL[selected.type] ?? selected.type}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button
                onClick={markUnread}
                title="Marquer comme non lu"
                style={{ padding: "6px 12px", background: "white", border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 12, color: "#64748b", cursor: "pointer", display: "flex", alignItems: "center", gap: 5 }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
                Non lu
              </button>
              <button style={{ border: "none", background: "none", cursor: "pointer", color: "#94a3b8" }}><DotsIcon /></button>
            </div>
          </div>
          <div style={{ flex: 1, padding: 20, overflowY: "auto" }}>
            {thread.map((msg) => {
              const isInstructeur = msg.from_role !== "citoyen";
              const senderName = [msg.prenom, msg.nom].filter(Boolean).join(" ") || (isInstructeur ? "Instructeur" : selected.petitionnaire);
              const time = new Date(msg.created_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
              return (
                <div key={msg.id} style={{ display: "flex", gap: 10, marginBottom: 16, justifyContent: isInstructeur ? "flex-end" : "flex-start" }}>
                  {!isInstructeur && <div style={{ width: 32, height: 32, borderRadius: "50%", background: stringToColor(selected.petitionnaire), color: "white", fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{nameInitials(selected.petitionnaire)}</div>}
                  <div style={{ maxWidth: "60%" }}>
                    {(() => {
                      const atts = msg.attachments ?? [];
                      const renderAtts = (dark: boolean) => atts.length > 0 && (
                        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: msg.content ? 8 : 0 }}>
                          {atts.map((att) => {
                            const isImg = (att.type ?? "").toLowerCase().startsWith("image/");
                            return isImg ? (
                              <a key={att.document_id} href={att.url} target="_blank" rel="noopener noreferrer" style={{ display: "block" }}>
                                <img src={att.url} alt={att.nom} style={{ maxHeight: 160, maxWidth: "100%", borderRadius: 8, border: dark ? "1px solid rgba(255,255,255,0.3)" : "1px solid #E2E8F0" }} />
                              </a>
                            ) : (
                              <a key={att.document_id} href={att.url} target="_blank" rel="noopener noreferrer"
                                style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600, textDecoration: "none", padding: "6px 10px", borderRadius: 8,
                                  background: dark ? "rgba(255,255,255,0.15)" : "#F8FAFC", color: dark ? "white" : "#334155", border: dark ? "1px solid rgba(255,255,255,0.25)" : "1px solid #E2E8F0" }}>
                                📎 <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 200 }}>{att.nom}</span>
                              </a>
                            );
                          })}
                        </div>
                      );
                      return isInstructeur ? (
                        <div style={{ background: "linear-gradient(135deg, #4F46E5, #6366F1)", borderRadius: "12px 4px 12px 12px", padding: "12px 14px" }}>
                          {msg.content && <p style={{ margin: 0, fontSize: 13, color: "white", lineHeight: 1.5 }}>{msg.content}</p>}
                          {renderAtts(true)}
                        </div>
                      ) : (
                        <div style={{ background: "white", borderRadius: "4px 12px 12px 12px", padding: "12px 14px", border: "1px solid #E2E8F0", boxShadow: "0 1px 2px rgba(0,0,0,0.04)" }}>
                          {msg.content && <p style={{ margin: 0, fontSize: 13, color: "#374151", lineHeight: 1.5 }}>{msg.content}</p>}
                          {renderAtts(false)}
                        </div>
                      );
                    })()}
                    <span style={{ fontSize: 11, color: "#94a3b8", marginTop: 4, display: "block", textAlign: isInstructeur ? "right" : "left" }}>{time}</span>
                  </div>
                  {isInstructeur && <div style={{ width: 32, height: 32, borderRadius: "50%", background: "linear-gradient(135deg,#4F46E5,#7C3AED)", color: "white", fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{nameInitials(senderName)}</div>}
                </div>
              );
            })}
          </div>
          <div style={{ padding: "12px 16px", borderTop: "1px solid #E2E8F0", background: "white", display: "flex", alignItems: "center", gap: 10 }}>
            <input
              placeholder="Écrire un message..."
              value={citizenDraft}
              onChange={e => setCitizenDraft(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void sendCitizenMessage(); } }}
              disabled={sending}
              style={{ flex: 1, border: "1px solid #E2E8F0", borderRadius: 8, padding: "9px 14px", fontSize: 13, outline: "none" }}
            />
            <button
              onClick={() => void sendCitizenMessage()}
              disabled={!citizenDraft.trim() || sending}
              style={{ width: 36, height: 36, borderRadius: "50%", background: "linear-gradient(135deg, #4F46E5, #6366F1)", border: "none", cursor: citizenDraft.trim() && !sending ? "pointer" : "not-allowed", opacity: citizenDraft.trim() && !sending ? 1 : 0.5, color: "white", display: "flex", alignItems: "center", justifyContent: "center" }}
            >
              <SendIcon size={14} />
            </button>
          </div>
        </>) : (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#94a3b8", fontSize: 13 }}>Sélectionnez une conversation</div>
        )}
      </div>

      {/* ── Panneau info ── */}
      <div style={{ width: 260, borderLeft: "1px solid #E2E8F0", background: "white", padding: 16, overflowY: "auto" }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#0F172A", marginBottom: 12 }}>Informations</div>
        {selectedService ? (() => {
          const svcName = selectedService.service_full_name ?? selectedService.service_name;
          const svcColor = stringToColor(svcName);
          const statusLabel: Record<string, { label: string; bg: string; color: string }> = {
            en_attente: { label: "En attente", bg: "#FEF3C7", color: "#92400E" },
            avis_recu: { label: "Avis reçu", bg: "#DCFCE7", color: "#15803D" },
            non_requis: { label: "Non requis", bg: "#F1F5F9", color: "#64748b" },
            refuse: { label: "Refusé", bg: "#FEE2E2", color: "#B91C1C" },
          };
          const st = statusLabel[selectedService.consultation_status] ?? { label: selectedService.consultation_status, bg: "#EEF2FF", color: "#4F46E5" };
          return (<>
          <div style={{ marginBottom: 4, fontSize: 11, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.06em" }}>Service consulté</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <div style={{ width: 32, height: 32, borderRadius: "50%", background: svcColor, color: "white", fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{nameInitials(svcName)}</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#0F172A", lineHeight: 1.3 }}>{svcName}</div>
          </div>
          {selectedService.service_email && (
            <div style={{ fontSize: 12, color: "#64748b", marginBottom: 12 }}>{selectedService.service_email}</div>
          )}
          <div style={{ borderTop: "1px solid #F1F5F9", paddingTop: 12, marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Dossier lié</div>
            <button
              onClick={() => onDossierClick({ id: selectedService.dossier_id, numero: selectedService.numero, type: selectedService.type, petitionnaire: "—", adresse: "—", status: selectedService.status, echeance: "—" })}
              style={{ background: "none", border: "none", padding: 0, fontSize: 13, fontWeight: 600, color: "#4F46E5", marginBottom: 4, cursor: "pointer", textDecoration: "underline", display: "block" }}
            >
              {selectedService.numero}
            </button>
            <div style={{ fontSize: 12, color: "#64748b" }}>{TYPE_LABEL[selectedService.type] ?? selectedService.type}</div>
          </div>
          {selectedService.last_content && (
            <div style={{ borderTop: "1px solid #F1F5F9", paddingTop: 12, marginBottom: 12 }}>
              <div style={{ fontSize: 11, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Dernier message</div>
              <div style={{ fontSize: 12, color: "#64748b" }}>{selectedService.last_content}</div>
            </div>
          )}
          <div style={{ borderTop: "1px solid #F1F5F9", paddingTop: 12 }}>
            <div style={{ fontSize: 11, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Statut consultation</div>
            <span style={{ display: "inline-block", padding: "3px 10px", borderRadius: 12, background: st.bg, color: st.color, fontSize: 11, fontWeight: 600 }}>{st.label}</span>
          </div>
          </>);
        })() : selected ? (<>
          <div style={{ marginBottom: 4, fontSize: 11, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.06em" }}>Pétitionnaire</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#4F46E5", marginBottom: 12 }}>{selected.petitionnaire}</div>
          <div style={{ borderTop: "1px solid #F1F5F9", paddingTop: 12, marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Dossier</div>
            <button
              onClick={() => onDossierClick({ id: selected.dossier_id, numero: selected.numero, type: selected.type, petitionnaire: selected.petitionnaire, adresse: "—", status: selected.status, echeance: "—" })}
              style={{ background: "none", border: "none", padding: 0, fontSize: 13, fontWeight: 600, color: "#4F46E5", marginBottom: 4, cursor: "pointer", textDecoration: "underline", display: "block" }}
            >
              {selected.numero}
            </button>
            <div style={{ fontSize: 12, color: "#64748b", marginBottom: 8 }}>{TYPE_LABEL[selected.type] ?? selected.type}</div>
            <StatusBadge status={STATUS_LABEL[selected.status] ?? selected.status} />
          </div>
        </>) : <div style={{ fontSize: 12, color: "#94a3b8" }}>Aucune conversation sélectionnée</div>}
      </div>
    </div>
  );
}
