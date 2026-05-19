import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Card, CardContent } from "../../components/ui/card";
import { api } from "../../lib/api";

type ParcelAnalysis = {
  query: string;
  address?: { label: string; lat: number; lng: number; city: string; postcode: string };
  parcel?: { parcelle_id: string; section: string; numero: string; surface_m2: number; commune: string; code_insee: string };
  plu_zone?: { zone_code: string; zone_label: string; zone_type: string; plu_nom?: string };
  risks?: { flood_risk: string; seismic_zone: string };
  db_zone?: { id: string; code: string; label: string | null; type: string | null } | null;
  rules: Array<{ id: string; topic: string; rule_text: string; value_min: number | null; value_max: number | null; unit: string | null; summary: string | null; article_number: number | null; conditions: string | null }>;
  buildability: {
    maxFootprintM2: number; remainingFootprintM2: number; maxHeightM: number | null;
    minSetbackFromRoadM: number | null; minSetbackFromBoundariesM: number | null;
    estimatedFloors: number | null; greenSpaceRatio: number | null;
    greenSpaceRequiredM2: number | null; confidence: number; resultSummary: string;
  } | null;
  data_sources: string[];
  warnings: string[];
};

const TOPIC_LABEL: Record<string, string> = {
  recul_voie: "Recul voirie", recul_limite: "Recul limites", emprise_sol: "Emprise au sol",
  hauteur: "Hauteur max.", stationnement: "Stationnement", espaces_verts: "Espaces verts",
  terrain_min: "Terrain minimum",
};

const TOPIC_ICON: Record<string, string> = {
  recul_voie: "↔", recul_limite: "⬛", emprise_sol: "▦", hauteur: "↑",
  stationnement: "🅿", espaces_verts: "🌿", terrain_min: "⬜",
};

function floodLabel(v: string) {
  return { fort: "Aléa fort – PPRI", moyen: "Aléa moyen", faible: "Aléa faible", nul: "Hors zone inondable", inconnu: "Non déterminé" }[v] ?? v;
}
function floodColor(v: string) {
  return v === "fort" || v === "moyen" ? "text-red-700 bg-red-50 border-red-200"
    : v === "faible" ? "text-amber-700 bg-amber-50 border-amber-200"
    : v === "nul" ? "text-green-700 bg-green-50 border-green-200"
    : "text-gray-500 bg-gray-50 border-gray-200";
}

export function AnalyseParcellaire() {
  const [query, setQuery] = useState("");
  const [analysis, setAnalysis] = useState<ParcelAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSearch = async () => {
    if (!query.trim()) return;
    setLoading(true);
    setError("");
    setAnalysis(null);
    try {
      const result = await api.get<ParcelAnalysis>(`/public/analyse?q=${encodeURIComponent(query.trim())}`);
      setAnalysis(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur de recherche");
    } finally {
      setLoading(false);
    }
  };

  const zone = analysis?.plu_zone ?? (analysis?.db_zone ? { zone_code: analysis.db_zone.code, zone_label: analysis.db_zone.label ?? analysis.db_zone.code, zone_type: analysis.db_zone.type ?? "U" } : null);
  const confidence = analysis?.buildability ? Math.round(analysis.buildability.confidence * 100) : null;

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Analyse parcellaire</h1>
        <p className="text-gray-500 mt-1">
          Entrez une adresse ou une référence cadastrale pour connaître les règles d'urbanisme applicables.
        </p>
      </div>

      {/* Search */}
      <Card className="mb-6">
        <CardContent className="p-6">
          <div className="flex gap-3">
            <Input
              placeholder="Ex: 12 rue du Commerce, Ballan-Miré  ou  37018000AB0050"
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleSearch()}
              className="h-12 text-base flex-1"
            />
            <Button onClick={handleSearch} disabled={loading} className="h-12 px-6">
              {loading ? (
                <span className="flex items-center gap-2">
                  <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" /></svg>
                  Analyse…
                </span>
              ) : "Analyser"}
            </Button>
          </div>
          <p className="text-xs text-gray-400 mt-2">Sources : BAN · IGN Cadastre · Géoportail de l'Urbanisme (GPU) · GéoRisques · Base HEUREKA</p>
        </CardContent>
      </Card>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm mb-6">{error}</div>
      )}

      {/* Warnings */}
      {analysis?.warnings && analysis.warnings.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6 space-y-1">
          {analysis.warnings.map((w, i) => (
            <p key={i} className="text-sm text-amber-800">⚠️ {w}</p>
          ))}
        </div>
      )}

      {analysis && (
        <div className="space-y-5">
          {/* Header résultat */}
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-bold text-gray-900">
                {analysis.address?.label ?? analysis.parcel?.parcelle_id ?? analysis.query}
              </h2>
              {analysis.parcel && (
                <p className="text-sm text-gray-500 mt-0.5">
                  Parcelle {analysis.parcel.parcelle_id} · {analysis.parcel.surface_m2} m² · {analysis.parcel.commune}
                </p>
              )}
            </div>
            {analysis.data_sources.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {analysis.data_sources.map(s => (
                  <span key={s} className="text-xs font-semibold text-indigo-600 bg-indigo-50 rounded-full px-2.5 py-0.5">{s}</span>
                ))}
              </div>
            )}
          </div>

          <div className="grid md:grid-cols-3 gap-5">
            {/* ── Colonne principale ── */}
            <div className="md:col-span-2 space-y-5">
              {/* Zone PLU */}
              {zone && (
                <Card>
                  <CardContent className="p-5">
                    <p className="text-xs text-indigo-500 font-semibold uppercase tracking-wide mb-2">Zone réglementaire</p>
                    <div className="flex items-baseline gap-3">
                      <span className="text-3xl font-black text-indigo-700">{zone.zone_code}</span>
                      <span className="text-indigo-600 font-medium">{zone.zone_label}</span>
                    </div>
                    {analysis.plu_zone?.plu_nom && (
                      <p className="text-xs text-gray-400 mt-2">GPU : {analysis.plu_zone.plu_nom}</p>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* Règles applicables */}
              {analysis.rules.length > 0 ? (
                <Card>
                  <CardContent className="p-5">
                    <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4">
                      Règles applicables ({analysis.rules.length})
                    </h3>
                    <div className="space-y-3">
                      {analysis.rules.map(rule => (
                        <div key={rule.id} className="flex items-start gap-3 border border-gray-100 rounded-xl p-3.5 hover:border-indigo-100 transition-colors">
                          <span className="text-lg w-7 text-center flex-shrink-0">{TOPIC_ICON[rule.topic] ?? "•"}</span>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-gray-800">{TOPIC_LABEL[rule.topic] ?? rule.topic}</p>
                            <p className="text-sm text-gray-500 mt-0.5">{rule.summary ?? rule.rule_text.slice(0, 120)}</p>
                            {rule.conditions && (
                              <p className="text-xs text-gray-400 mt-1">↳ {rule.conditions}</p>
                            )}
                          </div>
                          {(rule.value_max != null || rule.value_min != null) && (
                            <div className="bg-indigo-50 rounded-lg px-3 py-1.5 text-center flex-shrink-0">
                              <p className="text-base font-bold text-indigo-700">
                                {rule.value_max != null ? `≤${rule.value_max}` : `≥${rule.value_min}`}
                              </p>
                              <p className="text-xs text-indigo-400">{rule.unit ?? ""}</p>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <Card>
                  <CardContent className="p-5 text-center text-gray-400">
                    <p>Aucune règle enregistrée dans la base HEUREKA pour cette zone.</p>
                    <p className="text-xs mt-1">Contactez votre mairie pour obtenir les règles applicables.</p>
                  </CardContent>
                </Card>
              )}

              {/* Résumé constructibilité */}
              {analysis.buildability?.resultSummary && (
                <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-sm text-green-800">
                  ✅ {analysis.buildability.resultSummary}
                </div>
              )}
            </div>

            {/* ── Colonne latérale ── */}
            <div className="space-y-4">
              {/* Confiance + CTA */}
              <Card>
                <CardContent className="p-5 text-center">
                  {confidence !== null && (
                    <>
                      <p className="text-xs text-gray-500 mb-1">Données disponibles</p>
                      <p className="text-5xl font-black mb-2" style={{ color: confidence >= 80 ? "#16a34a" : confidence >= 50 ? "#ca8a04" : "#dc2626" }}>
                        {confidence}%
                      </p>
                      <div className="w-full bg-gray-100 rounded-full h-1.5 mb-4">
                        <div className="h-1.5 rounded-full transition-all" style={{ width: `${confidence}%`, backgroundColor: confidence >= 80 ? "#16a34a" : confidence >= 50 ? "#ca8a04" : "#dc2626" }} />
                      </div>
                    </>
                  )}
                  <Link to="/register">
                    <Button className="w-full">Déposer une demande →</Button>
                  </Link>
                </CardContent>
              </Card>

              {/* Risques */}
              {analysis.risks && (
                <Card>
                  <CardContent className="p-4">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Risques</p>
                    <div className="space-y-2">
                      <div className={`text-xs font-semibold rounded-lg px-3 py-2 border flex justify-between ${floodColor(analysis.risks.flood_risk)}`}>
                        <span>Inondation</span>
                        <span>{floodLabel(analysis.risks.flood_risk)}</span>
                      </div>
                      <div className="text-xs font-semibold rounded-lg px-3 py-2 border border-gray-200 bg-gray-50 text-gray-600 flex justify-between">
                        <span>Sismique</span>
                        <span>Zone {analysis.risks.seismic_zone}</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Constructibilité synthèse */}
              {analysis.buildability && (
                <Card>
                  <CardContent className="p-4">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Constructibilité</p>
                    <div className="space-y-2">
                      {[
                        ["Emprise restante", analysis.buildability.remainingFootprintM2 > 0 ? `${Math.round(analysis.buildability.remainingFootprintM2)} m²` : "0 m²"],
                        ["Hauteur max.", analysis.buildability.maxHeightM ? `${analysis.buildability.maxHeightM} m` : "—"],
                        ["Étages", analysis.buildability.estimatedFloors ? `~${analysis.buildability.estimatedFloors}` : "—"],
                        ["Espaces verts requis", analysis.buildability.greenSpaceRequiredM2 ? `${Math.round(analysis.buildability.greenSpaceRequiredM2)} m²` : "—"],
                      ].map(([l, v]) => (
                        <div key={l} className="flex justify-between text-sm">
                          <span className="text-gray-500">{l}</span>
                          <span className="font-semibold text-gray-900">{v}</span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        </div>
      )}

      {!analysis && !error && !loading && (
        <Card className="bg-gray-50 border-dashed border-2">
          <CardContent className="p-12 text-center text-gray-400">
            <svg className="w-14 h-14 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
            </svg>
            <p className="text-lg font-medium">Entrez une adresse ou une référence cadastrale</p>
            <p className="text-sm mt-1">Analyse instantanée : zone PLU · risques · règles · constructibilité</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
