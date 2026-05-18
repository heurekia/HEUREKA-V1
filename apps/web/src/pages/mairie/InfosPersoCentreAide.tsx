import { useState } from "react";
import { Card, CardContent, CardHeader } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Link, useLocation } from "react-router-dom";
import { cn } from "../../lib/utils";
import { Search, ChevronDown, ChevronUp, Mail, Phone, MessageSquare } from "lucide-react";

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

const faqs = [
  { q: "Comment créer un nouveau dossier d'instruction ?", a: "Depuis le menu Dossiers, cliquez sur 'Nouveau' et suivez les étapes." },
  { q: "Comment consulter l'analyse parcellaire ?", a: "Ouvrez le dossier concerné et cliquez sur l'onglet 'Analyse'." },
  { q: "Comment ajouter un utilisateur à ma commune ?", a: "Rendez-vous dans Paramètres > Utilisateurs." },
];

export function InfosPersoCentreAide() {
  const loc = useLocation();
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[#000020]">Centre d'aide</h1>
        <p className="text-gray-500 text-sm mt-1">Assistance et documentation</p>
      </div>
      <div className="flex gap-6">
        <nav className="w-56 shrink-0 space-y-1">
          {subNav.map((item) => (
            <Link key={item.to} to={item.to} className={cn("block px-4 py-2.5 rounded-lg text-sm font-medium transition-colors", loc.pathname === item.to ? "bg-heureka-500 text-white" : "text-gray-600 hover:bg-gray-100")}>{item.label}</Link>
          ))}
        </nav>
        <div className="flex-1 space-y-6">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input placeholder="Rechercher..." className="pl-9" />
          </div>
          <div className="space-y-2">
            {faqs.map((faq, i) => (
              <Card key={i} className="border-gray-200/80 cursor-pointer" onClick={() => setOpenFaq(openFaq === i ? null : i)}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-[#000020]">{faq.q}</span>
                    {openFaq === i ? <ChevronUp className="w-4 h-4 text-heureka-500" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
                  </div>
                  {openFaq === i && <p className="text-sm text-gray-600 mt-3">{faq.a}</p>}
                </CardContent>
              </Card>
            ))}
          </div>
          <Card className="border-heureka-200 bg-heureka-50/50">
            <CardContent className="p-5 flex flex-wrap gap-3 items-center justify-between">
              <p className="text-sm font-medium text-[#000020]">Vous n'avez pas trouvé votre réponse ?</p>
              <div className="flex gap-2">
                <Button size="sm" className="gap-1"><Mail className="w-3.5 h-3.5" /> Email</Button>
                <Button size="sm" variant="outline" className="gap-1"><Phone className="w-3.5 h-3.5" /> Téléphone</Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
