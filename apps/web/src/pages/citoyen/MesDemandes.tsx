import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { api } from "../../lib/api";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardHeader } from "../../components/ui/card";
import { Badge, statusLabels } from "../../components/ui/badge";
import { Table, THead, TBody, Th, Td, Tr } from "../../components/ui/table";

export function MesDemandes() {
  const [dossiers, setDossiers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<any[]>("/dossiers").then(setDossiers).catch(console.error).finally(() => setLoading(false));
  }, []);

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Mes demandes</h1>
          <p className="text-gray-500 text-sm">Suivez l'avancement de vos dossiers</p>
        </div>
        <Button>Nouvelle demande</Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-8 text-center text-gray-500">Chargement...</div>
          ) : dossiers.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              <p className="mb-4">Vous n'avez aucune demande pour le moment.</p>
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
                {dossiers.map((d) => (
                  <Tr key={d.id}>
                    <Td><span className="font-medium text-gray-900">{d.numero}</span></Td>
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
