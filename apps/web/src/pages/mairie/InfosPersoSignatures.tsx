import { useState, useEffect } from "react";
import { Card, CardContent } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Badge } from "../../components/ui/badge";
import { Link, useLocation } from "react-router-dom";
import { cn } from "../../lib/utils";
import { api } from "../../lib/api";
import { PenSquare, Plus, Download } from "lucide-react";

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

// Les signatures/tampons de la commune sont stockés sur l'en-tête (letterhead)
// sous forme d'URL d'image (signature_image / tampon_image).
interface Letterhead {
  commune_configured?: boolean;
  signature_image?: string | null;
  tampon_image?: string | null;
}

interface SignatureItem {
  key: string;
  name: string;
  type: string;
  url: string;
}

export function InfosPersoSignatures() {
  const loc = useLocation();
  const [items, setItems] = useState<SignatureItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.get<Letterhead>("/mairie/commune-letterhead")
      .then((lh) => {
        const next: SignatureItem[] = [];
        if (lh.signature_image) next.push({ key: "signature", name: "Signature", type: "Image de signature", url: lh.signature_image });
        if (lh.tampon_image) next.push({ key: "tampon", name: "Tampon / Cachet", type: "Image de tampon", url: lh.tampon_image });
        setItems(next);
      })
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[#000020]">Mes signatures</h1>
        <p className="text-gray-500 text-sm mt-1">Gérer vos signatures électroniques</p>
      </div>
      <div className="flex gap-6">
        <nav className="w-56 shrink-0 space-y-1">
          {subNav.map((item) => (
            <Link key={item.to} to={item.to} className={cn("block px-4 py-2.5 rounded-lg text-sm font-medium transition-colors", loc.pathname === item.to ? "bg-heureka-500 text-white" : "text-gray-600 hover:bg-gray-100")}>{item.label}</Link>
          ))}
        </nav>
        <div className="flex-1 space-y-4">
          <div className="flex justify-end">
            <Button size="sm" className="gap-2"><Plus className="w-4 h-4" /> Ajouter une signature</Button>
          </div>
          <Card className="border-gray-200/80">
            <CardContent className="p-0 divide-y divide-gray-100">
              {loading ? (
                <div className="px-6 py-10 text-center text-gray-400 text-sm">Chargement…</div>
              ) : items.length === 0 ? (
                <div className="px-6 py-10 text-center text-gray-400 text-sm">Aucune signature enregistrée</div>
              ) : (
                items.map((s) => (
                  <div key={s.key} className="flex items-center justify-between px-6 py-4">
                    <div className="flex items-center gap-3">
                      <PenSquare className="w-5 h-5 text-gray-400" />
                      <div>
                        <p className="text-sm font-medium text-[#000020]">{s.name}</p>
                        <p className="text-xs text-gray-400">{s.type}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="success">Active</Badge>
                      <a href={s.url} download={s.name} target="_blank" rel="noopener noreferrer">
                        <Button variant="ghost" size="sm" title="Télécharger"><Download className="w-4 h-4" /></Button>
                      </a>
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
