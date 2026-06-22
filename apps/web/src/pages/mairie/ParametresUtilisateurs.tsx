import { useState, useEffect } from "react";
import { Card, CardContent } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Link, useLocation } from "react-router-dom";
import { cn } from "../../lib/utils";
import { api } from "../../lib/api";
import { useAuth } from "../../hooks/useAuth";
import { Avatar } from "../../components/ui/avatar";
import { Badge } from "../../components/ui/badge";
import { Search, Plus, Shield, Check, X } from "lucide-react";

const subNav = [
  { to: "/mairie/parametres", label: "Général" },
  { to: "/mairie/parametres/documents", label: "Documents" },
  { to: "/mairie/parametres/utilisateurs", label: "Utilisateurs" },
  { to: "/mairie/parametres/workflow", label: "Workflow" },
  { to: "/mairie/parametres/notifications", label: "Notifications" },
  { to: "/mairie/parametres/integrations", label: "Intégrations" },
];

interface StaffUser {
  id: string;
  email: string;
  prenom: string;
  nom: string;
  role: string;
  commune: string | null;
  telephone: string | null;
  role_config_id: string | null;
}

interface RoleConfig {
  id: string;
  label: string;
  base_role: string;
  color: string;
}

const ROLE_LABELS: Record<string, string> = { admin: "Admin", mairie: "Mairie", instructeur: "Instructeur" };
const ROLE_COLORS: Record<string, string> = { admin: "#DC2626", mairie: "#4F46E5", instructeur: "#0891B2" };
const SYSTEM_ROLES = ["instructeur", "mairie", "admin"];

export function ParametresUtilisateurs() {
  const loc = useLocation();
  const { user } = useAuth();
  const commune = user?.commune ?? "";

  const [users, setUsers] = useState<StaffUser[]>([]);
  const [roleConfigs, setRoleConfigs] = useState<RoleConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  const load = () => {
    if (!commune) { setUsers([]); setLoading(false); return; }
    setLoading(true);
    api.get<StaffUser[]>(`/mairie/admin/users?commune=${encodeURIComponent(commune)}`)
      .then(setUsers)
      .catch(() => setUsers([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [commune]);
  useEffect(() => {
    api.get<RoleConfig[]>("/admin/roles").then(setRoleConfigs).catch(() => {});
  }, []);

  const roleLabel = (u: StaffUser) => {
    if (u.role_config_id) {
      const c = roleConfigs.find((rc) => rc.id === u.role_config_id);
      if (c) return c.label;
    }
    return ROLE_LABELS[u.role] ?? u.role;
  };
  const roleColor = (u: StaffUser) => {
    if (u.role_config_id) {
      const c = roleConfigs.find((rc) => rc.id === u.role_config_id);
      if (c) return c.color;
    }
    return ROLE_COLORS[u.role] ?? "#64748b";
  };

  const openEditor = (u: StaffUser) => {
    setEditingId(u.id);
    setEditValue(u.role_config_id ? `config:${u.role_config_id}` : `role:${u.role}`);
  };

  const saveRole = async (id: string) => {
    let role = "instructeur";
    let role_config_id: string | null = null;
    if (editValue.startsWith("config:")) {
      role_config_id = editValue.slice("config:".length);
      const c = roleConfigs.find((rc) => rc.id === role_config_id);
      role = c?.base_role ?? "instructeur";
    } else if (editValue.startsWith("role:")) {
      role = editValue.slice("role:".length);
    }
    try {
      await api.patch(`/mairie/admin/users/${id}`, { role, role_config_id });
      setEditingId(null);
      load();
    } catch (err) {
      console.error(err);
      alert(err instanceof Error ? err.message : "Mise à jour du rôle impossible.");
    }
  };

  const filtered = users.filter((u) =>
    !search || `${u.prenom} ${u.nom} ${u.email}`.toLowerCase().includes(search.toLowerCase())
  );

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
              <Input placeholder="Rechercher..." className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <Button size="sm" className="gap-2"><Plus className="w-4 h-4" /> Ajouter</Button>
          </div>
          <Card className="border-gray-200/80">
            <CardContent className="p-0 divide-y divide-gray-100">
              {loading ? (
                <div className="px-6 py-10 text-center text-gray-400 text-sm">Chargement…</div>
              ) : !commune ? (
                <div className="px-6 py-10 text-center text-gray-400 text-sm">Compte non rattaché à une commune.</div>
              ) : filtered.length === 0 ? (
                <div className="px-6 py-10 text-center text-gray-400 text-sm">Aucun utilisateur</div>
              ) : (
                filtered.map((u) => (
                  <div key={u.id} className="flex items-center justify-between px-6 py-4">
                    <div className="flex items-center gap-3">
                      <Avatar fallback={`${u.prenom} ${u.nom}`} />
                      <div>
                        <p className="text-sm font-medium text-[#000020]">{u.prenom} {u.nom}</p>
                        <p className="text-xs text-gray-400">{u.email}</p>
                      </div>
                    </div>
                    {editingId === u.id ? (
                      <div className="flex items-center gap-2">
                        <select
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          className="h-8 rounded-lg border border-gray-300 bg-white px-2 text-sm focus:outline-none focus:ring-2 focus:ring-heureka-500"
                        >
                          {SYSTEM_ROLES.map((r) => (
                            <option key={r} value={`role:${r}`}>{ROLE_LABELS[r]}</option>
                          ))}
                          {roleConfigs.map((rc) => (
                            <option key={rc.id} value={`config:${rc.id}`}>{rc.label}</option>
                          ))}
                        </select>
                        <Button variant="ghost" size="sm" className="text-green-600" onClick={() => void saveRole(u.id)} title="Enregistrer"><Check className="w-4 h-4" /></Button>
                        <Button variant="ghost" size="sm" className="text-gray-400" onClick={() => setEditingId(null)} title="Annuler"><X className="w-4 h-4" /></Button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-3">
                        {u.commune && <Badge variant="info">{u.commune}</Badge>}
                        <span className="text-xs font-medium" style={{ color: roleColor(u) }}>{roleLabel(u)}</span>
                        <Button variant="ghost" size="sm" onClick={() => openEditor(u)} title="Modifier le rôle"><Shield className="w-4 h-4" /></Button>
                      </div>
                    )}
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
