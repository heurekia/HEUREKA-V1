import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { api } from "../../lib/api";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Card, CardContent } from "../../components/ui/card";
import { Badge, statusLabels } from "../../components/ui/badge";
import { Table, THead, TBody, Th, Td, Tr } from "../../components/ui/table";

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
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Dossiers</h1>
        <div className="flex items-center gap-3">
          <div className="flex gap-2">
            <Input
              placeholder="Rechercher..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              className="w-64"
            />
            <Button variant="secondary" onClick={handleSearch}>Rechercher</Button>
          </div>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-8 text-center text-gray-500">Chargement...</div>
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
                    <Td><span className="font-medium text-gray-900">{d.numero}</span></Td>
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
