import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Badge } from "../../components/ui/badge";
import { Link, useLocation } from "react-router-dom";
import { cn } from "../../lib/utils";
import { Plus, X, ArrowUp, ArrowDown, Save } from "lucide-react";
import { api } from "../../lib/api";

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

type Instructeur = { id: string; prenom: string; nom: string; email: string };
type Delegation = {
  id: string;
  delegate_user_id: string;
  priority: number;
  prenom: string | null;
  nom: string | null;
  email: string | null;
};
type Absence = {
  id: string;
  start_date: string;
  end_date: string;
  reason: string;
};

function fullName(u: { prenom?: string | null; nom?: string | null; email?: string | null }) {
  const n = [u.prenom, u.nom].filter(Boolean).join(" ").trim();
  return n || u.email || "—";
}

export function InfosPersoDelegations() {
  const loc = useLocation();
  const [instructeurs, setInstructeurs] = useState<Instructeur[]>([]);
  const [delegates, setDelegates] = useState<string[]>([]);
  const [initialDelegates, setInitialDelegates] = useState<string[]>([]);
  const [absences, setAbsences] = useState<Absence[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    Promise.all([
      api.get<Instructeur[]>("/mairie/instructeurs").catch(() => []),
      api.get<Delegation[]>("/mairie/my-delegations").catch(() => []),
      api.get<{ absences: Absence[] }>("/mairie/my-availability").catch(() => ({ absences: [] as Absence[] })),
    ])
      .then(([list, delegs, avail]) => {
        setInstructeurs(list);
        const ordered = [...delegs].sort((a, b) => a.priority - b.priority).map((d) => d.delegate_user_id);
        setDelegates(ordered);
        setInitialDelegates(ordered);
        setAbsences(avail.absences ?? []);
      })
      .finally(() => setLoading(false));
  }, []);

  const dirty = useMemo(() => {
    if (delegates.length !== initialDelegates.length) return true;
    return delegates.some((id, i) => id !== initialDelegates[i]);
  }, [delegates, initialDelegates]);

  const usersById = useMemo(() => {
    const m = new Map<string, Instructeur>();
    instructeurs.forEach((u) => m.set(u.id, u));
    return m;
  }, [instructeurs]);

  const available = instructeurs.filter((u) => !delegates.includes(u.id));

  const todayIso = new Date().toISOString().slice(0, 10);
  const activeAbsence = absences.find((a) => a.start_date <= todayIso && a.end_date >= todayIso);
  const upcomingAbsence = absences
    .filter((a) => a.start_date > todayIso)
    .sort((a, b) => a.start_date.localeCompare(b.start_date))[0];

  const addDelegate = (id: string) => {
    if (!id || delegates.includes(id)) return;
    setDelegates((prev) => [...prev, id]);
    setMsg(null);
  };
  const removeDelegate = (id: string) => setDelegates((prev) => prev.filter((d) => d !== id));
  const move = (idx: number, dir: -1 | 1) => {
    setDelegates((prev) => {
      const next = [...prev];
      const j = idx + dir;
      if (j < 0 || j >= next.length) return prev;
      const a = next[idx]!;
      const b = next[j]!;
      next[idx] = b;
      next[j] = a;
      return next;
    });
  };

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      await api.put("/mairie/my-delegations", { delegates });
      setInitialDelegates(delegates);
      setMsg({ ok: true, text: "Délégation enregistrée." });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Erreur" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[#000020]">Délégations</h1>
        <p className="text-gray-500 text-sm mt-1">
          Désignez les instructeurs qui prendront le relais pendant vos absences.
        </p>
      </div>
      <div className="flex gap-6">
        <nav className="w-56 shrink-0 space-y-1">
          {subNav.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className={cn(
                "block px-4 py-2.5 rounded-lg text-sm font-medium transition-colors",
                loc.pathname === item.to ? "bg-heureka-500 text-white" : "text-gray-600 hover:bg-gray-100",
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="flex-1 space-y-4">
          {loading ? (
            <div className="text-sm text-gray-400 py-10 text-center">Chargement…</div>
          ) : (
            <>
              {(activeAbsence || upcomingAbsence) && (
                <div
                  className={cn(
                    "rounded-lg border px-4 py-3 text-sm",
                    activeAbsence
                      ? "bg-orange-50 border-orange-200 text-orange-800"
                      : "bg-blue-50 border-blue-200 text-blue-800",
                  )}
                >
                  {activeAbsence ? (
                    <>
                      Vous êtes en absence jusqu'au{" "}
                      <strong>{new Date(activeAbsence.end_date).toLocaleDateString("fr-FR")}</strong>.
                      Vos nouveaux dossiers et ceux dont l'échéance tombe d'ici là sont redirigés vers la
                      chaîne ci-dessous.
                    </>
                  ) : (
                    <>
                      Prochaine absence prévue du{" "}
                      <strong>{new Date(upcomingAbsence!.start_date).toLocaleDateString("fr-FR")}</strong> au{" "}
                      <strong>{new Date(upcomingAbsence!.end_date).toLocaleDateString("fr-FR")}</strong>.
                    </>
                  )}
                </div>
              )}

              <Card className="border-gray-200/80">
                <CardContent className="p-6 space-y-4">
                  <div>
                    <h2 className="text-sm font-semibold text-[#000020]">Chaîne de délégation</h2>
                    <p className="text-xs text-gray-500 mt-1">
                      Le 1er instructeur est sollicité en priorité. Si lui-même est absent, le système
                      passe au suivant, et ainsi de suite.
                    </p>
                  </div>

                  {delegates.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-gray-200 px-4 py-6 text-center text-sm text-gray-400">
                      Aucun délégué configuré. En cas d'absence, vos dossiers resteront sur votre nom.
                    </div>
                  ) : (
                    <ul className="space-y-2">
                      {delegates.map((id, idx) => {
                        const u = usersById.get(id);
                        return (
                          <li
                            key={id}
                            className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3"
                          >
                            <Badge variant="info" className="shrink-0">
                              Priorité {idx + 1}
                            </Badge>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-[#000020] truncate">
                                {u ? fullName(u) : "Utilisateur introuvable"}
                              </p>
                              {u?.email && <p className="text-xs text-gray-400 truncate">{u.email}</p>}
                            </div>
                            <button
                              onClick={() => move(idx, -1)}
                              disabled={idx === 0}
                              title="Monter"
                              className="p-1 rounded hover:bg-gray-100 disabled:opacity-30"
                            >
                              <ArrowUp className="w-4 h-4 text-gray-500" />
                            </button>
                            <button
                              onClick={() => move(idx, 1)}
                              disabled={idx === delegates.length - 1}
                              title="Descendre"
                              className="p-1 rounded hover:bg-gray-100 disabled:opacity-30"
                            >
                              <ArrowDown className="w-4 h-4 text-gray-500" />
                            </button>
                            <button
                              onClick={() => removeDelegate(id)}
                              title="Retirer"
                              className="p-1 rounded hover:bg-red-50"
                            >
                              <X className="w-4 h-4 text-red-500" />
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}

                  {available.length > 0 && (
                    <div className="flex items-center gap-2 pt-2">
                      <select
                        onChange={(e) => {
                          if (e.target.value) addDelegate(e.target.value);
                          e.currentTarget.selectedIndex = 0;
                        }}
                        className="flex-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-heureka-500"
                        defaultValue=""
                      >
                        <option value="" disabled>
                          Ajouter un délégué…
                        </option>
                        {available.map((u) => (
                          <option key={u.id} value={u.id}>
                            {fullName(u)} {u.email ? `(${u.email})` : ""}
                          </option>
                        ))}
                      </select>
                      <Button variant="outline" size="sm" className="gap-1.5" disabled>
                        <Plus className="w-4 h-4" /> Ajouter
                      </Button>
                    </div>
                  )}

                  {msg && (
                    <div
                      className={cn(
                        "rounded-lg border px-3 py-2 text-sm",
                        msg.ok
                          ? "bg-green-50 border-green-200 text-green-700"
                          : "bg-red-50 border-red-200 text-red-700",
                      )}
                    >
                      {msg.text}
                    </div>
                  )}

                  <div className="flex justify-end pt-2">
                    <Button onClick={save} disabled={!dirty || saving} className="gap-2">
                      <Save className="w-4 h-4" />
                      {saving ? "Enregistrement…" : "Enregistrer"}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
