import { useState, useCallback, useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../../hooks/useAuth";
import { api } from "../../lib/api";
import { linkifyArticles } from "../../utils/linkifyArticles";

// ─── Types ───────────────────────────────────────────────────────────────────

type Step = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
type NatureId =
  | "maison_neuve"
  | "agrandissement"
  | "petite_construction"
  | "amenagement"
  | "demolition"
  | "changement_destination"
  | "modification_aspect"
  | "division_terrain"
  | "certificat";

interface ParcelInfo {
  adresse?: string;
  commune?: string;
  zone?: string;       // zone_code  e.g. "UA"
  zoneLabel?: string;  // zone_label e.g. "Zone Urbaine Centrale"
  parcelle?: string;   // parcelle_id e.g. "37218000AB0050"
  surfaceTerrain?: number; // m²
  servitudes?: Array<{ categorie?: string; libelle?: string }>;
}

function mapAnalysis(result: Record<string, unknown>, fallbackAdresse = ""): ParcelInfo {
  type Addr = { label?: string; city?: string };
  type Parcel = { parcelle_id?: string; commune?: string; surface_m2?: number };
  type PluZone = { zone_code?: string; zone_label?: string };
  type Municipality = { libelle?: string };

  const address = result.address as Addr | undefined;
  const parcel = result.parcel as Parcel | undefined;
  const pluZone = result.plu_zone as PluZone | undefined;
  const municipality = result.municipality as Municipality | undefined;
  const servitudes = (result.servitudes as Array<{ categorie?: string; libelle?: string }>) ?? [];

  return {
    adresse: address?.label ?? fallbackAdresse,
    commune: address?.city ?? parcel?.commune ?? municipality?.libelle,
    zone: pluZone?.zone_code,
    zoneLabel: pluZone?.zone_label,
    parcelle: parcel?.parcelle_id,
    surfaceTerrain: parcel?.surface_m2,
    servitudes,
  };
}

interface Classification {
  type: string;
  subtype?: string | null;
  libelle: string;
  libelle_court?: string;
  articles?: string[];
  explication: string;
  delai_moyen: string;
  pieces_requises: Array<{ code: string; nom: string; requis: boolean; aide: string }>;
  alertes: string[];
  architecte_requis?: boolean;
  confiance: "haute" | "moyenne" | "faible";
  modifiers?: string[];
}

interface PieceAnalysis {
  score: "conforme" | "acceptable" | "incomplet" | "non_conforme";
  commentaire: string;
  suggestions: string[];
}

interface UploadedPiece {
  id: string;
  nom: string;
  url: string;
  analyse: PieceAnalysis | null;
}

function getScoreConfig(score: string): { label: string; bg: string; color: string } | null {
  switch (score) {
    case "conforme":      return { label: "✓ Conforme",     bg: "#DCFCE7", color: "#15803D" };
    case "acceptable":   return { label: "⚠ Acceptable",   bg: "#FEF9C3", color: "#854D0E" };
    case "incomplet":    return { label: "⚠ Incomplet",    bg: "#FEF3C7", color: "#92400E" };
    case "non_conforme": return { label: "✗ Non conforme", bg: "#FEE2E2", color: "#DC2626" };
    default: return null;
  }
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STEP_LABELS = [
  "Localisation",
  "Mon projet",
  "Détails",
  "Analyse",
  "Compléments",
  "Mes infos",
  "Documents",
  "Dépôt",
];

const CERFA_DESTINATIONS = [
  { value: "habitation", label: "Habitation" },
  { value: "garage", label: "Garage / stationnement" },
  { value: "hebergement_hotelier", label: "Hébergement hôtelier" },
  { value: "bureaux", label: "Bureaux" },
  { value: "commerce_services", label: "Commerce et activités de services" },
  { value: "industrie", label: "Industrie" },
  { value: "exploitation_agricole", label: "Exploitation agricole ou forestière" },
  { value: "entrepot", label: "Entrepôt" },
  { value: "service_public", label: "Service public ou d'intérêt collectif" },
  { value: "autre", label: "Autre" },
];

const NATURES: Array<{
  id: NatureId;
  emoji: string;
  label: string;
  desc: string;
  color: string;
  border: string;
  activeText: string;
}> = [
  {
    id: "maison_neuve",
    emoji: "🏠",
    label: "Construire ma maison",
    desc: "Maison individuelle sur terrain nu",
    color: "#DBEAFE",
    border: "#93C5FD",
    activeText: "#1D4ED8",
  },
  {
    id: "agrandissement",
    emoji: "🔨",
    label: "Agrandir mon logement",
    desc: "Extension, véranda, surélévation…",
    color: "#D1FAE5",
    border: "#6EE7B7",
    activeText: "#065F46",
  },
  {
    id: "petite_construction",
    emoji: "🏡",
    label: "Petite construction",
    desc: "Garage, abri, pergola, carport…",
    color: "#FEF3C7",
    border: "#FCD34D",
    activeText: "#78350F",
  },
  {
    id: "amenagement",
    emoji: "🌿",
    label: "Aménager mon terrain",
    desc: "Piscine, clôture, terrasse, allée…",
    color: "#EDE9FE",
    border: "#C4B5FD",
    activeText: "#5B21B6",
  },
  {
    id: "demolition",
    emoji: "🏗️",
    label: "Démolir un bâtiment",
    desc: "Démolition totale ou partielle",
    color: "#FEE2E2",
    border: "#FCA5A5",
    activeText: "#991B1B",
  },
  {
    id: "changement_destination",
    emoji: "🔄",
    label: "Changer la destination",
    desc: "Garage → logement, commerce → habitat…",
    color: "#FFEDD5",
    border: "#FED7AA",
    activeText: "#C2410C",
  },
  {
    id: "modification_aspect",
    emoji: "🎨",
    label: "Modifier l'aspect extérieur",
    desc: "Ravalement, toiture, fenêtres, volets…",
    color: "#FDF4FF",
    border: "#E9D5FF",
    activeText: "#7E22CE",
  },
  {
    id: "division_terrain",
    emoji: "✂️",
    label: "Diviser mon terrain",
    desc: "Détachement, lotissement, partage…",
    color: "#F0FDFA",
    border: "#99F6E4",
    activeText: "#0F766E",
  },
  {
    id: "certificat",
    emoji: "📋",
    label: "Connaître les règles",
    desc: "Certificat d'urbanisme informatif",
    color: "#F1F5F9",
    border: "#CBD5E1",
    activeText: "#334155",
  },
];

function surfaceHelper(v: number): string {
  if (v <= 5) return "🪑 Environ la taille d'une table à manger";
  if (v <= 10) return "🏓 Environ 2 tables de ping-pong";
  if (v <= 20) return "🛋️ La taille d'un grand salon";
  if (v <= 40) return "🏠 Un appartement studio complet";
  if (v <= 80) return "🏡 Un appartement 3 pièces";
  if (v <= 150) return "🏗️ Une belle maison de plain-pied";
  return "🏢 Un petit immeuble";
}

const NATURE_LABELS: Record<string, string> = {
  maison_neuve: "Construction d'une maison neuve",
  agrandissement: "Agrandissement d'une construction existante",
  petite_construction: "Petite construction (garage, abri de jardin, pergola…)",
  amenagement: "Aménagement de terrain",
  demolition: "Démolition",
  changement_destination: "Changement de destination d'un bâtiment",
  modification_aspect: "Modification de l'aspect extérieur",
  division_terrain: "Division foncière / lotissement",
  certificat: "Demande de certificat d'urbanisme",
};

// ─── Step 3 config per project type ──────────────────────────────────────────

interface Step3Config {
  title: string;
  subtitle: string;
  surfaceLabel: string | null;       // null → hide surface block
  surfaceMax: number;
  surfaceExistanteLabel: string | null; // null → hide
  showAmenagementType: boolean;
  descriptionLabel: string;
  descriptionPlaceholder: string;
  descriptionRequired: boolean;
  quickValues: number[];
  surfaceHint?: string;
}

const STEP3_CONFIGS: Record<NatureId, Step3Config> = {
  maison_neuve: {
    title: "Votre maison",
    subtitle: "Précisez la surface et décrivez brièvement votre projet.",
    surfaceLabel: "Surface plancher créée",
    surfaceMax: 400,
    surfaceExistanteLabel: null,
    showAmenagementType: false,
    descriptionLabel: "Décrivez votre projet",
    descriptionPlaceholder: "Ex. : Maison de plain-pied, 4 pièces, garage intégré, bardage bois et enduit blanc…",
    descriptionRequired: false,
    quickValues: [50, 80, 100, 120, 150, 200],
    surfaceHint: "Surface de plancher créée = somme de tous les niveaux (hors combles non aménageables, garages, sous-sols non habitables)",
  },
  agrandissement: {
    title: "Votre agrandissement",
    subtitle: "Précisez les surfaces créée et existante pour déterminer la procédure.",
    surfaceLabel: "Surface plancher créée",
    surfaceMax: 200,
    surfaceExistanteLabel: "Surface plancher existante du bâtiment",
    showAmenagementType: false,
    descriptionLabel: "Que souhaitez-vous agrandir ?",
    descriptionPlaceholder: "Ex. : Extension côté jardin pour créer une cuisine ouverte et une chambre en R+1…",
    descriptionRequired: false,
    quickValues: [10, 20, 30, 40, 60, 80],
    surfaceHint: "Surface de plancher ajoutée uniquement (hors surfaces existantes conservées)",
  },
  petite_construction: {
    title: "Votre construction",
    subtitle: "Précisez la surface au sol de la construction.",
    surfaceLabel: "Surface au sol de la construction",
    surfaceMax: 100,
    surfaceExistanteLabel: null,
    showAmenagementType: false,
    descriptionLabel: "Décrivez la construction",
    descriptionPlaceholder: "Ex. : Abri de jardin en bois 4×3 m, toit monopente, pas de fondation béton…",
    descriptionRequired: false,
    quickValues: [5, 10, 15, 20, 40],
    surfaceHint: "Pour un garage, carport, pergola ou abri : surface au sol couverte",
  },
  amenagement: {
    title: "Votre aménagement",
    subtitle: "Précisez le type et la surface concernée.",
    surfaceLabel: "Surface concernée",
    surfaceMax: 200,
    surfaceExistanteLabel: null,
    showAmenagementType: true,
    descriptionLabel: "Décrivez l'aménagement",
    descriptionPlaceholder: "Ex. : Piscine 6×3 m avec local technique, entourée d'une terrasse dallée de 30 m²…",
    descriptionRequired: false,
    quickValues: [10, 20, 30, 50, 80, 100],
    surfaceHint: "Pour une piscine : surface du bassin (hors plages). Pour une terrasse : surface totale dallée ou construite.",
  },
  demolition: {
    title: "Votre démolition",
    subtitle: "Précisez la surface à démolir et ce qui sera conservé.",
    surfaceLabel: "Surface plancher à démolir",
    surfaceMax: 500,
    surfaceExistanteLabel: "Surface plancher conservée après démolition",
    showAmenagementType: false,
    descriptionLabel: "Décrivez ce qui sera démoli",
    descriptionPlaceholder: "Ex. : Ancien garage en parpaing de 40 m² en bout de parcelle, le bâtiment principal reste intact…",
    descriptionRequired: false,
    quickValues: [20, 40, 60, 100, 200],
    surfaceHint: "Surface plancher des volumes à démolir (hors surfaces conservées)",
  },
  changement_destination: {
    title: "Changement de destination",
    subtitle: "Précisez la surface concernée et décrivez l'usage actuel et futur du bâtiment.",
    surfaceLabel: "Surface plancher transformée",
    surfaceMax: 500,
    surfaceExistanteLabel: null,
    showAmenagementType: false,
    descriptionLabel: "Usage actuel → usage futur",
    descriptionPlaceholder: "Ex. : Ancien commerce de 80 m² au rez-de-chaussée transformé en appartement. Pas de travaux de structure prévus, uniquement aménagement intérieur…",
    descriptionRequired: false,
    quickValues: [20, 40, 60, 80, 120],
    surfaceHint: "Surface plancher dont la destination change (ex. : commerce → logement, garage → bureau)",
  },
  modification_aspect: {
    title: "Modification de l'aspect extérieur",
    subtitle: "Décrivez les éléments que vous souhaitez modifier (façade, toiture, ouvertures…).",
    surfaceLabel: null,
    surfaceMax: 300,
    surfaceExistanteLabel: null,
    showAmenagementType: false,
    descriptionLabel: "Décrivez les modifications",
    descriptionPlaceholder: "Ex. : Ravalement de façade avec nouvelle couleur (blanc cassé), remplacement des fenêtres bois par du PVC anthracite, remplacement des tuiles canal par tuiles mécaniques…",
    descriptionRequired: false,
    quickValues: [],
  },
  division_terrain: {
    title: "Division foncière",
    subtitle: "Précisez la surface du lot détaché et l'usage prévu.",
    surfaceLabel: "Surface du lot à détacher",
    surfaceMax: 2000,
    surfaceExistanteLabel: null,
    showAmenagementType: false,
    descriptionLabel: "Décrivez la division envisagée",
    descriptionPlaceholder: "Ex. : Détachement d'un lot de 400 m² au fond du jardin pour y construire une maison. Le terrain total fait 1 200 m². Accès par la rue latérale…",
    descriptionRequired: false,
    quickValues: [200, 400, 600, 800, 1000],
    surfaceHint: "Surface cadastrale du lot détaché (terrain nu)",
  },
  certificat: {
    title: "Votre projet",
    subtitle: "Décrivez le projet envisagé — c'est la seule information dont nous avons besoin pour un CU.",
    surfaceLabel: null,
    surfaceMax: 300,
    surfaceExistanteLabel: null,
    showAmenagementType: false,
    descriptionLabel: "Décrivez le projet envisagé",
    descriptionPlaceholder: "Ex. : Projet de construction d'une maison de 120 m² avec piscine sur terrain de 600 m². Besoin de vérifier la constructibilité et les servitudes avant de lancer le projet…",
    descriptionRequired: true,
    quickValues: [],
  },
};

// ─── Main component ───────────────────────────────────────────────────────────

export function NouvelleDemandeWizard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const qParam = searchParams.get("q") ?? "";

  const [step, setStep] = useState<Step>(1);

  // Step 1 – Localisation
  const [search, setSearch] = useState(qParam);
  const [searching, setSearching] = useState(false);
  const [parcel, setParcel] = useState<ParcelInfo | null>(null);
  const [banSuggestions, setBanSuggestions] = useState<{ label: string }[]>([]);
  const [showBanSuggestions, setShowBanSuggestions] = useState(false);
  const suggestTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Step 2 – Nature (multi-select)
  const [natures, setNatures] = useState<NatureId[]>([]);
  const toggleNature = (id: NatureId) =>
    setNatures((prev) => prev.includes(id) ? prev.filter((n) => n !== id) : [...prev, id]);

  // Step 3 – Précisions
  const [surface, setSurface] = useState<number>(0);
  const [surfaceStr, setSurfaceStr] = useState<string>("");
  const [empriseExistante, setEmpriseExistante] = useState("");
  const [amenagementType, setAmenagementType] = useState("");
  const [certificatType, setCertificatType] = useState<"a" | "b">("b");
  const [hasVoirieCommune, setHasVoirieCommune] = useState<boolean | null>(null);

  // Step 4 – Classification
  const [classifying, setClassifying] = useState(false);
  const [classification, setClassification] = useState<Classification | null>(null);

  // Step 5 – Compléments CERFA
  const [qualiteDemandeur, setQualiteDemandeur] = useState("");
  const [empriseSol, setEmpriseSol] = useState("");
  const [hauteurProjet, setHauteurProjet] = useState("");
  const [destinationActuelle, setDestinationActuelle] = useState("");
  const [destinationFuture, setDestinationFuture] = useState("");
  const [nbLogements, setNbLogements] = useState("");

  // Step 6 – Infos personnelles
  const [nom, setNom] = useState(user?.nom ?? "");
  const [prenom, setPrenom] = useState(user?.prenom ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [description, setDescription] = useState("");

  // Step 8 – Résultat
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState<{ id: string; numero: string } | null>(null);

  // Step 7 – Upload tracking
  // Plusieurs fichiers possibles par rubrique → tableau par code_piece.
  // Les annexes libres sont stockées sous la clé spéciale ANNEXE_KEY.
  const ANNEXE_KEY = "ANNEXE";
  const [dossierId, setDossierId] = useState<string | null>(null);
  const [dossierNumero, setDossierNumero] = useState<string | null>(null);
  const [uploadedPieces, setUploadedPieces] = useState<Record<string, UploadedPiece[]>>({});
  const [uploadingCodes, setUploadingCodes] = useState<Set<string>>(new Set());
  const [creatingDossier, setCreatingDossier] = useState(false);
  // RGPD — consentement explicite à l'analyse IA des pièces (art. 13 + 22).
  // true par défaut (le service est conçu autour de l'analyse), mais le
  // citoyen peut décocher → ses pièces sont alors transmises à l'instructeur
  // SANS aucun appel LLM.
  const [aiConsent, setAiConsent] = useState<boolean>(true);
  const [showAiDetails, setShowAiDetails] = useState<boolean>(false);

  // ── Auto-search when wizard is opened with ?q= (from AnalyseParcellaire) ───
  useEffect(() => {
    if (!qParam) return;
    setSearching(true);
    api.get<Record<string, unknown>>(`/public/analyse?q=${encodeURIComponent(qParam)}`)
      .then((result) => setParcel(mapAnalysis(result, qParam)))
      .catch(() => setParcel({ adresse: qParam }))
      .finally(() => setSearching(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentional: only on mount

  // ── BAN autocomplete ─────────────────────────────────────────────────────────
  const handleSearchChange = (val: string) => {
    setSearch(val);
    setShowBanSuggestions(true);
    if (suggestTimer.current) clearTimeout(suggestTimer.current);
    if (val.length < 3) { setBanSuggestions([]); return; }
    suggestTimer.current = setTimeout(() => {
      void fetch(`https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(val)}&limit=5`)
        .then((r) => r.json())
        .then((data: { features?: Array<{ properties: { label: string } }> }) => {
          setBanSuggestions((data.features ?? []).map((f) => ({ label: f.properties.label })));
        })
        .catch(() => setBanSuggestions([]));
    }, 250);
  };

  // ── Parcel lookup ────────────────────────────────────────────────────────────
  const searchParcel = useCallback(async (q?: string) => {
    const query = (q ?? search).trim();
    if (!query) return;
    setBanSuggestions([]);
    setShowBanSuggestions(false);
    setSearching(true);
    try {
      const result = await api.get<Record<string, unknown>>(
        `/public/analyse?q=${encodeURIComponent(query)}`,
      );
      setParcel(mapAnalysis(result, query));
    } catch {
      setParcel({ adresse: query });
    } finally {
      setSearching(false);
    }
  }, [search]);

  // ── AI classification ────────────────────────────────────────────────────────
  const classify = useCallback(async () => {
    setClassifying(true);
    setStep(4);
    try {
      const result = await api.post<Classification>("/dossiers/classify", {
        natures,
        surface: natures.some((n) => n !== "certificat") && surface > 0 ? surface : undefined,
        parcelData: parcel,
        empriseExistante: empriseExistante || undefined,
        amenagementType: amenagementType || undefined,
        description: description || undefined,
        certificatType: natures.includes("certificat") ? certificatType : undefined,
        hasVoirieCommune: natures.includes("division_terrain") ? (hasVoirieCommune ?? false) : undefined,
      });
      setClassification(result);
    } catch {
      // Graceful fallback — never block the user
      setClassification({
        type: "declaration_prealable",
        libelle: "Déclaration Préalable",
        explication:
          "D'après les informations fournies, votre projet semble nécessiter une Déclaration Préalable. Nous vous recommandons de confirmer avec votre mairie.",
        delai_moyen: "1 à 2 mois",
        pieces_requises: [
          {
            code: "DP1",
            nom: "Plan de situation du terrain",
            requis: true,
            aide: "Extrait de plan localisant le terrain dans la commune",
          },
          {
            code: "DP2",
            nom: "Plan de masse des constructions",
            requis: true,
            aide: "Vue de dessus à l'échelle avec toutes les dimensions",
          },
          {
            code: "DP4",
            nom: "Notice descriptive du projet",
            requis: true,
            aide: "Description du terrain, du projet et de son insertion dans l'environnement",
          },
        ],
        alertes: [],
        confiance: "moyenne",
      });
    } finally {
      setClassifying(false);
    }
  }, [natures, surface, parcel, empriseExistante, amenagementType, description, certificatType, hasVoirieCommune]);

  // ── Create dossier brouillon then advance to step 7 ─────────────────────────
  const createDossierAndNext = useCallback(async () => {
    if (dossierId) { setStep((s) => (s + 1) as Step); return; }
    if (!classification || classification.type === "aucune_autorisation") return;
    setCreatingDossier(true);
    try {
      const result = await api.post<{ id: string; numero: string }>("/dossiers", {
        type: classification.type,
        adresse: parcel?.adresse ?? "",
        commune: parcel?.commune ?? "",
        description: description || undefined,
        surface_plancher: natures.some((n) => n !== "certificat") && surface > 0 ? String(surface) : undefined,
        metadata: {
          natures,
          zone: parcel?.zone,
          parcelle: parcel?.parcelle,
          servitudes: parcel?.servitudes ?? [],
          cerfa_data: {
            qualiteDemandeur: qualiteDemandeur || undefined,
            empriseSol: empriseSol || undefined,
            hauteurProjet: hauteurProjet || undefined,
            destinationActuelle: destinationActuelle || undefined,
            destinationFuture: destinationFuture || undefined,
            nbLogements: nbLogements || undefined,
          },
        },
      });
      setDossierId(result.id);
      setDossierNumero(result.numero);
      setStep((s) => (s + 1) as Step);
    } catch {
      alert("Erreur lors de la création du dossier. Vérifiez votre connexion et réessayez.");
    } finally {
      setCreatingDossier(false);
    }
  }, [dossierId, classification, parcel, description, natures, surface, qualiteDemandeur, empriseSol, hauteurProjet, destinationActuelle, destinationFuture, nbLogements]);

  // ── Upload a piece and get AI analysis ───────────────────────────────────────
  // `rubricLabel` = libellé de la catégorie (ex. "Plan de situation" ou "Annexe")
  // Le nom stocké en base devient "<catégorie> - <nom du fichier>" pour que la mairie
  // voit à la fois la rubrique et le fichier d'origine du pétitionnaire.
  const uploadPiece = useCallback(async (codePiece: string, rubricLabel: string, file: File) => {
    if (!dossierId) return;
    setUploadingCodes((prev) => new Set(prev).add(codePiece));
    try {
      const combinedName = `${rubricLabel} - ${file.name}`;
      const formData = new FormData();
      formData.append("file", file);
      formData.append("code_piece", codePiece);
      formData.append("nom_piece", combinedName);
      // RGPD : transmis à chaque upload pour traçabilité de la dernière
      // décision exprimée par le citoyen.
      formData.append("ai_consent", aiConsent ? "true" : "false");
      const res = await fetch(`/api/dossiers/${dossierId}/pieces/upload`, {
        method: "POST",
        credentials: "include",
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error ?? `Erreur ${res.status}`);
      }
      const data = await res.json() as { id: string; nom: string; url: string; analyse_ia: PieceAnalysis | null };
      setUploadedPieces((prev) => {
        const current = prev[codePiece] ?? [];
        return {
          ...prev,
          [codePiece]: [...current, { id: data.id, nom: file.name, url: data.url, analyse: data.analyse_ia }],
        };
      });
    } catch (e) {
      const msg = e instanceof Error && e.message ? e.message : "Erreur inconnue";
      alert(`Erreur lors du dépôt : ${msg}`);
    } finally {
      setUploadingCodes((prev) => {
        const next = new Set(prev);
        next.delete(codePiece);
        return next;
      });
    }
  }, [dossierId, aiConsent]);

  // ── Delete a previously uploaded piece ─────────────────────────────────────
  const deletePiece = useCallback(async (codePiece: string, pieceId: string) => {
    if (!dossierId) return;
    try {
      const res = await fetch(`/api/dossiers/${dossierId}/pieces/${pieceId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok && res.status !== 204) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error ?? `Erreur ${res.status}`);
      }
      setUploadedPieces((prev) => {
        const remaining = (prev[codePiece] ?? []).filter((p) => p.id !== pieceId);
        const next = { ...prev };
        if (remaining.length === 0) delete next[codePiece];
        else next[codePiece] = remaining;
        return next;
      });
    } catch (e) {
      const msg = e instanceof Error && e.message ? e.message : "Erreur inconnue";
      alert(`Suppression impossible : ${msg}`);
    }
  }, [dossierId]);

  // ── Submit (soumettre à la mairie) ────────────────────────────────────────────
  const soumettreALaMairie = useCallback(async () => {
    if (!dossierId || !dossierNumero) return;
    setSubmitting(true);
    try {
      await api.post(`/dossiers/${dossierId}/soumettre`, {});
      setSubmitted({ id: dossierId, numero: dossierNumero });
    } catch {
      alert("Erreur lors de la soumission. Réessayez.");
    } finally {
      setSubmitting(false);
    }
  }, [dossierId, dossierNumero]);

  const next = () => setStep((s) => (s + 1) as Step);
  const prev = () => setStep((s) => (s - 1) as Step);

  const hasABF = parcel?.servitudes?.some(
    (s) => s.categorie?.startsWith("AC") || s.libelle?.toLowerCase().includes("abf"),
  );

  // ── Shared input style ───────────────────────────────────────────────────────
  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "11px 14px",
    border: "2px solid #E2E8F0",
    borderRadius: 10,
    fontSize: 14,
    outline: "none",
    fontFamily: "inherit",
    boxSizing: "border-box",
    transition: "border-color 0.15s",
  };

  // ── Success screen ───────────────────────────────────────────────────────────
  if (submitted) {
    return (
      <div
        style={{
          minHeight: "100%",
          background: "linear-gradient(135deg, #F0F4FF 0%, #F8FAFC 100%)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
        }}
      >
        <div style={{ maxWidth: 520, width: "100%", textAlign: "center" }}>
          <div style={{ fontSize: 80, marginBottom: 20, lineHeight: 1 }}>🎉</div>
          <h1 style={{ fontSize: 28, fontWeight: 800, color: "#0F172A", marginBottom: 8 }}>
            Dossier soumis à la mairie !
          </h1>
          <p style={{ fontSize: 15, color: "#64748b", marginBottom: 16 }}>
            Votre numéro de dossier est :
          </p>
          <div
            style={{
              background: "#EEF2FF",
              border: "2px solid #C7D2FE",
              borderRadius: 14,
              padding: "16px 40px",
              marginBottom: 28,
              display: "inline-block",
            }}
          >
            <span
              style={{
                fontSize: 26,
                fontWeight: 800,
                color: "#4F46E5",
                letterSpacing: "0.06em",
                fontFamily: "monospace",
              }}
            >
              {submitted.numero}
            </span>
          </div>
          <div style={{ background: "#F0FDF4", border: "1px solid #86EFAC", borderRadius: 12, padding: "14px 20px", marginBottom: 24, textAlign: "left" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#15803D", marginBottom: 6 }}>✓ Dossier transmis à la mairie</div>
            <div style={{ fontSize: 13, color: "#166534", lineHeight: 1.6 }}>
              Vous recevrez un accusé de réception et pourrez suivre l'avancement de votre dossier en temps réel depuis votre espace.
            </div>
          </div>
          <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
            <button
              onClick={() => navigate(`/citoyen/mes-demandes/${submitted.id}`)}
              style={{
                padding: "11px 28px",
                background: "#4F46E5",
                color: "white",
                border: "none",
                borderRadius: 10,
                fontSize: 14,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Suivre mon dossier →
            </button>
            <button
              onClick={() => navigate("/citoyen")}
              style={{
                padding: "11px 28px",
                background: "white",
                color: "#374151",
                border: "1px solid #E2E8F0",
                borderRadius: 10,
                fontSize: 14,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Retour à l'accueil
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Wizard shell ─────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: "100%", background: "#F8FAFC", padding: "32px 24px" }}>
      <div style={{ maxWidth: 700, margin: "0 auto" }}>
        {/* Nav + Progress */}
        <div style={{ marginBottom: 28 }}>
          <button
            onClick={() => navigate("/citoyen")}
            style={{
              border: "none",
              background: "none",
              color: "#64748b",
              fontSize: 13,
              cursor: "pointer",
              marginBottom: 18,
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: 0,
            }}
          >
            ← Retour à l'accueil
          </button>

          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 10 }}>
            <div>
              <h1 style={{ fontSize: 22, fontWeight: 800, color: "#0F172A", margin: 0 }}>
                Nouvelle demande
              </h1>
              <p style={{ fontSize: 13, color: "#94a3b8", marginTop: 2 }}>
                Étape {step} / {STEP_LABELS.length} — {STEP_LABELS[step - 1]}
              </p>
            </div>
          </div>

          {/* Progress segments */}
          <div style={{ display: "flex", gap: 5 }}>
            {STEP_LABELS.map((_, i) => (
              <div
                key={i}
                style={{
                  flex: 1,
                  height: 5,
                  borderRadius: 5,
                  background: i + 1 <= step ? "#4F46E5" : "#E2E8F0",
                  transition: "background 0.4s ease",
                }}
              />
            ))}
          </div>
        </div>

        {/* Card */}
        <div
          style={{
            background: "white",
            borderRadius: 18,
            border: "1px solid #E2E8F0",
            padding: "36px 36px",
            boxShadow: "0 2px 12px rgba(0,0,0,0.04)",
          }}
        >
          {/* ───── STEP 1 : Localisation ───── */}
          {step === 1 && (
            <div>
              <div style={{ textAlign: "center", marginBottom: 28 }}>
                <div style={{ fontSize: 52, marginBottom: 10 }}>📍</div>
                <h2 style={{ fontSize: 22, fontWeight: 800, color: "#0F172A", marginBottom: 8 }}>
                  Où se situe votre projet ?
                </h2>
                <p style={{ fontSize: 14, color: "#64748b", maxWidth: 440, margin: "0 auto" }}>
                  Saisissez l'adresse du terrain ou sa référence cadastrale. On analysera les règles
                  qui s'y appliquent.
                </p>
              </div>

              <div style={{ display: "flex", gap: 10, marginBottom: 16, alignItems: "flex-start" }}>
                <div style={{ flex: 1, position: "relative" }}>
                  <input
                    value={search}
                    onChange={(e) => handleSearchChange(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void searchParcel();
                      if (e.key === "Escape") { setBanSuggestions([]); setShowBanSuggestions(false); }
                    }}
                    onFocus={(e) => { e.target.style.borderColor = "#4F46E5"; setShowBanSuggestions(true); }}
                    onBlur={(e) => {
                      e.target.style.borderColor = "#E2E8F0";
                      setTimeout(() => setShowBanSuggestions(false), 150);
                    }}
                    placeholder="Ex : 15 rue des Tilleuls, Tours  —  ou  37261000AB0050"
                    style={{ ...inputStyle, width: "100%", fontSize: 14, padding: "13px 16px", boxSizing: "border-box" }}
                  />
                  {showBanSuggestions && banSuggestions.length > 0 && (
                    <div style={{
                      position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 200,
                      background: "white", border: "1px solid #E2E8F0", borderRadius: 10,
                      boxShadow: "0 8px 24px rgba(0,0,0,0.12)", overflow: "hidden",
                    }}>
                      {banSuggestions.map((s, i) => (
                        <button
                          key={i}
                          onMouseDown={(e) => { e.preventDefault(); setSearch(s.label); void searchParcel(s.label); }}
                          style={{
                            display: "flex", alignItems: "center", gap: 10, width: "100%",
                            padding: "11px 14px", background: "white", border: "none",
                            borderBottom: i < banSuggestions.length - 1 ? "1px solid #F1F5F9" : "none",
                            cursor: "pointer", textAlign: "left", fontSize: 13, color: "#0F172A",
                          }}
                          onMouseEnter={(e) => (e.currentTarget.style.background = "#F8FAFC")}
                          onMouseLeave={(e) => (e.currentTarget.style.background = "white")}
                        >
                          <span style={{ color: "#94a3b8", flexShrink: 0 }}>📍</span>
                          {s.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => void searchParcel()}
                  disabled={!search.trim() || searching}
                  style={{
                    padding: "13px 22px",
                    background: "#4F46E5",
                    color: "white",
                    border: "none",
                    borderRadius: 10,
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: !search.trim() || searching ? "not-allowed" : "pointer",
                    opacity: !search.trim() || searching ? 0.6 : 1,
                    whiteSpace: "nowrap",
                    flexShrink: 0,
                    transition: "opacity 0.2s",
                  }}
                >
                  {searching ? "Analyse…" : "Analyser →"}
                </button>
              </div>

              {parcel && (
                <div
                  style={{
                    background: "#F0FDF4",
                    border: "1px solid #86EFAC",
                    borderRadius: 14,
                    padding: 20,
                    marginBottom: 20,
                  }}
                >
                  <div
                    style={{ fontSize: 13, fontWeight: 700, color: "#15803D", marginBottom: 14 }}
                  >
                    ✓ Parcelle analysée
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    {[
                      ["📌 Adresse", parcel.adresse],
                      ["🏘️ Commune", parcel.commune ?? "—"],
                      ["🗺️ Zone PLU", parcel.zone
                        ? `${parcel.zone}${parcel.zoneLabel ? ` — ${parcel.zoneLabel}` : ""}`
                        : "Non déterminée"],
                      ["📐 Référence parcelle", parcel.parcelle ?? "—"],
                      ...(parcel.surfaceTerrain
                        ? [["🌿 Surface du terrain", `${parcel.surfaceTerrain.toLocaleString("fr-FR")} m²`] as [string, string]]
                        : []),
                    ].map(([label, value]) => (
                      <div key={label}>
                        <div style={{ fontSize: 11, color: "#64748b", marginBottom: 3 }}>{label}</div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: "#0F172A" }}>{value}</div>
                      </div>
                    ))}
                  </div>

                  {hasABF && (
                    <div
                      style={{
                        marginTop: 14,
                        background: "#FFF7ED",
                        border: "1px solid #FED7AA",
                        borderRadius: 10,
                        padding: "11px 14px",
                        fontSize: 13,
                        color: "#92400E",
                        lineHeight: 1.5,
                      }}
                    >
                      ⚠️ <strong>Zone ABF détectée</strong> — Votre terrain est dans le périmètre
                      de l'Architecte des Bâtiments de France. Une consultation sera automatiquement
                      déclenchée.
                    </div>
                  )}
                </div>
              )}

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 8 }}>
                {!parcel && (
                  <button
                    onClick={() => {
                      setParcel({ adresse: search.trim() || "Adresse non renseignée" });
                      next();
                    }}
                    style={{
                      padding: "10px 20px",
                      background: "white",
                      color: "#64748b",
                      border: "1px solid #E2E8F0",
                      borderRadius: 10,
                      fontSize: 13,
                      cursor: "pointer",
                    }}
                  >
                    Renseigner manuellement
                  </button>
                )}
                {parcel && (
                  <button
                    onClick={next}
                    style={{
                      padding: "11px 28px",
                      background: "#4F46E5",
                      color: "white",
                      border: "none",
                      borderRadius: 10,
                      fontSize: 14,
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    Continuer →
                  </button>
                )}
              </div>
            </div>
          )}

          {/* ───── STEP 2 : Nature du projet ───── */}
          {step === 2 && (
            <div>
              <div style={{ textAlign: "center", marginBottom: 24 }}>
                <div style={{ fontSize: 52, marginBottom: 10 }}>🔍</div>
                <h2 style={{ fontSize: 22, fontWeight: 800, color: "#0F172A", marginBottom: 8 }}>
                  Quel est votre projet ?
                </h2>
                <p style={{ fontSize: 14, color: "#64748b" }}>
                  Sélectionnez tout ce qui s'applique — vous pouvez cocher plusieurs cases.
                </p>
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr 1fr",
                  gap: 10,
                  marginBottom: 16,
                }}
              >
                {NATURES.map((n) => {
                  const active = natures.includes(n.id);
                  return (
                    <button
                      key={n.id}
                      onClick={() => toggleNature(n.id)}
                      style={{
                        padding: "14px 12px",
                        border: `2px solid ${active ? n.border : "#E2E8F0"}`,
                        borderRadius: 12,
                        background: active ? n.color : "white",
                        textAlign: "left",
                        cursor: "pointer",
                        transition: "all 0.15s",
                        display: "flex",
                        flexDirection: "column",
                        gap: 8,
                        position: "relative",
                      }}
                    >
                      {active && (
                        <div style={{
                          position: "absolute",
                          top: 8,
                          right: 8,
                          width: 18,
                          height: 18,
                          borderRadius: "50%",
                          background: n.activeText,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: 10,
                          color: "white",
                          fontWeight: 800,
                          flexShrink: 0,
                        }}>✓</div>
                      )}
                      <span style={{ fontSize: 28, lineHeight: 1 }}>{n.emoji}</span>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: active ? n.activeText : "#0F172A", marginBottom: 2, lineHeight: 1.3 }}>
                          {n.label}
                        </div>
                        <div style={{ fontSize: 11, color: active ? n.activeText : "#94a3b8", lineHeight: 1.4, opacity: active ? 0.85 : 1 }}>
                          {n.desc}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>

              {natures.length > 0 && (
                <div style={{ fontSize: 12, color: "#6366F1", marginBottom: 20, textAlign: "center" }}>
                  {natures.length === 1
                    ? "1 type de projet sélectionné"
                    : `${natures.length} types de projet sélectionnés`}
                </div>
              )}

              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <button
                  onClick={prev}
                  style={{
                    padding: "10px 20px",
                    background: "white",
                    color: "#374151",
                    border: "1px solid #E2E8F0",
                    borderRadius: 10,
                    fontSize: 13,
                    cursor: "pointer",
                  }}
                >
                  ← Retour
                </button>
                <button
                  onClick={next}
                  disabled={natures.length === 0}
                  style={{
                    padding: "11px 28px",
                    background: "#4F46E5",
                    color: "white",
                    border: "none",
                    borderRadius: 10,
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: natures.length === 0 ? "not-allowed" : "pointer",
                    opacity: natures.length === 0 ? 0.4 : 1,
                    transition: "opacity 0.2s",
                  }}
                >
                  Continuer →
                </button>
              </div>
            </div>
          )}

          {/* ───── STEP 3 : Précisions ───── */}
          {step === 3 && natures.length > 0 && (() => {
            const primaryNature = natures.length === 1 ? natures[0] : null;
            const cfg: Step3Config = primaryNature ? STEP3_CONFIGS[primaryNature] : {
              title: "Votre projet",
              subtitle: "Précisez les surfaces concernées et décrivez l'ensemble des travaux envisagés.",
              surfaceLabel: natures.some((n) => n !== "certificat") ? "Surface plancher créée ou transformée" : null,
              surfaceMax: 400,
              surfaceExistanteLabel: "Surface plancher existante (facultatif)",
              showAmenagementType: false,
              descriptionLabel: "Décrivez l'ensemble de votre projet",
              descriptionPlaceholder: "Décrivez les différents travaux envisagés, les surfaces concernées, et leur enchaînement prévu…",
              descriptionRequired: false,
              quickValues: [10, 20, 40, 80, 120, 200],
              surfaceHint: "Surface de plancher créée ou dont la destination change — hors surfaces conservées à l'identique",
            };
            const surfaceRequired = cfg.surfaceLabel !== null;
            const canAnalyse =
              (!cfg.descriptionRequired || description.trim().length > 0) &&
              (!surfaceRequired || surface > 0);
            return (
              <div>
                <div style={{ textAlign: "center", marginBottom: 28 }}>
                  <div style={{ fontSize: 52, marginBottom: 10 }}>📐</div>
                  <h2 style={{ fontSize: 22, fontWeight: 800, color: "#0F172A", marginBottom: 8 }}>
                    {cfg.title}
                  </h2>
                  <p style={{ fontSize: 14, color: "#64748b", maxWidth: 460, margin: "0 auto" }}>
                    {cfg.subtitle}
                  </p>
                </div>

                {/* Type d'aménagement */}
                {cfg.showAmenagementType && (
                  <div style={{ marginBottom: 20 }}>
                    <label style={{ fontSize: 14, fontWeight: 700, color: "#0F172A", display: "block", marginBottom: 10 }}>
                      Type d'aménagement
                    </label>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                      {([["piscine", "🏊 Piscine"], ["cloture", "🧱 Clôture / portail"], ["terrasse", "🪑 Terrasse"], ["autre", "✨ Autre"]] as [string, string][]).map(([val, label]) => (
                        <button key={val} onClick={() => setAmenagementType(val)}
                          style={{ padding: "13px", border: `2px solid ${amenagementType === val ? "#4F46E5" : "#E2E8F0"}`, borderRadius: 12, background: amenagementType === val ? "#EEF2FF" : "white", fontSize: 14, fontWeight: amenagementType === val ? 700 : 400, color: amenagementType === val ? "#4F46E5" : "#374151", cursor: "pointer", transition: "all 0.15s" }}>
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Surface principale */}
                {cfg.surfaceLabel && (
                  <div style={{ marginBottom: 22 }}>
                    <div style={{ marginBottom: 8 }}>
                      <label style={{ fontSize: 14, fontWeight: 700, color: "#0F172A" }}>
                        {cfg.surfaceLabel}
                      </label>
                      {cfg.surfaceHint && (
                        <p style={{ fontSize: 12, color: "#64748b", margin: "4px 0 0", lineHeight: 1.4 }}>
                          ℹ {cfg.surfaceHint}
                        </p>
                      )}
                    </div>

                    {/* Quick-pick chips */}
                    {cfg.quickValues.length > 0 && (
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
                        {cfg.quickValues.map((v) => (
                          <button
                            key={v}
                            type="button"
                            onClick={() => { setSurface(v); setSurfaceStr(String(v)); }}
                            style={{
                              padding: "6px 16px",
                              borderRadius: 20,
                              border: `1.5px solid ${surface === v ? "#4F46E5" : "#E2E8F0"}`,
                              background: surface === v ? "#EEF2FF" : "white",
                              color: surface === v ? "#4F46E5" : "#374151",
                              fontSize: 13,
                              fontWeight: surface === v ? 700 : 500,
                              cursor: "pointer",
                              transition: "all 0.12s",
                            }}
                          >
                            {v} m²
                          </button>
                        ))}
                      </div>
                    )}

                    {/* Number input */}
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <input
                        type="number"
                        min={1}
                        max={9999}
                        value={surfaceStr}
                        placeholder="Autre valeur…"
                        onChange={(e) => {
                          setSurfaceStr(e.target.value);
                          const v = parseInt(e.target.value, 10);
                          if (!isNaN(v) && v > 0) setSurface(v);
                          else if (e.target.value === "") setSurface(0);
                        }}
                        onBlur={() => { if (surface > 0) setSurfaceStr(String(surface)); }}
                        style={{ ...inputStyle, fontSize: 18, fontWeight: 700, color: surface > 0 ? "#4F46E5" : undefined, borderColor: surface > 0 ? "#C7D2FE" : "#E2E8F0" }}
                        onFocus={(e) => (e.target.style.borderColor = "#4F46E5")}
                      />
                      <span style={{ fontSize: 18, color: "#64748b", fontWeight: 700, flexShrink: 0 }}>m²</span>
                    </div>

                    {surface > 0 && (
                      <div style={{ fontSize: 13, color: "#64748b", background: "#F8FAFC", borderRadius: 10, padding: "10px 16px", border: "1px solid #E2E8F0", marginTop: 10 }}>
                        💡 {surfaceHelper(surface)}
                      </div>
                    )}
                  </div>
                )}

                {/* Surface existante / conservée */}
                {cfg.surfaceExistanteLabel && (
                  <div style={{ marginBottom: 20 }}>
                    <label style={{ fontSize: 14, fontWeight: 700, color: "#0F172A", display: "block", marginBottom: 4 }}>
                      {cfg.surfaceExistanteLabel}{" "}
                      <span style={{ fontWeight: 400, color: "#94a3b8", fontSize: 12 }}>facultatif</span>
                    </label>
                    <p style={{ fontSize: 12, color: "#64748b", margin: "0 0 8px", lineHeight: 1.4 }}>
                      ℹ Permet de calculer le total (existant + créé) et de vérifier le seuil d'obligation de recourir à un architecte (&gt; 150 m²)
                    </p>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <input type="number" value={empriseExistante}
                        onChange={(e) => setEmpriseExistante(e.target.value)}
                        placeholder="Ex : 80"
                        style={{ ...inputStyle, fontSize: 16, fontWeight: 600 }}
                        onFocus={(e) => (e.target.style.borderColor = "#4F46E5")}
                        onBlur={(e) => (e.target.style.borderColor = "#E2E8F0")} />
                      <span style={{ fontSize: 18, color: "#64748b", fontWeight: 700, flexShrink: 0 }}>m²</span>
                    </div>
                    {/* Running total */}
                    {surface > 0 && empriseExistante && Number(empriseExistante) > 0 && (
                      <div style={{
                        marginTop: 10,
                        padding: "10px 16px",
                        background: (surface + Number(empriseExistante)) > 150 ? "#FEF3C7" : "#F0FDF4",
                        border: `1px solid ${(surface + Number(empriseExistante)) > 150 ? "#FDE68A" : "#86EFAC"}`,
                        borderRadius: 10,
                        fontSize: 13,
                        color: (surface + Number(empriseExistante)) > 150 ? "#92400E" : "#15803D",
                        fontWeight: 600,
                      }}>
                        {(surface + Number(empriseExistante)) > 150
                          ? `⚠ Total : ${surface + Number(empriseExistante)} m² — architecte obligatoire (> 150 m²)`
                          : `✓ Total : ${surface + Number(empriseExistante)} m²`
                        }
                      </div>
                    )}
                  </div>
                )}

                {/* Description du projet */}
                <div style={{ marginBottom: 24 }}>
                  <label style={{ fontSize: 14, fontWeight: 700, color: "#0F172A", display: "block", marginBottom: 8 }}>
                    {cfg.descriptionLabel}{" "}
                    {!cfg.descriptionRequired && (
                      <span style={{ fontWeight: 400, color: "#94a3b8", fontSize: 12 }}>facultatif</span>
                    )}
                  </label>
                  <textarea value={description} onChange={(e) => setDescription(e.target.value)}
                    placeholder={cfg.descriptionPlaceholder} rows={3}
                    style={{ ...inputStyle, resize: "vertical", lineHeight: 1.6 }}
                    onFocus={(e) => (e.target.style.borderColor = "#4F46E5")}
                    onBlur={(e) => (e.target.style.borderColor = "#E2E8F0")} />
                  {cfg.descriptionRequired && !description.trim() && (
                    <p style={{ fontSize: 12, color: "#94a3b8", marginTop: 4 }}>
                      ↑ Nécessaire pour analyser votre projet de certificat.
                    </p>
                  )}
                </div>

                {/* ── Sous-question CUa / CUb ── */}
                {natures.includes("certificat") && (
                  <div style={{ marginBottom: 24 }}>
                    <label style={{ fontSize: 14, fontWeight: 700, color: "#0F172A", display: "block", marginBottom: 10 }}>
                      Type de certificat souhaité
                    </label>
                    <div style={{ display: "flex", gap: 10 }}>
                      {([
                        ["a", "📋 CUa — Informatif", "Connaître les règles du PLU applicables à la parcelle (1 mois)"],
                        ["b", "🔍 CUb — Opérationnel", "Vérifier la faisabilité d'un projet précis sur la parcelle (2 mois)"],
                      ] as ["a" | "b", string, string][]).map(([val, label, desc]) => (
                        <button key={val} onClick={() => setCertificatType(val)}
                          style={{
                            flex: 1, padding: "14px 12px", border: `2px solid ${certificatType === val ? "#4F46E5" : "#E2E8F0"}`,
                            borderRadius: 12, background: certificatType === val ? "#EEF2FF" : "white",
                            textAlign: "left", cursor: "pointer", transition: "all 0.15s",
                          }}>
                          <div style={{ fontSize: 13, fontWeight: 700, color: certificatType === val ? "#4F46E5" : "#0F172A", marginBottom: 4 }}>{label}</div>
                          <div style={{ fontSize: 11, color: certificatType === val ? "#6366F1" : "#94a3b8", lineHeight: 1.4 }}>{desc}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* ── Sous-question voirie commune (division terrain) ── */}
                {natures.includes("division_terrain") && (
                  <div style={{ marginBottom: 24 }}>
                    <label style={{ fontSize: 14, fontWeight: 700, color: "#0F172A", display: "block", marginBottom: 10 }}>
                      La division créera-t-elle des voies ou réseaux communs ?
                    </label>
                    <p style={{ fontSize: 12, color: "#64748b", marginBottom: 10, marginTop: -4 }}>
                      Voirie partagée, réseau eau/électricité commun, espace vert collectif…
                    </p>
                    <div style={{ display: "flex", gap: 10 }}>
                      {([
                        [true, "✓ Oui — Voirie ou réseaux communs", "→ Permis d'Aménager requis"],
                        [false, "✕ Non — Division simple", "→ Déclaration Préalable suffit"],
                      ] as [boolean, string, string][]).map(([val, label, sub]) => (
                        <button key={String(val)} onClick={() => setHasVoirieCommune(val)}
                          style={{
                            flex: 1, padding: "14px 12px",
                            border: `2px solid ${hasVoirieCommune === val ? (val ? "#4F46E5" : "#64748b") : "#E2E8F0"}`,
                            borderRadius: 12,
                            background: hasVoirieCommune === val ? (val ? "#EEF2FF" : "#F1F5F9") : "white",
                            textAlign: "left", cursor: "pointer", transition: "all 0.15s",
                          }}>
                          <div style={{ fontSize: 13, fontWeight: 700, color: hasVoirieCommune === val ? (val ? "#4F46E5" : "#374151") : "#0F172A", marginBottom: 4 }}>{label}</div>
                          <div style={{ fontSize: 11, color: "#94a3b8" }}>{sub}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <button onClick={prev}
                    style={{ padding: "10px 20px", background: "white", color: "#374151", border: "1px solid #E2E8F0", borderRadius: 10, fontSize: 13, cursor: "pointer" }}>
                    ← Retour
                  </button>
                  <button onClick={() => void classify()} disabled={!canAnalyse}
                    style={{ padding: "11px 28px", background: "#4F46E5", color: "white", border: "none", borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: canAnalyse ? "pointer" : "not-allowed", opacity: canAnalyse ? 1 : 0.4, transition: "opacity 0.2s" }}>
                    Analyser mon projet →
                  </button>
                </div>
              </div>
            );
          })()}

          {/* ───── STEP 4 : Classification IA ───── */}
          {step === 4 && (
            <div>
              {classifying ? (
                <div style={{ textAlign: "center", padding: "48px 0" }}>
                  <div
                    style={{
                      fontSize: 64,
                      marginBottom: 20,
                      display: "inline-block",
                      animation: "heureka-spin 1.5s linear infinite",
                    }}
                  >
                    🔍
                  </div>
                  <style>{`@keyframes heureka-spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }`}</style>
                  <h2
                    style={{
                      fontSize: 20,
                      fontWeight: 700,
                      color: "#0F172A",
                      marginBottom: 10,
                    }}
                  >
                    On analyse votre projet…
                  </h2>
                  <p style={{ fontSize: 14, color: "#64748b", maxWidth: 380, margin: "0 auto" }}>
                    On croise les règles d'urbanisme avec les caractéristiques de votre parcelle et
                    la nature de votre projet.
                  </p>
                </div>
              ) : classification ? (
                <div>
                  <div style={{ textAlign: "center", marginBottom: 24 }}>
                    <div style={{ fontSize: 52, marginBottom: 10 }}>✅</div>
                    <h2
                      style={{ fontSize: 22, fontWeight: 800, color: "#0F172A", marginBottom: 6 }}
                    >
                      Votre démarche est identifiée !
                    </h2>
                    <p style={{ fontSize: 14, color: "#64748b" }}>
                      Voici ce que la loi prévoit pour votre projet.
                    </p>
                  </div>

                  {/* Result card */}
                  <div
                    style={{
                      background: "linear-gradient(135deg, #EEF2FF, #F5F3FF)",
                      border: "2px solid #C7D2FE",
                      borderRadius: 16,
                      padding: 24,
                      marginBottom: 20,
                    }}
                  >
                    <div
                      style={{
                        fontSize: 11,
                        color: "#6366F1",
                        fontWeight: 800,
                        textTransform: "uppercase",
                        letterSpacing: "0.07em",
                        marginBottom: 6,
                      }}
                    >
                      Procédure requise
                    </div>
                    <div
                      style={{
                        fontSize: 26,
                        fontWeight: 900,
                        color: "#0F172A",
                        marginBottom: 14,
                      }}
                    >
                      {classification.libelle}
                    </div>
                    <p
                      style={{
                        fontSize: 14,
                        color: "#374151",
                        lineHeight: 1.7,
                        marginBottom: 20,
                      }}
                    >
                      {linkifyArticles(classification.explication)}
                    </p>
                    <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
                      {[
                        ["⏱", "Délai moyen", classification.delai_moyen],
                        ["💶", "Coût", "Gratuit"],
                        [
                          "🎯",
                          "Fiabilité",
                          classification.confiance === "haute"
                            ? "Élevée"
                            : classification.confiance === "moyenne"
                            ? "Bonne"
                            : "À confirmer",
                        ],
                      ].map(([icon, label, value]) => (
                        <div key={label}>
                          <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 3 }}>
                            {label}
                          </div>
                          <div style={{ fontSize: 14, fontWeight: 700, color: "#0F172A" }}>
                            {icon} {value}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {classification.architecte_requis && (
                    <div
                      style={{
                        background: "#FEF2F2",
                        border: "1.5px solid #FECACA",
                        borderRadius: 12,
                        padding: "14px 18px",
                        marginBottom: 16,
                        display: "flex",
                        alignItems: "flex-start",
                        gap: 12,
                      }}
                    >
                      <span style={{ fontSize: 18, flexShrink: 0 }}>🔴</span>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: "#991B1B", marginBottom: 4 }}>
                          Architecte obligatoire
                        </div>
                        <div style={{ fontSize: 13, color: "#7F1D1D", lineHeight: 1.5 }}>
                          {linkifyArticles("La surface plancher totale (existante + créée) dépasse 150 m². Le recours à un architecte est obligatoire pour déposer ce dossier (art. R431-2 CU).")}
                        </div>
                      </div>
                    </div>
                  )}

                  {classification.alertes.length > 0 && (
                    <div
                      style={{
                        background: "#FFF7ED",
                        border: "1px solid #FED7AA",
                        borderRadius: 12,
                        padding: "16px 18px",
                        marginBottom: 20,
                      }}
                    >
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 700,
                          color: "#92400E",
                          marginBottom: 10,
                        }}
                      >
                        ⚠️ Points d'attention
                      </div>
                      {classification.alertes.map((a, i) => (
                        <div
                          key={i}
                          style={{ fontSize: 13, color: "#78350F", marginBottom: 5, lineHeight: 1.5 }}
                        >
                          • {linkifyArticles(a)}
                        </div>
                      ))}
                    </div>
                  )}

                  {classification.type === "aucune_autorisation" ? (
                    <div>
                      <div
                        style={{
                          background: "#F0FDF4",
                          border: "1px solid #86EFAC",
                          borderRadius: 12,
                          padding: "16px 18px",
                          marginBottom: 24,
                          fontSize: 14,
                          color: "#15803D",
                          lineHeight: 1.6,
                        }}
                      >
                        ✅ <strong>Aucune autorisation d'urbanisme n'est requise</strong> pour votre projet en l'état. Vous pouvez réaliser vos travaux sans démarche préalable. En cas de doute, rapprochez-vous de votre mairie pour confirmation.
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <button
                          onClick={() => { setClassification(null); setStep(3); }}
                          style={{ padding: "10px 20px", background: "white", color: "#374151", border: "1px solid #E2E8F0", borderRadius: 10, fontSize: 13, cursor: "pointer" }}
                        >
                          ← Modifier mon projet
                        </button>
                        <button
                          onClick={() => navigate("/citoyen")}
                          style={{ padding: "11px 28px", background: "#15803D", color: "white", border: "none", borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: "pointer" }}
                        >
                          Retour à l'accueil
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <button
                        onClick={() => { setClassification(null); setStep(3); }}
                        style={{ padding: "10px 20px", background: "white", color: "#374151", border: "1px solid #E2E8F0", borderRadius: 10, fontSize: 13, cursor: "pointer" }}
                      >
                        ← Modifier
                      </button>
                      <button
                        onClick={next}
                        style={{ padding: "11px 28px", background: "#4F46E5", color: "white", border: "none", borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: "pointer" }}
                      >
                        Continuer avec cette procédure →
                      </button>
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          )}

          {/* ───── STEP 5 : Compléments CERFA ───── */}
          {step === 5 && (
            <div>
              <div style={{ textAlign: "center", marginBottom: 28 }}>
                <div style={{ fontSize: 52, marginBottom: 10 }}>📋</div>
                <h2 style={{ fontSize: 22, fontWeight: 800, color: "#0F172A", marginBottom: 8 }}>
                  Informations CERFA
                </h2>
                <p style={{ fontSize: 14, color: "#64748b", maxWidth: 460, margin: "0 auto" }}>
                  Ces informations serviront à préremplir votre formulaire officiel. Tous les champs sont facultatifs.
                </p>
              </div>

              {/* Qualité du demandeur */}
              <div style={{ marginBottom: 22 }}>
                <label style={{ fontSize: 14, fontWeight: 700, color: "#0F172A", display: "block", marginBottom: 10 }}>
                  Vous êtes{" "}
                  <span style={{ fontWeight: 400, color: "#94a3b8", fontSize: 12 }}>facultatif</span>
                </label>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  {(["Propriétaire", "Mandataire du propriétaire", "Autre"] as const).map((q) => (
                    <button
                      key={q}
                      onClick={() => setQualiteDemandeur(qualiteDemandeur === q ? "" : q)}
                      style={{
                        padding: "10px 16px",
                        border: `2px solid ${qualiteDemandeur === q ? "#4F46E5" : "#E2E8F0"}`,
                        borderRadius: 10,
                        background: qualiteDemandeur === q ? "#EEF2FF" : "white",
                        fontSize: 13,
                        fontWeight: qualiteDemandeur === q ? 700 : 400,
                        color: qualiteDemandeur === q ? "#4F46E5" : "#374151",
                        cursor: "pointer",
                        transition: "all 0.15s",
                      }}
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>

              {/* Emprise au sol créée */}
              {!natures.includes("certificat") && (
                <div style={{ marginBottom: 20 }}>
                  <label style={{ fontSize: 14, fontWeight: 700, color: "#0F172A", display: "block", marginBottom: 8 }}>
                    Emprise au sol créée{" "}
                    <span style={{ fontWeight: 400, color: "#94a3b8", fontSize: 12 }}>facultatif · m²</span>
                  </label>
                  <input
                    type="number"
                    value={empriseSol}
                    onChange={(e) => setEmpriseSol(e.target.value)}
                    placeholder="Ex : 25"
                    style={inputStyle}
                    onFocus={(e) => (e.target.style.borderColor = "#4F46E5")}
                    onBlur={(e) => (e.target.style.borderColor = "#E2E8F0")}
                  />
                  <p style={{ fontSize: 12, color: "#94a3b8", marginTop: 4 }}>
                    Surface au sol de la construction projetée (projection verticale sur le terrain).
                  </p>
                </div>
              )}

              {/* Changement de destination */}
              {natures.includes("changement_destination") && (
                <>
                  <div style={{ marginBottom: 16 }}>
                    <label style={{ fontSize: 14, fontWeight: 700, color: "#0F172A", display: "block", marginBottom: 8 }}>
                      Destination actuelle{" "}
                      <span style={{ fontWeight: 400, color: "#94a3b8", fontSize: 12 }}>facultatif</span>
                    </label>
                    <select
                      value={destinationActuelle}
                      onChange={(e) => setDestinationActuelle(e.target.value)}
                      style={{ ...inputStyle, background: "white", cursor: "pointer" }}
                    >
                      <option value="">— Sélectionner —</option>
                      {CERFA_DESTINATIONS.map((d) => (
                        <option key={d.value} value={d.value}>{d.label}</option>
                      ))}
                    </select>
                  </div>
                  <div style={{ marginBottom: 20 }}>
                    <label style={{ fontSize: 14, fontWeight: 700, color: "#0F172A", display: "block", marginBottom: 8 }}>
                      Destination future{" "}
                      <span style={{ fontWeight: 400, color: "#94a3b8", fontSize: 12 }}>facultatif</span>
                    </label>
                    <select
                      value={destinationFuture}
                      onChange={(e) => setDestinationFuture(e.target.value)}
                      style={{ ...inputStyle, background: "white", cursor: "pointer" }}
                    >
                      <option value="">— Sélectionner —</option>
                      {CERFA_DESTINATIONS.map((d) => (
                        <option key={d.value} value={d.value}>{d.label}</option>
                      ))}
                    </select>
                  </div>
                </>
              )}

              {/* PC uniquement : hauteur + nombre de logements */}
              {classification?.type === "permis_de_construire" && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 20 }}>
                  <div>
                    <label style={{ fontSize: 14, fontWeight: 700, color: "#0F172A", display: "block", marginBottom: 8 }}>
                      Hauteur maximale{" "}
                      <span style={{ fontWeight: 400, color: "#94a3b8", fontSize: 12 }}>facultatif · m</span>
                    </label>
                    <input
                      type="number"
                      value={hauteurProjet}
                      onChange={(e) => setHauteurProjet(e.target.value)}
                      placeholder="Ex : 6.5"
                      step="0.1"
                      style={inputStyle}
                      onFocus={(e) => (e.target.style.borderColor = "#4F46E5")}
                      onBlur={(e) => (e.target.style.borderColor = "#E2E8F0")}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: 14, fontWeight: 700, color: "#0F172A", display: "block", marginBottom: 8 }}>
                      Logements créés{" "}
                      <span style={{ fontWeight: 400, color: "#94a3b8", fontSize: 12 }}>facultatif</span>
                    </label>
                    <input
                      type="number"
                      value={nbLogements}
                      onChange={(e) => setNbLogements(e.target.value)}
                      placeholder="Ex : 1"
                      min={0}
                      style={inputStyle}
                      onFocus={(e) => (e.target.style.borderColor = "#4F46E5")}
                      onBlur={(e) => (e.target.style.borderColor = "#E2E8F0")}
                    />
                  </div>
                </div>
              )}

              <div
                style={{
                  background: "#EFF6FF",
                  border: "1px solid #BFDBFE",
                  borderRadius: 12,
                  padding: "13px 18px",
                  marginBottom: 24,
                  fontSize: 13,
                  color: "#1E40AF",
                  lineHeight: 1.6,
                }}
              >
                💡 Ces informations sont facultatives. Elles permettront de préremplir votre formulaire CERFA officiel lors du dépôt final.
              </div>

              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <button onClick={prev} style={{ padding: "10px 20px", background: "white", color: "#374151", border: "1px solid #E2E8F0", borderRadius: 10, fontSize: 13, cursor: "pointer" }}>
                  ← Retour
                </button>
                <button onClick={next} style={{ padding: "11px 28px", background: "#4F46E5", color: "white", border: "none", borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
                  Continuer →
                </button>
              </div>
            </div>
          )}

          {/* ───── STEP 6 : Informations ───── */}
          {step === 6 && (
            <div>
              <div style={{ textAlign: "center", marginBottom: 28 }}>
                <div style={{ fontSize: 52, marginBottom: 10 }}>👤</div>
                <h2 style={{ fontSize: 22, fontWeight: 800, color: "#0F172A", marginBottom: 8 }}>
                  Vos informations
                </h2>
                <p style={{ fontSize: 14, color: "#64748b" }}>
                  Pré-remplies depuis votre profil — modifiez si besoin.
                </p>
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 14,
                  marginBottom: 14,
                }}
              >
                {[
                  { label: "Prénom", value: prenom, onChange: setPrenom, placeholder: "Votre prénom" },
                  { label: "Nom", value: nom, onChange: setNom, placeholder: "Votre nom" },
                ].map((f) => (
                  <div key={f.label}>
                    <label
                      style={{
                        fontSize: 13,
                        fontWeight: 700,
                        color: "#374151",
                        display: "block",
                        marginBottom: 7,
                      }}
                    >
                      {f.label}
                    </label>
                    <input
                      value={f.value}
                      onChange={(e) => f.onChange(e.target.value)}
                      placeholder={f.placeholder}
                      style={inputStyle}
                      onFocus={(e) => (e.target.style.borderColor = "#4F46E5")}
                      onBlur={(e) => (e.target.style.borderColor = "#E2E8F0")}
                    />
                  </div>
                ))}
              </div>

              <div style={{ marginBottom: 14 }}>
                <label
                  style={{
                    fontSize: 13,
                    fontWeight: 700,
                    color: "#374151",
                    display: "block",
                    marginBottom: 7,
                  }}
                >
                  Email
                </label>
                <input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  type="email"
                  placeholder="votre@email.fr"
                  style={inputStyle}
                  onFocus={(e) => (e.target.style.borderColor = "#4F46E5")}
                  onBlur={(e) => (e.target.style.borderColor = "#E2E8F0")}
                />
              </div>

              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <button
                  onClick={prev}
                  style={{
                    padding: "10px 20px",
                    background: "white",
                    color: "#374151",
                    border: "1px solid #E2E8F0",
                    borderRadius: 10,
                    fontSize: 13,
                    cursor: "pointer",
                  }}
                >
                  ← Retour
                </button>
                <button
                  onClick={() => void createDossierAndNext()}
                  disabled={!nom.trim() || !prenom.trim() || creatingDossier}
                  style={{
                    padding: "11px 28px",
                    background: "#4F46E5",
                    color: "white",
                    border: "none",
                    borderRadius: 10,
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: (!nom.trim() || !prenom.trim() || creatingDossier) ? "not-allowed" : "pointer",
                    opacity: (!nom.trim() || !prenom.trim() || creatingDossier) ? 0.5 : 1,
                    transition: "opacity 0.2s",
                  }}
                >
                  {creatingDossier ? "Création…" : "Continuer →"}
                </button>
              </div>
            </div>
          )}

          {/* ───── STEP 7 : Documents (upload actif + analyse IA) ───── */}
          {step === 7 && (() => {
            const pieces = classification?.pieces_requises ?? [];
            const required = pieces.filter((p) => p.requis);
            const uploadedRequired = required.filter((p) => (uploadedPieces[p.code]?.length ?? 0) > 0).length;
            const annexes = uploadedPieces[ANNEXE_KEY] ?? [];
            const annexesUploading = uploadingCodes.has(ANNEXE_KEY);

            const renderFile = (codePiece: string, file: UploadedPiece) => {
              const scoreConf = file.analyse ? getScoreConfig(file.analyse.score) : null;
              return (
                <div
                  key={file.id}
                  style={{
                    padding: "10px 12px",
                    background: "white",
                    borderRadius: 8,
                    border: "1px solid #E2E8F0",
                    marginTop: 6,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 13, color: "#16a34a", fontWeight: 600, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      📎 {file.nom}
                    </span>
                    {scoreConf && (
                      <span style={{ padding: "2px 8px", borderRadius: 20, fontSize: 11, fontWeight: 700, background: scoreConf.bg, color: scoreConf.color, flexShrink: 0 }}>
                        {scoreConf.label}
                      </span>
                    )}
                    <button
                      onClick={() => void deletePiece(codePiece, file.id)}
                      style={{ padding: "3px 10px", background: "white", color: "#DC2626", border: "1px solid #FECACA", borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: "pointer", flexShrink: 0 }}
                    >
                      Retirer
                    </button>
                  </div>
                  {file.analyse?.commentaire && (
                    <p style={{ fontSize: 12, color: "#374151", margin: "6px 0 0", lineHeight: 1.4, fontStyle: "italic" }}>
                      {file.analyse.commentaire}
                    </p>
                  )}
                  {file.analyse?.suggestions && file.analyse.suggestions.length > 0 && (
                    <ul style={{ margin: "4px 0 0", paddingLeft: 16, fontSize: 12, color: "#64748b" }}>
                      {file.analyse.suggestions.map((s, i) => <li key={i}>{s}</li>)}
                    </ul>
                  )}
                </div>
              );
            };

            return (
              <div>
                <div style={{ textAlign: "center", marginBottom: 20 }}>
                  <div style={{ fontSize: 52, marginBottom: 10 }}>📁</div>
                  <h2 style={{ fontSize: 22, fontWeight: 800, color: "#0F172A", marginBottom: 8 }}>
                    Vos pièces justificatives
                  </h2>
                  <p style={{ fontSize: 14, color: "#64748b", maxWidth: 460, margin: "0 auto" }}>
                    Déposez vos documents ci-dessous — vous pouvez en ajouter plusieurs par rubrique.
                    {aiConsent
                      ? " L'IA analyse chaque pièce et vous guide instantanément."
                      : " Vos pièces seront vérifiées manuellement par l'instructeur."}
                  </p>
                </div>

                {/* ── RGPD : Information & consentement IA (art. 13 + 22 RGPD) ── */}
                <div
                  style={{
                    background: aiConsent ? "#F0F9FF" : "#FFFBEB",
                    border: `1px solid ${aiConsent ? "#BAE6FD" : "#FCD34D"}`,
                    borderRadius: 12,
                    padding: "12px 16px",
                    marginBottom: 16,
                    fontSize: 13,
                    color: "#0F172A",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                    <div style={{ fontSize: 18, lineHeight: 1, marginTop: 1 }}>{aiConsent ? "🤖" : "👤"}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, marginBottom: 4 }}>
                        Analyse automatisée par intelligence artificielle
                      </div>
                      <div style={{ color: "#475569", lineHeight: 1.5 }}>
                        Pour vous aider à déposer un dossier complet du premier coup, nous
                        soumettons chaque pièce à une analyse automatique opérée par{" "}
                        <strong>Anthropic (modèle Claude)</strong>, sous contrat de
                        sous-traitance RGPD. Le nom de fichier d'origine et les
                        identifiants directs sont retirés avant transmission. <strong>Une décision finale est toujours prise par un instructeur humain.</strong>
                        {" "}
                        <button
                          type="button"
                          onClick={() => setShowAiDetails((v) => !v)}
                          style={{
                            background: "none", border: "none", padding: 0,
                            color: "#4F46E5", cursor: "pointer", fontSize: 13,
                            textDecoration: "underline", fontWeight: 600,
                          }}
                        >
                          {showAiDetails ? "Masquer le détail" : "En savoir plus"}
                        </button>
                      </div>

                      {showAiDetails && (
                        <ul style={{ margin: "10px 0 0 0", paddingLeft: 18, color: "#475569", lineHeight: 1.6, fontSize: 12.5 }}>
                          <li><strong>Finalité :</strong> vérification automatisée de complétude / lisibilité des pièces et détection précoce de non-conformités PLU.</li>
                          <li><strong>Base légale :</strong> exécution d'une mission de service public (art. 6.1.e RGPD).</li>
                          <li><strong>Données envoyées :</strong> contenu du fichier + zone PLU + nature des travaux. <em>Aucune donnée d'identité (nom, email, adresse postale, numéro de parcelle complet) n'est transmise à l'IA.</em></li>
                          <li><strong>Sous-traitant :</strong> Anthropic, sous DPA + clauses contractuelles types (SCC). Rétention serveur : 30 jours maximum (zéro-rétention en option).</li>
                          <li><strong>Vos droits :</strong> opposition (case ci-dessous), accès, rectification, effacement, portabilité — via la page « Profil » ou le DPD de votre mairie.</li>
                          <li><strong>Décision automatisée :</strong> aucune ; l'IA produit un avis indicatif, la décision est rendue par un instructeur humain (art. 22 RGPD).</li>
                          <li><strong>Trace :</strong> chaque appel IA est journalisé (empreinte SHA-256 du fichier, sans dupliquer le contenu) pour audit.</li>
                        </ul>
                      )}

                      <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, cursor: "pointer", fontSize: 13, fontWeight: 600, color: "#0F172A" }}>
                        <input
                          type="checkbox"
                          checked={aiConsent}
                          onChange={(e) => setAiConsent(e.target.checked)}
                          style={{ width: 16, height: 16, cursor: "pointer", accentColor: "#4F46E5" }}
                        />
                        J'accepte l'analyse automatisée de mes pièces (recommandé)
                      </label>
                      {!aiConsent && (
                        <div style={{ marginTop: 8, padding: "8px 12px", background: "#FEF3C7", borderRadius: 8, color: "#92400E", fontSize: 12.5, lineHeight: 1.5 }}>
                          ⓘ Vous avez refusé l'analyse IA. Vos pièces seront uniquement vérifiées par un instructeur humain. Le délai d'instruction peut être légèrement allongé.
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {required.length > 0 && (
                  <div
                    style={{
                      background: uploadedRequired === required.length ? "#F0FDF4" : "#EFF6FF",
                      border: `1px solid ${uploadedRequired === required.length ? "#86EFAC" : "#BFDBFE"}`,
                      borderRadius: 10,
                      padding: "10px 16px",
                      marginBottom: 16,
                      fontSize: 13,
                      color: uploadedRequired === required.length ? "#15803D" : "#1E40AF",
                      textAlign: "center",
                      fontWeight: 600,
                    }}
                  >
                    {uploadedRequired === required.length
                      ? "✓ Toutes les pièces obligatoires ont été déposées !"
                      : `${uploadedRequired} / ${required.length} pièces obligatoires déposées`}
                  </div>
                )}

                {pieces.length > 0 ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
                    {pieces.map((piece) => {
                      const files = uploadedPieces[piece.code] ?? [];
                      const hasFiles = files.length > 0;
                      const isUploading = uploadingCodes.has(piece.code);
                      return (
                        <div
                          key={piece.code}
                          style={{
                            display: "flex",
                            alignItems: "flex-start",
                            gap: 14,
                            padding: "14px 18px",
                            background: hasFiles ? "#F0FDF4" : "#F8FAFC",
                            borderRadius: 12,
                            border: `1px solid ${hasFiles ? "#86EFAC" : "#E2E8F0"}`,
                            transition: "background 0.2s, border-color 0.2s",
                          }}
                        >
                          <span style={{ fontSize: 22, marginTop: 1, flexShrink: 0 }}>
                            {hasFiles ? "✅" : piece.requis ? "📄" : "📋"}
                          </span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            {/* Name + badges */}
                            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
                              <span style={{ fontSize: 14, fontWeight: 700, color: "#0F172A" }}>
                                {piece.nom}
                              </span>
                              <span
                                style={{
                                  padding: "2px 9px",
                                  borderRadius: 20,
                                  fontSize: 11,
                                  fontWeight: 700,
                                  background: piece.requis ? "#DCFCE7" : "#F1F5F9",
                                  color: piece.requis ? "#15803D" : "#64748B",
                                  flexShrink: 0,
                                }}
                              >
                                {piece.requis ? "Obligatoire" : "Facultatif"}
                              </span>
                              {hasFiles && (
                                <span style={{ padding: "2px 9px", borderRadius: 20, fontSize: 11, fontWeight: 700, background: "#EEF2FF", color: "#4F46E5", flexShrink: 0 }}>
                                  {files.length} fichier{files.length > 1 ? "s" : ""}
                                </span>
                              )}
                            </div>

                            {/* Aide text (shown only when no file yet) */}
                            {!hasFiles && piece.aide && (
                              <p style={{ fontSize: 12, color: "#94a3b8", margin: "0 0 10px 0", lineHeight: 1.4 }}>
                                {piece.aide}
                              </p>
                            )}

                            {/* Liste des fichiers déjà déposés pour cette rubrique */}
                            {files.map((f) => renderFile(piece.code, f))}

                            {/* Upload / add another button */}
                            <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center" }}>
                              {isUploading ? (
                                <span style={{ fontSize: 12, color: "#4F46E5", fontStyle: "italic" }}>
                                  ⏳ Analyse en cours…
                                </span>
                              ) : (
                                <label
                                  style={{
                                    cursor: "pointer",
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: 6,
                                    padding: "6px 14px",
                                    background: "#EEF2FF",
                                    color: "#4F46E5",
                                    borderRadius: 8,
                                    fontSize: 12,
                                    fontWeight: 600,
                                    border: "1px solid #C7D2FE",
                                  }}
                                >
                                  <input
                                    type="file"
                                    multiple
                                    style={{ display: "none" }}
                                    accept=".pdf,.jpg,.jpeg,.png,.gif,.webp,.tiff"
                                    onChange={(e) => {
                                      const files = Array.from(e.target.files ?? []);
                                      for (const file of files) {
                                        void uploadPiece(piece.code, piece.nom, file);
                                      }
                                      e.currentTarget.value = "";
                                    }}
                                  />
                                  {hasFiles ? "+ Ajouter un autre document" : "+ Déposer le document"}
                                </label>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div style={{ background: "#F8FAFC", borderRadius: 12, padding: 24, marginBottom: 20, textAlign: "center", color: "#64748b", fontSize: 14 }}>
                    La liste des pièces sera précisée par l'instructeur après dépôt.
                  </div>
                )}

                {/* ── Annexes libres ─────────────────────────────────────── */}
                <div
                  style={{
                    padding: "14px 18px",
                    background: annexes.length > 0 ? "#FFFBEB" : "#F8FAFC",
                    borderRadius: 12,
                    border: `1px solid ${annexes.length > 0 ? "#FCD34D" : "#E2E8F0"}`,
                    marginBottom: 20,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 22 }}>📎</span>
                    <span style={{ fontSize: 14, fontWeight: 700, color: "#0F172A" }}>
                      Annexes complémentaires
                    </span>
                    <span style={{ padding: "2px 9px", borderRadius: 20, fontSize: 11, fontWeight: 700, background: "#F1F5F9", color: "#64748B" }}>
                      Facultatif
                    </span>
                    {annexes.length > 0 && (
                      <span style={{ padding: "2px 9px", borderRadius: 20, fontSize: 11, fontWeight: 700, background: "#FEF3C7", color: "#92400E" }}>
                        {annexes.length} fichier{annexes.length > 1 ? "s" : ""}
                      </span>
                    )}
                  </div>
                  <p style={{ fontSize: 12, color: "#94a3b8", margin: "0 0 8px 0", lineHeight: 1.4 }}>
                    Photos, courriers, attestations, devis ou tout autre document utile à l'instruction.
                  </p>

                  {annexes.map((f) => renderFile(ANNEXE_KEY, f))}

                  <div style={{ marginTop: 8 }}>
                    {annexesUploading ? (
                      <span style={{ fontSize: 12, color: "#4F46E5", fontStyle: "italic" }}>
                        ⏳ Analyse en cours…
                      </span>
                    ) : (
                      <label
                        style={{
                          cursor: "pointer",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                          padding: "6px 14px",
                          background: "#EEF2FF",
                          color: "#4F46E5",
                          borderRadius: 8,
                          fontSize: 12,
                          fontWeight: 600,
                          border: "1px solid #C7D2FE",
                        }}
                      >
                        <input
                          type="file"
                          multiple
                          style={{ display: "none" }}
                          accept=".pdf,.jpg,.jpeg,.png,.gif,.webp,.tiff"
                          onChange={(e) => {
                            const files = Array.from(e.target.files ?? []);
                            for (const file of files) {
                              void uploadPiece(ANNEXE_KEY, "Annexe", file);
                            }
                            e.currentTarget.value = "";
                          }}
                        />
                        {annexes.length > 0 ? "+ Ajouter une autre annexe" : "+ Ajouter une annexe"}
                      </label>
                    )}
                  </div>
                </div>

                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <button
                    onClick={prev}
                    style={{ padding: "10px 20px", background: "white", color: "#374151", border: "1px solid #E2E8F0", borderRadius: 10, fontSize: 13, cursor: "pointer" }}
                  >
                    ← Retour
                  </button>
                  <button
                    onClick={next}
                    style={{ padding: "11px 28px", background: "#4F46E5", color: "white", border: "none", borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: "pointer" }}
                  >
                    Récapitulatif →
                  </button>
                </div>
              </div>
            );
          })()}

          {/* ───── STEP 8 : Récapitulatif & Dépôt ───── */}
          {step === 8 && (
            <div>
              <div style={{ textAlign: "center", marginBottom: 28 }}>
                <div style={{ fontSize: 52, marginBottom: 10 }}>🚀</div>
                <h2 style={{ fontSize: 22, fontWeight: 800, color: "#0F172A", marginBottom: 8 }}>
                  Tout est prêt !
                </h2>
                <p style={{ fontSize: 14, color: "#64748b" }}>
                  Vérifiez les informations puis déposez votre dossier en un clic.
                </p>
              </div>

              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                  marginBottom: 28,
                }}
              >
                {[
                  { icon: "📍", label: "Localisation", value: parcel?.adresse ?? "Non renseignée" },
                  {
                    icon: "🔨",
                    label: "Type de projet",
                    value: natures.map((id) => NATURES.find((n) => n.id === id)?.label ?? id).join(", "),
                  },
                  ...(natures.some((n) => n !== "certificat") && surface > 0
                    ? [{ icon: "📐", label: "Surface plancher", value: `${surface} m²` }]
                    : []),
                  { icon: "📋", label: "Procédure", value: classification?.libelle ?? "—" },
                  { icon: "⏱", label: "Délai estimé", value: classification?.delai_moyen ?? "—" },
                  {
                    icon: "👤",
                    label: "Pétitionnaire",
                    value: `${prenom} ${nom}  ·  ${email}`,
                  },
                ].map((item) => (
                  <div
                    key={item.label}
                    style={{
                      display: "flex",
                      gap: 14,
                      padding: "13px 18px",
                      background: "#F8FAFC",
                      borderRadius: 12,
                      border: "1px solid #E2E8F0",
                    }}
                  >
                    <span style={{ fontSize: 20, flexShrink: 0, marginTop: 1 }}>{item.icon}</span>
                    <div>
                      <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 3 }}>
                        {item.label}
                      </div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: "#0F172A" }}>
                        {item.value}
                      </div>
                    </div>
                  </div>
                ))}

                {description && (
                  <div
                    style={{
                      padding: "13px 18px",
                      background: "#F8FAFC",
                      borderRadius: 12,
                      border: "1px solid #E2E8F0",
                    }}
                  >
                    <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 4 }}>
                      💬 Description
                    </div>
                    <div
                      style={{
                        fontSize: 13,
                        color: "#374151",
                        lineHeight: 1.6,
                        fontStyle: "italic",
                      }}
                    >
                      {description}
                    </div>
                  </div>
                )}
              </div>

              {(() => {
                const pieces = classification?.pieces_requises ?? [];
                const required = pieces.filter((p) => p.requis);
                const missing = required.filter((p) => (uploadedPieces[p.code]?.length ?? 0) === 0).length;
                const canSubmit = missing === 0 && !!dossierId && !submitting;
                return (
                  <>
                    {missing > 0 ? (
                      <div style={{ background: "#FEE2E2", border: "1px solid #FECACA", borderRadius: 12, padding: "13px 18px", marginBottom: 16, fontSize: 13, color: "#DC2626", lineHeight: 1.5, fontWeight: 500 }}>
                        🚫 {missing} pièce{missing > 1 ? "s" : ""} obligatoire{missing > 1 ? "s" : ""} manquante{missing > 1 ? "s" : ""}. Retournez à l'étape précédente pour les déposer avant de soumettre.
                      </div>
                    ) : required.length > 0 ? (
                      <div style={{ background: "#F0FDF4", border: "1px solid #86EFAC", borderRadius: 12, padding: "13px 18px", marginBottom: 16, fontSize: 13, color: "#15803D", lineHeight: 1.5 }}>
                        ✓ Toutes les pièces obligatoires ont été déposées.
                      </div>
                    ) : null}
                    {missing === 0 && (
                      <div style={{ background: "#F0FDF4", border: "1px solid #86EFAC", borderRadius: 12, padding: "13px 18px", marginBottom: 24, fontSize: 13, color: "#15803D", lineHeight: 1.5 }}>
                        ✓ Votre dossier sera transmis à la mairie de{" "}
                        <strong>{parcel?.commune ?? "votre commune"}</strong>. Vous recevrez un
                        accusé de réception et pourrez suivre l'avancement en temps réel.
                      </div>
                    )}

                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <button
                        onClick={prev}
                        style={{
                          padding: "10px 20px",
                          background: "white",
                          color: "#374151",
                          border: "1px solid #E2E8F0",
                          borderRadius: 10,
                          fontSize: 13,
                          cursor: "pointer",
                        }}
                      >
                        ← Compléter les pièces
                      </button>
                      <button
                        onClick={() => void soumettreALaMairie()}
                        disabled={!canSubmit}
                        style={{
                          padding: "13px 36px",
                          background: !canSubmit ? "#C7D2FE" : "#4F46E5",
                          color: "white",
                          border: "none",
                          borderRadius: 10,
                          fontSize: 15,
                          fontWeight: 700,
                          cursor: !canSubmit ? "not-allowed" : "pointer",
                          transition: "background 0.2s",
                          letterSpacing: "0.01em",
                        }}
                      >
                        {submitting ? "Soumission…" : "🚀 Soumettre à la mairie"}
                      </button>
                    </div>
                  </>
                );
              })()}
            </div>
          )}
        </div>

        {/* Reassurance footer */}
        <p
          style={{
            textAlign: "center",
            fontSize: 12,
            color: "#CBD5E1",
            marginTop: 20,
            lineHeight: 1.5,
          }}
        >
          🔒 Données chiffrées en transit (HTTPS) et hébergées en UE. Traitement
          conforme RGPD — voir les mentions légales et la politique de confidentialité.
        </p>
      </div>
    </div>
  );
}
