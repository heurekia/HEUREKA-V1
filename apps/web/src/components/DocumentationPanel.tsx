import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  Search,
  Star,
  ExternalLink,
  MapPin,
  FileText,
  Shield,
  X,
  Building2,
  ArrowUpRight,
} from "lucide-react";

// ── Types côté front, miroir de documentationEngine.ts ───────────────────────

export interface DocumentationContext {
  commune: string | null;
  insee_code: string | null;
  parcelle: string | null;
  zone: string | null;
  zones_disponibles: string[];
  type_dossier: string | null;
  nature_projet: string[];
  servitudes: string[];
  presence_abf: boolean;
  oap_concernees: string[];
  piece_id: string | null;
  piece_code: string | null;
  piece_nom: string | null;
  piece_topics: string[];
}

export interface DocumentationReference {
  id_regle: string;
  titre: string;
  type: "plu_rule" | "commune_document" | "oap" | "servitude" | "code_urbanisme";
  source: string;
  zone: string | null;
  commune: string | null;
  texte: string;
  page: string | null;
  url_document: string | null;
  conditions: string[];
  topic?: string;
  sub_theme?: string | null;
  article_number?: number | null;
  matched_by: { rule: string; detail: string };
}

interface FavoriItem {
  id: string;
  reference_id: string;
  reference_type: string;
  titre: string;
  source: string | null;
}

interface Props {
  dossierId: string;
  // Pièce actuellement examinée — la liste des références applicables suit ce
  // changement automatiquement.
  pieceId: string | null;
  // Repli/dépli initial. Le composant gère son propre état au-delà.
  defaultOpen?: boolean;
}

const TYPE_BADGE: Record<DocumentationReference["type"], { label: string; variant: "default" | "success" | "warning" | "danger" | "info" | "purple" }> = {
  plu_rule: { label: "PLU", variant: "info" },
  oap: { label: "OAP", variant: "purple" },
  commune_document: { label: "Document", variant: "default" },
  servitude: { label: "Servitude", variant: "warning" },
  code_urbanisme: { label: "Code de l'urbanisme", variant: "info" },
};

const TYPE_DOSSIER_LABEL: Record<string, string> = {
  permis_de_construire: "Permis de construire",
  declaration_prealable: "Déclaration préalable",
  permis_amenager: "Permis d'aménager",
  permis_demolir: "Permis de démolir",
  permis_lotir: "Permis de lotir",
  certificat_urbanisme: "Certificat d'urbanisme",
};

export function DocumentationPanel({ dossierId, pieceId, defaultOpen = true }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [context, setContext] = useState<DocumentationContext | null>(null);
  const [references, setReferences] = useState<DocumentationReference[]>([]);
  const [expandedRef, setExpandedRef] = useState<string | null>(null);
  const [favoris, setFavoris] = useState<FavoriItem[]>([]);
  const [favoriIds, setFavoriIds] = useState<Set<string>>(new Set());

  // Recherche plein-texte
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<DocumentationReference[] | null>(null);
  const [searching, setSearching] = useState(false);

  const fetchContextAndRefs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = pieceId ? `?piece_id=${encodeURIComponent(pieceId)}` : "";
      const data = await api.get<{ context: DocumentationContext; references: DocumentationReference[] }>(
        `/mairie/dossiers/${dossierId}/documentation${qs}`,
      );
      setContext(data.context);
      setReferences(data.references);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur de chargement");
    } finally {
      setLoading(false);
    }
  }, [dossierId, pieceId]);

  const fetchFavoris = useCallback(async () => {
    try {
      const list = await api.get<FavoriItem[]>(`/mairie/dossiers/${dossierId}/documentation/favoris`);
      setFavoris(list);
      setFavoriIds(new Set(list.map((f) => f.reference_id)));
    } catch (err) {
      // Non bloquant : la zone Favoris affichera juste "aucun".
      console.warn("favoris:", err);
    }
  }, [dossierId]);

  useEffect(() => { void fetchContextAndRefs(); }, [fetchContextAndRefs]);
  useEffect(() => { void fetchFavoris(); }, [fetchFavoris]);

  // Recherche déclenchée avec un léger debounce — on évite de spammer le
  // serveur pendant la frappe.
  useEffect(() => {
    const q = searchQuery.trim();
    if (q.length < 2) {
      setSearchResults(null);
      return;
    }
    const handle = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await api.get<{ results: DocumentationReference[] }>(
          `/mairie/dossiers/${dossierId}/documentation/search?q=${encodeURIComponent(q)}`,
        );
        setSearchResults(res.results ?? []);
      } catch (err) {
        console.warn("doc-search:", err);
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => clearTimeout(handle);
  }, [searchQuery, dossierId]);

  const toggleFavori = useCallback(async (ref: DocumentationReference) => {
    const already = favoriIds.has(ref.id_regle);
    try {
      if (already) {
        await api.delete(`/mairie/dossiers/${dossierId}/documentation/favoris/${encodeURIComponent(ref.id_regle)}`);
        setFavoris((prev) => prev.filter((f) => f.reference_id !== ref.id_regle));
        setFavoriIds((prev) => {
          const next = new Set(prev);
          next.delete(ref.id_regle);
          return next;
        });
      } else {
        const created = await api.post<FavoriItem>(`/mairie/dossiers/${dossierId}/documentation/favoris`, {
          reference_id: ref.id_regle,
          reference_type: ref.type,
          titre: ref.titre,
          source: ref.source,
        });
        setFavoris((prev) => [...prev, created]);
        setFavoriIds((prev) => new Set(prev).add(ref.id_regle));
      }
    } catch (err) {
      console.error("toggle favori:", err);
    }
  }, [dossierId, favoriIds]);

  const visibleRefs = useMemo(() => {
    return searchResults != null ? searchResults : references;
  }, [searchResults, references]);

  return (
    <section className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
      {/* Header repliable */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-5 py-3 hover:bg-gray-50 transition-colors text-left"
        aria-expanded={open}
      >
        <div className="flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-heureka-500" />
          <span className="font-semibold text-[#000020]">Documentation</span>
          {context?.piece_code && (
            <Badge variant="info" className="ml-1">
              {context.piece_code}
              {context.piece_topics.length > 0 && ` · ${context.piece_topics.length} topic${context.piece_topics.length > 1 ? "s" : ""}`}
            </Badge>
          )}
          {!loading && (
            <span className="text-xs text-gray-500 ml-2">
              {references.length} référence{references.length > 1 ? "s" : ""}
              {favoris.length > 0 && ` · ${favoris.length} épinglée${favoris.length > 1 ? "s" : ""}`}
            </span>
          )}
        </div>
        {open ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
      </button>

      {open && (
        <div className="border-t border-gray-100">
          {loading && (
            <div className="p-6 text-center text-gray-400 text-sm">Chargement de la documentation…</div>
          )}
          {error && (
            <div className="p-4 mx-5 my-4 rounded-md bg-red-50 border border-red-200 text-sm text-red-700">
              {error}
            </div>
          )}
          {!loading && !error && context && (
            <>
              <ContextBlock context={context} />

              <SearchBlock
                query={searchQuery}
                onQueryChange={setSearchQuery}
                searching={searching}
                searchedFor={searchResults != null ? searchQuery : null}
                onClearSearch={() => { setSearchQuery(""); setSearchResults(null); }}
              />

              {favoris.length > 0 && (
                <FavorisBlock
                  favoris={favoris}
                  onRemove={(id) => {
                    void toggleFavori({
                      id_regle: id,
                      titre: "",
                      type: "plu_rule",
                      source: "",
                      zone: null,
                      commune: null,
                      texte: "",
                      page: null,
                      url_document: null,
                      conditions: [],
                      matched_by: { rule: "zone_match", detail: "" },
                    } as DocumentationReference);
                  }}
                />
              )}

              <div className="px-5 py-3 border-t border-gray-100 bg-gray-50">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                    {searchResults != null
                      ? `Résultats de recherche (${visibleRefs.length})`
                      : context.piece_code
                        ? `Références applicables à ${context.piece_code}`
                        : "Références applicables au dossier"}
                  </h4>
                  <span className="text-[11px] text-gray-400">
                    Moteur déterministe — règles métier explicites
                  </span>
                </div>
              </div>

              <div className="divide-y divide-gray-100">
                {visibleRefs.length === 0 && (
                  <div className="p-6 text-sm text-gray-500 text-center">
                    {searchResults != null
                      ? "Aucune référence ne correspond à votre recherche."
                      : "Aucune référence applicable identifiée pour ce contexte. Affinez la zone PLU ou la pièce consultée."}
                  </div>
                )}
                {visibleRefs.map((ref) => (
                  <ReferenceCard
                    key={ref.id_regle}
                    reference={ref}
                    expanded={expandedRef === ref.id_regle}
                    onToggle={() => setExpandedRef((cur) => (cur === ref.id_regle ? null : ref.id_regle))}
                    pinned={favoriIds.has(ref.id_regle)}
                    onTogglePin={() => toggleFavori(ref)}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}

// ── Bloc Contexte ────────────────────────────────────────────────────────────

function ContextBlock({ context }: { context: DocumentationContext }) {
  const dossierLabel = context.type_dossier ? TYPE_DOSSIER_LABEL[context.type_dossier] ?? context.type_dossier : null;
  return (
    <div className="px-5 py-4 border-b border-gray-100 bg-gray-50/60">
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <ContextRow icon={<Building2 className="w-3.5 h-3.5" />} label="Commune" value={context.commune} />
        <ContextRow icon={<MapPin className="w-3.5 h-3.5" />} label="Parcelle" value={context.parcelle} />
        <ContextRow
          icon={<Shield className="w-3.5 h-3.5" />}
          label="Zone PLU"
          value={context.zone ?? (context.zones_disponibles.length > 0 ? "Non résolue" : null)}
        />
        <ContextRow icon={<FileText className="w-3.5 h-3.5" />} label="Type de dossier" value={dossierLabel} />
        {context.nature_projet.length > 0 && (
          <div className="col-span-2">
            <span className="text-xs uppercase tracking-wide text-gray-500">Nature du projet</span>
            <p className="text-[#000020] mt-0.5">{context.nature_projet.join(" · ")}</p>
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5 mt-3">
        {context.presence_abf && <Badge variant="warning">ABF</Badge>}
        {context.oap_concernees.length > 0 && context.oap_concernees.map((o, i) => (
          <Badge key={`oap-${i}`} variant="purple">OAP : {o}</Badge>
        ))}
        {context.servitudes.length > 0 && context.servitudes.map((s, i) => (
          <Badge key={`srv-${i}`} variant="warning">{s}</Badge>
        ))}
        {context.piece_code && (
          <Badge variant="info">
            Pièce consultée : {context.piece_code}
          </Badge>
        )}
      </div>
    </div>
  );
}

function ContextRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string | null }) {
  return (
    <div>
      <span className="text-xs uppercase tracking-wide text-gray-500 inline-flex items-center gap-1">
        {icon}{label}
      </span>
      <p className="text-[#000020] mt-0.5 font-medium">{value ?? "—"}</p>
    </div>
  );
}

// ── Bloc Recherche ───────────────────────────────────────────────────────────

function SearchBlock({
  query,
  onQueryChange,
  searching,
  searchedFor,
  onClearSearch,
}: {
  query: string;
  onQueryChange: (v: string) => void;
  searching: boolean;
  searchedFor: string | null;
  onClearSearch: () => void;
}) {
  return (
    <div className="px-5 py-3 border-b border-gray-100">
      <label className="block">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Rechercher dans la réglementation (PLU, OAP, PPRI, servitudes…)"
            className="pl-9 pr-9"
            aria-label="Recherche documentaire"
          />
          {query && (
            <button
              type="button"
              onClick={onClearSearch}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-gray-100"
              aria-label="Effacer la recherche"
            >
              <X className="w-4 h-4 text-gray-400" />
            </button>
          )}
        </div>
      </label>
      {searching && <p className="text-[11px] text-gray-400 mt-1">Recherche en cours…</p>}
      {searchedFor && !searching && (
        <p className="text-[11px] text-gray-500 mt-1">Recherche : « {searchedFor} »</p>
      )}
    </div>
  );
}

// ── Bloc Favoris ─────────────────────────────────────────────────────────────

function FavorisBlock({ favoris, onRemove }: { favoris: FavoriItem[]; onRemove: (refId: string) => void }) {
  return (
    <div className="px-5 py-3 border-b border-gray-100 bg-amber-50/40">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-amber-800 flex items-center gap-1.5 mb-2">
        <Star className="w-3.5 h-3.5 fill-current" />
        Épinglées ({favoris.length})
      </h4>
      <ul className="space-y-1">
        {favoris.map((f) => (
          <li key={f.id} className="flex items-center justify-between gap-2 text-sm">
            <span className="truncate text-[#000020]">{f.titre}</span>
            <button
              type="button"
              onClick={() => onRemove(f.reference_id)}
              className="text-amber-600 hover:text-amber-800 shrink-0"
              title="Désépingler"
            >
              <Star className="w-4 h-4 fill-current" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Carte de référence ───────────────────────────────────────────────────────

function ReferenceCard({
  reference,
  expanded,
  onToggle,
  pinned,
  onTogglePin,
}: {
  reference: DocumentationReference;
  expanded: boolean;
  onToggle: () => void;
  pinned: boolean;
  onTogglePin: () => void;
}) {
  const badge = TYPE_BADGE[reference.type];
  return (
    <article className="px-5 py-3 hover:bg-gray-50/70">
      <header className="flex items-start gap-2">
        <button
          type="button"
          onClick={onToggle}
          className="flex-1 text-left flex items-start gap-2 group"
          aria-expanded={expanded}
        >
          <span className="mt-0.5 text-gray-400 group-hover:text-gray-600">
            {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </span>
          <span className="flex-1 min-w-0">
            <span className="flex items-center gap-2 flex-wrap">
              <Badge variant={badge.variant}>{badge.label}</Badge>
              {reference.zone && (
                <span className="font-mono text-[11px] text-gray-500">Zone {reference.zone}</span>
              )}
              <span className="text-sm font-medium text-[#000020]">{reference.titre}</span>
            </span>
            {!expanded && (
              <p className="text-xs text-gray-600 mt-1 line-clamp-2">{reference.texte}</p>
            )}
          </span>
        </button>
        <button
          type="button"
          onClick={onTogglePin}
          className={pinned ? "text-amber-500" : "text-gray-300 hover:text-amber-500"}
          title={pinned ? "Désépingler" : "Épingler"}
          aria-pressed={pinned}
        >
          <Star className={`w-4 h-4 ${pinned ? "fill-current" : ""}`} />
        </button>
      </header>

      {expanded && (
        <div className="mt-3 ml-6 space-y-3 text-sm">
          <div>
            <span className="text-xs uppercase tracking-wide text-gray-500">Source</span>
            <p className="text-[#000020]">{reference.source}</p>
          </div>
          <div>
            <span className="text-xs uppercase tracking-wide text-gray-500">Texte</span>
            <p className="text-[#000020] whitespace-pre-wrap leading-relaxed">{reference.texte}</p>
          </div>
          {reference.conditions.length > 0 && (
            <div>
              <span className="text-xs uppercase tracking-wide text-gray-500">Conditions</span>
              <ul className="list-disc list-inside text-[#000020] space-y-0.5 mt-1">
                {reference.conditions.map((c, i) => <li key={i}>{c}</li>)}
              </ul>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-3 pt-1">
            {reference.page && (
              <span className="text-xs text-gray-500">Page {reference.page}</span>
            )}
            {reference.url_document && (
              <a
                href={reference.url_document}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-sm text-heureka-500 hover:underline"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                Ouvrir le document source
              </a>
            )}
            <span className="text-[11px] text-gray-400 inline-flex items-center gap-1">
              <ArrowUpRight className="w-3 h-3" />
              {reference.matched_by.detail}
            </span>
          </div>
          {reference.type === "plu_rule" && (
            <p className="text-[11px] text-gray-400 italic">
              Règle déclenchée par moteur déterministe — explicable juridiquement.
            </p>
          )}
        </div>
      )}
    </article>
  );
}
