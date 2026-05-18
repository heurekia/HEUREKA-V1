import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { api } from "../../lib/api";
import { Button } from "../../components/ui/button";
import { Card, CardContent } from "../../components/ui/card";
import { Badge, statusLabels } from "../../components/ui/badge";
import { Table, THead, TBody, Th, Td, Tr } from "../../components/ui/table";
import { Input } from "../../components/ui/input";
import { Search, Plus, Filter } from "lucide-react";

export function MesDemandes() {
  const [dossiers, setDossiers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    api.get<any[]>("/dossiers").then(setDossiers).catch(console.error).finally(() => setLoading(false));
  }, []);

  const filtered = dossiers.filter((d) =>
    !search || [d.numero, d.type, d.adresse].some((f) => String(f ?? "").toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="max-w-7xl mx-auto px-6 py-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#000020]">Mes demandes</h1>
          <p className="text-gray-500 text-sm">Suivez l'avancement de vos dossiers</p>
        </div>
        <Button className="gap-2">
          <Plus className="w-4 h-4" />
          Nouvelle demande
        </Button>
      </div>

      <div className="flex items-center gap-3 mb-6">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input
            placeholder="Rechercher un dossier..."
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Button variant="outline" size="sm" className="gap-2">
          <Filter className="w-4 h-4" />
          Filtres
        </Button>
      </div>

      <Card className="border-gray-200/80">
        <CardContent className="p-0">
          {loading ? (
            <div className="p-12 text-center text-gray-400">Chargement...</div>
          ) : filtered.length === 0 ? (
            <div className="p-12 text-center text-gray-400">
              <p className="mb-4">Aucune demande trouvée.</p>
              <Button>Déposer une demande</Button>
            </div>
          ) : (
            <Table>
              <THead>
                <Tr>
                  <Th>N° Dossier</Th>
                  <Th>Type</Th>
                  <Th>Adresse</Th>
                  <Th>Date</Th>
                  <Th>Statut</Th>
                  <Th></Th>
                </Tr>
              </THead>
              <TBody>
                {filtered.map((d) => (
                  <Tr key={d.id}>
                    <Td>
                      <span className="font-medium text-[#000020]">{d.numero}</span>
                    </Td>
                    <Td className="capitalize">{d.type.replace(/_/g, " ")}</Td>
                    <Td className="max-w-[200px] truncate">{d.adresse ?? "-"}</Td>
                    <Td>{new Date(d.created_at).toLocaleDateString("fr-FR")}</Td>
                    <Td>
                      <Badge variant={statusLabels[d.status]?.variant ?? "default"}>
                        {statusLabels[d.status]?.label ?? d.status}
                      </Badge>
                    </Td>
                    <Td>
                      <Link to={`/citoyen/mes-demandes/${d.id}`}>
                        <Button variant="ghost" size="sm">Voir</Button>
                      </Link>
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
