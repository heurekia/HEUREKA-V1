import { useState, useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../../lib/api";
import { useAuth } from "../../hooks/useAuth";
import { DotsIcon, StatusBadge } from "./ui";
import { COMMUNE_INSEE, notifIcon, notifColor, relTime, resolveCommune, type ApiNotif } from "./shared";
import { ReglementationScreen } from "./ReglementationScreen";
import { TemplateManagerPanel, CommuneLetterheadPanel } from "./MairieCourrierScreen";

// Écran "Paramètres" : onglets Général / Utilisateurs / Réglementation /
// Documents / Notifications / Workflow / Intégrations, et le panneau
// documentaire (DocumentsPanel + SegmentsModal). Extrait de MairieApp.tsx.

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
  const [communeSigs, setCommuneSigs] = useState<{ id: string; user_id: string; role: string; fonction: string | null; signature_image: string | null; tampon_image: string | null; delegation_arrete: string | null }[]>([]);
  const [sigModal, setSigModal] = useState<{ userId: string; name: string } | null>(null);
  const [sigRole, setSigRole] = useState("maire");
  const [sigFonction, setSigFonction] = useState("");
  const [sigDelegation, setSigDelegation] = useState("");
  const [sigSignature, setSigSignature] = useState("");
  const [sigTampon, setSigTampon] = useState("");
  const [sigSaving, setSigSaving] = useState(false);

  const load = () => {
    setLoading(true);
    api.get<StaffUser[]>(`/mairie/admin/users?commune=${encodeURIComponent(commune)}`)
      .then(setUserList)
      .catch(() => setUserList([]))
      .finally(() => setLoading(false));
  };
  const loadSigs = () => {
    api.get<{ id: string; user_id: string; role: string; fonction: string | null; signature_image: string | null; tampon_image: string | null; delegation_arrete: string | null }[]>(
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
          ["Mairie", String(userList.filter(u => u.role === "mairie").length), "#7C3AED"],
          ["Instructeurs", String(userList.filter(u => u.role === "instructeur").length), "#0891B2"],
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
                      <button onClick={() => { const s = getSig(u.id); setSigModal({ userId: u.id, name: `${u.prenom} ${u.nom}` }); setSigRole(s?.role ?? "maire"); setSigFonction(s?.fonction ?? ""); setSigDelegation(s?.delegation_arrete ?? ""); setSigSignature(s?.signature_image ?? ""); setSigTampon(s?.tampon_image ?? ""); }}
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
              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: "#64748b", display: "block", marginBottom: 5 }}>Fonction (intitulé exact imprimé sur les courriers)</label>
                <input value={sigFonction} onChange={e => setSigFonction(e.target.value)} placeholder="ex. Conseiller Municipal Délégué à l'Urbanisme (facultatif)" style={{ width: "100%", padding: "8px 10px", border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 12.5, outline: "none", boxSizing: "border-box" as const }} />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
                {([
                  { label: "Signature", val: sigSignature, set: setSigSignature, hint: "PNG fond transparent recommandé" },
                  { label: "Tampon / Cachet", val: sigTampon, set: setSigTampon, hint: "Image du cachet officiel" },
                ] as const).map(f => (
                  <div key={f.label}>
                    <label style={{ fontSize: 11, fontWeight: 600, color: "#64748b", display: "block", marginBottom: 5 }}>{f.label}</label>
                    {f.val && <img src={f.val} alt="" style={{ height: 40, width: "auto", maxWidth: "100%", border: "1px solid #E2E8F0", borderRadius: 5, objectFit: "contain", background: "#F8FAFC", padding: 3, marginBottom: 6, display: "block" }} />}
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <label style={{ fontSize: 11.5, color: "#4F46E5", cursor: "pointer", border: "1px solid #E2E8F0", borderRadius: 7, padding: "5px 10px", background: "white" }}>
                        {f.val ? "Remplacer" : "Téléverser"}
                        <input type="file" accept="image/*" style={{ display: "none" }} onChange={e => {
                          const file = e.target.files?.[0]; if (!file) return;
                          const reader = new FileReader();
                          reader.onload = () => f.set(typeof reader.result === "string" ? reader.result : "");
                          reader.readAsDataURL(file);
                        }} />
                      </label>
                      {f.val && <button onClick={() => f.set("")} style={{ fontSize: 11, color: "#EF4444", border: "none", background: "none", cursor: "pointer" }}>Retirer</button>}
                    </div>
                    <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 4 }}>{f.hint}</div>
                  </div>
                ))}
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
                      ? api.put(`/decisions/communes/${encodeURIComponent(commune)}/signataires/${currentSig.id}`, { role: sigRole, fonction: sigFonction || null, signature_image: sigSignature || null, tampon_image: sigTampon || null, delegation_arrete: sigDelegation || null })
                      : api.post(`/decisions/communes/${encodeURIComponent(commune)}/signataires`, { user_id: sigModal.userId, role: sigRole, fonction: sigFonction || null, signature_image: sigSignature || null, tampon_image: sigTampon || null, delegation_arrete: sigDelegation || null });
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

export function ParametresScreen({ commune = "", communes = [], isAdmin = false, canManageUsers = false, communeInseeMap = COMMUNE_INSEE, onInseeUpdated }: { commune?: string; communes?: string[]; isAdmin?: boolean; canManageUsers?: boolean; communeInseeMap?: Record<string, string>; onInseeUpdated?: () => void }) {
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
              ) : histNotifs.map(n => {
                // Agent multi-communes : préfixe le nom de la ville concernée.
                const communeLabel = communes.length > 1 ? (resolveCommune(n.commune, communes) ?? n.commune) : null;
                return (
                <div key={n.id} onClick={() => markOneRead(n)}
                  style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "14px 20px", borderBottom: "1px solid #F8FAFC", background: n.is_read ? "white" : "#F8F7FF", cursor: "pointer", transition: "background 0.15s" }}>
                  <div style={{ width: 36, height: 36, borderRadius: 10, background: notifColor(n.type) + "18", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0 }}>{notifIcon(n.type)}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" as const }}>
                      {communeLabel && <span style={{ fontSize: 10, fontWeight: 700, color: "#4F46E5", background: "#EEF2FF", borderRadius: 4, padding: "1px 7px" }}>{communeLabel}</span>}
                      <span style={{ fontSize: 13, fontWeight: n.is_read ? 500 : 700, color: "#0F172A" }}>{n.title}</span>
                      <span style={{ fontSize: 11, color: "#94a3b8", flexShrink: 0 }}>{relTime(n.created_at)}</span>
                    </div>
                    <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>{n.message}</div>
                  </div>
                  {!n.is_read && <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#4F46E5", flexShrink: 0, marginTop: 6 }} />}
                </div>
                );
              })}
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
            {/* Pas de titre ici : TemplateManagerPanel rend déjà son propre
                en-tête (« Mes Modèles de Courrier » + bouton « Nouveau modèle »).
                Le doublon de titres a été retiré. */}
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
