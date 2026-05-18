import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Card, CardContent, CardHeader } from "../../components/ui/card";
import { Badge } from "../../components/ui/badge";
import { api } from "../../lib/api";

export function Accueil() {
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
    <div>
      <section className="bg-gradient-to-br from-heureka-600 via-heureka-700 to-blue-900 text-white">
        <div className="max-w-7xl mx-auto px-4 py-20 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto">
            <h1 className="text-4xl sm:text-5xl font-bold mb-4">
              Simplifiez vos démarches d'urbanisme
            </h1>
            <p className="text-lg text-blue-100 mb-8">
              Déposez et suivez vos demandes d'urbanisme en ligne, ou analysez
              le potentiel réglementaire d'une parcelle en un clic.
            </p>
            <div className="relative max-w-xl mx-auto">
              <Input
                placeholder="Rechercher une adresse ou une parcelle..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                className="h-14 pl-4 pr-12 text-gray-900 bg-white rounded-xl text-base border-0"
              />
              <button
                onClick={handleSearch}
                disabled={loading}
                className="absolute right-2 top-1/2 -translate-y-1/2 bg-heureka-600 text-white p-2.5 rounded-lg hover:bg-heureka-700 disabled:opacity-50 transition-colors"
              >
                {loading ? (
                  <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                ) : (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                )}
              </button>
            </div>
          </div>
        </div>
      </section>

      {analysis && (
        <section className="max-w-7xl mx-auto px-4 -mt-6 sm:px-6 lg:px-8 relative z-10">
          <Card className="shadow-lg border-heureka-100">
            <CardContent className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-gray-900">
                  Analyse parcellaire : <span className="text-heureka-600">{analysis.parcelle}</span>
                </h2>
                {analysis.conformite_globale && (
                  <Badge variant={analysis.conformite_globale >= 80 ? "success" : analysis.conformite_globale >= 60 ? "warning" : "danger"}>
                    {analysis.conformite_globale}% conforme
                  </Badge>
                )}
              </div>

              {analysis.zone ? (
                <div className="grid md:grid-cols-2 gap-6">
                  <div>
                    <h3 className="text-sm font-medium text-gray-500 mb-2">Zone réglementaire</h3>
                    <div className="bg-heureka-50 rounded-lg p-4">
                      <p className="text-lg font-bold text-heureka-700">{analysis.zone.code}</p>
                      <p className="text-sm text-heureka-600">{analysis.zone.label}</p>
                    </div>
                    {analysis.rules.length > 0 && (
                      <div className="mt-4">
                        <h3 className="text-sm font-medium text-gray-500 mb-2">
                          Règles applicables ({analysis.rules.length})
                        </h3>
                        <div className="space-y-2 max-h-60 overflow-y-auto">
                          {analysis.rules.map((rule: any) => (
                            <div key={rule.id} className="bg-gray-50 rounded-lg p-3 text-sm">
                              <p className="font-medium text-gray-900">
                                {rule.article_number ? `Art. ${rule.article_number}` : ""} {rule.article_title}
                              </p>
                              <p className="text-gray-600 mt-1">{rule.summary ?? rule.rule_text?.slice(0, 120)}</p>
                              {rule.value_exact != null && (
                                <p className="text-heureka-600 font-medium mt-1">
                                  {rule.value_exact} {rule.unit ?? ""}
                                </p>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col items-center justify-center bg-gray-50 rounded-lg p-8">
                    <div className="text-center">
                      <div className="text-5xl font-bold mb-2" style={{ color: analysis.conformite_globale >= 80 ? "#16a34a" : analysis.conformite_globale >= 60 ? "#ca8a04" : "#dc2626" }}>
                        {analysis.conformite_globale}%
                      </div>
                      <p className="text-gray-500 text-sm mb-4">Score de conformité réglementaire</p>
                      <Link to="/register">
                        <Button>
                          Déposer une demande pour cette parcelle
                        </Button>
                      </Link>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-center py-6 text-gray-500">
                  <p>Aucune zone réglementaire trouvée pour cette parcelle.</p>
                  <p className="text-sm mt-1">Vérifiez la référence ou contactez votre mairie.</p>
                </div>
              )}
            </CardContent>
          </Card>
        </section>
      )}

      {error && (
        <section className="max-w-7xl mx-auto px-4 -mt-6 sm:px-6 lg:px-8 relative z-10">
          <Card className="border-red-200">
            <CardContent className="p-4 text-red-700 text-sm">
              {error}
            </CardContent>
          </Card>
        </section>
      )}

      <section className="max-w-7xl mx-auto px-4 py-16 sm:px-6 lg:px-8">
        <div className="grid md:grid-cols-3 gap-6">
          <Card className="hover:shadow-lg transition-shadow">
            <CardContent className="p-6">
              <div className="w-12 h-12 bg-heureka-100 rounded-xl flex items-center justify-center mb-4">
                <svg className="w-6 h-6 text-heureka-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Déposer une demande</h3>
              <p className="text-gray-600 text-sm mb-4">
                Permis de construire, déclaration préalable, certificat d'urbanisme...
              </p>
              <Link to="/register">
                <Button className="w-full">Commencer</Button>
              </Link>
            </CardContent>
          </Card>
          <Card className="hover:shadow-lg transition-shadow">
            <CardContent className="p-6">
              <div className="w-12 h-12 bg-heureka-100 rounded-xl flex items-center justify-center mb-4">
                <svg className="w-6 h-6 text-heureka-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Analyse parcellaire</h3>
              <p className="text-gray-600 text-sm mb-4">
                Découvrez le potentiel réglementaire d'une parcelle avant de déposer.
              </p>
              <Link to="/analyse-parcellaire">
                <Button variant="outline" className="w-full">Analyser</Button>
              </Link>
            </CardContent>
          </Card>
          <Card className="hover:shadow-lg transition-shadow">
            <CardContent className="p-6">
              <div className="w-12 h-12 bg-heureka-100 rounded-xl flex items-center justify-center mb-4">
                <svg className="w-6 h-6 text-heureka-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Centre d'aide</h3>
              <p className="text-gray-600 text-sm mb-4">
                Questions fréquentes, guides et assistance.
              </p>
              <Link to="/citoyen/centre-aide">
                <Button variant="outline" className="w-full">En savoir plus</Button>
              </Link>
            </CardContent>
          </Card>
        </div>
      </section>
    </div>
  );
}
