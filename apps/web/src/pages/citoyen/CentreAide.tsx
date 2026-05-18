import { Card, CardContent, CardHeader } from "../../components/ui/card";

const faqs = [
  { q: "Comment déposer un permis de construire ?", a: "Connectez-vous à votre compte, cliquez sur 'Nouvelle demande' et suivez le guide pas à pas." },
  { q: "Quels documents sont nécessaires ?", a: "Cela dépend du type de demande. Le formulaire vous indiquera les pièces requises." },
  { q: "Quel est le délai d'instruction ?", a: "Le délai varie selon le type de demande : 1 à 3 mois en général." },
  { q: "Comment suivre l'avancement de ma demande ?", a: "Rendez-vous dans 'Mes demandes' depuis votre tableau de bord." },
];

export function CentreAide() {
  return (
    <div className="max-w-7xl mx-auto px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Centre d'aide</h1>
        <p className="text-gray-500 text-sm">Questions fréquentes et assistance</p>
      </div>
      <div className="space-y-4">
        {faqs.map((faq, i) => (
          <Card key={i}>
            <CardHeader><h3 className="font-semibold text-gray-900">{faq.q}</h3></CardHeader>
            <CardContent><p className="text-gray-600 text-sm">{faq.a}</p></CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
