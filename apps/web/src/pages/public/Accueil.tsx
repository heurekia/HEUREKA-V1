import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Card, CardContent } from "../../components/ui/card";
import { Badge } from "../../components/ui/badge";
import { api } from "../../lib/api";

const features = [
  {
    title: "Comprenez les règles",
    desc: "Consultez les règles d'urbanisme applicables à votre terrain en quelques clics.",
    icon: (
      <svg className="w-6 h-6 text-heureka-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
      </svg>
    ),
  },
  {
    title: "Déposez vos demandes",
    desc: "Déposez vos demandes d'autorisation d'urbanisme en ligne, 24h/24.",
    icon: (
      <svg className="w-6 h-6 text-heureka-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    ),
  },
  {
    title: "Suivez vos dossiers",
    desc: "Suivez l'avancement de vos demandes en temps réel.",
    icon: (
      <svg className="w-6 h-6 text-heureka-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
  {
    title: "Échangez facilement",
    desc: "Communiquez avec votre commune directement depuis votre espace personnel.",
    icon: (
      <svg className="w-6 h-6 text-heureka-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
      </svg>
    ),
  },
];

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
      <section className="bg-[#F0F0F0] pt-20 pb-32">
        <div className="max-w-3xl mx-auto text-center px-4">
          <h1 className="text-4xl sm:text-5xl font-bold text-[#000020] mb-4">
            L'urbanisme simplifié, pour tous.
          </h1>
          <p className="text-gray-500 mb-10 max-w-xl mx-auto">
            Comprenez les règles applicables à votre projet, déposez vos demandes
            et suivez leur avancement, simplement.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 max-w-xl mx-auto">
            <Input
              placeholder="Ex. : 15 rue des Lilas, 75012 Paris"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              className="h-12 bg-white border-gray-200 text-sm"
            />
            <Button
              onClick={handleSearch}
              disabled={loading}
              className="h-12 px-6 whitespace-nowrap"
            >
              {loading ? "..." : "Analyser mon projet"}
            </Button>
          </div>
        </div>
      </section>

      {analysis && (
        <section className="max-w-5xl mx-auto px-4 -mt-24 relative z-10">
          <Card className="shadow-lg border-0">
            <CardContent className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-[#000020]">
                  Analyse parcellaire : <span className="text-heureka-500">{analysis.parcelle}</span>
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
                      <p className="text-lg font-bold text-heureka-500">{analysis.zone.code}</p>
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
                                <p className="text-heureka-500 font-medium mt-1">
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
        <section className="max-w-5xl mx-auto px-4 -mt-24 relative z-10">
          <Card className="border-red-200">
            <CardContent className="p-4 text-red-700 text-sm">{error}</CardContent>
          </Card>
        </section>
      )}

      <section className="py-20 bg-white">
        <div className="max-w-5xl mx-auto px-4">
          <h2 className="text-2xl font-bold text-center text-[#000020] mb-12">
            Tout ce dont vous avez besoin
          </h2>
          <div className="grid sm:grid-cols-2 gap-6">
            {features.map((f) => (
              <Card key={f.title} className="border-0 shadow-sm hover:shadow-md transition-shadow">
                <CardContent className="p-6">
                  <div className="w-10 h-10 bg-heureka-50 rounded-lg flex items-center justify-center mb-4">
                    {f.icon}
                  </div>
                  <h3 className="font-semibold text-[#000020] mb-2">{f.title}</h3>
                  <p className="text-sm text-gray-500">{f.desc}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <section className="py-20 bg-[#F0F0F0] text-center">
        <div className="max-w-xl mx-auto px-4">
          <h2 className="text-2xl font-bold text-[#000020] mb-4">
            Prêt à simplifier vos démarches ?
          </h2>
          <p className="text-gray-500 mb-8">
            Créez votre compte gratuitement pour déposer vos demandes et suivre tous vos projets.
          </p>
          <Link to="/register">
            <Button size="lg">
              Créer un compte
            </Button>
          </Link>
        </div>
      </section>
    </div>
  );
}
