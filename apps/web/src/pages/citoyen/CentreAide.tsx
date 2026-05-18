import { useState } from "react";
import { Card, CardContent } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Search, ChevronDown, ChevronUp, Mail, Phone, MessageSquare } from "lucide-react";

const faqs = [
  { q: "Comment déposer un permis de construire ?", a: "Connectez-vous à votre compte, cliquez sur 'Nouvelle demande' et suivez le guide pas à pas. Vous devrez fournir les pièces requises selon votre projet." },
  { q: "Quels documents sont nécessaires ?", a: "Cela dépend du type de demande. Le formulaire vous indiquera les pièces requises. En général : un plan de situation, un plan de masse, des photos du terrain, et une notice descriptive." },
  { q: "Quel est le délai d'instruction ?", a: "Le délai varie selon le type de demande : 1 mois pour une déclaration préalable, 2 à 3 mois pour un permis de construire." },
  { q: "Comment suivre l'avancement de ma demande ?", a: "Rendez-vous dans 'Mes demandes' depuis votre tableau de bord. Chaque étape est affichée avec son statut." },
  { q: "Puis-je modifier une demande déjà soumise ?", a: "Tant que l'instruction n'a pas commencé, vous pouvez modifier votre demande depuis l'espace 'Mes demandes'." },
  { q: "Comment contacter le service instructeur ?", a: "Utilisez la messagerie intégrée depuis votre espace citoyen. Vous recevrez une réponse sous 48h ouvrées." },
];

export function CentreAide() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [search, setSearch] = useState("");

  const filtered = faqs.filter(
    (faq) => !search || faq.q.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="max-w-4xl mx-auto px-6 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-[#000020]">Centre d'aide</h1>
        <p className="text-gray-500 text-sm mt-1">Questions fréquentes et assistance</p>
      </div>

      <div className="relative mb-8">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
        <Input
          placeholder="Rechercher une question..."
          className="pl-11 py-3 text-base"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="space-y-3 mb-10">
        {filtered.map((faq, i) => (
          <Card
            key={i}
            className={`border-gray-200/80 overflow-hidden transition-shadow cursor-pointer ${
              openIndex === i ? "shadow-md" : ""
            }`}
            onClick={() => setOpenIndex(openIndex === i ? null : i)}
          >
            <CardContent className="p-0">
              <div className="flex items-center justify-between px-5 py-4">
                <h3 className="text-sm font-semibold text-[#000020] pr-4">{faq.q}</h3>
                {openIndex === i ? (
                  <ChevronUp className="w-4 h-4 text-heureka-500 shrink-0" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />
                )}
              </div>
              {openIndex === i && (
                <div className="px-5 pb-4 pt-0">
                  <p className="text-sm text-gray-600 leading-relaxed">{faq.a}</p>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="border-heureka-200 bg-heureka-50/50">
        <CardContent className="p-6">
          <h2 className="text-lg font-semibold text-[#000020] mb-4">
            Vous n'avez pas trouvé réponse à votre question ?
          </h2>
          <div className="flex flex-wrap gap-3">
            <Button variant="default" className="gap-2">
              <Mail className="w-4 h-4" />
              Nous écrire
            </Button>
            <Button variant="outline" className="gap-2">
              <Phone className="w-4 h-4" />
              Nous appeler
            </Button>
            <Button variant="outline" className="gap-2">
              <MessageSquare className="w-4 h-4" />
              Chat en direct
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
