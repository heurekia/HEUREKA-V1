// Contenu de la documentation du Centre d'aide (thèmes + articles).
//
// Données pures consommées par `seed-help-documentation.ts`. Chaque article
// décrit une fonctionnalité de l'espace mairie d'HEUREKIA, à destination des
// agents (mairie, instructeur, admin).
//
// Le HTML n'utilise QUE des balises rendues par le lecteur d'articles
// (apps/web/src/index.css → .help-article-content) et autorisées par
// l'assainisseur (apps/web/src/utils/renderHelpHtml.ts) : h2, h3, p, ul, ol,
// li, strong, em, a, blockquote, hr. Les encadrés (astuce / attention / info)
// réutilisent <blockquote>. Pas de tableau ni de style en ligne : le rendu doit
// rester identique côté aperçu super-admin et côté lecture agent.

export interface ArticleSeed {
  slug: string;
  title: string;
  excerpt: string;
  html: string;
}

export interface ThemeSeed {
  slug: string;
  title: string;
  icon: string;
  description: string;
  articles: ArticleSeed[];
}

// ─── Petits utilitaires de mise en page ───────────────────────────────────────
const h2 = (t: string) => `<h2>${t}</h2>`;
const h3 = (t: string) => `<h3>${t}</h3>`;
const p = (...html: string[]) => `<p>${html.join(" ")}</p>`;
const ul = (items: string[]) => `<ul>${items.map((i) => `<li>${i}</li>`).join("")}</ul>`;
const ol = (items: string[]) => `<ol>${items.map((i) => `<li>${i}</li>`).join("")}</ol>`;
const tip = (html: string) => `<blockquote>💡 <strong>Astuce</strong> — ${html}</blockquote>`;
const warn = (html: string) => `<blockquote>⚠️ <strong>Attention</strong> — ${html}</blockquote>`;
const info = (html: string) => `<blockquote>ℹ️ <strong>Bon à savoir</strong> — ${html}</blockquote>`;
const doc = (...parts: string[]) => parts.join("\n");

export const HELP_THEMES: ThemeSeed[] = [
  // ════════════════════════════════════════════════════════════════════════
  // 1 — PRISE EN MAIN
  // ════════════════════════════════════════════════════════════════════════
  {
    slug: "prise-en-main",
    title: "Prise en main",
    icon: "🚀",
    description: "Découvrez l'espace mairie, sa navigation et les outils transverses.",
    articles: [
      {
        slug: "bienvenue",
        title: "Bienvenue sur HEUREKIA",
        excerpt: "Présentation de la plateforme, du vocabulaire ADS et des rôles.",
        html: doc(
          p(
            "HEUREKIA est la plateforme d'instruction des autorisations d'urbanisme (ADS) de votre commune : permis de construire, déclarations préalables, permis d'aménager, de démolir et certificats d'urbanisme. Elle accompagne chaque dossier du dépôt au comptoir jusqu'à la signature de l'arrêté.",
          ),
          h2("Ce que vous pouvez faire"),
          ul([
            "Enregistrer et suivre les dossiers déposés par les pétitionnaires ;",
            "Examiner les pièces, lancer l'analyse de conformité au PLU assistée par IA ;",
            "Échanger avec les pétitionnaires et consulter les services extérieurs (ABF, SDIS…) ;",
            "Rédiger les courriers et arrêtés, les faire signer et les notifier ;",
            "Piloter l'activité du service (délais, statistiques, calendrier des échéances).",
          ]),
          h2("Les trois rôles"),
          ul([
            "<strong>Instructeur</strong> — instruit les dossiers qui lui sont confiés.",
            "<strong>Mairie</strong> — supervise le service : répartit les dossiers, gère les paramètres de la commune.",
            "<strong>Admin</strong> — administre la plateforme et la configuration avancée.",
          ]),
          info(
            "Selon votre rôle (et d'éventuels rôles personnalisés), certaines sections ou actions peuvent être masquées. Si une fonction décrite dans cette documentation n'apparaît pas chez vous, c'est probablement une question de droits : rapprochez-vous de l'administrateur de votre commune.",
          ),
          h2("Quelques repères de vocabulaire"),
          ul([
            "<strong>Pétitionnaire</strong> — la personne qui dépose la demande.",
            "<strong>Complétude</strong> — l'étape de vérification que toutes les pièces obligatoires sont présentes.",
            "<strong>Instruction</strong> — l'examen au fond du projet (conformité au PLU, consultations).",
            "<strong>Arrêté / décision</strong> — l'acte officiel qui clôt le dossier (accord, refus, non-opposition…).",
          ]),
        ),
      },
      {
        slug: "navigation",
        title: "Naviguer dans l'espace mairie",
        excerpt: "Le menu latéral, la barre du haut et les repères de l'interface.",
        html: doc(
          p(
            "L'écran se compose d'un <strong>menu latéral</strong> à gauche (les grandes sections) et d'une <strong>barre supérieure</strong> commune à tous les écrans (recherche, notifications, aide, création de dossier).",
          ),
          h2("Le menu latéral"),
          p("De haut en bas, vous y trouvez vos sections de travail :"),
          ul([
            "<strong>Tableau de bord</strong> — l'essentiel de votre activité du jour ;",
            "<strong>Dossiers</strong> — la liste de toutes les demandes ;",
            "<strong>Calendrier</strong> — les échéances et dépôts en vue agenda ;",
            "<strong>Messagerie</strong> — les échanges avec les pétitionnaires et les services ;",
            "<strong>Carte</strong> — la visualisation du territoire et du zonage ;",
            "<strong>Statistiques</strong> — les indicateurs de la commune ;",
            "<strong>Signatures</strong> — visible si vous êtes signataire habilité (arrêtés à signer) ;",
            "<strong>Paramètres</strong> — la configuration de la commune.",
          ]),
          p(
            "Tout en bas, votre <strong>pastille de profil</strong> ouvre vos « Infos perso » ; l'icône de sortie vous déconnecte. Les badges chiffrés (Messagerie, Signatures) signalent les éléments en attente.",
          ),
          h2("La barre supérieure"),
          ul([
            "<strong>Recherche</strong> — retrouvez un dossier par numéro, adresse ou pétitionnaire ;",
            "<strong>🔔 Cloche</strong> — vos notifications ;",
            "<strong>? Aide</strong> — l'assistant d'aide IA ;",
            "<strong>+ Nouveau dossier</strong> — enregistrer une demande au comptoir.",
          ]),
          tip(
            "Chaque article de cette documentation indique l'<em>emplacement</em> de la fonction décrite. En cas de doute, l'assistant d'aide (icône « ? ») répond aux questions « Comment faire… ».",
          ),
        ),
      },
      {
        slug: "multi-communes",
        title: "Travailler sur plusieurs communes",
        excerpt: "Basculer d'une commune à l'autre quand vous instruisez pour plusieurs collectivités.",
        html: doc(
          p(
            "Si vous instruisez pour plusieurs communes (service mutualisé, EPCI), un <strong>sélecteur de commune</strong> apparaît en haut du menu latéral, sous le logo.",
          ),
          h2("Changer de commune"),
          ol([
            "Cliquez sur le bloc « Commune » dans le menu latéral.",
            "Au-delà de 5 communes, un champ de recherche vous aide à filtrer la liste.",
            "Sélectionnez la commune voulue : l'application bascule l'ensemble des écrans (dossiers, statistiques, paramètres…) sur cette commune et revient au tableau de bord.",
          ]),
          info(
            "Toutes les listes (dossiers, messagerie, statistiques) sont filtrées sur la commune active. Votre rôle peut différer d'une commune à l'autre.",
          ),
          tip(
            "Quand une notification concerne une autre commune que celle affichée, cliquer dessus bascule automatiquement sur la bonne commune avant d'ouvrir le dossier. Le nom de la commune est rappelé sur chaque notification.",
          ),
        ),
      },
      {
        slug: "recherche",
        title: "Rechercher un dossier",
        excerpt: "La recherche rapide depuis la barre supérieure.",
        html: doc(
          p(
            "Le champ de recherche de la barre supérieure permet de retrouver instantanément un dossier sans passer par la liste complète.",
          ),
          h2("Comment faire"),
          ol([
            "Cliquez dans le champ « Rechercher un dossier, une adresse, un pétitionnaire… ».",
            "Saisissez au moins deux caractères : les résultats s'affichent après un court instant.",
            "Cliquez sur un résultat pour ouvrir directement la fiche du dossier.",
          ]),
          p("La recherche porte sur le <strong>numéro de dossier</strong>, l'<strong>adresse</strong> du projet et le <strong>nom du pétitionnaire</strong>. Les accents et la casse sont ignorés."),
          info(
            "La recherche est limitée à la commune active et affiche les meilleurs résultats. Pour une recherche fine avec filtres (statut, type, secteur), utilisez plutôt la section « Dossiers ».",
          ),
        ),
      },
      {
        slug: "notifications",
        title: "Suivre ses notifications",
        excerpt: "La cloche : nouveaux messages, échéances, signatures requises, décisions.",
        html: doc(
          p(
            "La <strong>cloche 🔔</strong> de la barre supérieure regroupe les événements importants de vos dossiers. Un badge rouge indique le nombre de notifications non lues.",
          ),
          h2("Consulter et traiter"),
          ol([
            "Cliquez sur la cloche pour dérouler les dernières notifications.",
            "Cliquez sur une notification : elle est marquée comme lue et vous êtes amené directement sur le dossier concerné.",
            "Utilisez « Tout marquer lu » pour solder la liste, ou « Voir toutes les notifications » pour l'historique complet.",
          ]),
          h2("Les types de notifications"),
          ul([
            "💬 Nouveau message d'un pétitionnaire ou d'un service ;",
            "⏰ Échéance d'instruction qui approche ou dépassée, pièces manquantes ;",
            "✅ Décision rendue, dossier accepté ou refusé ;",
            "📁 Nouveau dossier déposé ou qui vous est assigné ;",
            "✍️ Signature requise (pour les signataires).",
          ]),
          info(
            "La cloche se rafraîchit automatiquement (environ toutes les 30 secondes et au retour sur l'onglet). Vous réglez les événements et canaux qui vous notifient dans Paramètres → Notifications et dans vos Infos perso.",
          ),
        ),
      },
      {
        slug: "assistant-ia",
        title: "L'assistant d'aide IA",
        excerpt: "Poser une question « Comment faire… » sans quitter votre écran.",
        html: doc(
          p(
            "L'<strong>assistant d'aide</strong> (icône « ? » de la barre supérieure) est un chat qui répond à vos questions sur l'utilisation de l'espace mairie et le déroulé de l'instruction.",
          ),
          h2("Comment l'utiliser"),
          ol([
            "Cliquez sur l'icône « ? » en haut à droite.",
            "Choisissez une question suggérée (ex. « Comment demander des pièces complémentaires ? ») ou saisissez la vôtre.",
            "Appuyez sur Entrée pour envoyer (Maj+Entrée pour un retour à la ligne). La réponse s'affiche au fil de l'eau.",
            "« Effacer » repart d'une conversation vierge.",
          ]),
          tip(
            "Posez vos questions en mode « Comment faire… » : l'assistant répond par étapes concrètes en s'appuyant sur le fonctionnement réel de la plateforme.",
          ),
          warn(
            "Les réponses sont générées par IA : vérifiez toujours les actions sensibles (envoi de courrier, signature, changement de statut) avant de les valider.",
          ),
        ),
      },
    ],
  },
  // ════════════════════════════════════════════════════════════════════════
  // 2 — GÉRER LES DOSSIERS
  // ════════════════════════════════════════════════════════════════════════
  {
    slug: "dossiers",
    title: "Gérer les dossiers",
    icon: "📁",
    description: "Créer, suivre et piloter les demandes d'autorisation d'urbanisme.",
    articles: [
      {
        slug: "liste-dossiers",
        title: "La liste des dossiers",
        excerpt: "Filtrer, rechercher, personnaliser les colonnes et exporter.",
        html: doc(
          p(
            "La section <strong>Dossiers</strong> affiche toutes les demandes de la commune active sous forme de tableau, du plus récent au plus ancien.",
          ),
          h2("Filtrer et retrouver un dossier"),
          ul([
            "<strong>Portée</strong> : « Tous les dossiers », « Mes dossiers » (ceux qui vous sont assignés) ou « Non assignés » (la boîte à trier) ;",
            "<strong>Onglets de statut</strong> : Tous, Nouveau, En instruction, Pré-instruction, Incomplet, Décision en cours, Accepté, Refusé — chacun indiquant son nombre de dossiers ;",
            "<strong>Recherche</strong> : par numéro, adresse ou pétitionnaire ;",
            "<strong>Filtres</strong> : par type de dossier et par secteur.",
          ]),
          h2("Adapter l'affichage"),
          ol([
            "Cliquez sur « Colonnes » pour afficher ou masquer des colonnes (instructeur, échéance, parcelle…).",
            "Votre choix est mémorisé sur votre poste pour vos prochaines visites.",
          ]),
          h2("Exporter"),
          p("Le bouton « Exporter CSV » télécharge la liste filtrée (numéro, type, statut, pétitionnaire, adresse, dates, délais…), prête à ouvrir dans un tableur."),
          info(
            "Un dossier dont les pièces sont encore en cours d'analyse apparaît grisé avec « Chargement en cours… » : il devient cliquable dès la fin de l'analyse (vous recevez alors une notification). Une échéance dépassée s'affiche en rouge avec un ⚠.",
          ),
        ),
      },
      {
        slug: "creer-dossier",
        title: "Créer un dossier au comptoir",
        excerpt: "Déposer les pièces, laisser l'IA pré-remplir le CERFA, vérifier et enregistrer.",
        html: doc(
          p(
            "Le bouton <strong>« + Nouveau dossier »</strong> (barre supérieure) sert à enregistrer une demande déposée au comptoir. L'IA lit le CERFA et pré-remplit le formulaire pour vous faire gagner du temps.",
          ),
          h2("Étapes"),
          ol([
            "Déposez les fichiers (CERFA + plans + photos) par glisser-déposer. Formats acceptés : PDF, JPG, PNG.",
            "L'application repère le CERFA et en extrait les données (type, pétitionnaire, adresse, parcelle, surface…).",
            "Vérifiez et corrigez le formulaire pré-rempli. Le <strong>nom du pétitionnaire</strong> et le <strong>type de dossier</strong> sont obligatoires.",
            "Renseignez l'e-mail du pétitionnaire pour lui ouvrir un espace de suivi (case « Inviter le pétitionnaire »).",
            "Affectez si besoin un instructeur, puis validez la création.",
          ]),
          h2("Dépôt d'un dossier complet en un seul PDF"),
          p(
            "Si vous déposez un seul PDF regroupant toutes les pièces, l'application propose de le <strong>découper automatiquement</strong> en pièces distinctes (CERFA, plan de masse, façades…) que vous validez avant l'enregistrement. Voir l'article « Le dépôt groupé ».",
          ),
          info(
            "Après l'enregistrement, l'analyse OCR et IA des pièces se poursuit en arrière-plan. Inutile d'ouvrir le dossier tout de suite : vous (ou l'instructeur assigné) recevez une notification dans la cloche dès qu'il est prêt à instruire.",
          ),
          tip(
            "Nommez vos fichiers de façon parlante (ex. « PC2-plan-masse.pdf ») : l'application en déduit le type de pièce et accélère le classement.",
          ),
        ),
      },
      {
        slug: "fiche-dossier",
        title: "La fiche dossier",
        excerpt: "L'en-tête, les onglets et la barre d'avancement d'un dossier.",
        html: doc(
          p("Cliquer sur un dossier ouvre sa <strong>fiche complète</strong>. L'en-tête reste visible en permanence ; le travail se répartit en onglets."),
          h2("L'en-tête"),
          ul([
            "Numéro et <strong>statut</strong> du dossier, type et description du projet ;",
            "Pétitionnaire, adresse (modifiable), parcelle, instructeur ;",
            "Chips de dates : <strong>date de dépôt</strong> et <strong>échéance</strong> (cliquez sur l'échéance pour le détail du délai légal) ;",
            "Actions rapides : contacter le pétitionnaire, générer un courrier, exporter le dossier.",
          ]),
          h2("Les onglets"),
          ul([
            "<strong>Résumé</strong> — informations clés et avancement du dossier ;",
            "<strong>Terrain</strong> — parcelle, zonage PLU, risques, servitudes, historique ;",
            "<strong>Documents</strong> — les pièces et leur examen ;",
            "<strong>Instruction</strong> — l'analyse de conformité au PLU ;",
            "<strong>Consultations</strong> — les avis des services extérieurs ;",
            "<strong>Courriers</strong> — les courriers émis et leurs brouillons ;",
            "<strong>Chronologie</strong> — l'historique horodaté de toutes les actions ;",
            "<strong>Décision</strong> — le projet d'arrêté et sa signature.",
          ]),
          tip(
            "La barre « Avancement du dossier » (onglet Résumé) résume les étapes Dépôt → Complétude → Instruction → Consultations → Décision. Cliquer une étape vous amène directement à l'onglet correspondant.",
          ),
        ),
      },
      {
        slug: "cycle-vie",
        title: "Le cycle de vie d'un dossier",
        excerpt: "Comprendre les statuts et les transitions de l'instruction.",
        html: doc(
          p("Un dossier suit un parcours balisé par des <strong>statuts</strong>. Le bandeau d'actions, sous l'en-tête, indique toujours la « prochaine étape » et ne propose que les transitions possibles."),
          h2("Les statuts"),
          ul([
            "<strong>Nouveau (soumis)</strong> — la demande vient d'arriver ;",
            "<strong>Pré-instruction</strong> — vérification de la complétude des pièces ;",
            "<strong>Incomplet</strong> — en attente de pièces complémentaires du pétitionnaire ;",
            "<strong>En instruction</strong> — examen au fond du projet ;",
            "<strong>Décision en cours</strong> — projet d'arrêté en circuit de signature ;",
            "<strong>Accepté / Refusé / Accord avec prescriptions</strong> — statuts terminaux.",
          ]),
          h2("Le déroulé courant"),
          ol([
            "Vous <strong>prenez en charge</strong> un dossier nouveau → il passe en pré-instruction.",
            "Vous <strong>déclarez le dossier complet</strong> → il passe en instruction (ou en incomplet si des pièces manquent).",
            "Une fois l'instruction terminée, vous le <strong>mettez en décision</strong> → le projet d'arrêté part en signature.",
            "La signature de l'arrêté place le dossier dans son statut terminal et notifie le pétitionnaire.",
          ]),
          info(
            "Demander des pièces complémentaires bascule le dossier en « Incomplet » et suspend le délai d'instruction jusqu'à réception des pièces (voir l'article « Les délais légaux d'instruction »).",
          ),
        ),
      },
      {
        slug: "prise-en-charge",
        title: "Prendre en charge et assigner un dossier",
        excerpt: "S'attribuer un dossier, le confier à un collègue ou le remettre à trier.",
        html: doc(
          p("Chaque dossier peut être confié à un instructeur. Les dossiers « Non assignés » constituent la boîte à trier du service."),
          h2("S'attribuer un dossier"),
          p("Sur un dossier non assigné, cliquez sur <strong>« Prendre en charge »</strong> (bandeau d'actions ou bouton de l'en-tête) : vous en devenez l'instructeur et il passe en pré-instruction."),
          h2("Assigner ou réassigner (rôle Mairie / Admin)"),
          ol([
            "Depuis la fiche, utilisez le menu « Assigner » / « Réassigner » et choisissez l'instructeur.",
            "« Retirer l'instructeur » remet le dossier dans la boîte à trier.",
          ]),
          p("Depuis la liste, le menu d'actions (⋮) d'une ligne permet aussi de copier le numéro, désassigner l'instructeur ou supprimer le dossier."),
          info(
            "Si l'instructeur assigné est déclaré absent, les nouveaux dossiers et les échéances proches sont automatiquement redirigés vers sa chaîne de délégation (voir « Déléguer ses dossiers »). Chaque redirection est tracée dans la chronologie.",
          ),
        ),
      },
      {
        slug: "delais",
        title: "Les délais légaux d'instruction",
        excerpt: "Comment l'échéance est calculée, ses majorations et la date de complétude.",
        html: doc(
          p(
            "HEUREKIA calcule automatiquement le <strong>délai légal d'instruction</strong> de chaque dossier et l'affiche sous forme d'échéance (avec un compteur J-X, ou J+X en rouge en cas de retard).",
          ),
          h2("Voir le détail du calcul"),
          p("Cliquez sur le chip <strong>« Échéance »</strong> de l'en-tête : un encadré détaille la durée de base, les éventuelles majorations (avec l'article du Code de l'urbanisme correspondant) et le total."),
          h2("Le délai de base par type"),
          ul([
            "Déclaration préalable (DP) et certificat d'urbanisme informatif (CUa) : 1 mois ;",
            "Permis de construire maison individuelle (PCMI), permis de démolir, CU opérationnel : 2 mois ;",
            "Permis de construire, permis d'aménager, permis de lotir : 3 mois.",
          ]),
          h2("Les majorations possibles"),
          p("Le délai de base est allongé selon le contexte du projet, par exemple :"),
          ul([
            "Périmètre d'un monument / site patrimonial (ABF, SPR) : +1 mois ; site UNESCO : +2 mois ;",
            "Dérogation au PLU ou avis de la CDPENAF (zones A/N) : +2 mois ;",
            "Évaluation environnementale : +1 mois (au cas par cas) ou +6 mois (systématique) ;",
            "Natura 2000, défrichement, ERP, dérogation accessibilité : +1 mois.",
          ]),
          h2("La date de complétude"),
          p(
            "Tant qu'aucune date de complétude n'est saisie, le délai court à partir de la date de dépôt. Quand vous déclarez le dossier complet, renseignez la <strong>date de complétude</strong> dans l'encadré du délai puis enregistrez : l'échéance est recalculée à partir de cette date.",
          ),
          warn(
            "Une demande de pièces complémentaires suspend le délai. Il redémarre à la réception des pièces. Surveillez les échéances : un dépassement peut entraîner une décision tacite.",
          ),
        ),
      },
    ],
  },
  // ════════════════════════════════════════════════════════════════════════
  // 3 — PIÈCES & DOCUMENTS
  // ════════════════════════════════════════════════════════════════════════
  {
    slug: "pieces",
    title: "Pièces & documents",
    icon: "📎",
    description: "Déposer, classer, examiner et annoter les pièces d'un dossier.",
    articles: [
      {
        slug: "deposer-pieces",
        title: "Déposer et consulter les pièces",
        excerpt: "Téléverser une pièce et la lire dans l'onglet Documents.",
        html: doc(
          p(
            "L'onglet <strong>Documents</strong> d'un dossier réunit toutes les pièces du pétitionnaire, regroupées par catégorie (CERFA, plan de situation, plan de masse, façades, notice, photos…).",
          ),
          h2("Ajouter une pièce"),
          ol([
            "Dans l'onglet Documents, utilisez le bouton de dépôt et choisissez le fichier (PDF, JPEG, PNG, GIF, WEBP ou TIFF).",
            "Renseignez si besoin son code (ex. « PC2 ») et son nom.",
            "La pièce apparaît immédiatement avec un badge « OCR en cours » : son analyse démarre en arrière-plan.",
          ]),
          h2("Consulter une pièce"),
          ul([
            "Cliquez une pièce dans la liste de gauche : son aperçu s'affiche au centre.",
            "Trois modes d'affichage en haut : <strong>Aperçu</strong> (pièce + analyse), <strong>Comparer</strong> (pièce face à un document réglementaire) et <strong>Lecture</strong> (plein écran).",
            "Le bouton plein écran agrandit l'aperçu pour un examen détaillé.",
          ]),
          info(
            "Tant qu'une pièce est en cours d'analyse, le dossier n'est pas encore consultable : il le devient à la fin du traitement, signalée par une notification. Une pièce remplacée lors d'un complément est archivée mais conservée pour la traçabilité.",
          ),
        ),
      },
      {
        slug: "depot-groupe",
        title: "Le dépôt groupé : découper un PDF en pièces",
        excerpt: "Segmenter automatiquement un dossier déposé en un seul fichier.",
        html: doc(
          p(
            "Quand un dossier est remis sous forme d'un <strong>unique PDF</strong> regroupant toutes les pièces, HEUREKIA propose de le découper automatiquement en pièces distinctes. Vous validez le découpage avant que les pièces ne soient créées.",
          ),
          h2("Comment ça marche"),
          ol([
            "Déposez le PDF : la fenêtre « Découpage du dossier déposé » s'ouvre et l'IA analyse le document.",
            "À gauche, feuilletez le PDF ; à droite, vérifiez les pièces proposées (code, type, pages, indice de confiance).",
            "Corrigez si besoin : changez un code ou un type, renommez, réaffectez des pages (ex. « 3-5, 8 »), ajoutez ou supprimez une pièce.",
            "Cliquez sur « Valider · X pièce(s) » : les pièces sont créées et repassent dans l'analyse OCR / IA.",
          ]),
          info(
            "L'indice de confiance est un code couleur : vert (fiable), orange (à vérifier), rouge (à revoir). Une page peut être partagée par plusieurs pièces (badge « partagée ») ; un avertissement signale les pages non rattachées.",
          ),
          tip(
            "La proposition de découpage n'est qu'une suggestion : c'est vous qui décidez du résultat final avant de valider. Le PDF d'origine est conservé.",
          ),
        ),
      },
      {
        slug: "examiner-pieces",
        title: "Examiner une pièce : valider, rejeter, demander un complément",
        excerpt: "Qualifier chaque pièce et tracer la décision.",
        html: doc(
          p(
            "Pour chaque pièce, l'instructeur pose un <strong>statut d'examen</strong> dans le panneau de droite de l'onglet Documents (section « Annotation instructeur »).",
          ),
          h2("Les statuts"),
          ul([
            "<strong>✓ Valider</strong> — la pièce est conforme et peut servir de base à l'analyse ;",
            "<strong>✎ Complément</strong> — demander au pétitionnaire une version corrigée ou complète ;",
            "<strong>✕ Rejeter</strong> — la pièce est inexploitable (illisible, hors sujet…).",
          ]),
          h2("Comment faire"),
          ol([
            "Sélectionnez la pièce, puis cliquez le statut voulu.",
            "Ajoutez si besoin une note (motif du rejet, élément manquant…) et enregistrez-la.",
            "Le statut s'affiche sous la pièce et l'action est tracée dans la chronologie.",
          ]),
          info(
            "Quand toutes les pièces restantes sont validées, le dossier peut passer de la pré-instruction à l'instruction. Une pièce rejetée reste visible (barrée) pour la traçabilité. Le statut d'examen est indépendant du classement de la pièce.",
          ),
        ),
      },
      {
        slug: "reclasser",
        title: "Reclasser une pièce",
        excerpt: "Corriger le code ou le type d'une pièce mal classée.",
        html: doc(
          p(
            "Si une pièce a été rangée dans la mauvaise catégorie (par l'IA ou lors du dépôt), vous pouvez la <strong>reclasser</strong> manuellement.",
          ),
          h2("Comment faire"),
          ol([
            "Sélectionnez la pièce dans l'onglet Documents.",
            "Dans le panneau de droite, repérez l'« Emplacement » courant et cliquez sur « ✏️ Reclasser ».",
            "Choisissez le nouveau code (ex. « PC2 ») et/ou le type de document (plan de masse, coupe, façades, notice, photo…).",
            "Enregistrez : la pièce rejoint la bonne catégorie dans la liste.",
          ]),
          info(
            "Le reclassement est tracé dans la chronologie et ne modifie pas le statut d'examen de la pièce (validé / rejeté / complément). Le nom généré automatiquement est mis à jour pour rester cohérent.",
          ),
        ),
      },
      {
        slug: "annoter",
        title: "Annoter une pièce et la partager",
        excerpt: "Surligner, mesurer, commenter un plan puis l'exporter.",
        html: doc(
          p(
            "L'outil d'annotation permet de mettre en évidence des éléments sur un plan ou une photo (entourer, flécher, mesurer, commenter), puis d'exporter une version annotée — sans jamais modifier la pièce d'origine.",
          ),
          h2("Annoter"),
          ol([
            "Sélectionnez la pièce et activez « ✏️ Annoter / Envoyer ».",
            "Choisissez un outil : rectangle, ellipse, flèche, tracé libre, texte, échelle, mesure ou polygone.",
            "Pour mesurer, définissez d'abord une longueur de référence avec l'outil « Échelle », puis utilisez « Mesure ».",
            "Réglez la couleur et l'épaisseur, et indiquez si chaque marque est « interne » (visible de vous seul) ou « citoyen » (destinée au pétitionnaire).",
          ]),
          h2("Exporter et partager"),
          ol([
            "Cliquez sur « Exporter » : choisissez le format (PDF ou PNG), un nom et une note de contexte.",
            "L'export est enregistré dans la GED du dossier (documents produits par l'instruction).",
            "Pour le transmettre, joignez-le à un courrier : il devient alors visible du pétitionnaire.",
          ]),
          info(
            "Les coordonnées des marques sont indépendantes du zoom. Un document de la GED reste invisible du pétitionnaire tant qu'il n'a pas été joint à un courrier. Une pièce annotée peut être consultée en « version initiale » ou « version finale ».",
          ),
        ),
      },
      {
        slug: "ocr-ia",
        title: "Comprendre l'analyse OCR et IA des pièces",
        excerpt: "Ce que la plateforme lit et extrait automatiquement de vos pièces.",
        html: doc(
          p(
            "À chaque dépôt, HEUREKIA analyse la pièce en arrière-plan : <strong>OCR</strong> (reconnaissance du texte) puis <strong>extraction structurée</strong> des informations utiles à l'instruction (type de pièce, cotes de hauteur, reculs, surfaces, échelle…).",
          ),
          h2("Ce que vous voyez"),
          ul([
            "Un <strong>badge d'état</strong> sur la pièce : « OCR en cours », « analysée » ou « échec » ;",
            "Une <strong>analyse</strong> indicative (pièce exploitable, à compléter ou à reprendre) ;",
            "Une <strong>extraction</strong> des valeurs détectées, avec leurs citations dans la pièce.",
          ]),
          h2("Relancer l'analyse"),
          p("Depuis le panneau de droite, vous pouvez relancer l'extraction d'une pièce (par exemple après le remplacement d'un plan)."),
          warn(
            "L'analyse IA est une aide à la lecture, pas une décision. Une cote mal imprimée ou un plan illisible peut fausser l'extraction : vérifiez toujours les valeurs sur la pièce avant de vous appuyer dessus.",
          ),
        ),
      },
    ],
  },
  // ════════════════════════════════════════════════════════════════════════
  // 4 — ANALYSE RÉGLEMENTAIRE & CONFORMITÉ
  // ════════════════════════════════════════════════════════════════════════
  {
    slug: "conformite",
    title: "Analyse réglementaire & conformité",
    icon: "⚖️",
    description: "Terrain, zonage, conformité au PLU assistée par IA et règlement.",
    articles: [
      {
        slug: "terrain",
        title: "L'onglet Terrain : parcelle, zonage, risques",
        excerpt: "Tout savoir sur le terrain d'un projet en un coup d'œil.",
        html: doc(
          p(
            "L'onglet <strong>Terrain</strong> d'un dossier rassemble l'analyse de la parcelle : cadastre, zonage PLU, risques, servitudes et historique des autorisations.",
          ),
          h2("Ce que vous y trouvez"),
          ul([
            "<strong>Parcelle cadastrale</strong> : section, numéro et surface ;",
            "<strong>Zone PLU</strong> applicable (U, AU, A, N) ;",
            "<strong>Risques</strong> : inondation, sismicité, retrait-gonflement des argiles, radon ;",
            "<strong>Servitudes</strong> et prescriptions : périmètre ABF, site classé, SPR, Natura 2000… ;",
            "<strong>Synthèse de constructibilité</strong> : estimations d'emprise, de hauteur et de reculs ;",
            "<strong>Historique SITADEL / ADS</strong> : les autorisations passées sur la parcelle, la rue ou la commune.",
          ]),
          h2("Corriger l'adresse ou la parcelle"),
          p("Le bouton ✏️ de l'en-tête permet de rectifier l'adresse (avec autocomplétion) ; l'analyse parcellaire et le zonage sont alors recalculés."),
          warn(
            "La synthèse de constructibilité donne des estimations orientatives, fondées sur les règles du PLU. L'instructeur reste seul juge : la constructibilité réelle dépend aussi des servitudes et des contraintes du terrain.",
          ),
        ),
      },
      {
        slug: "carte",
        title: "La carte du territoire",
        excerpt: "Visualiser les parcelles, le zonage PLU et lire les règles d'une zone.",
        html: doc(
          p("La section <strong>Carte</strong> affiche le territoire de la commune et permet de visualiser le zonage du PLU."),
          h2("Choisir le fond et les couches"),
          ul([
            "Basculez le fond de carte : photo aérienne (ortho IGN), plan neutre ou plan IGN ;",
            "Affichez ou masquez la <strong>couche du zonage PLU</strong> (zones U, AU, A, N, repérées par des couleurs) ;",
            "Pour les agents multi-communes, sélectionnez la commune à afficher.",
          ]),
          h2("Consulter les règles d'une zone"),
          ol([
            "Dans le panneau latéral « Règlement PLU », recherchez une zone par son code ou son libellé.",
            "Dépliez la zone pour lire ses règles validées (article, thème et résumé).",
          ]),
          info("Le zonage provient du Géoportail de l'Urbanisme. Les règles affichées sont celles que la commune a validées dans son référentiel (voir « Gérer le règlement PLU »)."),
        ),
      },
      {
        slug: "analyse-conformite",
        title: "L'analyse de conformité automatique",
        excerpt: "Lancer l'analyse et lire les constats réglementaires.",
        html: doc(
          p(
            "Dans l'onglet <strong>Instruction</strong>, HEUREKIA confronte automatiquement le projet aux règles du PLU validées pour la zone et produit des <strong>constats</strong> argumentés.",
          ),
          h2("Lancer l'analyse"),
          ol([
            "Ouvrez l'onglet Instruction et cliquez sur « Lancer l'analyse » (ou « Relancer »).",
            "Après quelques instants, le rapport affiche un aperçu global et la liste des constats.",
          ]),
          h2("Ce qui est évalué automatiquement"),
          p("Le moteur évalue notamment les critères chiffrés du règlement :"),
          ul([
            "<strong>Hauteur</strong> maximale (égout, faîtage) ;",
            "<strong>Emprise au sol</strong> ;",
            "<strong>Recul</strong> par rapport aux voies et aux limites séparatives ;",
            "<strong>Stationnement</strong>.",
          ]),
          h2("Lire les constats"),
          p("Les constats sont triés par sévérité : écarts bloquants, à régulariser par prescription, à vérifier, conformes, et règles écartées. Chaque constat indique l'article du PLU, le fait observé sur la pièce, la valeur attendue, le verdict et sa justification."),
          info(
            "Les thèmes qualitatifs (aspect extérieur, espaces verts, destinations…) ne sont pas tranchés automatiquement : ils sont remontés en « à vérifier » pour votre appréciation. Relancez l'analyse après toute modification d'une pièce, de l'adresse ou des règles.",
          ),
        ),
      },
      {
        slug: "qualifier-constats",
        title: "Qualifier les constats réglementaires",
        excerpt: "Le moteur constate, l'instructeur décide.",
        html: doc(
          p(
            "Aucun constat n'a valeur de décision. Chaque constat doit être <strong>qualifié</strong> par l'instructeur pour construire une instruction motivée.",
          ),
          h2("Les actions sur un constat"),
          ul([
            "<strong>Accepter</strong> — le constat est juste et retenu au dossier ;",
            "<strong>Corriger</strong> — le constat est inexact : indiquez la raison ;",
            "<strong>Écarter</strong> — le constat ne s'applique pas (dérogation, servitude couverte, hors sujet).",
          ]),
          h2("Remonter à la source"),
          ul([
            "« Ouvrir la pièce » affiche la pièce d'où provient la mesure ;",
            "« Voir la règle » ouvre le fondement réglementaire (texte du PLU).",
          ]),
          tip(
            "Un verdict « conforme » ne dispense pas de valider la pièce source ; un « non conforme » est une alerte qui peut parfois se régulariser par prescription. La progression de qualification des constats est affichée en haut de l'onglet.",
          ),
        ),
      },
      {
        slug: "analyse-finale",
        title: "L'analyse finale avant décision",
        excerpt: "Verrouiller la conformité sur les seules pièces validées.",
        html: doc(
          p(
            "Avant de rédiger l'arrêté, lancez l'<strong>analyse finale</strong> : elle ne tient compte que des pièces validées et sert de base à la décision.",
          ),
          h2("Les conditions préalables"),
          p("L'analyse finale est possible lorsque :"),
          ul([
            "toutes les pièces ont reçu un statut (validée, rejetée ou complément demandé) ;",
            "aucun complément n'est en attente de réponse du pétitionnaire ;",
            "au moins une pièce a été validée.",
          ]),
          p("Si une condition manque, le bandeau d'action indique précisément le point bloquant à lever."),
          h2("Comment faire"),
          ol([
            "Ouvrez l'onglet Instruction et cliquez sur « Lancer l'analyse finale ».",
            "Vérifiez le rapport définitif, puis passez le dossier en décision.",
          ]),
          info("Une fois la conformité finale établie, vous pouvez préparer et faire signer l'arrêté (voir le thème « Courriers, décisions & signatures »)."),
        ),
      },
      {
        slug: "reglement-plu",
        title: "Gérer le règlement PLU (zones & règles)",
        excerpt: "Importer le PLU, créer les zones et valider les règles.",
        html: doc(
          p(
            "Le référentiel du PLU alimente l'analyse de conformité. Il se gère dans <strong>Paramètres → Réglementation</strong> et comprend des <strong>zones</strong> (U, AU, A, N) et leurs <strong>règles</strong> par article.",
          ),
          h2("Importer un PLU"),
          ol([
            "Glissez le PDF du règlement et indiquez la commune et le code INSEE.",
            "Cliquez sur « Analyser le PLU » : l'IA détecte les zones et extrait les règles des articles (hauteur, emprise, reculs, stationnement…).",
            "Suivez l'avancement ; à la fin, un résumé indique le nombre de zones et de règles extraites.",
          ]),
          p("Vous pouvez aussi créer les zones et saisir les règles manuellement."),
          h2("Valider les règles"),
          p(
            "Les règles extraites sont créées en <strong>brouillon</strong>. Relisez chaque règle puis « ✓ Valider », « ✗ Rejeter » ou « ✏️ Modifier ». Seules les règles validées sont utilisées par le moteur d'analyse.",
          ),
          warn(
            "Une règle en brouillon n'est jamais appliquée aux dossiers. Pensez à valider les règles importées avant de vous fier à l'analyse de conformité.",
          ),
        ),
      },
    ],
  },
  // ════════════════════════════════════════════════════════════════════════
  // 5 — COURRIERS, DÉCISIONS & SIGNATURES
  // ════════════════════════════════════════════════════════════════════════
  {
    slug: "courriers-decisions",
    title: "Courriers, décisions & signatures",
    icon: "📨",
    description: "Rédiger les courriers, instruire la décision et gérer la signature des arrêtés.",
    articles: [
      {
        slug: "generer-courrier",
        title: "Générer un courrier",
        excerpt: "Rédiger un courrier à partir d'un modèle et l'envoyer au pétitionnaire.",
        html: doc(
          p(
            "Depuis la fiche dossier (onglet <strong>Courriers</strong> ou bouton « Générer un courrier »), vous rédigez un courrier au pétitionnaire à partir d'un modèle, avec substitution automatique des données du dossier.",
          ),
          h2("Comment faire"),
          ol([
            "Choisissez un modèle dans la liste : le corps se remplit et les variables (numéro de dossier, adresse, pétitionnaire…) sont remplacées.",
            "Au besoin, cliquez sur « Modifier le texte » pour ajuster le contenu.",
            "Ajoutez si nécessaire les mentions légales recommandées et des documents de la GED.",
            "Imprimez / téléchargez le PDF, ou envoyez directement.",
          ]),
          h2("Choisir le canal d'envoi"),
          ul([
            "<strong>Messagerie interne</strong> — dépôt instantané dans l'espace du pétitionnaire ;",
            "<strong>E-mail</strong> — notification avec lien vers l'espace ;",
            "<strong>Courrier postal</strong> ou <strong>recommandé (LRAR)</strong> — à imprimer et poster.",
          ]),
          info(
            "Un courrier peut être enregistré en <strong>brouillon</strong> (modifiable, sans effet) puis repris plus tard. Une fois envoyé, il est figé et conservé dans l'historique du dossier. Les modèles et l'en-tête se gèrent dans Paramètres → Courriers.",
          ),
        ),
      },
      {
        slug: "demande-pieces",
        title: "Demander des pièces complémentaires",
        excerpt: "Lister les pièces manquantes et notifier le pétitionnaire.",
        html: doc(
          p(
            "La <strong>demande de pièces complémentaires</strong> est un courrier spécialisé qui liste les pièces à fournir ou à corriger et bascule le dossier en « Incomplet ».",
          ),
          h2("Comment faire"),
          ol([
            "Depuis l'onglet Courriers (ou Pièces), cliquez sur « 📎 Demander des pièces ».",
            "Cochez les pièces concernées et précisez, pour chacune, la raison (ex. « plan illisible »).",
            "Ajoutez au besoin une pièce libre (code + nom + motif).",
            "Vérifiez le courrier, signez-le si requis, puis émettez la demande via le canal voulu.",
          ]),
          warn(
            "L'émission d'une demande de pièces a des effets sur le dossier : passage en « Incomplet », notification du pétitionnaire et <strong>suspension du délai d'instruction</strong> jusqu'à réception des pièces. Le délai redémarre à la réception.",
          ),
        ),
      },
      {
        slug: "arrete",
        title: "Rédiger et émettre un arrêté",
        excerpt: "Le projet de décision : type, prescriptions, signataire.",
        html: doc(
          p("L'onglet <strong>Décision</strong> sert à préparer le projet d'arrêté (accord, refus, non-opposition, accord avec prescriptions, sursis…) puis à le faire signer et notifier."),
          h2("Préparer le projet"),
          ol([
            "Cliquez sur « Créer un projet d'arrêté ».",
            "Choisissez le type de décision (les options dépendent du type de dossier).",
            "Ajoutez les prescriptions éventuelles (liste ordonnée) et les observations / motifs.",
            "Désignez le signataire parmi les signataires habilités, puis enregistrez le brouillon.",
          ]),
          p("L'aperçu génère automatiquement l'arrêté au format administratif (« Vu… », « Arrête », articles, bloc signature)."),
          h2("Le parcours de l'arrêté"),
          ol([
            "<strong>Soumettre pour signature</strong> — le signataire est notifié ;",
            "<strong>Signature</strong> — l'arrêté est numéroté et horodaté automatiquement, avec calcul du délai de recours ;",
            "<strong>Marquer comme notifié</strong> — une fois l'arrêté transmis au pétitionnaire.",
          ]),
          info("Un arrêté signé ne peut plus être modifié. En cas de refus de signature, le projet revient en « révision nécessaire » avec le motif, pour correction puis nouvelle soumission."),
        ),
      },
      {
        slug: "circuit-signature",
        title: "Le circuit de signature",
        excerpt: "Signer soi-même ou envoyer à un signataire habilité.",
        html: doc(
          p(
            "La signature des courriers et arrêtés dépend de l'<strong>habilitation signataire</strong>, et non du rôle du compte. Un instructeur habilité signe lui-même ; sinon, il transmet à un signataire.",
          ),
          h2("Deux cas de figure"),
          ul([
            "<strong>Vous êtes signataire habilité</strong> — le bouton « Signer » appose votre signature (et votre tampon) sur place ;",
            "<strong>Vous n'êtes pas habilité</strong> — « Demander la signature » envoie le document au signataire désigné, qui le retrouve dans sa section « Signatures ».",
          ]),
          info(
            "Tant qu'une signature requise n'est pas apposée, l'envoi du courrier reste bloqué. La signature et le tampon utilisés sont ceux du signataire ; à défaut, ceux configurés au niveau de la commune. L'habilitation se gère dans Paramètres → Utilisateurs (voir « Habiliter les signataires »).",
          ),
        ),
      },
      {
        slug: "signatures",
        title: "L'écran Signatures (signataire)",
        excerpt: "Pour les signataires : traiter les arrêtés en attente.",
        html: doc(
          p(
            "La section <strong>Signatures</strong> du menu n'apparaît que si vous êtes signataire habilité. Elle liste les arrêtés soumis en attente de votre signature.",
          ),
          h2("Traiter un arrêté"),
          ol([
            "Ouvrez « Signatures » : chaque carte indique le dossier, le type de décision, l'adresse et l'instructeur.",
            "Utilisez « Voir le dossier » ou « Voir l'arrêté » pour vérifier le projet.",
            "Cliquez sur « Signer » pour valider : l'arrêté est numéroté, horodaté et l'instructeur est notifié.",
            "Ou cliquez sur « Refuser » et indiquez le motif : le projet repart en révision auprès de l'instructeur.",
          ]),
          info("Un badge sur l'onglet « Signatures » indique le nombre d'arrêtés en attente. Vous voyez les arrêtés de toutes les communes pour lesquelles vous êtes signataire habilité."),
        ),
      },
      {
        slug: "consultations",
        title: "Consulter les services extérieurs",
        excerpt: "Solliciter l'ABF, le SDIS, la DDT… et suivre leurs avis.",
        html: doc(
          p(
            "L'onglet <strong>Consultations</strong> d'un dossier permet de solliciter l'avis des services extérieurs (ABF, SDIS, gestionnaires de réseaux…) et de suivre leurs réponses.",
          ),
          h2("Lancer une consultation"),
          ol([
            "Cliquez sur « + Nouvelle consultation » (ou « Missionner un service »).",
            "Choisissez le service parmi ceux couvrant la commune, ajoutez un message d'accompagnement.",
            "Créez la consultation : le service est notifié et un fil d'échange est ouvert.",
          ]),
          h2("Suivre et enregistrer l'avis"),
          ul([
            "L'état évolue de « En attente » à « Avis reçu » ;",
            "Renseignez le sens de l'avis (favorable, avec réserves, défavorable) et le texte de la réponse.",
          ]),
          info("Les services disponibles sont paramétrés au niveau de la plateforme, avec leur couverture par commune. L'étape « Consultations » du dossier est considérée traitée lorsque les consultations lancées ont reçu une réponse."),
        ),
      },
    ],
  },
  // ════════════════════════════════════════════════════════════════════════
  // 6 — SUIVI & ÉCHANGES
  // ════════════════════════════════════════════════════════════════════════
  {
    slug: "suivi-echanges",
    title: "Suivi & échanges",
    icon: "📊",
    description: "Tableau de bord, messagerie, calendrier et statistiques.",
    articles: [
      {
        slug: "tableau-bord",
        title: "Le tableau de bord",
        excerpt: "Votre point d'entrée quotidien : indicateurs et carte des demandes.",
        html: doc(
          p("Le <strong>Tableau de bord</strong> est la page d'accueil de l'espace mairie. Il résume l'essentiel de votre activité du jour."),
          h2("Les indicateurs « À traiter aujourd'hui »"),
          ul([
            "<strong>Nouveaux dossiers</strong> — demandes en attente d'ouverture d'instruction ;",
            "<strong>En instruction</strong> — dossiers en cours ;",
            "<strong>Messages sans réponse</strong> — échanges en attente ;",
            "<strong>Incomplets</strong> — dossiers en attente de pièces (avec alerte de délai).",
          ]),
          p("Chaque carte affiche un compteur et un bouton qui ouvre la liste filtrée correspondante."),
          h2("La carte des demandes"),
          p("Une carte interactive localise les dossiers par des repères colorés selon leur statut. Filtrez par statut ou par type, agrandissez la carte, et cliquez un repère pour ouvrir le dossier."),
        ),
      },
      {
        slug: "messagerie",
        title: "La messagerie",
        excerpt: "Échanger avec les pétitionnaires et avec les services consultés.",
        html: doc(
          p(
            "La <strong>Messagerie</strong> centralise vos échanges, répartis en deux onglets : <strong>Citoyens</strong> (les pétitionnaires) et <strong>Services / Consultations</strong> (les services extérieurs).",
          ),
          h2("Échanger avec un pétitionnaire"),
          ol([
            "Ouvrez l'onglet « Citoyens » et sélectionnez une conversation (liste de gauche).",
            "Lisez le fil au centre ; rédigez votre réponse en bas (Entrée pour envoyer, Maj+Entrée pour un retour à la ligne).",
            "Les pièces jointes s'affichent directement dans le fil.",
          ]),
          p("Le panneau de droite rappelle le dossier lié (numéro cliquable, type, statut). Une conversation ouverte est marquée comme lue."),
          h2("Suivre les services consultés"),
          p("L'onglet « Services / Consultations » regroupe les fils ouverts avec les services extérieurs et l'état de chaque consultation."),
          info("Un badge sur l'icône « Messagerie » du menu signale les messages non lus. Les messages sans réponse alimentent aussi un indicateur du tableau de bord."),
        ),
      },
      {
        slug: "calendrier",
        title: "Le calendrier et les échéances",
        excerpt: "Visualiser les dépôts et les échéances pour éviter les dépassements.",
        html: doc(
          p(
            "Le <strong>Calendrier</strong> place les dossiers sur une vue agenda (mois ou semaine) selon leur échéance d'instruction (ou, à défaut, leur date de dépôt).",
          ),
          h2("Naviguer"),
          ul([
            "Basculez entre les vues « Mois » et « Semaine » ; revenez au présent avec « Aujourd'hui » ;",
            "Chaque événement est une pastille colorée par statut (type + numéro de dossier) ; cliquez-la pour ouvrir le dossier ;",
            "Filtrez par type de dossier et par statut.",
          ]),
          h2("Les échéances à venir"),
          p(
            "Le panneau latéral « Échéances à venir » liste les prochaines échéances et les retards, avec un repère de délai coloré (« En retard », « Aujourd'hui », « Dans X jours »).",
          ),
          tip("Consultez le calendrier en début de journée pour repérer d'un coup d'œil les dossiers dont l'échéance approche."),
        ),
      },
      {
        slug: "statistiques",
        title: "Les statistiques de la commune",
        excerpt: "Volumes, délais, taux d'acceptation et performance des consultations.",
        html: doc(
          p("La section <strong>Statistiques</strong> mesure l'activité d'instruction de la commune."),
          h2("Les indicateurs clés"),
          ul([
            "<strong>Dossiers traités</strong> et volume total ;",
            "<strong>Délai moyen</strong> d'instruction des dossiers délivrés ;",
            "<strong>Taux d'acceptation</strong> ;",
            "<strong>Dossiers en retard</strong>.",
          ]),
          h2("Les analyses détaillées"),
          ul([
            "<strong>Vue générale</strong> — dépôts par mois, répartition par type, résultats des décisions ;",
            "<strong>Délais</strong> — délai moyen par type comparé au délai légal, évolution, dossiers en dépassement ;",
            "<strong>Types de dossiers</strong> — volumes et détail (déposés, accordés, refusés, délai) ;",
            "<strong>Services</strong> — nombre de consultations, délais de retour et taux de réponse par service.",
          ]),
          info("Les statistiques portent sur la commune active."),
        ),
      },
    ],
  },
  // ════════════════════════════════════════════════════════════════════════
  // 7 — PARAMÈTRES DE LA COMMUNE
  // ════════════════════════════════════════════════════════════════════════
  {
    slug: "parametres",
    title: "Paramètres de la commune",
    icon: "⚙️",
    description: "Configurer la commune : utilisateurs, signataires, délais, modèles, intégrations.",
    articles: [
      {
        slug: "general",
        title: "Informations générales de la commune",
        excerpt: "Logo, coordonnées et identité de la collectivité.",
        html: doc(
          p("L'onglet <strong>Paramètres → Général</strong> rassemble l'identité de la commune, utilisée notamment sur les courriers et arrêtés."),
          h2("Ce que vous renseignez"),
          ul([
            "Logo de la commune ;",
            "Département, région, code postal, population, surface ;",
            "E-mail de contact urbanisme et téléphone ;",
            "Description / contexte de la commune.",
          ]),
          h2("Mettre à jour le code INSEE"),
          ol([
            "Cliquez sur « Trouver » et saisissez le nom de la commune.",
            "Sélectionnez la bonne commune : INSEE, département, région et code postal sont récupérés automatiquement.",
            "Enregistrez.",
          ]),
          info("La plupart de ces champs sont réservés au rôle Admin. Le nom et le code INSEE servent de référence à de nombreux écrans (carte, zonage, statistiques)."),
        ),
      },
      {
        slug: "utilisateurs",
        title: "Gérer les utilisateurs et les rôles",
        excerpt: "Créer des comptes agents et définir leurs droits.",
        html: doc(
          p("L'onglet <strong>Paramètres → Utilisateurs</strong> permet de gérer les comptes des agents de la commune."),
          h2("Créer un compte agent"),
          ol([
            "Cliquez sur « + Ajouter un agent ».",
            "Renseignez prénom, nom, e-mail, rôle (et téléphone en option).",
            "Validez : une invitation est envoyée par e-mail. L'agent définit son mot de passe via un lien valable 7 jours.",
          ]),
          h2("Les rôles"),
          ul([
            "<strong>Admin</strong> — administration de la plateforme ;",
            "<strong>Mairie</strong> — supervision et paramétrage de la commune ;",
            "<strong>Instructeur</strong> — instruction des dossiers ;",
            "<strong>Rôles personnalisés</strong> — droits affinés (permissions par section), avec libellé et couleur.",
          ]),
          info("La gestion des utilisateurs requiert le rôle Admin ou la permission adéquate. Les rôles personnalisés masquent automatiquement les sections non autorisées."),
        ),
      },
      {
        slug: "signataires",
        title: "Habiliter les signataires",
        excerpt: "Désigner qui peut signer les arrêtés, avec signature et tampon.",
        html: doc(
          p(
            "L'<strong>habilitation signataire</strong> détermine qui peut signer les arrêtés et courriers de la commune. Elle se gère depuis l'onglet Utilisateurs, via l'icône ✍️ d'un agent.",
          ),
          h2("Accorder une habilitation"),
          ol([
            "Sur la ligne de l'agent, cliquez sur ✍️ (« Signature ADS »).",
            "Choisissez la fonction de signature : Maire, Adjoint au Maire, DGS, Responsable ADS ou Directeur de service.",
            "Renseignez si besoin le numéro d'arrêté de délégation et l'intitulé exact de la fonction.",
            "Téléversez la signature et le tampon (images PNG, fond transparent recommandé) puis accordez l'habilitation.",
          ]),
          info(
            "La signature et le tampon du signataire priment sur ceux définis au niveau de la commune. L'habilitation, et non le rôle, ouvre l'accès à la section « Signatures » et au bouton « Signer ».",
          ),
        ),
      },
      {
        slug: "documents-reglementaires",
        title: "Le référentiel documentaire (PLU, PPRI…)",
        excerpt: "Centraliser les documents réglementaires de la commune.",
        html: doc(
          p(
            "L'onglet <strong>Paramètres → Documents</strong> centralise les documents réglementaires locaux (PLU, PPRI, OAP, PEB…). Ils sont indexés pour assister l'analyse de conformité.",
          ),
          h2("Ajouter un document"),
          ol([
            "Cliquez sur « + Ajouter un document ».",
            "Choisissez le type, donnez un nom, déposez le PDF et ajoutez une synthèse.",
            "Enregistrez : le document est indexé en arrière-plan (« Indexation… » puis « Indexé »).",
          ]),
          h2("Valider un document"),
          p("Validez un document pour qu'il devienne actif pour l'analyse. Modifier sa synthèse le repasse en brouillon (une revalidation est alors nécessaire)."),
          info("Vous pouvez consulter les passages indexés et les annoter (correction, précision, jurisprudence, point d'attention). Seules les synthèses validées alimentent le moteur d'instruction."),
        ),
      },
      {
        slug: "courriers-parametres",
        title: "En-tête et modèles de courrier",
        excerpt: "Le papier à en-tête de la commune et les modèles réutilisables.",
        html: doc(
          p("L'onglet <strong>Paramètres → Courriers</strong> regroupe l'en-tête commun et la bibliothèque de modèles."),
          h2("L'en-tête de la commune"),
          p(
            "Configurez le papier à lettre appliqué à tous les courriers : logo, titre, sous-titre (service), adresse, pied de page, et signature / tampon de repli. Un aperçu s'affiche en direct.",
          ),
          h2("Les modèles de courrier"),
          ol([
            "Cliquez sur « + Nouveau modèle ».",
            "Donnez un nom et une catégorie (demande de pièces, avis favorable, refus, notification de décision…).",
            "Composez le contenu en insérant des variables (numéro de dossier, pétitionnaire, adresse…) qui seront remplacées à la génération.",
          ]),
          info("Les modèles et l'en-tête sont partagés par toute la commune, et s'appliquent à la commune sélectionnée pour les agents multi-communes."),
        ),
      },
      {
        slug: "notifications-parametres",
        title: "Préférences de notifications (commune)",
        excerpt: "Choisir les événements, les canaux et les destinataires.",
        html: doc(
          p("L'onglet <strong>Paramètres → Notifications</strong> règle, au niveau de la commune, les notifications du service."),
          h2("Ce que vous réglez"),
          ul([
            "<strong>Par événement</strong> — activez/désactivez chaque déclencheur (nouveau dossier, dossier assigné, demande de pièces, avis reçu, délai dépassé…) ;",
            "<strong>Canaux</strong> — e-mail, plateforme, SMS ;",
            "<strong>Destinataires</strong> — agents concernés, tous les instructeurs, ou liste personnalisée ;",
            "<strong>Plages horaires</strong> — les notifications hors plage sont envoyées le jour ouvré suivant.",
          ]),
          info("Vos préférences personnelles se règlent séparément dans vos Infos perso (voir « Profil et informations personnelles »). L'onglet « Historique » conserve les notifications reçues."),
        ),
      },
      {
        slug: "integrations",
        title: "Intégrations et services connectés",
        excerpt: "L'état des connexions externes de la plateforme.",
        html: doc(
          p("L'onglet <strong>Paramètres → Intégrations</strong> présente les services externes connectés à la plateforme et leur état (actif, en attente, désactivé)."),
          h2("Exemples de services"),
          ul([
            "Portail ADS / PLAT'AU — dépôt national des autorisations d'urbanisme ;",
            "DGFiP — données foncières et cadastrales ;",
            "Géoportail de l'Urbanisme — documents d'urbanisme (PLU, POS…) ;",
            "Services de signature électronique et d'envoi d'e-mails.",
          ]),
          info("Chaque service indique son statut et propose, selon les cas, une action « Configurer » ou « Activer »."),
        ),
      },
    ],
  },
  // ════════════════════════════════════════════════════════════════════════
  // 8 — MON COMPTE
  // ════════════════════════════════════════════════════════════════════════
  {
    slug: "mon-compte",
    title: "Mon compte",
    icon: "👤",
    description: "Profil, disponibilités, délégations, sécurité et support.",
    articles: [
      {
        slug: "profil",
        title: "Profil et informations personnelles",
        excerpt: "Vos coordonnées, vos communes, vos préférences.",
        html: doc(
          p("Vos <strong>Infos perso</strong> (pastille de profil, en bas du menu) regroupent vos informations et préférences personnelles."),
          h2("Ce que vous y gérez"),
          ul([
            "<strong>À propos</strong> — prénom, nom, téléphone (l'e-mail est en lecture seule) ;",
            "<strong>Communes & rôles</strong> — les communes auxquelles vous avez accès et votre rôle sur chacune ;",
            "<strong>Notifications personnelles</strong> — les événements qui vous alertent ;",
            "<strong>Préférences</strong> — langue, fuseau horaire, format de date, nombre de dossiers par page, thème.",
          ]),
          info("Les autres onglets (Disponibilités, Délégations, Sécurité, Centre d'aide) font l'objet d'articles dédiés dans ce thème."),
        ),
      },
      {
        slug: "disponibilites",
        title: "Disponibilités et absences",
        excerpt: "Déclarer vos jours travaillés, vos horaires et vos congés.",
        html: doc(
          p("L'onglet <strong>Disponibilités</strong> de vos Infos perso informe le service de vos plages de travail et de vos absences."),
          h2("Jours et horaires"),
          ol([
            "Sélectionnez vos jours travaillés (Lun → Dim) et vos horaires de début et de fin.",
            "Enregistrez.",
          ]),
          h2("Déclarer une absence"),
          ol([
            "Cliquez sur « + Nouvelle absence ».",
            "Indiquez les dates, le motif (congés, maladie, formation, autre) et une note éventuelle.",
            "Ajoutez : l'absence apparaît dans « À venir / En cours ».",
          ]),
          info("Pendant une absence active, vos nouveaux dossiers et les échéances proches sont redirigés vers votre chaîne de délégation (voir « Déléguer ses dossiers »)."),
        ),
      },
      {
        slug: "delegations",
        title: "Déléguer ses dossiers",
        excerpt: "Désigner les instructeurs qui prennent le relais en votre absence.",
        html: doc(
          p(
            "L'onglet <strong>Délégations</strong> définit la chaîne d'instructeurs qui reçoivent vos dossiers lorsque vous êtes absent.",
          ),
          h2("Constituer la chaîne"),
          ol([
            "Ajoutez un ou plusieurs délégués via « Ajouter un délégué… ».",
            "Ordonnez-les avec les flèches ↑ ↓ : le 1er est sollicité en priorité.",
            "Enregistrez.",
          ]),
          info(
            "En cas d'absence, le 1er délégué disponible reçoit vos nouveaux dossiers et ceux dont l'échéance tombe pendant l'absence. S'il est lui aussi absent, le système passe au suivant. Sans délégué, vos dossiers restent à votre nom.",
          ),
        ),
      },
      {
        slug: "securite",
        title: "Sécuriser son compte (mot de passe, 2FA)",
        excerpt: "Changer son mot de passe et activer la double authentification.",
        html: doc(
          p("L'onglet <strong>Sécurité / Connexion</strong> de vos Infos perso protège l'accès à votre compte."),
          h2("Mot de passe"),
          p("Saisissez votre mot de passe actuel, puis le nouveau (8 caractères minimum) et sa confirmation, et validez."),
          h2("Double authentification (2FA)"),
          ol([
            "Cliquez sur « Activer la double authentification ».",
            "Scannez le QR code avec une application d'authentification (Google Authenticator, Microsoft Authenticator, FreeOTP…).",
            "Saisissez le code à 6 chiffres pour confirmer l'activation.",
            "Conservez précieusement les codes de secours affichés : ils ne seront plus montrés.",
          ]),
          warn(
            "Les codes de secours ne s'affichent qu'une seule fois et chacun n'est utilisable qu'une fois. Notez-les en lieu sûr : ils permettent de vous reconnecter en cas de perte de votre téléphone.",
          ),
        ),
      },
      {
        slug: "support",
        title: "Aide et contact support",
        excerpt: "Retrouver la documentation et écrire à l'équipe support.",
        html: doc(
          p("L'onglet <strong>Centre d'aide</strong> de vos Infos perso réunit la documentation et le contact du support."),
          h2("Les accès"),
          ul([
            "<strong>Documentation</strong> — ouvre ce centre d'aide (guides sur toutes les fonctionnalités) ;",
            "<strong>Contacter le support</strong> — ouvre un formulaire de message ;",
            "<strong>Questions fréquentes</strong> — lance la documentation sur le sujet choisi.",
          ]),
          h2("Écrire au support"),
          ol([
            "Choisissez le type de demande (question, problème technique, évolution, autre).",
            "Renseignez un sujet et décrivez votre demande, puis envoyez.",
          ]),
          warn(
            "Pour accélérer le traitement, votre nom, votre commune, votre rôle et la page consultée sont joints automatiquement. N'incluez pas de données personnelles d'un pétitionnaire : référencez plutôt le numéro de dossier.",
          ),
        ),
      },
    ],
  },
];
