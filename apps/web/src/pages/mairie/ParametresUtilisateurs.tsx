import { Card, CardContent, CardHeader } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Link, useLocation } from "react-router-dom";
import { cn } from "../../lib/utils";
import { Avatar } from "../../components/ui/avatar";
import { Badge } from "../../components/ui/badge";
import { Search, Plus, Shield } from "lucide-react";

const subNav = [
  { to: "/mairie/parametres", label: "Général" },
  { to: "/mairie/parametres/documents", label: "Documents" },
  { to: "/mairie/parametres/utilisateurs", label: "Utilisateurs" },
  { to: "/mairie/parametres/workflow", label: "Workflow" },
  { to: "/mairie/parametres/notifications", label: "Notifications" },
  { to: "/mairie/parametres/integrations", label: "Intégrations" },
];

const users = [
  { name: "Marie Martin", email: "marie@ville-tours.fr", role: "Instructeur", commune: "Tours" },
  { name: "Pierre Dubois", email: "pierre@ville-tours.fr", role: "Mairie", commune: "Tours" },
  { name: "Sophie Leroy", email: "sophie@rochecorbon.fr", role: "Instructeur", commune: "Rochecorbon" },
];

export function ParametresUtilisateurs() {
  const loc = useLocation();
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[#000020]">Paramètres — Utilisateurs</h1>
        <p className="text-gray-500 text-sm mt-1">Gérer les utilisateurs et leurs permissions</p>
      </div>
      <div className="flex gap-6">
        <nav className="w-56 shrink-0 space-y-1">
          {subNav.map((item) => (
            <Link key={item.to} to={item.to} className={cn("block px-4 py-2.5 rounded-lg text-sm font-medium transition-colors", loc.pathname === item.to ? "bg-heureka-500 text-white" : "text-gray-600 hover:bg-gray-100")}>{item.label}</Link>
          ))}
        </nav>
        <div className="flex-1 space-y-6">
          <div className="flex items-center justify-between">
            <div className="relative w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input placeholder="Rechercher..." className="pl-9" />
            </div>
            <Button size="sm" className="gap-2"><Plus className="w-4 h-4" /> Ajouter</Button>
          </div>
          <Card className="border-gray-200/80">
            <CardContent className="p-0 divide-y divide-gray-100">
              {users.map((u) => (
                <div key={u.email} className="flex items-center justify-between px-6 py-4">
                  <div className="flex items-center gap-3">
                    <Avatar fallback={u.name} />
                    <div>
                      <p className="text-sm font-medium text-[#000020]">{u.name}</p>
                      <p className="text-xs text-gray-400">{u.email}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge variant="info">{u.commune}</Badge>
                    <span className="text-xs text-gray-500 capitalize">{u.role}</span>
                    <Button variant="ghost" size="sm"><Shield className="w-4 h-4" /></Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
