import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { api } from "../../lib/api";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Card, CardContent } from "../../components/ui/card";
import { Badge, statusLabels } from "../../components/ui/badge";
import { Table, THead, TBody, Th, Td, Tr } from "../../components/ui/table";
import { Search, Filter, Plus, FileText } from "lucide-react";

export function MairieDossiers() {
  const [dossiers, setDossiers] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  const fetchDossiers = async (query?: string) => {
    setLoading(true);
    try {
      const url = query ? `/mairie/dossiers?search=${encodeURIComponent(query)}` : "/mairie/dossiers";
      const data = await api.get<any[]>(url);
      setDossiers(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchDossiers(); }, []);

  const handleSearch = () => fetchDossiers(search);

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#000020]">Dossiers</h1>
          <p className="text-gray-500 text-sm mt-1">Gestion des demandes d'urbanisme</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              placeholder="Rechercher..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              className="pl-9 w-64"
            />
          </div>
          <Button variant="outline" size="sm" className="gap-2">
            <Filter className="w-4 h-4" />
            Filtres
          </Button>
          <Button size="sm" className="gap-2">
            <Plus className="w-4 h-4" />
            Nouveau
          </Button>
        </div>
      </div>

      <Card className="border-gray-200/80">
        <CardContent className="p-0">
          {loading ? (
            <div className="p-12 text-center text-gray-400">Chargement...</div>
          ) : dossiers.length === 0 ? (
            <div className="p-12 text-center text-gray-400">
              <FileText className="w-12 h-12 mx-auto mb-3 text-gray-300" />
              <p>Aucun dossier trouvé</p>
            </div>
          ) : (
            <Table>
              <THead>
                <Tr>
                  <Th>N° Dossier</Th>
                  <Th>Type</Th>
                  <Th>Adresse</Th>
                  <Th>Parcelle</Th>
                  <Th>Date dépôt</Th>
                  <Th>Statut</Th>
                  <Th></Th>
                </Tr>
              </THead>
              <TBody>
                {dossiers.map((d) => (
                  <Tr key={d.id}>
                    <Td><span className="font-medium text-[#000020]">{d.numero}</span></Td>
                    <Td className="capitalize">{d.type.replace(/_/g, " ")}</Td>
                    <Td className="max-w-[200px] truncate">{d.adresse ?? "-"}</Td>
                    <Td>{d.parcelle ?? "-"}</Td>
                    <Td>{d.date_depot ? new Date(d.date_depot).toLocaleDateString("fr-FR") : "-"}</Td>
                    <Td>
                      <Badge variant={statusLabels[d.status]?.variant ?? "default"}>
                        {statusLabels[d.status]?.label ?? d.status}
                      </Badge>
                    </Td>
                    <Td>
                      <Link to={`/mairie/dossiers/${d.id}`}>
                        <Button variant="ghost" size="sm">Détail</Button>
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
