// Étape 5 du tunnel de dépôt — Informations CERFA.
//
// Restitue les sections du CERFA 13406*16 (PCMI) de manière ludique mais
// fidèle au formulaire officiel. Chaque section s'adapte au type de dossier
// classifié (PC vs DP vs CU…) et à la nature des travaux (extension vs
// neuf vs surélévation).
//
// Toutes les questions sont facultatives — le PDF prérempli côté API reste
// modifiable par le citoyen avant signature.

import { useState } from "react";
import type { CSSProperties } from "react";
import { linkifyArticles } from "../../utils/linkifyArticles";
import { useIsMobile } from "../../hooks/useMediaQuery";

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

// ── Composant principal ────────────────────────────────────────────────────

export function Step5CerfaInfos({
  classification,
  natures,
  surface,
  cerfaData,
  setCerfa,
  inputStyle,
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
                  value={cerfaData.dateNaissance ?? ""}
                  onChange={(e) => setCerfa("dateNaissance", e.target.value)}
                  placeholder="15/06/1985"
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
          <div style={{ display: "grid", gridTemplateColumns: "80px 1fr", gap: 12, marginBottom: 12 }}>
            <input
              type="text"
              value={cerfaData.adresseDemandeurNumero ?? ""}
              onChange={(e) => setCerfa("adresseDemandeurNumero", e.target.value)}
              placeholder="N°"
              style={inputStyle}
              onFocus={onFocus}
              onBlur={onBlur}
            />
            <input
              type="text"
              value={cerfaData.adresseDemandeurVoie ?? ""}
              onChange={(e) => setCerfa("adresseDemandeurVoie", e.target.value)}
              placeholder="Rue, avenue…"
              style={inputStyle}
              onFocus={onFocus}
              onBlur={onBlur}
            />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "100px 1fr", gap: 12 }}>
            <input
              type="text"
              value={cerfaData.adresseDemandeurCodePostal ?? ""}
              onChange={(e) => setCerfa("adresseDemandeurCodePostal", e.target.value)}
              placeholder="CP"
              maxLength={5}
              style={inputStyle}
              onFocus={onFocus}
              onBlur={onBlur}
            />
            <input
              type="text"
              value={cerfaData.adresseDemandeurLocalite ?? ""}
              onChange={(e) => setCerfa("adresseDemandeurLocalite", e.target.value)}
              placeholder="Ville"
              style={inputStyle}
              onFocus={onFocus}
              onBlur={onBlur}
            />
          </div>
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

      <div
        style={{
          background: "#EFF6FF",
          border: "1px solid #BFDBFE",
          borderRadius: 12,
          padding: "13px 18px",
          marginTop: 18,
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
