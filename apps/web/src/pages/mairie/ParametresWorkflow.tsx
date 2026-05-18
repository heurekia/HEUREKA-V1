import { Card, CardContent, CardHeader } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Link, useLocation } from "react-router-dom";
import { cn } from "../../lib/utils";
import { ArrowRight, Plus, GripVertical } from "lucide-react";

const subNav = [
  { to: "/mairie/parametres", label: "Général" },
  { to: "/mairie/parametres/documents", label: "Documents" },
  { to: "/mairie/parametres/utilisateurs", label: "Utilisateurs" },
  { to: "/mairie/parametres/workflow", label: "Workflow" },
  { to: "/mairie/parametres/notifications", label: "Notifications" },
  { to: "/mairie/parametres/integrations", label: "Intégrations" },
];

const steps = [
  { label: "Dépôt", desc: "Validation du dépôt par le citoyen" },
  { label: "Pré-instruction", desc: "Vérification des pièces et complétude" },
  { label: "Instruction", desc: "Analyse réglementaire et expertise" },
  { label: "Consultation", desc: "Avis des services (DDT, CAUE, ABF…)" },
  { label: "Décision", desc: "Prise de décision par le maire" },
];

export function ParametresWorkflow() {
  const loc = useLocation();
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[#000020]">Paramètres — Workflow</h1>
        <p className="text-gray-500 text-sm mt-1">Personnaliser le circuit d'instruction</p>
      </div>
      <div className="flex gap-6">
        <nav className="w-56 shrink-0 space-y-1">
          {subNav.map((item) => (
            <Link key={item.to} to={item.to} className={cn("block px-4 py-2.5 rounded-lg text-sm font-medium transition-colors", loc.pathname === item.to ? "bg-heureka-500 text-white" : "text-gray-600 hover:bg-gray-100")}>{item.label}</Link>
          ))}
        </nav>
        <div className="flex-1 space-y-6">
          <div className="flex justify-end">
            <Button size="sm" className="gap-2"><Plus className="w-4 h-4" /> Ajouter une étape</Button>
          </div>
          <Card className="border-gray-200/80">
            <CardContent className="p-0 divide-y divide-gray-100">
              {steps.map((step, i) => (
                <div key={step.label} className="flex items-center gap-4 px-6 py-4">
                  <GripVertical className="w-4 h-4 text-gray-300 cursor-move" />
                  <div className="w-8 h-8 rounded-full bg-heureka-100 flex items-center justify-center text-sm font-bold text-heureka-600">{i + 1}</div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-[#000020]">{step.label}</p>
                    <p className="text-xs text-gray-400">{step.desc}</p>
                  </div>
                  <ArrowRight className="w-4 h-4 text-gray-300" />
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
