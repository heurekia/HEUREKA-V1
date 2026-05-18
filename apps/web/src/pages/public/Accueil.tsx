import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Card, CardContent } from "../../components/ui/card";
import { Badge } from "../../components/ui/badge";
import { api } from "../../lib/api";
import { Search, FileText, MessageSquare, Eye, ArrowRight, CheckCircle, BarChart3, Building2, Clock, Shield } from "lucide-react";

const features = [
  {
    title: "Comprenez les règles",
    desc: "Consultez les règles d'urbanisme applicables à votre terrain en quelques clics.",
    icon: Search,
    color: "bg-heureka-500",
  },
  {
    title: "Déposez vos demandes",
    desc: "Déposez vos demandes d'autorisation d'urbanisme en ligne, 24h/24.",
    icon: FileText,
    color: "bg-blue-500",
  },
  {
    title: "Suivez vos dossiers",
    desc: "Suivez l'avancement de vos demandes en temps réel.",
    icon: Eye,
    color: "bg-emerald-500",
  },
  {
    title: "Échangez facilement",
    desc: "Communiquez avec votre commune directement depuis votre espace personnel.",
    icon: MessageSquare,
    color: "bg-amber-500",
  },
];

const stats = [
  { label: "Dossiers traités", value: "12 500+", icon: FileText },
  { label: "Communes partenaires", value: "48", icon: Building2 },
  { label: "Satisfaction", value: "96%", icon: Shield },
  { label: "Délai moyen", value: "48h", icon: Clock },
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
    <div className="bg-[#F0F0F0]">
      {/* Navigation */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 bg-heureka-500 rounded-lg flex items-center justify-center">
                <span className="text-white font-bold text-xs">H</span>
              </div>
              <span className="text-lg font-bold text-[#000020]">HEUREKA</span>
            </div>
            <div className="flex items-center gap-4">
              <Link to="/login" className="text-sm text-gray-600 hover:text-[#000020] font-medium transition-colors">Se connecter</Link>
              <Link to="/register">
                <Button size="sm" className="bg-heureka-500 hover:bg-heureka-600 text-white rounded-lg">
                  Créer un compte
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="pt-16 pb-24 overflow-hidden">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div>
              <Badge variant="default" className="mb-4 bg-heureka-500 text-white border-0 rounded-full px-4 py-1">
                Plateforme d'urbanisme nouvelle génération
              </Badge>
              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-[#000020] leading-tight mb-4">
                L'urbanisme simplifié,<br />
                <span className="text-heureka-500">pour tous.</span>
              </h1>
              <p className="text-gray-500 text-lg mb-8 max-w-lg">
                Comprenez les règles applicables à votre projet, déposez vos demandes
                et suivez leur avancement, simplement.
              </p>
              <div className="flex flex-col sm:flex-row gap-3 max-w-lg">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                  <Input
                    placeholder="Ex. : 15 rue des Lilas, 75012 Paris"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                    className="h-12 pl-10 bg-white border-gray-200 text-sm rounded-xl"
                  />
                </div>
                <Button
                  onClick={handleSearch}
                  disabled={loading}
                  className="h-12 px-6 whitespace-nowrap rounded-xl"
                >
                  {loading ? "..." : "Analyser mon projet"}
                </Button>
              </div>
              <div className="flex items-center gap-6 mt-6 text-sm text-gray-400">
                <span className="flex items-center gap-1.5"><CheckCircle className="w-4 h-4 text-green-500" /> Gratuit</span>
                <span className="flex items-center gap-1.5"><CheckCircle className="w-4 h-4 text-green-500" /> Sans inscription</span>
                <span className="flex items-center gap-1.5"><CheckCircle className="w-4 h-4 text-green-500" /> Immédiat</span>
              </div>
            </div>

            {/* App Mockup */}
            <div className="hidden lg:block relative">
              <div className="absolute -inset-4 bg-gradient-to-br from-heureka-500/10 via-transparent to-blue-500/10 rounded-3xl blur-2xl" />
              <div className="relative bg-white rounded-2xl shadow-2xl border border-gray-200 overflow-hidden">
                <div className="flex items-center gap-2 px-5 py-3 bg-gray-50 border-b border-gray-100">
                  <div className="w-3 h-3 rounded-full bg-red-400" />
                  <div className="w-3 h-3 rounded-full bg-yellow-400" />
                  <div className="w-3 h-3 rounded-full bg-green-400" />
                  <div className="ml-4 text-xs text-gray-400 bg-white px-3 py-1 rounded-md border border-gray-200 flex-1 max-w-[200px]">
                    heureka.app
                  </div>
                </div>
                <div className="flex" style={{ height: "320px" }}>
                  <div className="w-56 bg-[#000020] p-4 flex flex-col gap-2">
                    <div className="flex items-center gap-2 mb-4">
                      <div className="w-6 h-6 bg-heureka-500 rounded flex items-center justify-center">
                        <span className="text-white font-bold text-[10px]">H</span>
                      </div>
                      <span className="text-white text-xs font-bold">HEUREKA</span>
                    </div>
                    {["Accueil", "Mes demandes", "Messagerie", "Documents"].map((item, i) => (
                      <div
                        key={item}
                        className={`flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs ${
                          i === 0 ? "bg-heureka-500 text-white" : "text-white/60"
                        }`}
                      >
                        <div className={`w-1.5 h-1.5 rounded-full ${i === 0 ? "bg-white" : "bg-white/30"}`} />
                        {item}
                      </div>
                    ))}
                    <div className="mt-auto pt-4 border-t border-white/10 flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full bg-heureka-500 flex items-center justify-center text-white text-[10px] font-bold">
                        JD
                      </div>
                      <span className="text-white/50 text-xs">Jean Dupont</span>
                    </div>
                  </div>
                  <div className="flex-1 bg-[#F0F0F0] p-5">
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <div className="h-4 w-32 bg-gray-200 rounded" />
                        <div className="h-3 w-24 bg-gray-100 rounded mt-1" />
                      </div>
                      <div className="h-8 w-28 bg-heureka-500 rounded-lg" />
                    </div>
                    <div className="grid grid-cols-3 gap-3 mb-4">
                      {[1, 2, 3].map((i) => (
                        <div key={i} className="bg-white rounded-xl p-3 border border-gray-200">
                          <div className="h-3 w-16 bg-gray-200 rounded mb-2" />
                          <div className="h-5 w-10 bg-gray-300 rounded" />
                        </div>
                      ))}
                    </div>
                    <div className="bg-white rounded-xl p-4 border border-gray-200">
                      <div className="flex items-center justify-between mb-3">
                        <div className="h-4 w-28 bg-gray-200 rounded" />
                        <div className="h-3 w-16 bg-gray-100 rounded" />
                      </div>
                      <div className="space-y-2">
                        {[1, 2, 3].map((i) => (
                          <div key={i} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                            <div className="h-3 w-24 bg-gray-200 rounded" />
                            <div className="h-5 w-16 bg-green-100 rounded-full" />
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Analysis Results */}
      {analysis && (
        <section className="max-w-5xl mx-auto px-4 -mt-12 relative z-10">
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
        <section className="max-w-5xl mx-auto px-4 -mt-12 relative z-10">
          <Card className="border-red-200">
            <CardContent className="p-4 text-red-700 text-sm">{error}</CardContent>
          </Card>
        </section>
      )}

      {/* Stats */}
      <section className="py-16 bg-white">
        <div className="max-w-5xl mx-auto px-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            {stats.map((s) => {
              const Icon = s.icon;
              return (
                <div key={s.label} className="text-center">
                  <div className="w-12 h-12 rounded-xl bg-heureka-50 flex items-center justify-center mx-auto mb-3">
                    <Icon className="w-6 h-6 text-heureka-500" />
                  </div>
                  <p className="text-3xl font-bold text-[#000020]">{s.value}</p>
                  <p className="text-sm text-gray-500 mt-1">{s.label}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-20 bg-[#F0F0F0]">
        <div className="max-w-5xl mx-auto px-4">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-[#000020] mb-4">
              Tout ce dont vous avez besoin
            </h2>
            <p className="text-gray-500 max-w-lg mx-auto">
              Une plateforme complète pour gérer vos projets d'urbanisme de A à Z.
            </p>
          </div>
          <div className="grid sm:grid-cols-2 gap-6">
            {features.map((f) => {
              const Icon = f.icon;
              return (
                <Card key={f.title} className="border-0 shadow-sm hover:shadow-lg transition-all hover:-translate-y-0.5">
                  <CardContent className="p-6">
                    <div className={`w-12 h-12 rounded-xl ${f.color} flex items-center justify-center mb-4 shadow-sm`}>
                      <Icon className="w-6 h-6 text-white" />
                    </div>
                    <h3 className="font-semibold text-[#000020] mb-2">{f.title}</h3>
                    <p className="text-sm text-gray-500">{f.desc}</p>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-24 bg-[#000020] text-center relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-heureka-500/10 via-transparent to-blue-500/5" />
        <div className="max-w-xl mx-auto px-4 relative">
          <h2 className="text-3xl font-bold text-white mb-4">
            Prêt à simplifier vos démarches ?
          </h2>
          <p className="text-gray-400 mb-8">
            Créez votre compte gratuitement pour déposer vos demandes et suivre tous vos projets.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link to="/register">
              <Button size="lg" className="bg-heureka-500 hover:bg-heureka-600 text-white border-0 gap-2">
                Créer un compte gratuit
                <ArrowRight className="w-4 h-4" />
              </Button>
            </Link>
            <Link to="/login">
              <Button size="lg" variant="outline" className="border-white/20 text-white hover:bg-white/10">
                Se connecter
              </Button>
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
