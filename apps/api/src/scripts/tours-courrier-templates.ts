// Données pures des modèles de courrier de Tours Métropole (sans accès DB),
// réutilisables et testables. Le runner (seed-courrier-templates-tours.ts) les
// importe.
//
// Reconstruction au format Heureka :
//   - plomberie multi-commune (IF CommuneInseeCode, INCLUDETEXT logos, bloc
//     signataire par commune) SUPPRIMÉE — gérée par commune-letterhead ;
//   - en-tête/signature/tampon gérés par la commune et le signataire désigné ;
//   - champs disponibles = variables dynamiques (<span data-variable="…">) ;
//   - champs pas encore enrichis (adresse/civilité demandeur, prescriptions,
//     dispositions d'urbanisme…) = ZONES MANUELLES ambrées à compléter par
//     l'agent (cf. docs/courriers-tours/mapping-courriers-tours.md) ;
//   - variantes par type de dossier neutralisées en formulation valable pour
//     tous ; volets « taxes »/« ABF » traités en modèles séparés.

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

// ── Helpers de composition ─────────────────────────────────────────────────
// Variable dynamique (résolue à la génération via substituteVariables).
const v = (name: string, label: string) =>
  `<span data-variable="${name}" style="background:#EEF2FF;color:#4F46E5;border-radius:3px;padding:1px 5px;font-size:0.92em;font-weight:500;">${label}</span>`;
// Zone à compléter manuellement par l'agent (donnée pas encore enrichie).
const manual = (label: string) =>
  `<span style="background:#FEF3C7;color:#B45309;border-radius:3px;padding:1px 5px;font-size:0.92em;">[${label}]</span>`;

// En-tête « références » des lettres (pièces, majoration).
const enteteReferences = `
<p style="margin:0 0 2px;font-size:0.9em;color:#475569;">Références à rappeler : ${v("numero_dossier", "N° de dossier")}</p>
<p style="margin:0 0 2px;font-size:0.9em;color:#475569;">Affaire suivie par : ${v("nom_agent", "Agent instructeur")}</p>
<p style="margin:0 0 18px;font-size:0.9em;color:#475569;">Tél. : ${v("agent_tel", "Tél. agent")} — Courriel : ${v("agent_email", "Email agent")}</p>`;

// Bloc destinataire (fenêtre enveloppe).
const blocDestinataire = `
<div style="margin:0 0 18px;padding-left:55%;">
  <p style="margin:0;">${v("demandeur_nom", "Nom du demandeur")}</p>
  <p style="margin:0;">${manual("Adresse postale du demandeur")}</p>
  <p style="margin:6px 0 0;font-style:italic;font-size:0.85em;color:#64748b;">Lettre recommandée avec A.R.</p>
</div>`;

// Cartouche d'identification du dossier (demandeur + projet + terrain).
const cartoucheDossier = `
<div style="margin:0 0 18px;padding:12px 14px;border:1px solid #CBD5E1;border-radius:6px;font-size:0.92em;">
  <p style="margin:0 0 3px;"><strong>Demandeur :</strong> ${v("demandeur_nom", "Nom du demandeur")}</p>
  <p style="margin:0 0 3px;"><strong>Adresse du demandeur :</strong> ${manual("Adresse postale du demandeur")}</p>
  <p style="margin:0 0 3px;"><strong>Opération :</strong> ${v("description_projet", "Nature des travaux")}</p>
  <p style="margin:0 0 3px;"><strong>Adresse des travaux :</strong> ${v("adresse_travaux", "Adresse des travaux")}</p>
  <p style="margin:0 0 3px;"><strong>Références cadastrales :</strong> ${v("parcelle", "Références cadastrales")}</p>
  <p style="margin:0 0 3px;"><strong>Dossier N° :</strong> ${v("numero_dossier", "N° de dossier")} — <strong>Déposé le :</strong> ${v("date_depot", "Date de dépôt")}</p>
  <p style="margin:0;"><strong>Surface de plancher :</strong> ${v("surface_plancher", "Surface de plancher")}</p>
</div>`;

// Bloc signature (signataire désigné de la commune).
const signatureBloc = `
<div style="margin-top:24px;">
  <p style="margin:0 0 2px;">Pour le Maire et par délégation,</p>
  <p style="margin:0 0 2px;">${v("signataire_fonction", "Fonction du signataire")}</p>
  <p style="margin:0;">${v("signataire_nom", "Nom du signataire")}</p>
</div>`;

// Annexe « informations à lire » des décisions favorables (PC / DP).
const infosDecision = `
<div style="margin-top:22px;padding-top:14px;border-top:1px solid #CBD5E1;font-size:0.88em;color:#334155;">
  <p style="margin:0 0 8px;font-weight:700;">Informations à lire attentivement</p>
  <p style="margin:0 0 8px;"><strong>Caractère exécutoire :</strong> conformément à l'article L.424-7 du Code de l'urbanisme, la présente décision est exécutoire à compter de sa notification au bénéficiaire et de sa transmission au préfet.</p>
  <p style="margin:0 0 8px;"><strong>Conformité des travaux (DAACT) :</strong> préalablement au dépôt de la Déclaration Attestant l'Achèvement et la Conformité des Travaux, le bénéficiaire s'assure de la parfaite mise en œuvre des prescriptions et du respect des pièces annexées. Les travaux exécutés sans autorisation ou non conformes constituent un délit (articles L.480-1 à L.480-4 et L.610-1 du Code de l'urbanisme).</p>
  <p style="margin:0 0 8px;"><strong>Durée de validité :</strong> la décision est périmée si les travaux ne sont pas entrepris dans un délai de trois ans à compter de sa notification, ou s'ils sont interrompus pendant plus d'une année (article R.424-17 du Code de l'urbanisme). Elle peut être prorogée sur demande présentée deux mois au moins avant son expiration.</p>
  <p style="margin:0 0 8px;"><strong>Délais et voies de recours :</strong> la décision peut faire l'objet d'un recours gracieux ou hiérarchique dans un délai d'un mois, et/ou d'un recours contentieux devant le tribunal administratif dans un délai de deux mois à compter du premier jour d'une période continue de deux mois d'affichage sur le terrain (article R.600-2 du Code de l'urbanisme). À peine d'irrecevabilité, l'auteur du recours notifie copie de celui-ci à l'auteur de la décision et au bénéficiaire dans les quinze jours francs (article R.600-1 du Code de l'urbanisme).</p>
  <p style="margin:0 0 8px;"><strong>Affichage :</strong> la décision doit être affichée sur le terrain de façon visible de la voie publique pendant toute la durée du chantier, sur un panneau conforme aux articles A.424-15 à A.424-19 du Code de l'urbanisme.</p>
  <p style="margin:0 0 8px;"><strong>Droit des tiers :</strong> la présente décision est délivrée sous réserve du droit des tiers (article A.424-8 du Code de l'urbanisme).</p>
  <p style="margin:0;"><strong>Assurance dommages-ouvrage :</strong> lorsque le projet porte sur des constructions, le bénéficiaire a l'obligation de souscrire l'assurance prévue à l'article L.242-1 du code des assurances.</p>
</div>`;

// Annexe « informations » de la majoration de délai.
const infosMajoration = `
<div style="margin-top:22px;padding-top:14px;border-top:1px solid #CBD5E1;font-size:0.88em;color:#334155;">
  <p style="margin:0 0 8px;font-weight:700;">Informations</p>
  <p style="margin:0 0 8px;">Par ailleurs, conformément aux articles R.424-3 et R.424-4 du Code de l'urbanisme, en cas d'avis défavorable ou d'avis favorable assorti de prescriptions de l'Architecte des Bâtiments de France, vous ne pourrez pas vous prévaloir d'un permis tacite (une copie de l'avis vous sera alors transmise par l'Architecte des Bâtiments de France).</p>
  <p style="margin:0;">Si, à l'issue du délai d'instruction, vous n'avez pas reçu de réponse de l'administration, ce silence équivaudra à un refus susceptible de recours dans les conditions de droit commun (recours gracieux dans un délai d'un mois, recours contentieux devant le tribunal administratif dans un délai de deux mois).</p>
</div>`;

// Salutation / civilité (en attente d'enrichissement cerfa_data).
const salutation = `${manual("Madame, Monsieur")},`;

// ── Corps des modèles ──────────────────────────────────────────────────────

// 1) Demande de pièces manquantes
const DEMANDE_PIECES = `
${enteteReferences}
${blocDestinataire}
<p style="margin:0 0 16px;">${v("commune", "Commune")}, le ${v("date_courrier", "Date du courrier")}</p>
${cartoucheDossier}
<p style="margin:0 0 12px;">${salutation}</p>
<p style="margin:0 0 12px;">J'ai l'honneur de vous faire connaître que votre ${v("type_dossier", "Type de dossier")} déposée le ${v("date_depot", "Date de dépôt")} a été enregistrée sous les références portées ci-dessus.</p>
<p style="margin:0 0 12px;">Le récépissé de dépôt de votre dossier indiquait qu'en cas de silence de l'Administration à la fin du délai d'instruction de droit commun, vous bénéficieriez d'une autorisation tacite. Il vous alertait également sur la possibilité que des pièces manquantes vous soient réclamées dans le mois suivant le dépôt de votre dossier.</p>
<p style="margin:0 0 12px;">À cet effet, je vous informe que pour me permettre de poursuivre l'instruction de votre dossier, il convient que vous me fassiez parvenir les pièces ou indications suivantes :</p>
<div style="margin:0 0 12px;">${v("liste_pieces_a_completer", "Liste des pièces à compléter")}</div>
<p style="margin:0 0 12px;">Dans le cas d'une demande formulée par voie électronique, ces pièces devront être déposées sur le guichet numérique des autorisations d'urbanisme : <a href="https://gnau.tours-metropole.fr/gnau/#/">https://gnau.tours-metropole.fr/gnau/#/</a>.</p>
<p style="margin:0 0 12px;">Je vous rappelle que le délai d'instruction de votre dossier commencera à courir à partir de la date de réception de la totalité des informations et pièces manquantes.</p>
<p style="margin:0 0 12px;">Vous disposez de trois mois à compter de la date de réception de cette lettre pour faire parvenir à la mairie l'intégralité des pièces et informations manquantes. À défaut, vous serez réputé avoir renoncé à votre projet et votre demande fera l'objet d'une décision tacite de rejet ou d'opposition selon sa nature (article R.423-39 du Code de l'urbanisme).</p>
<p style="margin:0 0 18px;">Je vous prie d'agréer, ${manual("Madame, Monsieur")}, l'expression de mes sincères salutations.</p>
${signatureBloc}
`.trim();

// Fabrique d'une lettre de majoration de délai (motif variable).
const majorationBody = (motifHtml: string) => `
${enteteReferences}
${blocDestinataire}
<p style="margin:0 0 12px;text-align:center;font-weight:700;letter-spacing:0.04em;">MAJORATION DU DÉLAI D'INSTRUCTION</p>
<p style="margin:0 0 16px;">${v("commune", "Commune")}, le ${v("date_courrier", "Date du courrier")}</p>
${cartoucheDossier}
<p style="margin:0 0 12px;">${salutation}</p>
<p style="margin:0 0 12px;">J'ai l'honneur de vous faire connaître que votre ${v("type_dossier", "Type de dossier")} déposée le ${v("date_depot", "Date de dépôt")} a été enregistrée sous les références portées ci-dessus.</p>
<p style="margin:0 0 12px;">Lors de ce dépôt, le récépissé de votre dossier indiquait qu'en cas de silence de l'Administration à la fin du délai d'instruction de droit commun, vous bénéficieriez d'une autorisation tacite, et que ce délai pouvait être modifié dans les conditions fixées par le Code de l'urbanisme.</p>
<p style="margin:0 0 12px;">${motifHtml}</p>
<p style="margin:0 0 12px;">Sauf avis contraire de ma part, la date limite d'instruction de votre dossier est portée au ${v("date_limite_instruction", "Date limite d'instruction")}.</p>
<p style="margin:0 0 18px;">Je vous prie d'agréer, ${manual("Madame, Monsieur")}, l'expression de mes sincères salutations.</p>
${signatureBloc}
${infosMajoration}
`.trim();

const MOTIF_PPMH = `À cet effet, je vous informe que votre projet étant situé dans les abords des monuments historiques, le délai d'instruction de droit commun de votre dossier doit être majoré d'UN MOIS, en application de l'article R.423-24 c du Code de l'urbanisme.`;
const MOTIF_PSMV = `À cet effet, je vous informe que votre projet étant situé dans le périmètre du Site Patrimonial Remarquable (ex Secteur Sauvegardé) de la Ville de Tours, le délai d'instruction de droit commun de votre dossier doit être majoré d'UN MOIS, en application de l'article R.423-24 c du Code de l'urbanisme.`;
const MOTIF_PPMH_ERP = `À cet effet, je vous informe que votre projet étant situé dans les abords des monuments historiques et portant sur des travaux relatifs à un établissement recevant du public soumis à l'autorisation prévue à l'article L.122-3 du Code de la construction et de l'habitation, le délai d'instruction doit être porté à CINQ MOIS en application de l'article R.423-28-b du Code de l'urbanisme.`;
const MOTIF_PSMV_ERP = `À cet effet, je vous informe que votre projet étant situé dans le périmètre du Site Patrimonial Remarquable (ex Secteur Sauvegardé) de la Ville de Tours et portant sur des travaux relatifs à un établissement recevant du public soumis à l'autorisation prévue à l'article L.122-3 du Code de la construction et de l'habitation, le délai d'instruction doit être porté à CINQ MOIS en application de l'article R.423-28-b du Code de l'urbanisme.`;

// Fabrique « pièces manquantes + majoration de délai » (combine les deux).
const piecesEtMajorationBody = (motifHtml: string) => `
${enteteReferences}
${blocDestinataire}
<p style="margin:0 0 12px;text-align:center;font-weight:700;letter-spacing:0.04em;">DEMANDE DE PIÈCES MANQUANTES ET MAJORATION DU DÉLAI</p>
<p style="margin:0 0 16px;">${v("commune", "Commune")}, le ${v("date_courrier", "Date du courrier")}</p>
${cartoucheDossier}
<p style="margin:0 0 12px;">${salutation}</p>
<p style="margin:0 0 12px;">J'ai l'honneur de vous faire connaître que votre ${v("type_dossier", "Type de dossier")} déposée le ${v("date_depot", "Date de dépôt")} a été enregistrée sous les références portées ci-dessus.</p>
<p style="margin:0 0 12px;">Pour me permettre de poursuivre l'instruction de votre dossier, il convient que vous me fassiez parvenir les pièces ou indications suivantes :</p>
<div style="margin:0 0 12px;">${v("liste_pieces_a_completer", "Liste des pièces à compléter")}</div>
<p style="margin:0 0 12px;">Ces pièces devront être déposées sur le guichet numérique des autorisations d'urbanisme : <a href="https://gnau.tours-metropole.fr/gnau/#/">https://gnau.tours-metropole.fr/gnau/#/</a>. Le délai d'instruction commencera à courir à compter de la réception de l'intégralité des pièces manquantes ; à défaut de production dans les trois mois, votre demande fera l'objet d'une décision tacite de rejet ou d'opposition (article R.423-39 du Code de l'urbanisme).</p>
<p style="margin:0 0 12px;">${motifHtml}</p>
<p style="margin:0 0 12px;">Sauf avis contraire de ma part, la date limite d'instruction de votre dossier est portée au ${v("date_limite_instruction", "Date limite d'instruction")}.</p>
<p style="margin:0 0 18px;">Je vous prie d'agréer, ${manual("Madame, Monsieur")}, l'expression de mes sincères salutations.</p>
${signatureBloc}
${infosMajoration}
`.trim();

const MOTIF_ERP_SEUL = `À cet effet, je vous informe que votre projet portant sur des travaux relatifs à un établissement recevant du public soumis à l'autorisation prévue à l'article L.122-3 du Code de la construction et de l'habitation, le délai d'instruction doit être porté à CINQ MOIS en application de l'article R.423-28-b du Code de l'urbanisme.`;

// Cadres d'identification pour les arrêtés (CADRE 1 / CADRE 2).
const cadresDecision = `
<p style="margin:0 0 4px;font-weight:700;font-size:0.85em;color:#64748b;">CADRE 1</p>
<div style="margin:0 0 12px;font-size:0.92em;">
  <p style="margin:0 0 3px;"><strong>Nom du demandeur :</strong> ${v("demandeur_nom", "Nom du demandeur")}</p>
  <p style="margin:0 0 3px;"><strong>Adresse du demandeur :</strong> ${manual("Adresse postale du demandeur")}</p>
  <p style="margin:0 0 3px;"><strong>Opération :</strong> ${v("description_projet", "Nature des travaux")}</p>
  <p style="margin:0;"><strong>Adresse des travaux :</strong> ${v("adresse_travaux", "Adresse des travaux")}</p>
</div>
<p style="margin:0 0 4px;font-weight:700;font-size:0.85em;color:#64748b;">CADRE 2</p>
<div style="margin:0 0 16px;font-size:0.92em;">
  <p style="margin:0 0 3px;"><strong>Dossier N° :</strong> ${v("numero_dossier", "N° de dossier")} — <strong>Déposé le :</strong> ${v("date_depot", "Date de dépôt")}</p>
  <p style="margin:0 0 3px;"><strong>Références cadastrales :</strong> ${v("parcelle", "Références cadastrales")}</p>
  <p style="margin:0;"><strong>Surface de plancher :</strong> ${v("surface_plancher", "Surface de plancher")}</p>
</div>`;

// PC favorable
const PC_FAVORABLE = `
<p style="margin:0 0 2px;text-align:center;font-weight:700;letter-spacing:0.04em;">PERMIS DE CONSTRUIRE</p>
<p style="margin:0 0 16px;text-align:center;font-size:0.9em;">DÉLIVRÉ PAR LE MAIRE AU NOM DE LA COMMUNE</p>
${cadresDecision}
<p style="margin:0 0 12px;">LE MAIRE,</p>
<p style="margin:0 0 4px;">Vu la demande de permis de construire susvisée (cadre 1) ;</p>
<p style="margin:0 0 4px;">Vu le Code de l'urbanisme, notamment ses articles L.421-1 et suivants, R.421-1 et suivants ;</p>
<p style="margin:0 0 12px;">Vu ${manual("Dispositions d'urbanisme applicables (zone PLU, servitudes…)")} ;</p>
<p style="margin:0 0 10px;font-weight:700;">ARRÊTE :</p>
<p style="margin:0 0 12px;"><strong>Article 1 :</strong> Le permis de construire est ACCORDÉ pour le projet susvisé (cadres 1 et 2) sous réserve du respect de la (des) prescription(s) suivante(s) :</p>
<p style="margin:0 0 16px;">${manual("Prescriptions éventuelles (sinon : néant)")}</p>
${signatureBloc}
${infosDecision}
`.trim();

// DP non-opposition
const DP_NON_OPPOSITION = `
<p style="margin:0 0 2px;text-align:center;font-weight:700;letter-spacing:0.04em;">DÉCLARATION PRÉALABLE — DÉCISION DE NON-OPPOSITION</p>
<p style="margin:0 0 16px;text-align:center;font-size:0.9em;">DÉLIVRÉE PAR LE MAIRE AU NOM DE LA COMMUNE</p>
${cadresDecision}
<p style="margin:0 0 12px;">LE MAIRE,</p>
<p style="margin:0 0 4px;">Vu la déclaration préalable susvisée (cadre 1) ;</p>
<p style="margin:0 0 4px;">Vu le Code de l'urbanisme, notamment ses articles L.421-1 et suivants, R.421-1 et suivants ;</p>
<p style="margin:0 0 12px;">Vu ${manual("Dispositions d'urbanisme applicables (zone PLU, servitudes…)")} ;</p>
<p style="margin:0 0 10px;font-weight:700;">ARRÊTE :</p>
<p style="margin:0 0 12px;"><strong>Article 1 :</strong> Il n'est pas fait opposition à la déclaration préalable pour le projet susvisé (cadres 1 et 2) sous réserve du respect de la (des) prescription(s) suivante(s) :</p>
<p style="margin:0 0 16px;">${manual("Prescriptions éventuelles (sinon : néant)")}</p>
${signatureBloc}
${infosDecision}
`.trim();

// Volet « taxes » ajouté aux décisions favorables.
const voletTaxes = `
<div style="margin-top:18px;padding-top:14px;border-top:1px solid #CBD5E1;font-size:0.9em;">
  <p style="margin:0 0 8px;font-weight:700;">Taxes et participations</p>
  <p style="margin:0 0 8px;">Les impositions suivantes seront assises et liquidées après la délivrance effective ou tacite de l'autorisation :</p>
  <p style="margin:0 0 4px;">— la Taxe d'Aménagement (part communale et part départementale) ;</p>
  <p style="margin:0 0 4px;">— la Redevance d'Archéologie Préventive ;</p>
  <p style="margin:0 0 8px;">— le cas échéant, la participation pour le financement de l'assainissement collectif (loi n° 2012-354 du 14 mars 2012).</p>
  <p style="margin:0;">${manual("Secteur de taux majoré de taxe d'aménagement, le cas échéant")}</p>
  <p style="margin:8px 0 0;">La détermination de l'assiette de ces impositions sera fixée ultérieurement par les services de l'État chargés du calcul et du recouvrement des taxes d'urbanisme dans le département.</p>
</div>`;

// PC refus
const PC_REFUS = `
<p style="margin:0 0 2px;text-align:center;font-weight:700;letter-spacing:0.04em;">PERMIS DE CONSTRUIRE — REFUS</p>
<p style="margin:0 0 16px;text-align:center;font-size:0.9em;">DÉLIVRÉ PAR LE MAIRE AU NOM DE LA COMMUNE</p>
${cadresDecision}
<p style="margin:0 0 12px;">LE MAIRE,</p>
<p style="margin:0 0 4px;">Vu la demande de permis de construire susvisée (cadres 1 et 2) ;</p>
<p style="margin:0 0 4px;">Vu le Code de l'urbanisme, notamment ses articles L.421-1 et suivants, R.421-1 et suivants ;</p>
<p style="margin:0 0 12px;">Vu ${manual("Dispositions d'urbanisme applicables (zone PLU, servitudes…)")} ;</p>
<p style="margin:0 0 12px;"><strong>CONSIDÉRANT que :</strong> ${manual("Motifs de refus (conformité, ABF, sécurité…)")}</p>
<p style="margin:0 0 12px;">En conséquence, le projet n'étant pas conforme aux dispositions d'urbanisme en vigueur,</p>
<p style="margin:0 0 10px;font-weight:700;">ARRÊTE :</p>
<p style="margin:0 0 16px;"><strong>Article unique :</strong> Le permis de construire est REFUSÉ pour le projet décrit dans la demande susvisée.</p>
${signatureBloc}
<div style="margin-top:22px;padding-top:14px;border-top:1px solid #CBD5E1;font-size:0.88em;color:#334155;">
  <p style="margin:0 0 8px;font-weight:700;">Délais et voies de recours</p>
  <p style="margin:0 0 8px;">La présente décision est transmise au préfet dans les conditions prévues à l'article R.424-12 du Code de l'urbanisme.</p>
  <p style="margin:0 0 8px;">Si vous entendez contester cette décision, vous pouvez saisir le tribunal administratif compétent d'un recours contentieux dans un délai de deux mois à compter de sa notification. Vous pouvez également saisir le Maire d'un recours gracieux dans un délai d'un mois ; cette démarche ne prolonge pas le délai du recours contentieux, qui doit alors être introduit dans les deux mois suivant la réponse (le silence gardé pendant deux mois valant rejet implicite).</p>
  <p style="margin:0;">En cas de refus fondé sur une opposition de l'Architecte des Bâtiments de France, le demandeur peut, dans le délai de deux mois à compter de la notification, saisir le préfet de région d'un recours (article L.313-2 ou L.621-31 du Code du patrimoine), par lettre recommandée avec demande d'avis de réception.</p>
</div>
`.trim();

// CU informatif (CUa)
const CU_SIMPLE = `
<p style="margin:0 0 2px;text-align:center;font-weight:700;letter-spacing:0.04em;">CERTIFICAT D'URBANISME DE SIMPLE INFORMATION</p>
<p style="margin:0 0 16px;text-align:center;font-size:0.9em;">DÉLIVRÉ PAR LE MAIRE AU NOM DE LA COMMUNE</p>
<div style="margin:0 0 16px;padding:12px 14px;border:1px solid #CBD5E1;border-radius:6px;font-size:0.92em;">
  <p style="margin:0 0 3px;"><strong>Nom du demandeur :</strong> ${v("demandeur_nom", "Nom du demandeur")}</p>
  <p style="margin:0 0 3px;"><strong>Adresse du demandeur :</strong> ${manual("Adresse postale du demandeur")}</p>
  <p style="margin:0 0 3px;"><strong>Dossier N° :</strong> ${v("numero_dossier", "N° de dossier")} — <strong>Déposé le :</strong> ${v("date_depot", "Date de dépôt")}</p>
  <p style="margin:0 0 3px;"><strong>Adresse du terrain :</strong> ${v("adresse_travaux", "Adresse des travaux")}</p>
  <p style="margin:0 0 3px;"><strong>Références cadastrales :</strong> ${v("parcelle", "Références cadastrales")}</p>
  <p style="margin:0;"><strong>Surface du terrain déclarée :</strong> ${manual("Surface du terrain")}</p>
</div>
<p style="margin:0 0 8px;">Le Maire de ${v("commune", "Commune")},</p>
<p style="margin:0 0 4px;">Vu le Code de l'urbanisme, notamment ses articles L.410-1, R.410-1 et suivants ;</p>
<p style="margin:0 0 4px;">Vu la demande de certificat d'urbanisme susvisée ;</p>
<p style="margin:0 0 12px;">Considérant que le certificat d'urbanisme est demandé en application de l'article L.410-1-a du Code de l'urbanisme,</p>
<p style="margin:0 0 10px;font-weight:700;">CERTIFIE :</p>
<p style="margin:0 0 10px;"><strong>Article 1 — Règlement d'urbanisme :</strong> le terrain est soumis aux dispositions du règlement suivant : ${manual("Document d'urbanisme et zone applicable (PLU/PLUi)")}.</p>
<p style="margin:0 0 10px;"><strong>Article 2 — Droit de préemption :</strong> ${manual("Situation au regard du droit de préemption urbain")}.</p>
<p style="margin:0 0 10px;"><strong>Article 3 — Servitudes d'utilité publique :</strong> ${manual("Servitudes éventuelles")}.</p>
<p style="margin:0 0 10px;"><strong>Article 4 — Taxes et participations :</strong> Taxe d'Aménagement (part communale et départementale), Redevance d'Archéologie Préventive, et le cas échéant participations d'urbanisme, exigibles après délivrance effective ou tacite d'une autorisation.</p>
<p style="margin:0 0 16px;"><strong>Article 5 — Observations :</strong> tout projet de construction, de modification, de changement de destination ou d'aménagement devra faire l'objet d'une autorisation préalable et respecter le règlement applicable. ${manual("Observations particulières éventuelles")}</p>
<p style="margin:0 0 12px;font-size:0.9em;color:#475569;">Le présent certificat a une durée de validité de dix-huit mois à compter de sa délivrance (article L.410-1 du Code de l'urbanisme).</p>
${signatureBloc}
`.trim();

export interface TourCourrierTemplate {
  name: string;
  category: string;
  body: string;
}

export const TEMPLATES: TourCourrierTemplate[] = [
  // ── Pièces complémentaires ──
  { name: "Demande de pièces manquantes", category: "pieces_complementaires", body: DEMANDE_PIECES },
  { name: "Pièces manquantes et majoration de délai — abords Monument Historique", category: "pieces_complementaires", body: piecesEtMajorationBody(MOTIF_PPMH) },
  { name: "Pièces manquantes et majoration de délai — Site Patrimonial Remarquable", category: "pieces_complementaires", body: piecesEtMajorationBody(MOTIF_PSMV) },
  { name: "Pièces manquantes et majoration de délai — abords MH et ERP", category: "pieces_complementaires", body: piecesEtMajorationBody(MOTIF_PPMH_ERP) },
  { name: "Pièces manquantes et majoration de délai — SPR et ERP", category: "pieces_complementaires", body: piecesEtMajorationBody(MOTIF_PSMV_ERP) },
  { name: "Pièces manquantes et majoration de délai — ERP", category: "pieces_complementaires", body: piecesEtMajorationBody(MOTIF_ERP_SEUL) },
  // ── Majoration de délai ──
  { name: "Majoration de délai — abords Monument Historique", category: "majoration_delai", body: majorationBody(MOTIF_PPMH) },
  { name: "Majoration de délai — Site Patrimonial Remarquable", category: "majoration_delai", body: majorationBody(MOTIF_PSMV) },
  { name: "Majoration de délai — abords MH et ERP", category: "majoration_delai", body: majorationBody(MOTIF_PPMH_ERP) },
  { name: "Majoration de délai — SPR et ERP", category: "majoration_delai", body: majorationBody(MOTIF_PSMV_ERP) },
  // ── Décisions favorables ──
  { name: "Déclaration préalable — non-opposition", category: "avis_favorable", body: DP_NON_OPPOSITION },
  { name: "Déclaration préalable — non-opposition (avec taxes)", category: "avis_favorable", body: DP_NON_OPPOSITION + "\n" + voletTaxes },
  { name: "Permis de construire — favorable", category: "avis_favorable", body: PC_FAVORABLE },
  { name: "Permis de construire — favorable (avec taxes)", category: "avis_favorable", body: PC_FAVORABLE + "\n" + voletTaxes },
  { name: "Permis de construire modificatif — favorable (avec taxes)", category: "avis_favorable", body: PC_FAVORABLE.replace("PERMIS DE CONSTRUIRE", "PERMIS DE CONSTRUIRE MODIFICATIF") + "\n" + voletTaxes },
  // ── Refus ──
  { name: "Permis de construire — refus", category: "avis_defavorable", body: PC_REFUS },
  // ── Certificat d'urbanisme ──
  { name: "Certificat d'urbanisme de simple information (CUa)", category: "notification_decision", body: CU_SIMPLE },
];
