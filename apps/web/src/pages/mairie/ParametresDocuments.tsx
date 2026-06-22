import { Card, CardContent, CardHeader } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Link, useLocation } from "react-router-dom";
import { cn } from "../../lib/utils";
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

// Types de demandes d'autorisation d'urbanisme (avec nombre de pièces requises).
const demandeTypes = [
  "Permis de construire",
  "Déclaration préalable",
  "Permis d'aménager",
  "Permis de démolir",
  "Certificat d'urbanisme",
];

// Documents d'urbanisme de référence d'une commune, regroupés par nature.
// Aligné sur le référentiel back-end REGULATORY_DOCUMENT_TYPES
// (plu, plui, plum, ppri, pprt, oap, peb, plh, zac…). Le PLU est composé des
// pièces de l'art. L151-2 C. urb. ; PPRI/PPRT/PEB sont des documents autonomes
// (servitudes d'utilité publique) annexés au PLU, et non des pièces du PLU.
type DocEntry = { name: string; desc: string };
type DocGroup = { title: string; icon: LucideIcon; items: DocEntry[] };

const reglementaireGroups: DocGroup[] = [
  {
    title: "Pièces constitutives du PLU",
    icon: Layers,
    items: [
      { name: "Rapport de présentation", desc: "Diagnostic, état initial de l'environnement, justification des choix" },
      { name: "PADD — Projet d'Aménagement et de Développement Durables", desc: "Orientations générales du projet communal (art. L151-5)" },
      { name: "OAP — Orientations d'Aménagement et de Programmation", desc: "Sectorielles, thématiques, patrimoniales (art. L151-6)" },
      { name: "Règlement écrit", desc: "Règles écrites par zone U / AU / A / N (art. L151-8)" },
      { name: "Plan de zonage (documents graphiques)", desc: "Délimitation graphique des zones" },
      { name: "Annexes (dossier)", desc: "Pièces annexées au PLU (art. R151-51 à R151-53)" },
    ],
  },
  {
    title: "Annexes & servitudes d'utilité publique (SUP)",
    icon: ShieldAlert,
    items: [
      { name: "PPRI / PPRN", desc: "Plan de prévention des risques inondation / naturels — annexé comme SUP" },
      { name: "PPRT", desc: "Plan de prévention des risques technologiques — annexé comme SUP" },
      { name: "PEB", desc: "Plan d'exposition au bruit des aérodromes — annexé comme SUP" },
      { name: "Plans des réseaux", desc: "Eau potable, assainissement, eaux pluviales" },
      { name: "Droit de préemption urbain (DPU)", desc: "Périmètre de préemption" },
      { name: "ZAC — Zone d'aménagement concerté", desc: "Périmètres et règlement de ZAC" },
      { name: "Classement sonore des infrastructures", desc: "Voies bruyantes (arrêté préfectoral)" },
    ],
  },
  {
    title: "Autres documents d'urbanisme",
    icon: Building2,
    items: [
      { name: "PLUi / PLUm", desc: "PLU intercommunal / métropolitain (porté par un EPCI)" },
      { name: "SCoT — Schéma de cohérence territoriale", desc: "Norme supérieure de référence" },
      { name: "PLH — Programme local de l'habitat", desc: "Politique locale de l'habitat" },
      { name: "Carte communale", desc: "Document d'urbanisme simplifié (communes sans PLU)" },
    ],
  },
];

function DocRow({ name, desc }: DocEntry) {
  return (
    <div className="flex items-center justify-between px-6 py-4">
      <div className="flex items-center gap-3">
        <FileText className="w-5 h-5 text-gray-400 shrink-0" />
        <div>
          <p className="text-sm font-medium text-[#000020]">{name}</p>
          <p className="text-xs text-gray-400">{desc}</p>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Button variant="ghost" size="sm"><Download className="w-4 h-4" /></Button>
        <Button variant="ghost" size="sm" className="text-red-500"><Trash2 className="w-4 h-4" /></Button>
      </div>
    </div>
  );
}

export function ParametresDocuments() {
  const loc = useLocation();
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
          {/* Types de demandes d'autorisation d'urbanisme */}
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
                      <Button variant="ghost" size="sm"><Download className="w-4 h-4" /></Button>
                      <Button variant="ghost" size="sm" className="text-red-500"><Trash2 className="w-4 h-4" /></Button>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </section>

          {/* Documents d'urbanisme de référence (PLU, annexes/SUP, etc.) */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-[#000020]">Documents d'urbanisme de référence</h2>
                <p className="text-xs text-gray-400 mt-0.5">Pièces du PLU et documents annexés, consultés pendant l'instruction</p>
              </div>
              <Button size="sm" variant="outline" className="gap-2"><Plus className="w-4 h-4" /> Ajouter un document</Button>
            </div>
            {reglementaireGroups.map((group) => {
              const Icon = group.icon;
              return (
                <Card key={group.title} className="border-gray-200/80">
                  <CardHeader className="flex items-center gap-2.5">
                    <Icon className="w-4 h-4 text-heureka-500 shrink-0" />
                    <span className="text-sm font-semibold text-[#000020]">{group.title}</span>
                  </CardHeader>
                  <CardContent className="p-0 divide-y divide-gray-100">
                    {group.items.map((it) => (
                      <DocRow key={it.name} name={it.name} desc={it.desc} />
                    ))}
                  </CardContent>
                </Card>
              );
            })}
          </section>
        </div>
      </div>
    </div>
  );
}
