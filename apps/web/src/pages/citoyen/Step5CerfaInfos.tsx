// Étape 5 du tunnel de dépôt — Informations CERFA.
//
// Restitue les sections du CERFA 13406*16 (PCMI) de manière ludique mais
// fidèle au formulaire officiel. Chaque section s'adapte au type de dossier
// classifié (PC vs DP vs CU…) et à la nature des travaux (extension vs
// neuf vs surélévation).
//
// Toutes les questions sont facultatives — le PDF prérempli côté API reste
// modifiable par le citoyen avant signature.

import { useRef, useState } from "react";
import type { CSSProperties } from "react";
import { linkifyArticles } from "../../utils/linkifyArticles";
import { useIsMobile } from "../../hooks/useMediaQuery";

// Masque de saisie pour la date de naissance — l'utilisateur peut taper les
// chiffres « au kilomètre » (ex. « 26062026 ») et le champ insère les « / »
// automatiquement pour produire le format CERFA JJ/MM/AAAA (« 26/06/2026 »).
// On ne gère jamais de « / » final afin de ne pas bloquer les suppressions.
function formatDateNaissance(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 8);
  const parts: string[] = [];
  if (digits.length > 0) parts.push(digits.slice(0, 2));
  if (digits.length > 2) parts.push(digits.slice(2, 4));
  if (digits.length > 4) parts.push(digits.slice(4, 8));
  return parts.join("/");
}

// ── Types partagés avec le wizard parent ───────────────────────────────────

export type CerfaData = {
  qualiteDemandeur?: "particulier" | "sci" | "indivision" | "autre";
  // Civilité du demandeur personne physique (Madame / Monsieur). Réutilisée
  // dans les balises dynamiques de courrier (variable `demandeur_civilite`).
  civilite?: "madame" | "monsieur";
  dateNaissance?: string;
  communeNaissance?: string;
  deptNaissance?: string;
  paysNaissance?: string;
  societeDenomination?: string;
  societeTypeJuridique?: string;
  societeSiret?: string;
  // Représentant physique désigné de la personne morale (obligatoire) — sa
  // civilité alimente la variable de courrier `representant_nom`.
  societeRepresentantCivilite?: "madame" | "monsieur";
  societeRepresentantNom?: string;
  societeRepresentantPrenom?: string;
  // Co-demandeur (second pétitionnaire, ex. conjoint) — réutilisé dans les
  // balises de courrier `codemandeur_civilite` / `codemandeur_nom`.
  coDemandeur?: boolean;
  coDemandeurCivilite?: "madame" | "monsieur";
  coDemandeurNom?: string;
  coDemandeurPrenom?: string;
  adresseDemandeurNumero?: string;
  adresseDemandeurVoie?: string;
  adresseDemandeurLocalite?: string;
  adresseDemandeurCodePostal?: string;
  empriseSol?: string;
  hauteurProjet?: string;
  destinationActuelle?: string;
  destinationFuture?: string;
  destinationUsage?: "principale" | "secondaire";
  nbLogements?: string;
  nbPieces?: string;
  nbNiveaux?: string;
  comporteGarage?: boolean;
  comporteVeranda?: boolean;
  comportePiscine?: boolean;
  comporteAbriJardin?: boolean;
  surfaceExistanteAvant?: string;
  surfaceCreee?: string;
  surfaceSupprimee?: string;
  surelevation?: boolean;
  destinationVente?: boolean;
  destinationLocation?: boolean;
  architecteRequis?: boolean;
  architecteNom?: string;
  architectePrenom?: string;
  architecteOrdre?: string;
  architecteEmail?: string;
  architecteTelephone?: string;
  proximiteABF?: boolean;
  siteRemarquable?: boolean;
  monumentHistorique?: boolean;
  siteClasse?: boolean;
  raccordementReseaux?: boolean;
  accepteEmail?: boolean;
};

interface Classification {
  type: string;
  subtype?: string | null;
  libelle: string;
  libelle_court?: string;
}

interface Props {
  classification: Classification | null;
  natures: string[];
  surface: number;
  cerfaData: CerfaData;
  setCerfa: <K extends keyof CerfaData>(field: K, value: CerfaData[K]) => void;
  inputStyle: CSSProperties;
  // RGPD — mémorisation opt-in de l'état civil réutilisable pour les prochaines
  // demandes. Piloté par le wizard parent (persistance chiffrée côté serveur).
  rememberProfile: boolean;
  onToggleRemember: (v: boolean) => void;
  onPrev: () => void;
  onNext: () => void;
}

// ── Helpers de présentation ───────────────────────────────────────────────

const sectionStyle: CSSProperties = {
  border: "1px solid #E2E8F0",
  borderRadius: 14,
  background: "white",
  marginBottom: 14,
  overflow: "hidden",
};

const sectionHeaderStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "14px 18px",
  background: "#F8FAFC",
  cursor: "pointer",
  userSelect: "none",
};

const sectionBodyStyle: CSSProperties = {
  padding: "18px 18px 10px",
  borderTop: "1px solid #F1F5F9",
};

const labelStyle: CSSProperties = {
  fontSize: 13,
  fontWeight: 700,
  color: "#0F172A",
  display: "block",
  marginBottom: 6,
};

const labelHintStyle: CSSProperties = {
  fontWeight: 400,
  color: "#94a3b8",
  fontSize: 11,
};

const helpStyle: CSSProperties = {
  fontSize: 11.5,
  color: "#64748b",
  marginTop: 4,
  lineHeight: 1.5,
};

function Field({
  label,
  hint,
  help,
  children,
}: {
  label: string;
  hint?: string;
  help?: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={labelStyle}>
        {label} {hint && <span style={labelHintStyle}>{hint}</span>}
      </label>
      {children}
      {help && <p style={helpStyle}>{help}</p>}
    </div>
  );
}

function Toggle({
  value,
  onChange,
  label,
  help,
}: {
  value: boolean | undefined;
  onChange: (v: boolean) => void;
  label: string;
  help?: string;
}) {
  return (
    <label style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "8px 0", cursor: "pointer" }}>
      <input
        type="checkbox"
        checked={value === true}
        onChange={(e) => onChange(e.target.checked)}
        style={{ marginTop: 3, width: 16, height: 16, accentColor: "#4F46E5", cursor: "pointer" }}
      />
      <span style={{ fontSize: 13, color: "#0F172A", lineHeight: 1.5 }}>
        {label}
        {help && <span style={{ display: "block", color: "#64748b", fontSize: 11.5, marginTop: 2 }}>{help}</span>}
      </span>
    </label>
  );
}

function ChoiceGroup<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T | undefined;
  onChange: (v: T | undefined) => void;
  options: Array<{ value: T; label: string; emoji?: string }>;
}) {
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      {options.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(active ? undefined : opt.value)}
            style={{
              padding: "9px 14px",
              border: `2px solid ${active ? "#4F46E5" : "#E2E8F0"}`,
              borderRadius: 10,
              background: active ? "#EEF2FF" : "white",
              fontSize: 13,
              fontWeight: active ? 700 : 400,
              color: active ? "#4F46E5" : "#374151",
              cursor: "pointer",
              transition: "all 0.15s",
            }}
          >
            {opt.emoji && <span style={{ marginRight: 6 }}>{opt.emoji}</span>}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

interface SectionProps {
  emoji: string;
  title: string;
  subtitle?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

function Section({ emoji, title, subtitle, defaultOpen = false, children }: SectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={sectionStyle}>
      <div style={sectionHeaderStyle} onClick={() => setOpen(!open)}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 22 }}>{emoji}</span>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#0F172A" }}>{title}</div>
            {subtitle && (
              <div style={{ fontSize: 11.5, color: "#64748b", marginTop: 2 }}>{subtitle}</div>
            )}
          </div>
        </div>
        <span style={{ fontSize: 18, color: "#94a3b8" }}>{open ? "▾" : "▸"}</span>
      </div>
      {open && <div style={sectionBodyStyle}>{children}</div>}
    </div>
  );
}

// ── Autocomplétion d'adresse (Base Adresse Nationale, data.gouv.fr) ─────────
// Le citoyen saisit sa voie ; on interroge en « live » l'API Adresse publique
// (BAN) — le même référentiel que la recherche de terrain — et, au choix d'une
// suggestion, on remplit d'un coup le numéro, la voie, le code postal et la
// localité. API gratuite, sans clé, hébergée en France (cf. CSP connect-src).
type BanProperties = {
  label: string;
  housenumber?: string;
  street?: string;
  name?: string;
  postcode?: string;
  city?: string;
};

type AddressParts = {
  numero: string;
  voie: string;
  codePostal: string;
  localite: string;
};

function AddressAutocomplete({
  value,
  onType,
  onPick,
  inputStyle,
  onFocus,
  onBlur,
  placeholder,
}: {
  value: string;
  onType: (val: string) => void;
  onPick: (parts: AddressParts) => void;
  inputStyle: CSSProperties;
  onFocus: (e: React.FocusEvent<HTMLInputElement>) => void;
  onBlur: (e: React.FocusEvent<HTMLInputElement>) => void;
  placeholder: string;
}) {
  const [suggestions, setSuggestions] = useState<BanProperties[]>([]);
  const [show, setShow] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleChange = (val: string) => {
    onType(val);
    setShow(true);
    if (timer.current) clearTimeout(timer.current);
    // En deçà de 3 caractères la BAN renvoie surtout du bruit : on attend.
    if (val.trim().length < 3) { setSuggestions([]); return; }
    // Anti-rebond : on n'interroge l'API qu'après 250 ms sans frappe.
    timer.current = setTimeout(() => {
      void fetch(`https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(val)}&limit=6&autocomplete=1`)
        .then((r) => r.json())
        .then((data: { features?: Array<{ properties: BanProperties }> }) => {
          setSuggestions((data.features ?? []).map((f) => f.properties));
        })
        .catch(() => setSuggestions([]));
    }, 250);
  };

  const pick = (p: BanProperties) => {
    onPick({
      numero: p.housenumber ?? "",
      // `street` est renseigné au niveau numéro ; sinon `name` porte la voie
      // (adresses « rue » ou lieux-dits sans numéro).
      voie: p.street ?? p.name ?? "",
      codePostal: p.postcode ?? "",
      localite: p.city ?? "",
    });
    setSuggestions([]);
    setShow(false);
  };

  return (
    <div style={{ position: "relative" }}>
      <input
        type="text"
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Escape") { setSuggestions([]); setShow(false); } }}
        onFocus={(e) => { onFocus(e); setShow(true); }}
        onBlur={(e) => { onBlur(e); setTimeout(() => setShow(false), 150); }}
        placeholder={placeholder}
        style={inputStyle}
      />
      {show && suggestions.length > 0 && (
        <div style={{
          position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 200,
          background: "white", border: "1px solid #E2E8F0", borderRadius: 10,
          boxShadow: "0 8px 24px rgba(0,0,0,0.12)", overflow: "hidden",
        }}>
          {suggestions.map((s, i) => (
            <button
              key={i}
              type="button"
              // onMouseDown (avant le blur) pour que le clic ne ferme pas la liste.
              onMouseDown={(e) => { e.preventDefault(); pick(s); }}
              style={{
                display: "flex", alignItems: "center", gap: 10, width: "100%",
                padding: "11px 14px", background: "white", border: "none",
                borderBottom: i < suggestions.length - 1 ? "1px solid #F1F5F9" : "none",
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
  );
}

// ── Saisie d'adresse postale : une ligne de recherche, repli manuel ─────────
// L'adresse postale n'a qu'un champ visible — une ligne de recherche BAN — mais
// le CERFA exige le détail (n°, voie, CP, localité) en cases séparées. On
// récupère donc les quatre morceaux dans la réponse de l'API et on les stocke
// en coulisse. Trois états : recherche (vide), récapitulatif (adresse choisie,
// éditable), saisie manuelle (repli quand l'adresse n'est pas dans la BAN).
function PostalAddressInput({
  numero,
  voie,
  codePostal,
  localite,
  onChange,
  inputStyle,
  onFocus,
  onBlur,
}: {
  numero: string;
  voie: string;
  codePostal: string;
  localite: string;
  onChange: (field: keyof AddressParts, value: string) => void;
  inputStyle: CSSProperties;
  onFocus: (e: React.FocusEvent<HTMLInputElement>) => void;
  onBlur: (e: React.FocusEvent<HTMLInputElement>) => void;
}) {
  const [manual, setManual] = useState(false);
  const [query, setQuery] = useState("");
  const filled = !!(numero || voie || codePostal || localite);

  const ligne1 = [numero, voie].filter(Boolean).join(" ");
  const ligne2 = [codePostal, localite].filter(Boolean).join(" ");

  const linkBtn: CSSProperties = {
    background: "none", border: "none", padding: 0, cursor: "pointer",
    color: "#4F46E5", fontSize: 12.5, fontWeight: 600,
  };

  const clearAll = () => {
    onChange("numero", "");
    onChange("voie", "");
    onChange("codePostal", "");
    onChange("localite", "");
    setQuery("");
    setManual(false);
  };

  // ── Repli : saisie manuelle des quatre cases CERFA ──
  if (manual) {
    return (
      <div>
        <div style={{ display: "grid", gridTemplateColumns: "80px 1fr", gap: 12, marginBottom: 12 }}>
          <input
            type="text" value={numero} onChange={(e) => onChange("numero", e.target.value)}
            placeholder="N°" style={inputStyle} onFocus={onFocus} onBlur={onBlur}
          />
          <input
            type="text" value={voie} onChange={(e) => onChange("voie", e.target.value)}
            placeholder="Rue, avenue…" style={inputStyle} onFocus={onFocus} onBlur={onBlur}
          />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "100px 1fr", gap: 12 }}>
          <input
            type="text" value={codePostal} onChange={(e) => onChange("codePostal", e.target.value)}
            placeholder="CP" maxLength={5} style={inputStyle} onFocus={onFocus} onBlur={onBlur}
          />
          <input
            type="text" value={localite} onChange={(e) => onChange("localite", e.target.value)}
            placeholder="Ville" style={inputStyle} onFocus={onFocus} onBlur={onBlur}
          />
        </div>
        <button type="button" style={{ ...linkBtn, marginTop: 10 }} onClick={() => setManual(false)}>
          ← Revenir à la recherche
        </button>
      </div>
    );
  }

  // ── Récapitulatif : une adresse a été choisie ──
  if (filled) {
    return (
      <div>
        <div style={{
          display: "flex", alignItems: "center", gap: 12, padding: "12px 14px",
          background: "#F0FDF4", border: "1px solid #BBF7D0", borderRadius: 10,
        }}>
          <span style={{ fontSize: 18, flexShrink: 0 }}>📮</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#0F172A" }}>{ligne1 || "Adresse"}</div>
            {ligne2 && <div style={{ fontSize: 12, color: "#64748b", marginTop: 1 }}>{ligne2}</div>}
          </div>
          <button type="button" style={linkBtn} onClick={() => setManual(true)}>Modifier</button>
        </div>
        <button type="button" style={{ ...linkBtn, marginTop: 10, color: "#64748b" }} onClick={clearAll}>
          Chercher une autre adresse
        </button>
      </div>
    );
  }

  // ── Recherche : état initial, rien de saisi ──
  return (
    <div>
      <AddressAutocomplete
        value={query}
        onType={setQuery}
        onPick={(parts) => {
          onChange("numero", parts.numero);
          onChange("voie", parts.voie);
          onChange("codePostal", parts.codePostal);
          onChange("localite", parts.localite);
          setQuery("");
        }}
        placeholder="Rechercher votre adresse (n°, rue, ville)…"
        inputStyle={inputStyle}
        onFocus={onFocus}
        onBlur={onBlur}
      />
      <button
        type="button"
        style={{ ...linkBtn, marginTop: 10, color: "#64748b" }}
        onClick={() => {
          // L'adresse n'est pas dans la BAN (neuf, lieu-dit…) : on bascule en
          // saisie manuelle, en reprenant ce qui a déjà été tapé comme voie.
          if (query.trim()) onChange("voie", query.trim());
          setManual(true);
        }}
      >
        L'adresse n'est pas trouvée ? Saisir manuellement
      </button>
    </div>
  );
}

// ── Composant principal ────────────────────────────────────────────────────

export function Step5CerfaInfos({
  classification,
  natures,
  surface,
  cerfaData,
  setCerfa,
  inputStyle,
  rememberProfile,
  onToggleRemember,
  onPrev,
  onNext,
}: Props) {
  const isMobile = useIsMobile();
  const isPCMI = classification?.type === "permis_de_construire_mi"
    || (classification?.type === "permis_de_construire" && natures.includes("maison_neuve"));
  const isExtension = natures.includes("agrandissement");
  const isDemolition = natures.includes("demolition");
  const isChangementDest = natures.includes("changement_destination");
  const isCertificat = natures.includes("certificat");
  const isSociete = cerfaData.qualiteDemandeur && cerfaData.qualiteDemandeur !== "particulier";
  const architecteObligatoire = isPCMI && surface > 150;

  const onFocus = (e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) =>
    (e.currentTarget.style.borderColor = "#4F46E5");
  const onBlur = (e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) =>
    (e.currentTarget.style.borderColor = "#E2E8F0");

  return (
    <div>
      <div style={{ textAlign: "center", marginBottom: 24 }}>
        <div style={{ fontSize: 48, marginBottom: 8 }}>📋</div>
        <h2 style={{ fontSize: 22, fontWeight: 800, color: "#0F172A", marginBottom: 6 }}>
          On prépare votre {classification?.libelle_court ?? "CERFA"}
        </h2>
        <p style={{ fontSize: 13, color: "#64748b", maxWidth: 480, margin: "0 auto", lineHeight: 1.5 }}>
          Ces sections reprennent l'ordre du formulaire officiel. Tout est facultatif :
          ce qui est rempli ici vient automatiquement dans votre CERFA prérempli,
          le reste, vous pourrez l'ajouter au PDF.
        </p>
      </div>

      {/* ── Section 1 : Qui dépose ? ─────────────────────────────── */}
      <Section
        emoji="👤"
        title="Qui dépose la demande ?"
        subtitle="Vous, votre SCI, en indivision…"
        defaultOpen
      >
        <Field label="Vous êtes…">
          <ChoiceGroup<NonNullable<CerfaData["qualiteDemandeur"]>>
            value={cerfaData.qualiteDemandeur}
            onChange={(v) => setCerfa("qualiteDemandeur", v)}
            options={[
              { value: "particulier", label: "Un particulier", emoji: "🙋" },
              { value: "sci", label: "Une SCI / société", emoji: "🏢" },
              { value: "indivision", label: "En indivision", emoji: "👥" },
              { value: "autre", label: "Autre", emoji: "✍️" },
            ]}
          />
        </Field>

        {/* État civil — section CERFA "Identité du demandeur" */}
        {!isSociete && (
          <>
            <Field label="Civilité" help="Utilisée pour vous adresser les courriers de la mairie (« Madame », « Monsieur »).">
              <ChoiceGroup<NonNullable<CerfaData["civilite"]>>
                value={cerfaData.civilite}
                onChange={(v) => setCerfa("civilite", v)}
                options={[
                  { value: "madame", label: "Madame", emoji: "👩" },
                  { value: "monsieur", label: "Monsieur", emoji: "👨" },
                ]}
              />
            </Field>
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12 }}>
              <Field label="Date de naissance" hint="JJ/MM/AAAA">
                <input
                  type="text"
                  inputMode="numeric"
                  value={cerfaData.dateNaissance ?? ""}
                  onChange={(e) => setCerfa("dateNaissance", formatDateNaissance(e.target.value))}
                  placeholder="15/06/1985"
                  maxLength={10}
                  style={inputStyle}
                  onFocus={onFocus}
                  onBlur={onBlur}
                />
              </Field>
              <Field label="Pays de naissance">
                <input
                  type="text"
                  value={cerfaData.paysNaissance ?? "France"}
                  onChange={(e) => setCerfa("paysNaissance", e.target.value)}
                  placeholder="France"
                  style={inputStyle}
                  onFocus={onFocus}
                  onBlur={onBlur}
                />
              </Field>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "2fr 1fr", gap: 12 }}>
              <Field label="Commune de naissance">
                <input
                  type="text"
                  value={cerfaData.communeNaissance ?? ""}
                  onChange={(e) => setCerfa("communeNaissance", e.target.value)}
                  placeholder="Tours"
                  style={inputStyle}
                  onFocus={onFocus}
                  onBlur={onBlur}
                />
              </Field>
              <Field label="Département" hint="2 chiffres">
                <input
                  type="text"
                  value={cerfaData.deptNaissance ?? ""}
                  onChange={(e) => setCerfa("deptNaissance", e.target.value)}
                  placeholder="37"
                  maxLength={3}
                  style={inputStyle}
                  onFocus={onFocus}
                  onBlur={onBlur}
                />
              </Field>
            </div>
          </>
        )}

        {/* SCI / personne morale */}
        {isSociete && (
          <>
            <Field
              label="Dénomination de la société"
              help="Nom social tel qu'inscrit au RCS."
            >
              <input
                type="text"
                value={cerfaData.societeDenomination ?? ""}
                onChange={(e) => setCerfa("societeDenomination", e.target.value)}
                placeholder="SCI Les Vergers"
                style={inputStyle}
                onFocus={onFocus}
                onBlur={onBlur}
              />
            </Field>
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 2fr", gap: 12 }}>
              <Field label="Type juridique">
                <select
                  value={cerfaData.societeTypeJuridique ?? ""}
                  onChange={(e) => setCerfa("societeTypeJuridique", e.target.value)}
                  style={{ ...inputStyle, background: "white", cursor: "pointer" }}
                  onFocus={onFocus}
                  onBlur={onBlur}
                >
                  <option value="">—</option>
                  <option value="SCI">SCI</option>
                  <option value="SARL">SARL</option>
                  <option value="SAS">SAS</option>
                  <option value="SA">SA</option>
                  <option value="SCP">SCP</option>
                  <option value="Autre">Autre</option>
                </select>
              </Field>
              <Field label="SIRET" hint="14 chiffres">
                <input
                  type="text"
                  value={cerfaData.societeSiret ?? ""}
                  onChange={(e) => setCerfa("societeSiret", e.target.value)}
                  placeholder="12345678900012"
                  maxLength={14}
                  style={inputStyle}
                  onFocus={onFocus}
                  onBlur={onBlur}
                />
              </Field>
            </div>
            <Field
              label="Représentant physique désigné"
              hint="obligatoire"
              help="La personne morale agit toujours par l'intermédiaire d'une personne physique (gérant, président…) qui signe la demande et à qui les courriers sont adressés."
            >
              <div style={{ marginBottom: 12 }}>
                <ChoiceGroup<NonNullable<CerfaData["societeRepresentantCivilite"]>>
                  value={cerfaData.societeRepresentantCivilite}
                  onChange={(v) => setCerfa("societeRepresentantCivilite", v)}
                  options={[
                    { value: "madame", label: "Madame", emoji: "👩" },
                    { value: "monsieur", label: "Monsieur", emoji: "👨" },
                  ]}
                />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12 }}>
                <input
                  type="text"
                  value={cerfaData.societeRepresentantPrenom ?? ""}
                  onChange={(e) => setCerfa("societeRepresentantPrenom", e.target.value)}
                  placeholder="Prénom"
                  style={inputStyle}
                  onFocus={onFocus}
                  onBlur={onBlur}
                />
                <input
                  type="text"
                  value={cerfaData.societeRepresentantNom ?? ""}
                  onChange={(e) => setCerfa("societeRepresentantNom", e.target.value)}
                  placeholder="Nom"
                  style={inputStyle}
                  onFocus={onFocus}
                  onBlur={onBlur}
                />
              </div>
            </Field>
          </>
        )}

        {/* Co-demandeur — second pétitionnaire (ex. conjoint, indivisaire) */}
        <Field
          label="Co-demandeur"
          hint="facultatif"
          help="Si la demande est déposée à deux noms (ex. votre conjoint), ajoutez-le ici. Il sera mentionné sur les courriers de la mairie."
        >
          <Toggle
            label="➕ Ajouter un co-demandeur"
            value={cerfaData.coDemandeur}
            onChange={(v) => setCerfa("coDemandeur", v)}
          />
          {cerfaData.coDemandeur === true && (
            <div style={{ marginTop: 8 }}>
              <div style={{ marginBottom: 12 }}>
                <ChoiceGroup<NonNullable<CerfaData["coDemandeurCivilite"]>>
                  value={cerfaData.coDemandeurCivilite}
                  onChange={(v) => setCerfa("coDemandeurCivilite", v)}
                  options={[
                    { value: "madame", label: "Madame", emoji: "👩" },
                    { value: "monsieur", label: "Monsieur", emoji: "👨" },
                  ]}
                />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12 }}>
                <input
                  type="text"
                  value={cerfaData.coDemandeurPrenom ?? ""}
                  onChange={(e) => setCerfa("coDemandeurPrenom", e.target.value)}
                  placeholder="Prénom"
                  style={inputStyle}
                  onFocus={onFocus}
                  onBlur={onBlur}
                />
                <input
                  type="text"
                  value={cerfaData.coDemandeurNom ?? ""}
                  onChange={(e) => setCerfa("coDemandeurNom", e.target.value)}
                  placeholder="Nom"
                  style={inputStyle}
                  onFocus={onFocus}
                  onBlur={onBlur}
                />
              </div>
            </div>
          )}
        </Field>
      </Section>

      {/* ── Section 2 : Adresse postale (si différente du terrain) ─── */}
      <Section
        emoji="✉️"
        title="Votre adresse postale"
        subtitle="Si elle est différente de celle du terrain"
      >
        <Field
          label="Adresse"
          help="Renseignez seulement si le courrier doit arriver ailleurs que sur le terrain (ex : vous habitez encore ailleurs)."
        >
          <PostalAddressInput
            numero={cerfaData.adresseDemandeurNumero ?? ""}
            voie={cerfaData.adresseDemandeurVoie ?? ""}
            codePostal={cerfaData.adresseDemandeurCodePostal ?? ""}
            localite={cerfaData.adresseDemandeurLocalite ?? ""}
            onChange={(field, value) => {
              if (field === "numero") setCerfa("adresseDemandeurNumero", value);
              else if (field === "voie") setCerfa("adresseDemandeurVoie", value);
              else if (field === "codePostal") setCerfa("adresseDemandeurCodePostal", value);
              else setCerfa("adresseDemandeurLocalite", value);
            }}
            inputStyle={inputStyle}
            onFocus={onFocus}
            onBlur={onBlur}
          />
        </Field>
      </Section>

      {/* ── Section 3 : Caractéristiques du projet ──────────────── */}
      {!isCertificat && (
        <Section
          emoji="🏗️"
          title="Caractéristiques de votre projet"
          subtitle="Dimensions, logements, annexes"
          defaultOpen
        >
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12 }}>
            <Field label="Emprise au sol créée" hint="m²" help="Projection au sol de la construction.">
              <input
                type="number"
                value={cerfaData.empriseSol ?? ""}
                onChange={(e) => setCerfa("empriseSol", e.target.value)}
                placeholder="Ex : 95"
                style={inputStyle}
                onFocus={onFocus}
                onBlur={onBlur}
              />
            </Field>
            <Field label="Hauteur au faîtage" hint="m" help="Point le plus haut de la toiture.">
              <input
                type="number"
                step="0.1"
                value={cerfaData.hauteurProjet ?? ""}
                onChange={(e) => setCerfa("hauteurProjet", e.target.value)}
                placeholder="Ex : 6.5"
                style={inputStyle}
                onFocus={onFocus}
                onBlur={onBlur}
              />
            </Field>
          </div>

          {isPCMI && (
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr", gap: 12 }}>
              <Field label="Nombre de logements">
                <input
                  type="number"
                  min={1}
                  value={cerfaData.nbLogements ?? ""}
                  onChange={(e) => setCerfa("nbLogements", e.target.value)}
                  placeholder="1"
                  style={inputStyle}
                  onFocus={onFocus}
                  onBlur={onBlur}
                />
              </Field>
              <Field label="Nombre de pièces" help="Hors cuisine, SDB.">
                <input
                  type="number"
                  min={1}
                  value={cerfaData.nbPieces ?? ""}
                  onChange={(e) => setCerfa("nbPieces", e.target.value)}
                  placeholder="5"
                  style={inputStyle}
                  onFocus={onFocus}
                  onBlur={onBlur}
                />
              </Field>
              <Field label="Niveaux" help="Étages au-dessus du sol.">
                <input
                  type="number"
                  min={1}
                  value={cerfaData.nbNiveaux ?? ""}
                  onChange={(e) => setCerfa("nbNiveaux", e.target.value)}
                  placeholder="2"
                  style={inputStyle}
                  onFocus={onFocus}
                  onBlur={onBlur}
                />
              </Field>
            </div>
          )}

          {/* Annexes — pertinent en PCMI et DP construction */}
          {(isPCMI || natures.includes("petite_construction")) && (
            <Field label="Votre projet comprend…">
              <Toggle
                label="🚗 Un garage"
                value={cerfaData.comporteGarage}
                onChange={(v) => setCerfa("comporteGarage", v)}
              />
              <Toggle
                label="🌿 Une véranda"
                value={cerfaData.comporteVeranda}
                onChange={(v) => setCerfa("comporteVeranda", v)}
              />
              <Toggle
                label="🏊 Une piscine"
                value={cerfaData.comportePiscine}
                onChange={(v) => setCerfa("comportePiscine", v)}
              />
              <Toggle
                label="🪵 Un abri de jardin"
                value={cerfaData.comporteAbriJardin}
                onChange={(v) => setCerfa("comporteAbriJardin", v)}
              />
            </Field>
          )}
        </Section>
      )}

      {/* ── Section 4 : Travaux sur existant (extension/surélévation) ── */}
      {(isExtension || isDemolition) && (
        <Section
          emoji="📐"
          title="Travaux sur la construction existante"
          subtitle="Surfaces avant / après"
          defaultOpen
        >
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr", gap: 12 }}>
            <Field label="Surface existante" hint="m²" help="Avant les travaux.">
              <input
                type="number"
                value={cerfaData.surfaceExistanteAvant ?? ""}
                onChange={(e) => setCerfa("surfaceExistanteAvant", e.target.value)}
                placeholder="85"
                style={inputStyle}
                onFocus={onFocus}
                onBlur={onBlur}
              />
            </Field>
            <Field label="Surface créée" hint="m²" help="Construction nouvelle.">
              <input
                type="number"
                value={cerfaData.surfaceCreee ?? ""}
                onChange={(e) => setCerfa("surfaceCreee", e.target.value)}
                placeholder="35"
                style={inputStyle}
                onFocus={onFocus}
                onBlur={onBlur}
              />
            </Field>
            <Field label="Surface supprimée" hint="m²" help="Démolie ou déposée.">
              <input
                type="number"
                value={cerfaData.surfaceSupprimee ?? ""}
                onChange={(e) => setCerfa("surfaceSupprimee", e.target.value)}
                placeholder="0"
                style={inputStyle}
                onFocus={onFocus}
                onBlur={onBlur}
              />
            </Field>
          </div>
          <Toggle
            label="🏠 Mon projet comprend une surélévation"
            help="Ajout d'un niveau au-dessus de l'existant."
            value={cerfaData.surelevation}
            onChange={(v) => setCerfa("surelevation", v)}
          />
        </Section>
      )}

      {/* ── Section 5 : Changement de destination ────────────────── */}
      {isChangementDest && (
        <Section emoji="🔄" title="Changement de destination" defaultOpen>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12 }}>
            <Field label="Destination actuelle">
              <select
                value={cerfaData.destinationActuelle ?? ""}
                onChange={(e) => setCerfa("destinationActuelle", e.target.value)}
                style={{ ...inputStyle, background: "white", cursor: "pointer" }}
                onFocus={onFocus}
                onBlur={onBlur}
              >
                <option value="">—</option>
                <option value="habitation">Habitation</option>
                <option value="commerce_services">Commerce / services</option>
                <option value="bureaux">Bureaux</option>
                <option value="industrie">Industrie</option>
                <option value="exploitation_agricole">Exploitation agricole</option>
                <option value="entrepot">Entrepôt</option>
                <option value="autre">Autre</option>
              </select>
            </Field>
            <Field label="Destination future">
              <select
                value={cerfaData.destinationFuture ?? ""}
                onChange={(e) => setCerfa("destinationFuture", e.target.value)}
                style={{ ...inputStyle, background: "white", cursor: "pointer" }}
                onFocus={onFocus}
                onBlur={onBlur}
              >
                <option value="">—</option>
                <option value="habitation">Habitation</option>
                <option value="commerce_services">Commerce / services</option>
                <option value="bureaux">Bureaux</option>
                <option value="industrie">Industrie</option>
                <option value="exploitation_agricole">Exploitation agricole</option>
                <option value="entrepot">Entrepôt</option>
                <option value="autre">Autre</option>
              </select>
            </Field>
          </div>
        </Section>
      )}

      {/* ── Section 6 : Architecte (PCMI uniquement) ─────────────── */}
      {isPCMI && (
        <Section
          emoji="📐"
          title="Recours à un architecte"
          subtitle={architecteObligatoire ? "Obligatoire au-delà de 150 m²" : "Optionnel sous 150 m²"}
          defaultOpen={architecteObligatoire}
        >
          {architecteObligatoire ? (
            <div
              style={{
                background: "#FEF3C7",
                border: "1px solid #FDE68A",
                borderRadius: 10,
                padding: "10px 14px",
                marginBottom: 14,
                fontSize: 12.5,
                color: "#92400E",
                lineHeight: 1.5,
              }}
            >
              Votre projet dépasse 150 m² de surface plancher : le recours à un architecte
              est <strong>obligatoire</strong> ({linkifyArticles("art. R.431-2 CU")}).
            </div>
          ) : (
            <Toggle
              label="Je fais quand même appel à un architecte"
              help="Sinon, ne renseignez pas cette section : une déclaration sur l'honneur de dispense sera cochée pour vous."
              value={cerfaData.architecteRequis}
              onChange={(v) => setCerfa("architecteRequis", v)}
            />
          )}

          {(architecteObligatoire || cerfaData.architecteRequis === true) && (
            <>
              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12 }}>
                <Field label="Prénom">
                  <input
                    type="text"
                    value={cerfaData.architectePrenom ?? ""}
                    onChange={(e) => setCerfa("architectePrenom", e.target.value)}
                    style={inputStyle}
                    onFocus={onFocus}
                    onBlur={onBlur}
                  />
                </Field>
                <Field label="Nom">
                  <input
                    type="text"
                    value={cerfaData.architecteNom ?? ""}
                    onChange={(e) => setCerfa("architecteNom", e.target.value)}
                    style={inputStyle}
                    onFocus={onFocus}
                    onBlur={onBlur}
                  />
                </Field>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12 }}>
                <Field label="N° d'inscription à l'Ordre" hint="6 chiffres">
                  <input
                    type="text"
                    value={cerfaData.architecteOrdre ?? ""}
                    onChange={(e) => setCerfa("architecteOrdre", e.target.value)}
                    placeholder="123456"
                    style={inputStyle}
                    onFocus={onFocus}
                    onBlur={onBlur}
                  />
                </Field>
                <Field label="Téléphone">
                  <input
                    type="tel"
                    value={cerfaData.architecteTelephone ?? ""}
                    onChange={(e) => setCerfa("architecteTelephone", e.target.value)}
                    style={inputStyle}
                    onFocus={onFocus}
                    onBlur={onBlur}
                  />
                </Field>
              </div>
              <Field label="Email">
                <input
                  type="email"
                  value={cerfaData.architecteEmail ?? ""}
                  onChange={(e) => setCerfa("architecteEmail", e.target.value)}
                  style={inputStyle}
                  onFocus={onFocus}
                  onBlur={onBlur}
                />
              </Field>
            </>
          )}
        </Section>
      )}

      {/* ── Section 7 : Usage projeté ─────────────────────────────── */}
      {(isPCMI || isExtension) && (
        <Section emoji="🏠" title="Usage du futur logement" subtitle="Résidence, vente, location">
          <Field label="Ce logement sera votre…">
            <ChoiceGroup<NonNullable<CerfaData["destinationUsage"]>>
              value={cerfaData.destinationUsage}
              onChange={(v) => setCerfa("destinationUsage", v)}
              options={[
                { value: "principale", label: "Résidence principale", emoji: "🏡" },
                { value: "secondaire", label: "Résidence secondaire", emoji: "🌴" },
              ]}
            />
          </Field>
          <Field label="Vous prévoyez aussi…">
            <Toggle
              label="De le vendre"
              value={cerfaData.destinationVente}
              onChange={(v) => setCerfa("destinationVente", v)}
            />
            <Toggle
              label="De le louer"
              value={cerfaData.destinationLocation}
              onChange={(v) => setCerfa("destinationLocation", v)}
            />
          </Field>
        </Section>
      )}

      {/* ── Section 8 : Situations particulières ────────────────── */}
      <Section
        emoji="⚠️"
        title="Cas particuliers"
        subtitle="Site protégé, raccordements"
      >
        <Toggle
          label="🏛️ Mon terrain est à moins de 500 m d'un monument historique"
          help="Si oui, l'Architecte des Bâtiments de France émettra un avis sur votre projet."
          value={cerfaData.proximiteABF}
          onChange={(v) => setCerfa("proximiteABF", v)}
        />
        <Toggle
          label="🌳 Le projet est dans un site remarquable ou en covisibilité"
          value={cerfaData.siteRemarquable}
          onChange={(v) => setCerfa("siteRemarquable", v)}
        />
        <Toggle
          label="🛡️ Le terrain est dans un site classé"
          value={cerfaData.siteClasse}
          onChange={(v) => setCerfa("siteClasse", v)}
        />
        <Toggle
          label="🏰 Le terrain comprend un monument historique"
          value={cerfaData.monumentHistorique}
          onChange={(v) => setCerfa("monumentHistorique", v)}
        />
        <Toggle
          label="🔌 Le terrain a besoin de raccordements aux réseaux (eau, électricité…)"
          value={cerfaData.raccordementReseaux}
          onChange={(v) => setCerfa("raccordementReseaux", v)}
        />
      </Section>

      {/* ── Section 9 : Notifications numériques ────────────────── */}
      <Section emoji="📮" title="Comment souhaitez-vous être notifié(e) ?">
        <Toggle
          label="J'accepte de recevoir les notifications de la mairie par email"
          help="Sinon, les courriers vous seront envoyés par voie postale (et les délais d'instruction continuent de courir à compter de la réception postale)."
          value={cerfaData.accepteEmail}
          onChange={(v) => setCerfa("accepteEmail", v)}
        />
      </Section>

      {/* ── Mémorisation RGPD (opt-in) ──────────────────────────── */}
      <div
        style={{
          background: "#F5F3FF",
          border: "1px solid #DDD6FE",
          borderRadius: 12,
          padding: "14px 18px",
          marginTop: 18,
          marginBottom: 14,
        }}
      >
        <Toggle
          label="Mémoriser ces informations pour mes prochaines demandes"
          help="Pré-remplit votre état civil (civilité, date et lieu de naissance, qualité, adresse postale) lors de vos futurs dépôts. Ces données sont conservées chiffrées et liées à votre seul compte ; les informations propres au projet (surfaces, hauteur, parcelle…) ne sont jamais mémorisées. Vous pouvez retirer ce consentement à tout moment depuis « Mon profil » ou en décochant cette case."
          value={rememberProfile}
          onChange={onToggleRemember}
        />
      </div>

      <div
        style={{
          background: "#EFF6FF",
          border: "1px solid #BFDBFE",
          borderRadius: 12,
          padding: "13px 18px",
          marginTop: 4,
          marginBottom: 22,
          fontSize: 12.5,
          color: "#1E40AF",
          lineHeight: 1.55,
        }}
      >
        💡 Tout ce que vous renseignez ici sera reporté dans votre CERFA prérempli,
        que vous trouverez dans vos pièces à l'étape suivante. Le PDF reste modifiable
        avant signature.
      </div>

      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <button
          onClick={onPrev}
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
          onClick={onNext}
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
      </div>
    </div>
  );
}
