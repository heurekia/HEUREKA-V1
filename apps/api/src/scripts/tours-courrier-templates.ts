// Données pures des modèles de courrier de Tours Métropole (sans accès DB),
// pour être réutilisables et testables. Le runner de seed
// (seed-courrier-templates-tours.ts) importe ces constantes.
//
// Reconstruction au format Heureka :
//   - plomberie multi-commune (IF CommuneInseeCode, INCLUDETEXT logos, bloc
//     signataire par commune) SUPPRIMÉE — gérée par commune-letterhead ;
//   - champs disponibles = variables dynamiques (<span data-variable="…">) ;
//   - champs pas encore enrichis = ZONES MANUELLES ambrées (à compléter par
//     l'agent), en attendant la brique `cerfa_data`
//     (cf. docs/courriers-tours/mapping-courriers-tours.md).

// Communes de Tours Métropole présentes dans les modèles d'origine (INSEE).
export const TOURS_METROPOLE_INSEE = [
  "37261", // Tours
  "37050", // Chambray-lès-Tours
  "37025", // Berthenay
  "37054", // Chanceaux-sur-Choisille
  "37099", // Druye
  "37152", // Mettray
  "37172", // Notre-Dame-d'Oé
  "37179", // Parçay-Meslay
  "37203", // Rochecorbon
  "37217", // Saint-Étienne-de-Chigny
  "37219", // Saint-Genouph
  "37243", // Savonnières
  "37272", // Villandry
];

// ── Helpers de composition du corps ────────────────────────────────────────
// Variable dynamique (résolue à la génération via substituteVariables).
const v = (name: string, label: string) =>
  `<span data-variable="${name}" style="background:#EEF2FF;color:#4F46E5;border-radius:3px;padding:1px 5px;font-size:0.92em;font-weight:500;">${label}</span>`;
// Zone à compléter manuellement par l'agent (donnée pas encore enrichie).
const manual = (label: string) =>
  `<span style="background:#FEF3C7;color:#B45309;border-radius:3px;padding:1px 5px;font-size:0.92em;">[${label}]</span>`;

// ── Modèle 1 : Demande de pièces manquantes ────────────────────────────────
const DEMANDE_PIECES_MANQUANTES = `
<p style="margin:0 0 2px;font-size:0.9em;color:#475569;">Références à rappeler : ${v("numero_dossier", "N° de dossier")}</p>
<p style="margin:0 0 2px;font-size:0.9em;color:#475569;">Affaire suivie par : ${v("nom_agent", "Agent instructeur")}</p>
<p style="margin:0 0 18px;font-size:0.9em;color:#475569;">Tél. : ${v("agent_tel", "Tél. agent")} — Courriel : ${v("agent_email", "Email agent")}</p>

<div style="margin:0 0 18px;padding-left:55%;">
  <p style="margin:0;">${v("demandeur_nom", "Nom du demandeur")}</p>
  <p style="margin:0;">${manual("Adresse postale du demandeur")}</p>
  <p style="margin:6px 0 0;font-style:italic;font-size:0.85em;color:#64748b;">Lettre recommandée avec A.R.</p>
</div>

<p style="margin:0 0 16px;">${v("commune", "Commune")}, le ${v("date_courrier", "Date du courrier")}</p>

<div style="margin:0 0 18px;padding:12px 14px;border:1px solid #CBD5E1;border-radius:6px;font-size:0.92em;">
  <p style="margin:0 0 3px;"><strong>Demandeur :</strong> ${v("demandeur_nom", "Nom du demandeur")}</p>
  <p style="margin:0 0 3px;"><strong>Adresse du demandeur :</strong> ${manual("Adresse postale du demandeur")}</p>
  <p style="margin:0 0 3px;"><strong>Opération :</strong> ${v("description_projet", "Nature des travaux")}</p>
  <p style="margin:0 0 3px;"><strong>Adresse des travaux :</strong> ${v("adresse_travaux", "Adresse des travaux")}</p>
  <p style="margin:0 0 3px;"><strong>Dossier N° :</strong> ${v("numero_dossier", "N° de dossier")} — <strong>Déposé le :</strong> ${v("date_depot", "Date de dépôt")}</p>
  <p style="margin:0;"><strong>Surface de plancher :</strong> ${v("surface_plancher", "Surface de plancher")}</p>
</div>

<p style="margin:0 0 12px;">${manual("Madame, Monsieur")},</p>

<p style="margin:0 0 12px;">J'ai l'honneur de vous faire connaître que votre ${v("type_dossier", "Type de dossier")} déposée le ${v("date_depot", "Date de dépôt")} a été enregistrée sous les références portées ci-dessus.</p>

<p style="margin:0 0 12px;">Le récépissé de dépôt de votre dossier indiquait qu'en cas de silence de l'Administration à la fin du délai d'instruction de droit commun, vous bénéficieriez d'une autorisation tacite. Il vous alertait également sur la possibilité que des pièces manquantes vous soient réclamées dans le mois suivant le dépôt de votre dossier.</p>

<p style="margin:0 0 12px;">À cet effet, je vous informe que pour me permettre de poursuivre l'instruction de votre dossier, il convient que vous me fassiez parvenir les pièces ou indications suivantes :</p>

<div style="margin:0 0 12px;">${v("liste_pieces_a_completer", "Liste des pièces à compléter")}</div>

<p style="margin:0 0 12px;">Dans le cas d'une demande formulée par voie électronique, ces pièces devront être déposées sur le guichet numérique des autorisations d'urbanisme en vous connectant à votre compte à l'adresse suivante : <a href="https://gnau.tours-metropole.fr/gnau/#/">https://gnau.tours-metropole.fr/gnau/#/</a>.</p>

<p style="margin:0 0 12px;">Je vous rappelle que le délai d'instruction de votre dossier commencera à courir à partir de la date de réception de la totalité des informations et pièces manquantes.</p>

<p style="margin:0 0 12px;">Vous disposez de trois mois à compter de la date de réception de cette lettre pour faire parvenir à la mairie l'intégralité des pièces et informations manquantes. Dans le cas contraire, vous serez réputé avoir renoncé à votre projet, et votre demande fera l'objet d'une décision tacite de rejet ou d'opposition selon la nature de votre demande (article R. 423-39 du Code de l'Urbanisme).</p>

<p style="margin:0 0 18px;">Je vous prie d'agréer, ${manual("Madame, Monsieur")}, l'expression de mes sincères salutations.</p>

<div style="margin-top:24px;">
  <p style="margin:0 0 2px;">Pour le Maire et par délégation,</p>
  <p style="margin:0 0 2px;">${manual("Qualité du signataire")}</p>
  <p style="margin:0;">${manual("Nom du signataire")}</p>
</div>
`.trim();

export interface TourCourrierTemplate {
  name: string;
  category: string;
  body: string;
}

export const TEMPLATES: TourCourrierTemplate[] = [
  {
    name: "Demande de pièces manquantes",
    category: "pieces_complementaires",
    body: DEMANDE_PIECES_MANQUANTES,
  },
];
