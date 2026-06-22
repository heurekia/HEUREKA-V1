import { useState, useEffect } from "react";
import { Card, CardContent } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Link, useLocation } from "react-router-dom";
import { cn } from "../../lib/utils";
import { api } from "../../lib/api";
import { FileText, Plus, Download, Trash2 } from "lucide-react";

const subNav = [
  { to: "/mairie/infos-perso", label: "Infos personnelles" },
  { to: "/mairie/infos-perso/a-propos", label: "À propos" },
  { to: "/mairie/infos-perso/communes", label: "Communes & Rôles" },
  { to: "/mairie/infos-perso/delegations", label: "Délégations" },
  { to: "/mairie/infos-perso/disponibilites", label: "Disponibilités" },
  { to: "/mairie/infos-perso/modeles", label: "Mes modèles" },
  { to: "/mairie/infos-perso/signatures", label: "Mes signatures" },
  { to: "/mairie/infos-perso/notifications", label: "Notifications" },
  { to: "/mairie/infos-perso/preferences", label: "Préférences" },
  { to: "/mairie/infos-perso/securite", label: "Sécurité & Connexion" },
  { to: "/mairie/infos-perso/centre-aide", label: "Centre d'aide" },
];

interface Template {
  id: string;
  name: string;
  category: string;
  body: string;
  updated_at: string;
}

export function InfosPersoModeles() {
  const loc = useLocation();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    api.get<Template[]>("/mairie/templates")
      .then(setTemplates)
      .catch(() => setTemplates([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  // Les modèles sont stockés en texte (pas de fichier côté serveur) : le
  // téléchargement exporte le corps du modèle en .html généré côté client.
  const handleDownload = (tpl: Template) => {
    const blob = new Blob([tpl.body ?? ""], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${tpl.name || "modele"}.html`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const handleDelete = async (tpl: Template) => {
    if (!window.confirm(`Supprimer le modèle « ${tpl.name} » ?`)) return;
    try {
      await api.delete(`/mairie/templates/${tpl.id}`);
      setTemplates((prev) => prev.filter((t) => t.id !== tpl.id));
    } catch (err) {
      console.error(err);
      alert(err instanceof Error ? err.message : "Suppression impossible.");
    }
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[#000020]">Mes modèles</h1>
        <p className="text-gray-500 text-sm mt-1">Gérer vos modèles de documents</p>
      </div>
      <div className="flex gap-6">
        <nav className="w-56 shrink-0 space-y-1">
          {subNav.map((item) => (
            <Link key={item.to} to={item.to} className={cn("block px-4 py-2.5 rounded-lg text-sm font-medium transition-colors", loc.pathname === item.to ? "bg-heureka-500 text-white" : "text-gray-600 hover:bg-gray-100")}>{item.label}</Link>
          ))}
        </nav>
        <div className="flex-1 space-y-4">
          <div className="flex justify-end">
            <Button size="sm" className="gap-2"><Plus className="w-4 h-4" /> Nouveau modèle</Button>
          </div>
          <Card className="border-gray-200/80">
            <CardContent className="p-0 divide-y divide-gray-100">
              {loading ? (
                <div className="px-6 py-10 text-center text-gray-400 text-sm">Chargement…</div>
              ) : templates.length === 0 ? (
                <div className="px-6 py-10 text-center text-gray-400 text-sm">Aucun modèle de document</div>
              ) : (
                templates.map((tpl) => (
                  <div key={tpl.id} className="flex items-center justify-between px-6 py-4">
                    <div className="flex items-center gap-3">
                      <FileText className="w-5 h-5 text-gray-400" />
                      <span className="text-sm font-medium text-[#000020]">{tpl.name}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button variant="ghost" size="sm" onClick={() => handleDownload(tpl)} title="Télécharger"><Download className="w-4 h-4" /></Button>
                      <Button variant="ghost" size="sm" className="text-red-500" onClick={() => void handleDelete(tpl)} title="Supprimer"><Trash2 className="w-4 h-4" /></Button>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
