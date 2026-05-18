import { Card, CardContent, CardHeader } from "../../components/ui/card";
import { Link, useLocation } from "react-router-dom";
import { cn } from "../../lib/utils";

const subNav = [
  { to: "/mairie/parametres", label: "Général" },
  { to: "/mairie/parametres/documents", label: "Documents" },
  { to: "/mairie/parametres/utilisateurs", label: "Utilisateurs" },
  { to: "/mairie/parametres/workflow", label: "Workflow" },
  { to: "/mairie/parametres/notifications", label: "Notifications" },
  { to: "/mairie/parametres/notifications-evenements", label: "Par événement" },
  { to: "/mairie/parametres/integrations", label: "Intégrations" },
];

const events = [
  { name: "Dépôt d'un dossier", email: true, sms: false, push: true },
  { name: "Changement de statut", email: true, sms: true, push: true },
  { name: "Demande de pièces", email: true, sms: true, push: true },
  { name: "Décision rendue", email: true, sms: false, push: true },
  { name: "Avis d'un service", email: false, sms: false, push: true },
];

function Toggle({ checked }: { checked: boolean }) {
  return (
    <label className="relative inline-flex items-center cursor-pointer">
      <input type="checkbox" className="sr-only peer" defaultChecked={checked} />
      <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:bg-heureka-500 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all" />
    </label>
  );
}

export function ParametresNotificationsEvenements() {
  const loc = useLocation();
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[#000020]">Paramètres — Notifications par événement</h1>
        <p className="text-gray-500 text-sm mt-1">Associez des canaux aux événements</p>
      </div>
      <div className="flex gap-6">
        <nav className="w-56 shrink-0 space-y-1">
          {subNav.map((item) => (
            <Link key={item.to} to={item.to} className={cn("block px-4 py-2.5 rounded-lg text-sm font-medium transition-colors", loc.pathname === item.to ? "bg-heureka-500 text-white" : "text-gray-600 hover:bg-gray-100")}>{item.label}</Link>
          ))}
        </nav>
        <div className="flex-1 space-y-6">
          <Card className="border-gray-200/80">
            <CardHeader><h3 className="font-semibold text-[#000020]">Notifications par événement</h3></CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100">
                      <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">Événement</th>
                      <th className="text-center px-4 py-3 text-xs font-medium text-gray-500 uppercase">Email</th>
                      <th className="text-center px-4 py-3 text-xs font-medium text-gray-500 uppercase">SMS</th>
                      <th className="text-center px-4 py-3 text-xs font-medium text-gray-500 uppercase">Push</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {events.map((e) => (
                      <tr key={e.name} className="hover:bg-gray-50">
                        <td className="px-6 py-3 text-sm text-[#000020]">{e.name}</td>
                        <td className="px-4 py-3 text-center"><Toggle checked={e.email} /></td>
                        <td className="px-4 py-3 text-center"><Toggle checked={e.sms} /></td>
                        <td className="px-4 py-3 text-center"><Toggle checked={e.push} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
