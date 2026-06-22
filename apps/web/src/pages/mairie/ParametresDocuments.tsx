import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Badge } from "../../components/ui/badge";
import { Link, useLocation } from "react-router-dom";
import { cn } from "../../lib/utils";
import { api } from "../../lib/api";
import { useAuth } from "../../hooks/useAuth";
import { FileText, Plus, Download, Trash2, Layers, ShieldAlert, Building2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";

const subNav = [
  { to: "/mairie/parametres", label: "Général" },
  { to: "/mairie/parametres/documents", label: "Documents" },
  { to: "/mairie/parametres/utilisateurs", label: "Utilisateurs" },
  { to: "/mairie/parametres/workflow", label: "Workflow" },
  { to: "/mairie/parametres/notifications", label: "Notifications" },
  { to: "/mairie/parametres/integrations", label: "Intégrations" },
];

// Types de demandes d'autorisation : figés par l'enum SQL (dossier_type),
// il n'existe pas d'endpoint CRUD pour les gérer dynamiquement.
const demandeTypes = [
  "Permis de construire",
  "Déclaration préalable",
  "Permis d'aménager",
  "Permis de démolir",
  "Certificat d'urbanisme",
];

// Documents d'urbanisme de référence réellement stockés pour la commune
// (table regulatory_documents). Aligné sur REGULATORY_DOCUMENT_TYPES.
interface RegulatoryDocument {
  id: string;
  type: string;
  name: string;
  original_filename: string;
  file_size: number | null;
  validation_status: "brouillon" | "valide" | "rejete";
  created_at: string;
}

const TYPE_LABELS: Record<string, string> = {
  plu: "PLU", plui: "PLUi", plum: "PLUm", ppri: "PPRI / PPRN", pprt: "PPRT",
  oap: "OAP", peb: "PEB", plh: "PLH", zac: "ZAC", plan_hauteurs: "Plan des hauteurs",
  carte: "Carte communale", autre: "Autre",
};

const VALIDATION_BADGE: Record<string, { label: string; variant: "success" | "default" | "danger" }> = {
  valide: { label: "Validé", variant: "success" },
  brouillon: { label: "Brouillon", variant: "default" },
  rejete: { label: "Rejeté", variant: "danger" },
};

type DocGroup = { title: string; icon: LucideIcon; types: string[] };

// Le dernier groupe ("Autres") capte aussi les types non listés ailleurs.
const reglementaireGroups: DocGroup[] = [
  { title: "Pièces constitutives du PLU", icon: Layers, types: ["plu", "plui", "plum", "oap"] },
  { title: "Annexes & servitudes d'utilité publique (SUP)", icon: ShieldAlert, types: ["ppri", "pprt", "peb", "zac"] },
  { title: "Autres documents d'urbanisme", icon: Building2, types: ["plh", "plan_hauteurs", "carte", "autre"] },
];
const knownTypes = new Set(reglementaireGroups.flatMap((g) => g.types));

function formatSize(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

export function ParametresDocuments() {
  const loc = useLocation();
  const { user } = useAuth();
  const commune = user?.commune ?? "";

  const [docs, setDocs] = useState<RegulatoryDocument[]>([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    if (!commune) { setDocs([]); setLoading(false); return; }
    setLoading(true);
    api.get<RegulatoryDocument[]>(`/mairie/documents?commune=${encodeURIComponent(commune)}`)
      .then(setDocs)
      .catch(() => setDocs([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [commune]);

  const handleDelete = async (doc: RegulatoryDocument) => {
    if (!window.confirm(`Supprimer le document « ${doc.name} » ?`)) return;
    try {
      await api.delete(`/mairie/documents/${doc.id}`);
      setDocs((prev) => prev.filter((d) => d.id !== doc.id));
    } catch (err) {
      console.error(err);
      alert(err instanceof Error ? err.message : "Suppression impossible.");
    }
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[#000020]">Paramètres — Documents</h1>
        <p className="text-gray-500 text-sm mt-1">Gestion des types de documents</p>
      </div>
      <div className="flex gap-6">
        <nav className="w-56 shrink-0 space-y-1">
          {subNav.map((item) => (
            <Link key={item.to} to={item.to} className={cn("block px-4 py-2.5 rounded-lg text-sm font-medium transition-colors", loc.pathname === item.to ? "bg-heureka-500 text-white" : "text-gray-600 hover:bg-gray-100")}>{item.label}</Link>
          ))}
        </nav>
        <div className="flex-1 space-y-8">
          {/* Types de demandes d'autorisation d'urbanisme (enum figé, pas d'API) */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-[#000020]">Types de demandes d'autorisation</h2>
              <Button size="sm" className="gap-2"><Plus className="w-4 h-4" /> Ajouter un type</Button>
            </div>
            <Card className="border-gray-200/80">
              <CardContent className="p-0 divide-y divide-gray-100">
                {demandeTypes.map((doc, i) => (
                  <div key={doc} className="flex items-center justify-between px-6 py-4">
                    <div className="flex items-center gap-3">
                      <FileText className="w-5 h-5 text-gray-400" />
                      <div>
                        <p className="text-sm font-medium text-[#000020]">{doc}</p>
                        <p className="text-xs text-gray-400">{3 + i} pièces requises</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button variant="ghost" size="sm" disabled title="Type figé par la réglementation — non téléchargeable"><Download className="w-4 h-4" /></Button>
                      <Button variant="ghost" size="sm" className="text-red-500" disabled title="Type figé par la réglementation — non supprimable"><Trash2 className="w-4 h-4" /></Button>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </section>

          {/* Documents d'urbanisme de référence réellement déposés pour la commune */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-[#000020]">Documents d'urbanisme de référence</h2>
                <p className="text-xs text-gray-400 mt-0.5">Pièces du PLU et documents annexés, consultés pendant l'instruction</p>
              </div>
              <Button size="sm" variant="outline" className="gap-2"><Plus className="w-4 h-4" /> Ajouter un document</Button>
            </div>
            {loading ? (
              <Card className="border-gray-200/80"><CardContent className="px-6 py-10 text-center text-gray-400 text-sm">Chargement…</CardContent></Card>
            ) : !commune ? (
              <Card className="border-gray-200/80"><CardContent className="px-6 py-10 text-center text-gray-400 text-sm">Compte non rattaché à une commune.</CardContent></Card>
            ) : docs.length === 0 ? (
              <Card className="border-gray-200/80"><CardContent className="px-6 py-10 text-center text-gray-400 text-sm">Aucun document de référence pour {commune}.</CardContent></Card>
            ) : (
              reglementaireGroups.map((group, gi) => {
                const isOther = gi === reglementaireGroups.length - 1;
                const groupItems = docs.filter((d) =>
                  isOther ? (group.types.includes(d.type) || !knownTypes.has(d.type)) : group.types.includes(d.type)
                );
                if (groupItems.length === 0) return null;
                const Icon = group.icon;
                return (
                  <Card key={group.title} className="border-gray-200/80">
                    <CardHeader className="flex items-center gap-2.5">
                      <Icon className="w-4 h-4 text-heureka-500 shrink-0" />
                      <span className="text-sm font-semibold text-[#000020]">{group.title}</span>
                    </CardHeader>
                    <CardContent className="p-0 divide-y divide-gray-100">
                      {groupItems.map((doc) => {
                        const badge = VALIDATION_BADGE[doc.validation_status];
                        const size = formatSize(doc.file_size);
                        return (
                          <div key={doc.id} className="flex items-center justify-between px-6 py-4">
                            <div className="flex items-center gap-3">
                              <FileText className="w-5 h-5 text-gray-400 shrink-0" />
                              <div>
                                <p className="text-sm font-medium text-[#000020]">{doc.name}</p>
                                <p className="text-xs text-gray-400">{TYPE_LABELS[doc.type] ?? doc.type}{size ? ` · ${size}` : ""}</p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              {badge && <Badge variant={badge.variant}>{badge.label}</Badge>}
                              <a href={`/api/mairie/documents/${doc.id}/pdf`} download={doc.original_filename} target="_blank" rel="noopener noreferrer">
                                <Button variant="ghost" size="sm" title="Télécharger"><Download className="w-4 h-4" /></Button>
                              </a>
                              <Button variant="ghost" size="sm" className="text-red-500" onClick={() => void handleDelete(doc)} title="Supprimer"><Trash2 className="w-4 h-4" /></Button>
                            </div>
                          </div>
                        );
                      })}
                    </CardContent>
                  </Card>
                );
              })
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
