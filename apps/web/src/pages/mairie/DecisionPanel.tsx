import { useState, useEffect } from "react";
import { api, ApiError } from "../../lib/api";
import { useAuth, hasPermission } from "../../hooks/useAuth";
import { ROLE_LABELS, type DossierInfo } from "./shared";

// Onglet "Décision" du détail dossier : projet d'arrêté, type de décision,
// prescriptions, désignation du signataire, workflow de signature
// (soumission → signature → notification) et refus motivé. Extrait tel quel
// de MairieApp.tsx — comportement inchangé.

type DecisionStatus = "brouillon" | "soumis_signature" | "revision_necessaire" | "signe" | "notifie" | "archive";

type DecisionData = {
  id: string;
  dossier_id: string;
  commune: string;
  type: string;
  motif: string | null;
  prescriptions: string[];
  conditions: string | null;
  status: DecisionStatus;
  instructeur_id: string;
  signataire_id: string | null;
  arrete_numero: string | null;
  date_decision: string | null;
  date_notification: string | null;
  date_limite_recours: string | null;
  motif_refus_signature: string | null;
  created_at: string;
  updated_at: string;
  signataire?: { id: string; prenom: string; nom: string; email: string } | null;
};

type SignataireRow = {
  id: string;
  user_id: string;
  commune: string;
  role: string;
  delegation_arrete: string | null;
  active: boolean;
  user: { id: string; prenom: string; nom: string; email: string } | null;
};

const PC_DECISION_OPTIONS = [
  { key: "accord", label: "Accord", sub: "Autorisation accordée" },
  { key: "accord_prescription", label: "Accord avec prescriptions", sub: "Sous conditions" },
  { key: "refus", label: "Refus", sub: "Opposition au projet" },
  { key: "sursis_a_statuer", label: "Sursis à statuer", sub: "Décision différée" },
];
const CU_DECISION_OPTIONS = [
  { key: "cu_positif", label: "CU positif", sub: "Faisabilité confirmée" },
  { key: "cu_negatif", label: "CU négatif", sub: "Faisabilité impossible" },
];

const DECISION_OPTIONS: Record<string, Array<{ key: string; label: string; sub: string }>> = {
  permis_de_construire: PC_DECISION_OPTIONS,
  permis_de_construire_mi: PC_DECISION_OPTIONS,
  declaration_prealable: [
    { key: "non_opposition", label: "Non-opposition", sub: "Travaux autorisés" },
    { key: "non_opposition_prescription", label: "Non-opposition avec prescriptions", sub: "Sous réserves" },
    { key: "opposition", label: "Opposition", sub: "Travaux refusés" },
    { key: "pieces_complementaires", label: "Demande de pièces", sub: "Pièces manquantes" },
  ],
  certificat_urbanisme: CU_DECISION_OPTIONS,
  certificat_urbanisme_a: CU_DECISION_OPTIONS,
  certificat_urbanisme_b: CU_DECISION_OPTIONS,
  permis_amenager: [
    { key: "accord", label: "Accord", sub: "Autorisation accordée" },
    { key: "accord_prescription", label: "Accord avec prescriptions", sub: "Sous conditions" },
    { key: "refus", label: "Refus", sub: "Opposition au projet" },
    { key: "sursis_a_statuer", label: "Sursis à statuer", sub: "Décision différée" },
  ],
  permis_demolir: [
    { key: "accord", label: "Accord", sub: "Non-opposition à la démolition" },
    { key: "refus", label: "Refus", sub: "Opposition à la démolition" },
    { key: "sursis_a_statuer", label: "Sursis à statuer", sub: "Décision différée" },
  ],
  permis_lotir: [
    { key: "accord", label: "Accord", sub: "Autorisation accordée" },
    { key: "accord_prescription", label: "Accord avec prescriptions", sub: "Sous conditions" },
    { key: "refus", label: "Refus", sub: "Opposition au projet" },
    { key: "sursis_a_statuer", label: "Sursis à statuer", sub: "Décision différée" },
  ],
};

const STATUS_STEPS = [
  { key: "brouillon", label: "Préparation" },
  { key: "soumis_signature", label: "Soumis" },
  { key: "signe", label: "Signé" },
  { key: "notifie", label: "Notifié" },
] as const;

function decisionStepIndex(status: DecisionStatus): number {
  if (status === "brouillon" || status === "revision_necessaire") return 0;
  if (status === "soumis_signature") return 1;
  if (status === "signe") return 2;
  if (status === "notifie") return 3;
  return 0;
}

export function DecisionPanel({ dossier, liveCommune, currentUserId }: {
  dossier: DossierInfo;
  liveCommune: string | null;
  currentUserId?: string;
}) {
  const [decision, setDecision] = useState<DecisionData | null>(null);
  const [loadingDecision, setLoadingDecision] = useState(true);
  const [saving, setSaving] = useState(false);
  const [communeSignataires, setCommuneSignataires] = useState<SignataireRow[]>([]);
  const [showRefuseModal, setShowRefuseModal] = useState(false);
  const [refuseMotif, setRefuseMotif] = useState("");
  const [editingPrescriptions, setEditingPrescriptions] = useState(false);
  // Erreur de la dernière action (enregistrer/soumettre/signer/refuser/notifier).
  // Sans ça, un échec serveur/réseau était avalé silencieusement et l'instructeur
  // pouvait croire l'arrêté signé alors qu'il ne l'était pas.
  const [actionError, setActionError] = useState<string | null>(null);

  // Editable form state
  const [localType, setLocalType] = useState("");
  const [localMotif, setLocalMotif] = useState("");
  const [localPrescriptions, setLocalPrescriptions] = useState<string[]>([]);
  const [localConditions, setLocalConditions] = useState("");
  const [localSignataireId, setLocalSignataireId] = useState<string | null>(null);

  const { user } = useAuth();
  // Permission « Émettre une décision » (rédaction + soumission). La signature
  // reste régie séparément par l'habilitation signataire (cf. isSignataire).
  const canDecide = hasPermission(user, "dossiers.decision");
  const communeName = liveCommune ?? dossier.commune ?? "";
  const decisionOptions = (DECISION_OPTIONS[dossier.type] ?? DECISION_OPTIONS["permis_de_construire"]) as Array<{ key: string; label: string; sub: string }>;
  const isEditable = canDecide && (!decision || decision.status === "brouillon" || decision.status === "revision_necessaire");
  const isSignataire = communeSignataires.some(s => s.user_id === currentUserId);

  useEffect(() => {
    api.get<DecisionData | null>(`/decisions/dossier/${dossier.id}`)
      .then(d => {
        setDecision(d);
        if (d) {
          setLocalType(d.type);
          setLocalMotif(d.motif ?? "");
          setLocalPrescriptions(d.prescriptions ?? []);
          setLocalConditions(d.conditions ?? "");
          setLocalSignataireId(d.signataire_id);
        }
      })
      .catch(() => {})
      .finally(() => setLoadingDecision(false));
  }, [dossier.id]);

  useEffect(() => {
    if (!communeName) return;
    api.get<SignataireRow[]>(`/decisions/communes/${encodeURIComponent(communeName)}/signataires`)
      .then(data => setCommuneSignataires(data))
      .catch(() => {});
  }, [communeName]);

  // Exécuteur commun : pose l'état "en cours", remonte toute erreur serveur/
  // réseau à l'écran (message API si disponible) et renvoie le succès pour que
  // l'appelant enchaîne (ex. fermer la modale de refus).
  const runDecisionAction = async (fn: () => Promise<DecisionData>): Promise<boolean> => {
    setSaving(true);
    setActionError(null);
    try {
      setDecision(await fn());
      return true;
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : "L'opération a échoué. Vérifiez votre connexion et réessayez.");
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleSave = () => runDecisionAction(() => api.post<DecisionData>(`/decisions/dossier/${dossier.id}`, {
    type: localType || decisionOptions[0]?.key,
    motif: localMotif || null,
    prescriptions: localPrescriptions,
    conditions: localConditions || null,
    signataire_id: localSignataireId,
    commune: communeName,
  }));

  const handleSubmit = () => {
    if (!decision) return;
    void runDecisionAction(() => api.post<DecisionData>(`/decisions/${decision.id}/submit`, {}));
  };

  const handleSign = () => {
    if (!decision) return;
    void runDecisionAction(() => api.post<DecisionData>(`/decisions/${decision.id}/sign`, {}));
  };

  const handleRefuse = async () => {
    if (!decision || !refuseMotif.trim()) return;
    const ok = await runDecisionAction(() => api.post<DecisionData>(`/decisions/${decision.id}/refuse-signature`, { motif: refuseMotif }));
    if (ok) {
      setShowRefuseModal(false);
      setRefuseMotif("");
    }
  };

  const handleNotify = () => {
    if (!decision) return;
    void runDecisionAction(() => api.post<DecisionData>(`/decisions/${decision.id}/notify`, {}));
  };

  const stepIdx = decision ? decisionStepIndex(decision.status) : 0;
  const typeLabel = decisionOptions.find(o => o.key === (decision?.type ?? localType))?.label ?? "—";
  const signataireLabel = (() => {
    if (decision?.signataire) return `${decision.signataire.prenom} ${decision.signataire.nom}`;
    const row = communeSignataires.find(s => s.user_id === (localSignataireId ?? decision?.signataire_id));
    if (row?.user) return `${row.user.prenom} ${row.user.nom}`;
    return "Non désigné";
  })();

  if (loadingDecision) return <div style={{ padding: 48, textAlign: "center", color: "#94a3b8" }}>Chargement…</div>;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 16, alignItems: "flex-start" }}>
      <div style={{ display: "flex", flexDirection: "column" as const, gap: 16 }}>
        {actionError && (
          <div role="alert" style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "10px 14px", background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 9, fontSize: 12.5, color: "#991B1B" }}>
            <span style={{ fontWeight: 700 }}>⚠</span>
            <span style={{ flex: 1 }}>{actionError}</span>
            <button onClick={() => setActionError(null)} aria-label="Fermer" style={{ border: "none", background: "none", color: "#991B1B", cursor: "pointer", fontSize: 15, lineHeight: 1, padding: 0 }}>×</button>
          </div>
        )}
        {/* Workflow status bar */}
        <div style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", padding: "16px 20px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 0 }}>
            {STATUS_STEPS.map((step, i) => {
              const done = i < stepIdx;
              const active = i === stepIdx;
              const isRevision = decision?.status === "revision_necessaire" && i === 0;
              return (
                <div key={step.key} style={{ display: "flex", alignItems: "center", flex: i < STATUS_STEPS.length - 1 ? 1 : "none" }}>
                  <div style={{ display: "flex", flexDirection: "column" as const, alignItems: "center", gap: 4 }}>
                    <div style={{
                      width: 28, height: 28, borderRadius: "50%",
                      background: isRevision ? "#FEF2F2" : done ? "#4F46E5" : active ? "#EEF2FF" : "#F1F5F9",
                      border: `2px solid ${isRevision ? "#EF4444" : done ? "#4F46E5" : active ? "#4F46E5" : "#E2E8F0"}`,
                      display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                    }}>
                      {isRevision ? (
                        <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="#EF4444" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                      ) : done ? (
                        <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                      ) : (
                        <div style={{ width: 8, height: 8, borderRadius: "50%", background: active ? "#4F46E5" : "#CBD5E1" }} />
                      )}
                    </div>
                    <span style={{ fontSize: 10, fontWeight: active || done ? 700 : 400, color: isRevision ? "#EF4444" : active || done ? "#4F46E5" : "#94a3b8", whiteSpace: "nowrap" as const }}>
                      {isRevision ? "Révision" : step.label}
                    </span>
                  </div>
                  {i < STATUS_STEPS.length - 1 && (
                    <div style={{ flex: 1, height: 2, background: done ? "#4F46E5" : "#E2E8F0", margin: "0 6px", marginBottom: 16 }} />
                  )}
                </div>
              );
            })}
          </div>
          {decision?.status === "revision_necessaire" && decision.motif_refus_signature && (
            <div style={{ marginTop: 10, padding: "10px 14px", background: "#FEF2F2", borderRadius: 8, border: "1px solid #FECACA" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#B91C1C", marginBottom: 3 }}>Motif du refus de signature</div>
              <div style={{ fontSize: 12, color: "#7F1D1D" }}>{decision.motif_refus_signature}</div>
            </div>
          )}
          {decision?.status === "signe" && (
            <div style={{ marginTop: 10, padding: "10px 14px", background: "#F0FDF4", borderRadius: 8, border: "1px solid #BBF7D0" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#15803D", marginBottom: 2 }}>Arrêté signé — {decision.arrete_numero}</div>
              <div style={{ fontSize: 11, color: "#166534" }}>Date : {decision.date_decision} · Recours jusqu'au : {decision.date_limite_recours ?? "—"}</div>
            </div>
          )}
          {decision?.status === "notifie" && (
            <div style={{ marginTop: 10, padding: "10px 14px", background: "#F0FDF4", borderRadius: 8, border: "1px solid #BBF7D0" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#15803D" }}>Pétitionnaire notifié le {decision.date_notification}</div>
            </div>
          )}
        </div>

        {/* Decision form / read-only view */}
        <div style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", padding: 20 }}>
          {!canDecide && (
            <div style={{ marginBottom: 16, padding: "10px 14px", background: "#FFF7ED", borderRadius: 8, border: "1px solid #FED7AA", fontSize: 12, color: "#C2410C", fontWeight: 600 }}>
              Votre rôle ne vous autorise pas à rédiger ou soumettre une décision. Consultation seule.
            </div>
          )}
          <div style={{ fontSize: 14, fontWeight: 800, color: "#0F172A", marginBottom: 18 }}>
            {isEditable ? "Projet de décision" : "Décision"}
            {decision && !isEditable && <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 500, color: "#4F46E5", background: "#EEF2FF", borderRadius: 6, padding: "2px 8px" }}>{typeLabel}</span>}
          </div>

          {/* Decision type selector */}
          {isEditable && (
            <>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase" as const, letterSpacing: "0.07em", marginBottom: 10 }}>Type de décision</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 8, marginBottom: 20 }}>
                {decisionOptions.map(d => (
                  <button key={d.key} onClick={() => setLocalType(d.key)} style={{
                    border: `1.5px solid ${localType === d.key ? "#4F46E5" : "#E2E8F0"}`,
                    background: localType === d.key ? "#EEF2FF" : "white",
                    borderRadius: 10, padding: "11px 12px", cursor: "pointer", textAlign: "left" as const,
                    boxShadow: localType === d.key ? "0 2px 8px rgba(79,70,229,0.12)" : "none",
                    transition: "all 0.12s",
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 3 }}>
                      <div style={{ width: 16, height: 16, borderRadius: "50%", background: localType === d.key ? "#4F46E5" : "#E2E8F0", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                        <svg width={8} height={8} viewBox="0 0 24 24" fill="none" stroke={localType === d.key ? "white" : "#CBD5E1"} strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                      </div>
                      <span style={{ fontSize: 11.5, fontWeight: 700, color: localType === d.key ? "#4F46E5" : "#374151" }}>{d.label}</span>
                    </div>
                    <div style={{ fontSize: 10.5, color: "#94a3b8", paddingLeft: 23 }}>{d.sub}</div>
                  </button>
                ))}
              </div>
            </>
          )}

          {/* Prescriptions */}
          {(isEditable || (decision && decision.prescriptions?.length > 0)) && (
            <div style={{ marginBottom: 18 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase" as const, letterSpacing: "0.07em" }}>Prescriptions</span>
                  <span style={{ background: "#4F46E5", color: "white", borderRadius: "50%", width: 18, height: 18, fontSize: 10, fontWeight: 800, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                    {localPrescriptions.length}
                  </span>
                </div>
                {isEditable && (
                  <button onClick={() => setEditingPrescriptions(!editingPrescriptions)} style={{ border: "1px solid #E2E8F0", background: "white", borderRadius: 6, padding: "4px 10px", fontSize: 11.5, color: "#4F46E5", cursor: "pointer", fontWeight: 600 }}>
                    {editingPrescriptions ? "Fermer" : "Modifier"}
                  </button>
                )}
              </div>
              <div style={{ display: "flex", flexDirection: "column" as const, gap: 6 }}>
                {localPrescriptions.map((p, i) => (
                  <div key={i} style={{ display: "flex", gap: 9, alignItems: "flex-start", padding: "9px 12px", background: "#F8FAFC", borderRadius: 9, border: "1px solid #EAECF0" }}>
                    <span style={{ width: 19, height: 19, borderRadius: "50%", background: "#EEF2FF", color: "#4F46E5", fontSize: 10, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 1, border: "1px solid #C7D2FE" }}>{i + 1}</span>
                    {editingPrescriptions && isEditable ? (
                      <div style={{ flex: 1, display: "flex", gap: 6 }}>
                        <input value={p} onChange={e => { const next = [...localPrescriptions]; next[i] = e.target.value; setLocalPrescriptions(next); }} style={{ flex: 1, border: "1.5px solid #C7D2FE", borderRadius: 7, padding: "4px 8px", fontSize: 12, outline: "none" }} />
                        <button onClick={() => setLocalPrescriptions(localPrescriptions.filter((_, j) => j !== i))} style={{ border: "none", background: "none", cursor: "pointer", color: "#EF4444", fontSize: 14, padding: "0 4px" }}>×</button>
                      </div>
                    ) : (
                      <span style={{ fontSize: 12.5, color: "#374151", lineHeight: 1.5 }}>{p}</span>
                    )}
                  </div>
                ))}
                {editingPrescriptions && isEditable && (
                  <button onClick={() => setLocalPrescriptions([...localPrescriptions, ""])} style={{ border: "2px dashed #C7D2FE", background: "transparent", borderRadius: 9, padding: "8px 0", fontSize: 12, color: "#4F46E5", cursor: "pointer", fontWeight: 600 }}>+ Ajouter une prescription</button>
                )}
              </div>
            </div>
          )}

          {/* Motif */}
          {isEditable && (
            <div style={{ marginBottom: 18 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase" as const, letterSpacing: "0.07em", marginBottom: 8 }}>Motif / observations</div>
              <textarea value={localMotif} onChange={e => setLocalMotif(e.target.value)} rows={3} placeholder="Observations, éléments de droit, références réglementaires…" style={{ width: "100%", border: "1.5px solid #E2E8F0", borderRadius: 9, padding: "10px 12px", fontSize: 12.5, outline: "none", resize: "vertical" as const, fontFamily: "inherit", boxSizing: "border-box" as const, color: "#374151" }} />
            </div>
          )}

          {/* Save button for editable state */}
          {isEditable && (
            <button onClick={handleSave} disabled={saving || !localType} style={{ background: saving ? "#94a3b8" : "linear-gradient(135deg,#4F46E5,#6366F1)", color: "white", border: "none", borderRadius: 9, padding: "10px 18px", fontSize: 13, fontWeight: 600, cursor: saving || !localType ? "not-allowed" : "pointer", display: "flex", alignItems: "center", gap: 7 }}>
              {saving ? "Enregistrement…" : "Enregistrer le brouillon"}
            </button>
          )}
        </div>

        {/* Arrêté preview */}
        {(isEditable || decision) && (
          <div style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", background: "#F8FAFC", borderBottom: "1px solid #E2E8F0" }}>
              <span style={{ fontSize: 12, color: "#64748b", fontWeight: 500 }}>Aperçu du projet d'arrêté</span>
              {decision?.status === "signe" && decision.arrete_numero && (
                <span style={{ marginLeft: "auto", fontSize: 11, background: "#DCFCE7", color: "#15803D", borderRadius: 6, padding: "2px 8px", fontWeight: 600 }}>N° {decision.arrete_numero}</span>
              )}
            </div>
            <div style={{ padding: "24px 30px", fontFamily: "'Georgia', serif", fontSize: 12.5, lineHeight: 1.9, color: "#1a1a1a", background: "white", minHeight: 200 }}>
              <div style={{ textAlign: "center" as const, marginBottom: 16 }}>
                <div style={{ fontWeight: 700, fontSize: 14, letterSpacing: "0.12em", textTransform: "uppercase" as const }}>Arrêté</div>
                <div style={{ fontSize: 12.5, fontStyle: "italic" as const }}>
                  {decisionOptions.find(o => o.key === (decision?.type ?? localType))?.label?.toLowerCase() ?? "—"}
                </div>
              </div>
              <p style={{ margin: "0 0 8px" }}>Le Maire de {communeName || "la commune"},</p>
              <p style={{ margin: "0 0 4px" }}>Vu la demande présentée le {dossier.date_depot ? new Date(dossier.date_depot).toLocaleDateString("fr-FR") : "—"} par {dossier.petitionnaire}&nbsp;;</p>
              <p style={{ margin: "0 0 12px" }}>Vu le Code de l'urbanisme&nbsp;;</p>
              <p style={{ margin: "0 0 8px", fontWeight: 700, fontSize: 13, letterSpacing: "0.08em", textTransform: "uppercase" as const }}>Arrête</p>
              <p style={{ margin: "0 0 8px" }}><strong>Article 1er</strong> – {decisionOptions.find(o => o.key === (decision?.type ?? localType))?.label ?? "La décision"} est prononcée pour {dossier.petitionnaire}.</p>
              {localPrescriptions.length > 0 && (
                <p style={{ margin: "0 0 4px" }}><strong>Article 2</strong> – Prescriptions :<br />{localPrescriptions.map((p, i) => <span key={i}>{i + 1}. {p}<br /></span>)}</p>
              )}
              <p style={{ margin: "16px 0 0", fontStyle: "italic" as const, color: "#64748b", fontSize: 11 }}>
                {decision?.arrete_numero ? `N° ${decision.arrete_numero}` : "[Numéro d'arrêté]"} · {decision?.date_decision ?? "[Date de signature]"} · {signataireLabel}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Right column */}
      <div style={{ display: "flex", flexDirection: "column" as const, gap: 14 }}>
        {/* Signataire selector */}
        {isEditable && (
          <div style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", padding: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#0F172A", marginBottom: 12 }}>Signataire désigné</div>
            {communeSignataires.length === 0 ? (
              <div style={{ fontSize: 12, color: "#94a3b8", padding: "12px 0" }}>Aucun signataire configuré pour cette commune. Ajoutez-en un dans Paramètres → Signataires.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column" as const, gap: 6 }}>
                {communeSignataires.map(s => (
                  <button key={s.id} onClick={() => setLocalSignataireId(s.user_id)} style={{
                    display: "flex", alignItems: "center", gap: 10, padding: "10px 12px",
                    border: `1.5px solid ${localSignataireId === s.user_id ? "#4F46E5" : "#E2E8F0"}`,
                    borderRadius: 9, background: localSignataireId === s.user_id ? "#EEF2FF" : "white", cursor: "pointer", textAlign: "left" as const,
                  }}>
                    <div style={{ width: 32, height: 32, borderRadius: "50%", background: "linear-gradient(135deg,#4F46E5,#6366F1)", color: "white", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 800, flexShrink: 0 }}>
                      {s.user ? `${s.user.prenom[0] ?? ""}${s.user.nom[0] ?? ""}`.toUpperCase() : "?"}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 600, color: "#0F172A" }}>{s.user ? `${s.user.prenom} ${s.user.nom}` : "—"}</div>
                      <div style={{ fontSize: 11, color: "#94a3b8" }}>{ROLE_LABELS[s.role] ?? s.role}</div>
                    </div>
                    {localSignataireId === s.user_id && <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="#4F46E5" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Signatures status */}
        {decision && !isEditable && (
          <div style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", padding: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#0F172A", marginBottom: 12 }}>Signatures</div>
            {[
              { label: "Instructeur·trice", name: dossier.instructeur ?? "—", signed: true, date: decision.created_at?.split("T")[0] },
              { label: ROLE_LABELS[communeSignataires.find(s => s.user_id === decision.signataire_id)?.role ?? ""] ?? "Signataire", name: signataireLabel, signed: decision.status === "signe" || decision.status === "notifie", date: decision.date_decision },
            ].map((sig, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderBottom: i === 0 ? "1px solid #F1F5F9" : "none" }}>
                <div style={{ width: 34, height: 34, borderRadius: "50%", background: "linear-gradient(135deg,#4F46E5,#6366F1)", color: "white", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 800, flexShrink: 0 }}>
                  {sig.name.split(" ").map(w => w[0] ?? "").join("").slice(0, 2).toUpperCase() || "?"}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: "#0F172A" }}>{sig.name}</div>
                  <div style={{ fontSize: 11, color: "#94a3b8" }}>{sig.label}</div>
                </div>
                <span style={{ fontSize: 10.5, fontWeight: 700, color: sig.signed ? "#15803D" : "#C2410C", background: sig.signed ? "#F0FDF4" : "#FFF7ED", borderRadius: 6, padding: "3px 8px", border: `1px solid ${sig.signed ? "#BBF7D0" : "#FED7AA"}`, whiteSpace: "nowrap" as const }}>
                  {sig.signed ? (sig.date ?? "Signé") : "En attente"}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Actions */}
        <div style={{ display: "flex", flexDirection: "column" as const, gap: 9 }}>
          {/* Submit for signature */}
          {isEditable && decision && (
            <button onClick={handleSubmit} disabled={saving || !localSignataireId} style={{ background: !localSignataireId ? "#E2E8F0" : "linear-gradient(135deg,#4F46E5,#6366F1)", color: !localSignataireId ? "#94a3b8" : "white", border: "none", borderRadius: 11, padding: "13px 0", fontSize: 13.5, fontWeight: 700, cursor: !localSignataireId ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, boxShadow: !localSignataireId ? "none" : "0 4px 12px rgba(79,70,229,0.35)" }}>
              <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
              {saving ? "Envoi…" : "Soumettre pour signature"}
            </button>
          )}

          {/* Sign / Refuse (for signataire) */}
          {decision?.status === "soumis_signature" && isSignataire && (
            <>
              <button onClick={handleSign} disabled={saving} style={{ background: "linear-gradient(135deg,#059669,#10B981)", color: "white", border: "none", borderRadius: 11, padding: "13px 0", fontSize: 13.5, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, boxShadow: "0 4px 12px rgba(5,150,105,0.3)" }}>
                <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                {saving ? "Signature…" : "Signer l'arrêté"}
              </button>
              <button onClick={() => { setActionError(null); setShowRefuseModal(true); }} style={{ background: "white", color: "#EF4444", border: "1.5px solid #FECACA", borderRadius: 11, padding: "12px 0", fontSize: 13, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 7 }}>
                <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                Refuser — demander révision
              </button>
            </>
          )}

          {/* Pending info for instructeur */}
          {decision?.status === "soumis_signature" && !isSignataire && (
            <div style={{ padding: "14px 16px", background: "#FFF7ED", borderRadius: 11, border: "1px solid #FED7AA", fontSize: 12.5, color: "#92400E", textAlign: "center" as const, fontWeight: 500 }}>
              En attente de signature par {signataireLabel}
            </div>
          )}

          {/* Notify */}
          {decision?.status === "signe" && (
            <button onClick={handleNotify} disabled={saving} style={{ background: "linear-gradient(135deg,#0EA5E9,#38BDF8)", color: "white", border: "none", borderRadius: 11, padding: "13px 0", fontSize: 13.5, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, boxShadow: "0 4px 12px rgba(14,165,233,0.3)" }}>
              <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /><polyline points="22,6 12,13 2,6" /></svg>
              {saving ? "Envoi…" : "Marquer comme notifié"}
            </button>
          )}
        </div>
      </div>

      {/* Refuse modal */}
      {showRefuseModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => setShowRefuseModal(false)}>
          <div style={{ background: "white", borderRadius: 14, width: 460, padding: 24, boxShadow: "0 20px 50px rgba(0,0,0,0.2)" }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#0F172A", marginBottom: 6 }}>Refuser la signature</div>
            <div style={{ fontSize: 12.5, color: "#64748b", marginBottom: 16 }}>Précisez le motif du refus. L'instructeur sera notifié et devra réviser le projet d'arrêté.</div>
            <textarea value={refuseMotif} onChange={e => setRefuseMotif(e.target.value)} rows={4} placeholder="Ex : Le type de décision ne correspond pas à l'avis de la DDT. Article L.424-1 non respecté…" style={{ width: "100%", border: "1.5px solid #E2E8F0", borderRadius: 9, padding: "10px 12px", fontSize: 12.5, outline: "none", resize: "vertical" as const, fontFamily: "inherit", boxSizing: "border-box" as const, marginBottom: 16 }} />
            {actionError && (
              <div role="alert" style={{ padding: "9px 12px", background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 8, fontSize: 12, color: "#991B1B", marginBottom: 12 }}>{actionError}</div>
            )}
            <div style={{ display: "flex", gap: 9, justifyContent: "flex-end" }}>
              <button onClick={() => setShowRefuseModal(false)} style={{ border: "1px solid #E2E8F0", background: "white", borderRadius: 8, padding: "9px 18px", fontSize: 13, cursor: "pointer", color: "#374151" }}>Annuler</button>
              <button onClick={handleRefuse} disabled={!refuseMotif.trim() || saving} style={{ background: "#EF4444", color: "white", border: "none", borderRadius: 8, padding: "9px 18px", fontSize: 13, fontWeight: 600, cursor: !refuseMotif.trim() ? "not-allowed" : "pointer" }}>Confirmer le refus</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
