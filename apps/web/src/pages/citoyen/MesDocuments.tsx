import { Card, CardContent } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Search, Upload, FileText, FolderOpen, Download, Trash2 } from "lucide-react";

const documents = [
  { id: "1", name: "Permis de construire - PC024.pdf", type: "PDF", date: "15/05/2026", size: "2.4 MB" },
  { id: "2", name: "Plan de situation - Parcelle A4.pdf", type: "PDF", date: "15/05/2026", size: "1.1 MB" },
  { id: "3", name: "Photo façade principale.jpg", type: "Image", date: "14/05/2026", size: "3.7 MB" },
  { id: "4", name: "Notice descriptive.docx", type: "Document", date: "13/05/2026", size: "856 KB" },
];

export function MesDocuments() {
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
        <Input placeholder="Rechercher un document..." className="pl-9" />
      </div>

      {documents.length === 0 ? (
        <Card className="border-dashed border-gray-300 bg-white/50">
          <CardContent className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-16 h-16 rounded-full bg-heureka-100 flex items-center justify-center mb-4">
              <FolderOpen className="w-8 h-8 text-heureka-400" />
            </div>
            <h3 className="text-lg font-semibold text-[#000020] mb-2">Aucun document</h3>
            <p className="text-gray-500 max-w-sm mb-6">
              Importez vos pièces jointes pour les associer à vos demandes.
            </p>
            <Button className="gap-2">
              <Upload className="w-4 h-4" />
              Ajouter un document
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {documents.map((doc) => (
            <Card key={doc.id} className="border-gray-200/80 hover:shadow-md transition-shadow group">
              <CardContent className="p-5">
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded-xl bg-heureka-100 flex items-center justify-center shrink-0">
                    <FileText className="w-6 h-6 text-heureka-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-[#000020] truncate">{doc.name}</p>
                    <p className="text-xs text-gray-400 mt-1">
                      {doc.type} · {doc.size}
                    </p>
                    <p className="text-xs text-gray-400">Ajouté le {doc.date}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 mt-4 pt-3 border-t border-gray-100">
                  <Button variant="ghost" size="sm" className="gap-1.5 text-gray-500">
                    <Download className="w-3.5 h-3.5" />
                    Télécharger
                  </Button>
                  <Button variant="ghost" size="sm" className="gap-1.5 text-red-500 hover:text-red-700 hover:bg-red-50 ml-auto">
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
