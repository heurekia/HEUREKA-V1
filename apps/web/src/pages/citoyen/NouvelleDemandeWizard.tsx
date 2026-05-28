import { useState, useCallback, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../../hooks/useAuth";
import { api } from "../../lib/api";

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
  pieces_requises: Array<{ nom: string; requis: boolean; aide: string }>;
  alertes: string[];
  architecte_requis?: boolean;
  confiance: "haute" | "moyenne" | "faible";
  modifiers?: string[];
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
}

const STEP3_CONFIGS: Record<NatureId, Step3Config> = {
  maison_neuve: {
    title: "Votre maison",
    subtitle: "Précisez la surface et décrivez brièvement votre projet.",
    surfaceLabel: "Surface plancher totale créée",
    surfaceMax: 400,
    surfaceExistanteLabel: null,
    showAmenagementType: false,
    descriptionLabel: "Décrivez votre projet",
    descriptionPlaceholder: "Ex. : Maison de plain-pied, 4 pièces, garage intégré, bardage bois et enduit blanc…",
    descriptionRequired: false,
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
  },
  changement_destination: {
    title: "Changement de destination",
    subtitle: "Précisez la surface concernée et décrivez l'usage actuel et futur du bâtiment.",
    surfaceLabel: "Surface plancher concernée",
    surfaceMax: 500,
    surfaceExistanteLabel: null,
    showAmenagementType: false,
    descriptionLabel: "Usage actuel → usage futur",
    descriptionPlaceholder: "Ex. : Ancien commerce de 80 m² au rez-de-chaussée transformé en appartement. Pas de travaux de structure prévus, uniquement aménagement intérieur…",
    descriptionRequired: false,
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

  // ── Parcel lookup ────────────────────────────────────────────────────────────
  const searchParcel = useCallback(async () => {
    if (!search.trim()) return;
    setSearching(true);
    try {
      const result = await api.get<Record<string, unknown>>(
        `/public/analyse?q=${encodeURIComponent(search.trim())}`,
      );
      setParcel(mapAnalysis(result, search.trim()));
    } catch {
      setParcel({ adresse: search.trim() });
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
            nom: "Plan de situation du terrain",
            requis: true,
            aide: "Extrait de plan localisant le terrain dans la commune",
          },
          {
            nom: "Plan de masse des constructions",
            requis: true,
            aide: "Vue de dessus à l'échelle avec toutes les dimensions",
          },
          {
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

  // ── Submit dossier ───────────────────────────────────────────────────────────
  const submitDossier = useCallback(async () => {
    if (!classification || classification.type === "aucune_autorisation") return;
    setSubmitting(true);
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
      setSubmitted(result);
    } finally {
      setSubmitting(false);
    }
  }, [classification, parcel, description, natures, surface, qualiteDemandeur, empriseSol, hauteurProjet, destinationActuelle, destinationFuture, nbLogements]);

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
            Dossier déposé !
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
          <p
            style={{
              fontSize: 14,
              color: "#64748b",
              marginBottom: 32,
              lineHeight: 1.7,
              maxWidth: 400,
              margin: "0 auto 32px",
            }}
          >
            La mairie a été notifiée. Suivez l'avancement de votre dossier depuis votre espace et
            ajoutez-y vos pièces justificatives au fur et à mesure.
          </p>
          <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
            <button
              onClick={() => navigate("/citoyen/mes-demandes")}
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
              Voir mes demandes
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

              <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && void searchParcel()}
                  placeholder="Ex : 15 rue des Tilleuls, Tours  —  ou  37261000AB0050"
                  style={{
                    ...inputStyle,
                    flex: 1,
                    fontSize: 14,
                    padding: "13px 16px",
                  }}
                  onFocus={(e) => (e.target.style.borderColor = "#4F46E5")}
                  onBlur={(e) => (e.target.style.borderColor = "#E2E8F0")}
                />
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
              surfaceLabel: natures.some((n) => n !== "certificat") ? "Surface plancher totale concernée" : null,
              surfaceMax: 400,
              surfaceExistanteLabel: null,
              showAmenagementType: false,
              descriptionLabel: "Décrivez l'ensemble de votre projet",
              descriptionPlaceholder: "Décrivez les différents travaux envisagés, les surfaces concernées, et leur enchaînement prévu…",
              descriptionRequired: false,
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
                    <label style={{ fontSize: 14, fontWeight: 700, color: "#0F172A", display: "block", marginBottom: 12 }}>
                      {cfg.surfaceLabel}
                    </label>
                    <div style={{ display: "flex", alignItems: "center", gap: 18, marginBottom: 10 }}>
                      <input type="range" min={1} max={cfg.surfaceMax} value={surface > 0 ? surface : 1}
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          setSurface(v);
                          setSurfaceStr(String(v));
                        }}
                        style={{ flex: 1, accentColor: "#4F46E5", height: 6, cursor: "pointer", opacity: surface === 0 ? 0.4 : 1 }} />
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                        <input
                          type="number"
                          min={1}
                          max={9999}
                          value={surfaceStr}
                          placeholder="Ex : 19"
                          onChange={(e) => {
                            setSurfaceStr(e.target.value);
                            const v = parseInt(e.target.value, 10);
                            if (!isNaN(v) && v > 0) setSurface(v);
                            else if (e.target.value === "") setSurface(0);
                          }}
                          onBlur={() => {
                            if (surface > 0) setSurfaceStr(String(surface));
                          }}
                          style={{ width: 76, padding: "10px", border: `2px solid ${surface > 0 ? "#C7D2FE" : "#E2E8F0"}`, borderRadius: 10, fontSize: 20, fontWeight: 800, textAlign: "center", outline: "none", fontFamily: "inherit", color: surface > 0 ? "#4F46E5" : "#94a3b8" }}
                        />
                        <span style={{ fontSize: 16, color: "#64748b", fontWeight: 600 }}>m²</span>
                      </div>
                    </div>
                    {surface > 0 ? (
                      <div style={{ fontSize: 13, color: "#64748b", background: "#F8FAFC", borderRadius: 10, padding: "10px 16px", border: "1px solid #E2E8F0" }}>
                        💡 {surfaceHelper(surface)}
                      </div>
                    ) : (
                      <div style={{ fontSize: 13, color: "#94a3b8", background: "#F8FAFC", borderRadius: 10, padding: "10px 16px", border: "1px solid #E2E8F0" }}>
                        ↑ Entrez la surface exacte en m²
                      </div>
                    )}
                  </div>
                )}

                {/* Surface existante / conservée */}
                {cfg.surfaceExistanteLabel && (
                  <div style={{ marginBottom: 20 }}>
                    <label style={{ fontSize: 14, fontWeight: 700, color: "#0F172A", display: "block", marginBottom: 8 }}>
                      {cfg.surfaceExistanteLabel}{" "}
                      <span style={{ fontWeight: 400, color: "#94a3b8", fontSize: 12 }}>facultatif</span>
                    </label>
                    <input type="number" value={empriseExistante}
                      onChange={(e) => setEmpriseExistante(e.target.value)}
                      placeholder="Ex : 80"
                      style={inputStyle}
                      onFocus={(e) => (e.target.style.borderColor = "#4F46E5")}
                      onBlur={(e) => (e.target.style.borderColor = "#E2E8F0")} />
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
                      {classification.explication}
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
                          La surface plancher totale (existante + créée) dépasse 150 m². Le recours à un architecte est obligatoire pour déposer ce dossier (art. R431-2 CU).
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
                          • {a}
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
                  onClick={next}
                  disabled={!nom.trim() || !prenom.trim()}
                  style={{
                    padding: "11px 28px",
                    background: "#4F46E5",
                    color: "white",
                    border: "none",
                    borderRadius: 10,
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: !nom.trim() || !prenom.trim() ? "not-allowed" : "pointer",
                    opacity: !nom.trim() || !prenom.trim() ? 0.4 : 1,
                    transition: "opacity 0.2s",
                  }}
                >
                  Continuer →
                </button>
              </div>
            </div>
          )}

          {/* ───── STEP 7 : Documents ───── */}
          {step === 7 && (
            <div>
              <div style={{ textAlign: "center", marginBottom: 28 }}>
                <div style={{ fontSize: 52, marginBottom: 10 }}>📁</div>
                <h2 style={{ fontSize: 22, fontWeight: 800, color: "#0F172A", marginBottom: 8 }}>
                  Documents à préparer
                </h2>
                <p style={{ fontSize: 14, color: "#64748b", maxWidth: 460, margin: "0 auto" }}>
                  Voici ce qu'il faudra joindre à votre dossier. Pas de panique — vous pourrez les
                  ajouter depuis votre espace après le dépôt.
                </p>
              </div>

              {classification?.pieces_requises && classification.pieces_requises.length > 0 ? (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                    marginBottom: 20,
                  }}
                >
                  {classification.pieces_requises.map((piece, i) => (
                    <div
                      key={i}
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: 14,
                        padding: "14px 18px",
                        background: "#F8FAFC",
                        borderRadius: 12,
                        border: "1px solid #E2E8F0",
                      }}
                    >
                      <span style={{ fontSize: 22, marginTop: 1, flexShrink: 0 }}>
                        {piece.requis ? "📄" : "📋"}
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            marginBottom: 4,
                            flexWrap: "wrap",
                          }}
                        >
                          <span
                            style={{
                              fontSize: 14,
                              fontWeight: 700,
                              color: "#0F172A",
                            }}
                          >
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
                        </div>
                        {piece.aide && (
                          <p style={{ fontSize: 12, color: "#94a3b8", margin: 0, lineHeight: 1.4 }}>
                            {piece.aide}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div
                  style={{
                    background: "#F8FAFC",
                    borderRadius: 12,
                    padding: 24,
                    marginBottom: 20,
                    textAlign: "center",
                    color: "#64748b",
                    fontSize: 14,
                  }}
                >
                  La liste des pièces sera précisée par l'instructeur après dépôt.
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
                💡 Vous n'avez pas besoin de tout préparer maintenant. Une fois votre dossier
                déposé, vous pourrez ajouter les documents depuis votre espace personnel à tout
                moment.
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
                  Voir le récapitulatif →
                </button>
              </div>
            </div>
          )}

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

              <div
                style={{
                  background: "#F0FDF4",
                  border: "1px solid #86EFAC",
                  borderRadius: 12,
                  padding: "13px 18px",
                  marginBottom: 24,
                  fontSize: 13,
                  color: "#15803D",
                  lineHeight: 1.5,
                }}
              >
                ✓ Votre dossier sera transmis à la mairie de{" "}
                <strong>{parcel?.commune ?? "votre commune"}</strong>. Vous recevrez un
                accusé de réception et pourrez suivre l'avancement en temps réel.
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
                  ← Modifier
                </button>
                <button
                  onClick={() => void submitDossier()}
                  disabled={submitting}
                  style={{
                    padding: "13px 36px",
                    background: submitting ? "#818CF8" : "#4F46E5",
                    color: "white",
                    border: "none",
                    borderRadius: 10,
                    fontSize: 15,
                    fontWeight: 700,
                    cursor: submitting ? "not-allowed" : "pointer",
                    transition: "background 0.2s",
                    letterSpacing: "0.01em",
                  }}
                >
                  {submitting ? "Dépôt en cours…" : "🚀 Déposer mon dossier"}
                </button>
              </div>
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
          }}
        >
          🔒 Vos données sont confidentielles et ne sont transmises qu'à votre mairie.
        </p>
      </div>
    </div>
  );
}
