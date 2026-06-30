import { useState, useEffect, useCallback } from "react";
import { api } from "../../lib/api";
import { useAuth } from "../../hooks/useAuth";

// Onglet « Fiscal » des Paramètres commune : le responsable y saisit la part
// communale de la taxe d'aménagement (et secteurs/exonérations), au-dessus des
// constantes nationales (lecture seule) déployées avec l'application. Un aperçu
// de calcul démontre la chaîne complète (résolveur → computeTaxeAmenagement).

// Un secteur à taux majoré est rattaché à une ZONE PLU réelle de la commune
// (zone_code), pour qu'une parcelle déjà classée dans sa zone hérite du bon taux.
type Secteur = { zone_code: string; libelle: string; taux: number };
type ZoneRef = { zone_code: string; zone_label: string | null; zone_type: string | null };

type Resolved = {
  year: number;
  is_idf: boolean;
  constantes: { valeur_forfaitaire_m2: number; abattement_rate: number; rap_rate: number } | null;
  valeur_forfaitaire_m2: number | null;
  forfait_piscine_m2: number | null;
  forfait_stationnement_min: number | null;
  forfait_stationnement_max: number | null;
  taux_communal_pct: number | null;
  secteurs_taux_majore: Secteur[] | null;
  exonerations_facultatives: string[] | null;
  taux_departemental_pct: number | null;
  source: {
    national: string | null;
    communale: { deliberation_ref: string | null; deliberation_date: string | null; effective_from: string } | null;
  };
  completeness: { national: boolean; communale: boolean; departementale: boolean };
  warnings: string[];
};

type Version = {
  id: string;
  part_communale_rate: number;
  deliberation_ref: string | null;
  effective_from: string;
  effective_to: string | null;
  status: string;
};

type Calcul = {
  base_totale_eur: number;
  part_communale_eur: number;
  part_departementale_eur: number;
  taxe_amenagement_eur: number;
  rap_eur: number;
  lignes: { libelle: string; base_eur: number }[];
};

// Exonérations facultatives les plus courantes (art. 1635 quater D CGI / ex-L.331-9).
const EXONERATIONS: { code: string; label: string }[] = [
  { code: "logements_sociaux_pls", label: "Logements sociaux financés en PLS" },
  { code: "commerces_moins_400m2", label: "Commerces de détail < 400 m²" },
  { code: "abris_jardin_dp", label: "Abris de jardin / pigeonniers soumis à DP" },
  { code: "locaux_artisanaux", label: "Locaux artisanaux et industriels" },
  { code: "maisons_sante", label: "Maisons de santé publiques" },
  { code: "immeubles_monuments", label: "Immeubles classés / inscrits (MH)" },
  { code: "constructions_agricoles", label: "Serres et locaux agricoles" },
];

const euro = (n: number) => n.toLocaleString("fr-FR", { maximumFractionDigits: 0 }) + " €";

export function FiscalTab({ commune, inseeMap }: { commune: string; inseeMap: Record<string, string> }) {
  const { user } = useAuth();
  const canEdit = user?.role === "mairie" || user?.role === "admin";
  const insee = inseeMap[commune];

  const [resolved, setResolved] = useState<Resolved | null>(null);
  const [zonesList, setZonesList] = useState<ZoneRef[]>([]);
  const [history, setHistory] = useState<Version[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Form (part communale)
  const [partCommunale, setPartCommunale] = useState("");
  const [exonerations, setExonerations] = useState<string[]>([]);
  const [secteurs, setSecteurs] = useState<Secteur[]>([]);
  const [deliberationRef, setDeliberationRef] = useState("");
  const [deliberationDate, setDeliberationDate] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState("");

  // Aperçu
  const [surface, setSurface] = useState("120");
  const [residencePrincipale, setResidencePrincipale] = useState(true);
  const [piscine, setPiscine] = useState("");
  const [stationnement, setStationnement] = useState("");
  const [calcul, setCalcul] = useState<Calcul | null>(null);
  const [previewing, setPreviewing] = useState(false);

  const load = useCallback(() => {
    if (!insee) { setLoading(false); return; }
    setLoading(true);
    Promise.all([
      api.get<{ fiscalite: Resolved }>(`/mairie/communes/${insee}/fiscalite`),
      api.get<Version[]>(`/mairie/communes/${insee}/fiscalite/history`).catch(() => []),
      api.get<ZoneRef[]>(`/mairie/communes/${insee}/zones`).catch(() => []),
    ])
      .then(([f, h, z]) => {
        setResolved(f.fiscalite);
        setHistory(h);
        setZonesList(z);
        // Pré-remplit le formulaire avec la version en vigueur.
        if (f.fiscalite.taux_communal_pct != null) setPartCommunale(String(f.fiscalite.taux_communal_pct));
        setExonerations(f.fiscalite.exonerations_facultatives ?? []);
        setSecteurs(f.fiscalite.secteurs_taux_majore ?? []);
        setDeliberationRef(f.fiscalite.source.communale?.deliberation_ref ?? "");
      })
      .catch(() => setError("Impossible de charger la fiscalité de la commune."))
      .finally(() => setLoading(false));
  }, [insee]);

  useEffect(() => { load(); }, [load]);

  const toggleExoneration = (code: string) =>
    setExonerations((xs) => (xs.includes(code) ? xs.filter((x) => x !== code) : [...xs, code]));

  const save = async () => {
    setError(null);
    const part = parseFloat(partCommunale.replace(",", "."));
    if (!Number.isFinite(part) || part < 0) { setError("Taux de part communale invalide."); return; }
    setSaving(true);
    try {
      await api.put(`/mairie/communes/${insee}/fiscalite`, {
        part_communale_rate: part,
        exonerations_facultatives: exonerations,
        secteurs_taux_majore: secteurs.filter((s) => s.zone_code.trim() && Number.isFinite(s.taux)),
        deliberation_ref: deliberationRef.trim() || null,
        deliberation_date: deliberationDate || null,
        effective_from: effectiveFrom || null,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Échec de l'enregistrement.");
    } finally {
      setSaving(false);
    }
  };

  const runPreview = async () => {
    setPreviewing(true);
    try {
      const r = await api.post<{ calcul: Calcul | null }>(`/mairie/communes/${insee}/fiscalite/preview`, {
        surface_m2: parseFloat(surface.replace(",", ".")) || 0,
        residence_principale: residencePrincipale,
        piscine_m2: parseFloat(piscine.replace(",", ".")) || 0,
        stationnement_places: parseFloat(stationnement.replace(",", ".")) || 0,
      });
      setCalcul(r.calcul);
    } catch {
      setCalcul(null);
    } finally {
      setPreviewing(false);
    }
  };

  if (!insee) {
    return <div style={{ padding: 24, color: "#92400E", background: "#FEF3C7", borderRadius: 10 }}>
      Code INSEE de la commune inconnu — impossible de charger la fiscalité.
    </div>;
  }
  if (loading) return <div style={{ padding: 32, textAlign: "center", color: "#94a3b8" }}>Chargement…</div>;

  const c = resolved?.completeness;
  const card: React.CSSProperties = { background: "white", border: "1px solid #E2E8F0", borderRadius: 12, padding: 20, marginBottom: 20 };
  const label: React.CSSProperties = { fontSize: 11, color: "#64748b", marginBottom: 4 };
  const value: React.CSSProperties = { fontSize: 14, fontWeight: 700, color: "#0F172A" };
  const input: React.CSSProperties = { width: "100%", boxSizing: "border-box", padding: "8px 12px", border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 13, color: "#374151", outline: "none" };

  return (
    <div style={{ maxWidth: 880 }}>
      {/* Complétude */}
      <div style={{ display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap" }}>
        {([
          ["Constantes nationales", c?.national],
          ["Part communale", c?.communale],
          ["Part départementale", c?.departementale],
        ] as const).map(([lbl, ok]) => (
          <span key={lbl} style={{
            fontSize: 12, fontWeight: 600, padding: "5px 12px", borderRadius: 999,
            background: ok ? "#DCFCE7" : "#FEF3C7", color: ok ? "#15803D" : "#92400E",
          }}>{ok ? "✓" : "⚠"} {lbl}</span>
        ))}
      </div>

      {/* Constantes nationales (lecture seule) */}
      <div style={card}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#0F172A", marginBottom: 14 }}>
          Constantes nationales {resolved?.year} {resolved?.is_idf ? "· Île-de-France" : ""}
          <span style={{ fontSize: 11, fontWeight: 400, color: "#94a3b8", marginLeft: 8 }}>(déployées avec l'application — lecture seule)</span>
        </div>
        {resolved?.constantes ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 14 }}>
            <div><div style={label}>Valeur forfaitaire / m²</div><div style={value}>{euro(resolved.valeur_forfaitaire_m2 ?? 0)}</div></div>
            <div><div style={label}>Abattement de droit</div><div style={value}>{Math.round((resolved.constantes.abattement_rate) * 100)} % (100 m²)</div></div>
            <div><div style={label}>Redevance archéologie (RAP)</div><div style={value}>{resolved.constantes.rap_rate} %</div></div>
            <div><div style={label}>Forfait piscine</div><div style={value}>{resolved.forfait_piscine_m2 ? euro(resolved.forfait_piscine_m2) + " / m²" : "—"}</div></div>
            <div><div style={label}>Forfait stationnement</div><div style={value}>{resolved.forfait_stationnement_min ? euro(resolved.forfait_stationnement_min) + " / place" : "—"}</div></div>
            <div><div style={label}>Part départementale</div><div style={value}>{resolved.taux_departemental_pct != null ? resolved.taux_departemental_pct + " %" : "Non renseignée"}</div></div>
          </div>
        ) : (
          <div style={{ color: "#92400E" }}>Constantes nationales absentes pour {resolved?.year}.</div>
        )}
      </div>

      {/* Part communale (éditable) */}
      <div style={card}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#0F172A", marginBottom: 4 }}>Part communale de la taxe d'aménagement</div>
        <div style={{ fontSize: 12, color: "#64748b", marginBottom: 16 }}>
          Taux voté par votre conseil municipal. Toute modification crée une nouvelle version datée
          (les versions précédentes sont conservées pour les certificats déjà délivrés).
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
          <div>
            <div style={label}>Taux de part communale (%)</div>
            <input style={input} value={partCommunale} onChange={(e) => setPartCommunale(e.target.value)} disabled={!canEdit} placeholder="ex. 5" inputMode="decimal" />
          </div>
          <div>
            <div style={label}>Date d'effet</div>
            <input style={input} type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} disabled={!canEdit} />
          </div>
          <div>
            <div style={label}>Délibération de référence</div>
            <input style={input} value={deliberationRef} onChange={(e) => setDeliberationRef(e.target.value)} disabled={!canEdit} placeholder="ex. DCM 2025-42" />
          </div>
          <div>
            <div style={label}>Date de la délibération</div>
            <input style={input} type="date" value={deliberationDate} onChange={(e) => setDeliberationDate(e.target.value)} disabled={!canEdit} />
          </div>
        </div>

        {/* Exonérations facultatives */}
        <div style={label}>Exonérations facultatives délibérées</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16, marginTop: 4 }}>
          {EXONERATIONS.map((x) => {
            const on = exonerations.includes(x.code);
            return (
              <button key={x.code} onClick={() => canEdit && toggleExoneration(x.code)} disabled={!canEdit}
                style={{
                  fontSize: 12, padding: "6px 12px", borderRadius: 999, cursor: canEdit ? "pointer" : "default",
                  border: `1px solid ${on ? "#4F46E5" : "#E2E8F0"}`,
                  background: on ? "#EEF2FF" : "white", color: on ? "#4F46E5" : "#64748b", fontWeight: on ? 600 : 400,
                }}>{on ? "✓ " : ""}{x.label}</button>
            );
          })}
        </div>

        {/* Secteurs à taux majoré */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
          <div style={label}>Secteurs à taux majoré</div>
          {canEdit && (
            <button onClick={() => setSecteurs((s) => [...s, { zone_code: "", libelle: "", taux: 0 }])}
              disabled={zonesList.length === 0}
              style={{ fontSize: 12, color: zonesList.length === 0 ? "#CBD5E1" : "#4F46E5", background: "none", border: "none", cursor: zonesList.length === 0 ? "not-allowed" : "pointer" }}>+ Ajouter un secteur</button>
          )}
        </div>
        {zonesList.length === 0 && (
          <div style={{ fontSize: 12, color: "#92400E", background: "#FEF3C7", borderRadius: 8, padding: "8px 11px", marginBottom: 8 }}>
            Aucune zone PLU disponible pour cette commune. Les secteurs à taux majoré se rattachent à une zone :
            créez-la d'abord dans l'onglet <strong>Réglementation</strong> (zones de la commune).
          </div>
        )}
        {zonesList.length > 0 && secteurs.length === 0 && <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 8 }}>Aucun secteur à taux majoré.</div>}
        {secteurs.map((s, i) => (
          <div key={i} style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <select style={{ ...input, flex: 1 }} value={s.zone_code} disabled={!canEdit}
              onChange={(e) => {
                const z = zonesList.find((zz) => zz.zone_code === e.target.value);
                setSecteurs((arr) => arr.map((x, j) => j === i ? { ...x, zone_code: e.target.value, libelle: z?.zone_label || e.target.value } : x));
              }}>
              <option value="">— Choisir une zone PLU —</option>
              {zonesList.map((z) => (
                <option key={z.zone_code} value={z.zone_code}>{z.zone_code}{z.zone_label ? ` — ${z.zone_label}` : ""}</option>
              ))}
            </select>
            <input style={{ ...input, width: 110 }} value={String(s.taux)} disabled={!canEdit} placeholder="Taux %" inputMode="decimal"
              onChange={(e) => setSecteurs((arr) => arr.map((x, j) => j === i ? { ...x, taux: parseFloat(e.target.value.replace(",", ".")) || 0 } : x))} />
            {canEdit && <button onClick={() => setSecteurs((arr) => arr.filter((_, j) => j !== i))}
              style={{ border: "1px solid #E2E8F0", background: "white", borderRadius: 8, padding: "0 12px", cursor: "pointer", color: "#DC2626" }}>×</button>}
          </div>
        ))}

        {error && <div style={{ color: "#DC2626", fontSize: 13, marginTop: 12 }}>{error}</div>}
        {canEdit && (
          <div style={{ marginTop: 16, display: "flex", alignItems: "center", gap: 12 }}>
            <button onClick={save} disabled={saving}
              style={{ background: "linear-gradient(135deg,#4F46E5,#6366F1)", color: "white", border: "none", borderRadius: 8, padding: "9px 22px", fontSize: 13, fontWeight: 600, cursor: saving ? "not-allowed" : "pointer" }}>
              {saving ? "Enregistrement…" : "Enregistrer une nouvelle version"}
            </button>
            {saved && <span style={{ color: "#15803D", fontSize: 13 }}>✓ Version enregistrée</span>}
          </div>
        )}
        {!canEdit && <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 8 }}>Seul un responsable de la commune peut modifier ces valeurs.</div>}
      </div>

      {/* Aperçu de calcul */}
      <div style={card}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#0F172A", marginBottom: 14 }}>Aperçu de calcul</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 12, marginBottom: 14 }}>
          <div><div style={label}>Surface taxable (m²)</div><input style={input} value={surface} onChange={(e) => setSurface(e.target.value)} inputMode="decimal" /></div>
          <div><div style={label}>Piscine (m²)</div><input style={input} value={piscine} onChange={(e) => setPiscine(e.target.value)} inputMode="decimal" placeholder="0" /></div>
          <div><div style={label}>Stationnement (places)</div><input style={input} value={stationnement} onChange={(e) => setStationnement(e.target.value)} inputMode="decimal" placeholder="0" /></div>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#374151", alignSelf: "end", paddingBottom: 8 }}>
            <input type="checkbox" checked={residencePrincipale} onChange={(e) => setResidencePrincipale(e.target.checked)} />
            Résidence principale
          </label>
        </div>
        <button onClick={runPreview} disabled={previewing}
          style={{ background: "white", color: "#4F46E5", border: "1px solid #4F46E5", borderRadius: 8, padding: "8px 18px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
          {previewing ? "Calcul…" : "Calculer la taxe d'aménagement"}
        </button>
        {calcul && (
          <div style={{ marginTop: 16, borderTop: "1px solid #E2E8F0", paddingTop: 14 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 14 }}>
              <div><div style={label}>Part communale</div><div style={value}>{euro(calcul.part_communale_eur)}</div></div>
              <div><div style={label}>Part départementale</div><div style={value}>{euro(calcul.part_departementale_eur)}</div></div>
              <div><div style={label}>Total taxe d'aménagement</div><div style={{ ...value, color: "#4F46E5" }}>{euro(calcul.taxe_amenagement_eur)}</div></div>
              <div><div style={label}>RAP</div><div style={value}>{euro(calcul.rap_eur)}</div></div>
            </div>
            <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 10 }}>
              Base : {euro(calcul.base_totale_eur)} · {calcul.lignes.map((l) => `${l.libelle} (${euro(l.base_eur)})`).join(" + ")}
            </div>
          </div>
        )}
      </div>

      {/* Historique */}
      {history.length > 0 && (
        <div style={card}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#0F172A", marginBottom: 12 }}>Historique des versions</div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead>
              <tr style={{ textAlign: "left", color: "#64748b" }}>
                <th style={{ padding: "6px 8px" }}>Effet</th>
                <th style={{ padding: "6px 8px" }}>Fin</th>
                <th style={{ padding: "6px 8px" }}>Part communale</th>
                <th style={{ padding: "6px 8px" }}>Délibération</th>
              </tr>
            </thead>
            <tbody>
              {history.map((v) => (
                <tr key={v.id} style={{ borderTop: "1px solid #F1F5F9", color: "#374151" }}>
                  <td style={{ padding: "6px 8px" }}>{new Date(v.effective_from).toLocaleDateString("fr-FR")}</td>
                  <td style={{ padding: "6px 8px" }}>{v.effective_to ? new Date(v.effective_to).toLocaleDateString("fr-FR") : <span style={{ color: "#15803D", fontWeight: 600 }}>en vigueur</span>}</td>
                  <td style={{ padding: "6px 8px" }}>{v.part_communale_rate} %</td>
                  <td style={{ padding: "6px 8px" }}>{v.deliberation_ref ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
