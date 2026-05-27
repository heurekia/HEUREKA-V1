import { Card, CardContent, CardHeader } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Link, useLocation } from "react-router-dom";
import { cn } from "../../lib/utils";
import { Mail, MessageSquare, Bell, Smartphone } from "lucide-react";
import { Badge } from "../../components/ui/badge";

const subNav = [
  { to: "/mairie/parametres", label: "Général" },
  { to: "/mairie/parametres/documents", label: "Documents" },
  { to: "/mairie/parametres/utilisateurs", label: "Utilisateurs" },
  { to: "/mairie/parametres/workflow", label: "Workflow" },
  { to: "/mairie/parametres/notifications", label: "Notifications" },
  { to: "/mairie/parametres/notifications-evenements", label: "Par événement" },
  { to: "/mairie/parametres/integrations", label: "Intégrations" },
];

const channels = [
  { name: "Email", icon: Mail, desc: "Notifications par courrier électronique", enabled: true },
  { name: "SMS", icon: Smartphone, desc: "Notifications par message texte", enabled: false },
  { name: "Messagerie interne", icon: MessageSquare, desc: "Notifications dans la messagerie HEUREKIA", enabled: true },
  { name: "Push", icon: Bell, desc: "Notifications push navigateur", enabled: true },
];

export function ParametresNotifications() {
  const loc = useLocation();
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[#000020]">Paramètres — Notifications</h1>
        <p className="text-gray-500 text-sm mt-1">Configurer les canaux de notification</p>
      </div>
      <div className="flex gap-6">
        <nav className="w-56 shrink-0 space-y-1">
          {subNav.map((item) => (
            <Link key={item.to} to={item.to} className={cn("block px-4 py-2.5 rounded-lg text-sm font-medium transition-colors", loc.pathname === item.to ? "bg-heureka-500 text-white" : "text-gray-600 hover:bg-gray-100")}>{item.label}</Link>
          ))}
        </nav>
        <div className="flex-1 space-y-6">
          <Card className="border-gray-200/80">
            <CardHeader><h3 className="font-semibold text-[#000020]">Canaux de notification</h3></CardHeader>
            <CardContent className="divide-y divide-gray-100">
              {channels.map((ch) => {
                const Icon = ch.icon;
                return (
                  <div key={ch.name} className="flex items-center justify-between py-4">
                    <div className="flex items-center gap-3">
                      <Icon className="w-5 h-5 text-gray-400" />
                      <div>
                        <p className="text-sm font-medium text-[#000020]">{ch.name}</p>
                        <p className="text-xs text-gray-400">{ch.desc}</p>
                      </div>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input type="checkbox" className="sr-only peer" defaultChecked={ch.enabled} />
                      <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:bg-heureka-500 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all" />
                    </label>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
