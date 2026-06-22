import { useState, useEffect } from "react";
import { api } from "../../lib/api";
import { Card, CardContent } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Search, Upload, FileText, FolderOpen, Download, Trash2 } from "lucide-react";

interface Dossier {
  id: string;
  numero: string;
  type: string;
  status: string;
}

interface Piece {
  id: string;
  nom: string;
  code_piece: string | null;
  url: string;
  uploaded_at: string;
}

// Pièce enrichie du contexte de son dossier : nécessaire pour la suppression
// (DELETE /dossiers/:dossierId/pieces/:pieceId) et pour n'autoriser celle-ci
// que sur les dossiers encore en brouillon (les pièces deviennent immuables
// une fois le dossier déposé — l'API renvoie 403 sinon).
interface DocItem extends Piece {
  dossierId: string;
  dossierNumero: string;
  dossierStatus: string;
}

function fileType(nom: string): string {
  const ext = nom.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "pdf") return "PDF";
  if (["jpg", "jpeg", "png", "gif", "webp", "tiff", "tif"].includes(ext)) return "Image";
  if (["doc", "docx", "odt"].includes(ext)) return "Document";
  return ext ? ext.toUpperCase() : "Fichier";
}

export function MesDocuments() {
  const [docs, setDocs] = useState<DocItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  // Il n'existe pas d'endpoint « tous les documents du citoyen » : les pièces
  // sont rattachées aux dossiers. On récupère donc les dossiers puis on agrège
  // leurs pièces en une seule liste.
  const load = () => {
    setLoading(true);
    api.get<Dossier[]>("/dossiers")
      .then(async (dossiers) => {
        const lists = await Promise.all(
          dossiers.map((d) =>
            api.get<Piece[]>(`/dossiers/${d.id}/pieces`)
              .then((pieces) =>
                pieces.map((p): DocItem => ({
                  ...p,
                  dossierId: d.id,
                  dossierNumero: d.numero,
                  dossierStatus: d.status,
                }))
              )
              .catch(() => [] as DocItem[])
          )
        );
        setDocs(lists.flat().sort((a, b) => b.uploaded_at.localeCompare(a.uploaded_at)));
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const handleDelete = async (doc: DocItem) => {
    if (!window.confirm(`Supprimer définitivement « ${doc.nom} » ?`)) return;
    try {
      await api.delete(`/dossiers/${doc.dossierId}/pieces/${doc.id}`);
      setDocs((prev) => prev.filter((d) => d.id !== doc.id));
    } catch (err) {
      console.error(err);
      alert(err instanceof Error ? err.message : "Suppression impossible.");
    }
  };

  const filtered = docs.filter((d) =>
    !search || [d.nom, d.dossierNumero].some((f) => f.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-[#000020]">Mes documents</h1>
          <p className="text-gray-500 text-sm">Retrouvez tous vos documents et pièces jointes</p>
        </div>
        <Button className="gap-2 w-full sm:w-auto justify-center">
          <Upload className="w-4 h-4" />
          Ajouter un document
        </Button>
      </div>

      <div className="relative mb-6 sm:max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <Input
          placeholder="Rechercher un document..."
          className="pl-9"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {loading ? (
        <div className="p-12 text-center text-gray-400">Chargement...</div>
      ) : filtered.length === 0 ? (
        <Card className="border-dashed border-gray-300 bg-white/50">
          <CardContent className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-16 h-16 rounded-full bg-heureka-100 flex items-center justify-center mb-4">
              <FolderOpen className="w-8 h-8 text-heureka-400" />
            </div>
            <h3 className="text-lg font-semibold text-[#000020] mb-2">
              {search ? "Aucun document trouvé" : "Aucun document"}
            </h3>
            <p className="text-gray-500 max-w-sm mb-6">
              {search
                ? "Aucun document ne correspond à votre recherche."
                : "Importez vos pièces jointes pour les associer à vos demandes."}
            </p>
            {!search && (
              <Button className="gap-2">
                <Upload className="w-4 h-4" />
                Ajouter un document
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((doc) => (
            <Card key={doc.id} className="border-gray-200/80 hover:shadow-md transition-shadow group">
              <CardContent className="p-5">
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded-xl bg-heureka-100 flex items-center justify-center shrink-0">
                    <FileText className="w-6 h-6 text-heureka-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-[#000020] truncate" title={doc.nom}>{doc.nom}</p>
                    <p className="text-xs text-gray-400 mt-1">
                      {fileType(doc.nom)} · Dossier {doc.dossierNumero}
                    </p>
                    <p className="text-xs text-gray-400">
                      Ajouté le {new Date(doc.uploaded_at).toLocaleDateString("fr-FR")}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 mt-4 pt-3 border-t border-gray-100">
                  <a href={doc.url} download={doc.nom} target="_blank" rel="noopener noreferrer">
                    <Button variant="ghost" size="sm" className="gap-1.5 text-gray-500">
                      <Download className="w-3.5 h-3.5" />
                      Télécharger
                    </Button>
                  </a>
                  {doc.dossierStatus === "brouillon" && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="gap-1.5 text-red-500 hover:text-red-700 hover:bg-red-50 ml-auto"
                      onClick={() => void handleDelete(doc)}
                      title="Supprimer cette pièce"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
