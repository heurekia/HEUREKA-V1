import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Card, CardContent, CardHeader } from "../../components/ui/card";
import { Badge } from "../../components/ui/badge";
import { api } from "../../lib/api";

export function AnalyseParcellaire() {
  const [searchQuery, setSearchQuery] = useState("");
  const [analysis, setAnalysis] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setLoading(true);
    setError("");
    setAnalysis(null);
    try {
      const result = await api.get<any>(`/public/analyse-parcelle/${encodeURIComponent(searchQuery.trim())}`);
      setAnalysis(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur de recherche");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Analyse parcellaire</h1>
        <p className="text-gray-500 mt-1">
          Recherchez une parcelle pour connaître son zonage réglementaire et les règles d'urbanisme applicables.
        </p>
      </div>

      <Card className="mb-8">
        <CardContent className="p-6">
          <div className="flex gap-3">
            <div className="flex-1">
              <Input
                placeholder="Référence cadastrale ou adresse..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                className="h-12 text-base"
              />
            </div>
            <Button onClick={handleSearch} disabled={loading} className="h-12 px-6">
              {loading ? "Analyse..." : "Analyser"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {error && (
        <Card className="border-red-200 mb-6">
          <CardContent className="p-4 text-red-700 text-sm">{error}</CardContent>
        </Card>
      )}

      {analysis && (
        <div className="space-y-6">
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-semibold text-gray-900">
                  Parcelle : <span className="text-heureka-600">{analysis.parcelle}</span>
                </h2>
                {analysis.conformite_globale && (
                  <Badge variant={analysis.conformite_globale >= 80 ? "success" : analysis.conformite_globale >= 60 ? "warning" : "danger"} className="text-sm px-4 py-1">
                    {analysis.conformite_globale}% conforme
                  </Badge>
                )}
              </div>

              {analysis.zone ? (
                <div className="grid md:grid-cols-3 gap-6">
                  <div className="md:col-span-2">
                    <div className="bg-heureka-50 rounded-xl p-4 mb-4">
                      <p className="text-xs text-heureka-500 font-medium uppercase">Zone réglementaire</p>
                      <p className="text-2xl font-bold text-heureka-700 mt-1">{analysis.zone.code}</p>
                      <p className="text-heureka-600">{analysis.zone.label}</p>
                    </div>

                    {analysis.rules.length > 0 && (
                      <div>
                        <h3 className="text-sm font-medium text-gray-500 mb-3 uppercase tracking-wider">
                          Règles applicables ({analysis.rules.length})
                        </h3>
                        <div className="space-y-3">
                          {analysis.rules.map((rule: any) => (
                            <div key={rule.id} className="border border-gray-200 rounded-lg p-4 hover:border-heureka-200 transition-colors">
                              <div className="flex items-start justify-between">
                                <div>
                                  <p className="font-medium text-gray-900">
                                    {rule.article_number ? `Article ${rule.article_number}` : ""}
                                    {rule.article_title ? ` - ${rule.article_title}` : ""}
                                  </p>
                                  <p className="text-sm text-gray-600 mt-1">
                                    {rule.summary ?? rule.rule_text?.slice(0, 200)}
                                  </p>
                                </div>
                                {rule.value_exact != null && (
                                  <div className="bg-heureka-50 rounded-lg px-3 py-2 text-center ml-4">
                                    <p className="text-lg font-bold text-heureka-700">{rule.value_exact}</p>
                                    <p className="text-xs text-heureka-500">{rule.unit ?? ""}</p>
                                  </div>
                                )}
                              </div>
                              {rule.conditions && (
                                <p className="text-xs text-gray-400 mt-2">
                                  Conditions : {rule.conditions}
                                </p>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  <div>
                    <div className="bg-gray-50 rounded-xl p-6 text-center sticky top-6">
                      <p className="text-sm text-gray-500 mb-2">Score de conformité</p>
                      <div className="text-6xl font-bold mb-2" style={{ color: analysis.conformite_globale >= 80 ? "#16a34a" : analysis.conformite_globale >= 60 ? "#ca8a04" : "#dc2626" }}>
                        {analysis.conformite_globale}%
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-2 mb-4">
                        <div
                          className="h-2 rounded-full transition-all"
                          style={{
                            width: `${analysis.conformite_globale}%`,
                            backgroundColor: analysis.conformite_globale >= 80 ? "#16a34a" : analysis.conformite_globale >= 60 ? "#ca8a04" : "#dc2626",
                          }}
                        />
                      </div>
                      <Link to="/register">
                        <Button className="w-full">Déposer une demande</Button>
                      </Link>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-center py-8 text-gray-500">
                  <p>Aucune zone réglementaire trouvée pour cette parcelle.</p>
                  <p className="text-sm mt-1">Vérifiez la référence cadastrale ou contactez votre mairie.</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {!analysis && !error && (
        <Card className="bg-gray-50 border-dashed border-2">
          <CardContent className="p-12 text-center text-gray-400">
            <svg className="w-16 h-16 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
            </svg>
            <p className="text-lg">Entrez une référence cadastrale ou une adresse</p>
            <p className="text-sm mt-1">pour analyser le potentiel réglementaire de la parcelle</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
