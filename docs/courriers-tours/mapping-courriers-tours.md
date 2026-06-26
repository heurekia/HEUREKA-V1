# Mapping des modèles de courrier de Tours Métropole → Heureka

> **Statut : à valider ensemble** (étape « valider le mapping d'abord »).
> Aucune ligne de code ni schéma n'est encore touché. Ce document fige la
> correspondance avant développement.

## 1. Nature des 17 modèles

Modèles **mail-merge Word (logiciel ADS Operis)**, **mutualisés sur toute Tours
Métropole Val de Loire** (Tours `37261`, mais aussi Berthenay `37025`,
Mettray `37152`, Villandry `37272`, Rochecorbon `37203`, Chambray `37050`,
Notre-Dame-d'Oé, Saint-Genouph `37219`, Parçay, Chanceaux, Druye, Savonnières…).

Conséquence directe : une grande partie du contenu est de la **plomberie
multi-commune** qui n'a **pas lieu d'être chez Heureka** (où chaque commune a
déjà son en-tête/signature) :

- `IF CommuneInseeCode = "37261"…` → bascule logo / signataire / mentions par commune.
- `INCLUDETEXT "Q:\…\logo TOURS.doc"` → insertion du logo communal.
- Blocs signataire (maire/adjoint) dupliqués par commune.

➡️ **On supprime cette plomberie** : elle est remplacée par le système
`commune-letterhead` existant (logo, titre, sous-titre, adresse, `footer_text`,
`signature_image`, `tampon_image`), déjà géré par commune.

## 2. Inventaire → catégorie Heureka

| # | Modèle Tours | Type dossier | Objet | Catégorie Heureka |
|---|---|---|---|---|
| 1 | AA_Demande de pièces manquantes | tous | Demande de pièces complémentaires | `pieces_complementaires` |
| 2 | AA_Majoration Délai ABF PPMH | tous | Majoration de délai (monument hist.) | **`majoration_delai`** (à créer) |
| 3 | AA_Majoration Délai ABF PSMV | tous | Majoration de délai (secteur sauvegardé) | **`majoration_delai`** |
| 4 | AA_Pieces manquantes et Majoration ABF PPMH | tous | Pièces + majoration délai | `pieces_complementaires` |
| 5 | AA_Pieces manquantes et Majoration ABF PSMV | tous | Pièces + majoration délai | `pieces_complementaires` |
| 6 | CU_CUA 0Simple_F | CUa | Certificat d'urbanisme informatif | `notification_decision` |
| 7 | DP_1Non opposition_F | DP | Décision de non-opposition | `avis_favorable` |
| 8 | DP_2Non opposition TAXES_F | DP | Non-opposition + volet taxes | `avis_favorable` (variante taxes) |
| 9 | PC_1Favorable_F | PC | Arrêté favorable | `avis_favorable` |
| 10 | PC_2Favorable Taxes_F | PC | Favorable + volet taxes | `avis_favorable` (variante taxes) |
| 11 | PC_3Defavorable_D | PC | Refus | `avis_defavorable` |
| 12 | PC_Majoration Délai ABF PPMH et ERP | PC | Majoration de délai (ABF + ERP) | **`majoration_delai`** |
| 13 | PC_Majoration Délai ABF PSMV et ERP | PC | Majoration de délai (ABF + ERP) | **`majoration_delai`** |
| 14 | PC_Modif Favorable Taxes_F | PC modificatif | Permis modificatif favorable + taxes | `avis_favorable` |
| 15 | PC_Pieces manquantes et Majoration ABF PPMH et ERP | PC | Pièces + majoration | `pieces_complementaires` |
| 16 | PC_Pieces manquantes et Majoration ABF PSMV et ERP | PC | Pièces + majoration | `pieces_complementaires` |
| 17 | PC_Pieces manquantes et Majoration ERP | PC | Pièces + majoration (ERP) | `pieces_complementaires` |

**4 familles fonctionnelles :** pièces manquantes (6) · majoration de délai (4) ·
décisions favorables (6) · refus (1).

## 3. Dictionnaire de correspondance (champs Operis → variables Heureka)

Légende statut : ✅ existe déjà · 🟡 donnée déjà en base, à exposer · 🔴 donnée
absente, à créer + alimenter · ⚪ plomberie à supprimer.

| Concept | Champs Operis bruts | Variable Heureka | Statut | Source d'alimentation |
|---|---|---|---|---|
| N° / désignation dossier | `DossierNom`, `DossierDesignation` | `numero_dossier` | ✅ | — |
| Type de dossier | `dossiermodelecode/nom` | `type_dossier` | ✅ | — |
| Date de dépôt | `DateDepot` | `date_depot` | ✅ | — |
| Date de complétude | `completudedate` | `date_completude` | ✅ | — |
| Date limite d'instruction | `limiteinstructiondate` | `date_limite_instruction` | ✅ | — |
| Adresse des travaux | `DOSADR1NUMVOIE/TYPEVOIE/LIBVOIE/BTVOIE/EXCIPIENT`, `DosAdr1Complement` | `adresse_travaux` | ✅ | — |
| Références cadastrales | `RefCad` | `parcelle` | ✅ | — |
| Commune (nom) | `CommuneINSEENom` | `commune` / `nom_service` | ✅ | — |
| Coordonnées mairie | `CommuneINSEEAdr*`, `CommuneInseemel`, `communeinseetelephone1`, `CommuneINSEEfax` | `coordonnees_mairie` (en-tête) | ✅ | letterhead |
| Direction / service | `CommuneINSEEDIRECTIONNOM`, `CommuneINSEESERVICENOM` | `service_instructeur` | ✅ | letterhead |
| Agent instructeur (nom) | `InstrNom`, `InstrPrenom` | `nom_agent` | ✅ | — |
| Demandeur (nom) | `demandeur` | `demandeur_nom` | ✅ | — |
| Surface de plancher créée | `TOTALSHONCREE` | `surface_plancher` | ✅ (≈) | — |
| **Description projet / nature travaux** | `Projetcomment`, `DM_Projet_Desc`, `PDCOMMENT` | `description_projet` *(nouv.)* | 🟡 | `dossiers.description` (existe) |
| **Coordonnées agent** | `INSTRTELEPHONE1/2`, `INSTRMEL` | `agent_tel`, `agent_email` *(nouv.)* | 🟡 | `users.telephone` / `users.email` |
| Date d'incomplétude | `incompletudedate` | `date_incompletude` *(nouv.)* | 🟡 | instruction (ou = date courrier) |
| Date début d'affichage | `datedebaffich` | `date_debut_affichage` *(nouv.)* | 🟡 | instruction |
| **Civilité / qualité demandeur** | `DEMANDQUALITE`, `Demandcategorie` | `demandeur_civilite` *(intégré)* | ✅ | dépôt citoyen (`cerfa_data.civilite`) → OCR → manuel |
| **Adresse postale demandeur** | `DEMANDADRNUMVOIE/TYPEVOIE/LIBVOIE/BTVOIE/EXCIPIENT`, `DemandAdrComplement`, `DemandAdrBP`, `DemandAdrCodePostal`, `DemandAdrCommune`, `DemandAdrCedex` | `demandeur_adresse` *(intégré, composé)* | ✅ | dépôt citoyen (`cerfa_data.adresseDemandeur*`, fallback terrain) → OCR → manuel |
| **Mandataire / représentant** | `representant`, `REPRESNOM`, `REPRESPRENOM`, `REPRESQUALITE` | `mandataire_nom`, `mandataire_qualite` *(nouv.)* | 🔴 | CERFA → OCR → manuel |
| **Destinataire (si ≠ demandeur)** | `destinataire`, `destinataireadresse`, `DestAdr*` | `destinataire_*` *(nouv., dérivé)* | 🔴 | logique (mandataire sinon demandeur) |
| **Surfaces & comptages détaillés** | `TotalShonDemoli`, `lognbcrees`, `totalnbcree`, `PROJETSHOB`, `PROJETSURFACE` | `surface_demolie`, `nb_logements`, `nb_batiments`, `surface_terrain` *(nouv.)* | 🔴 | CERFA → OCR → manuel |
| **Signataire (maire/adjoint)** | `COMMUNEINSEERESPNOM/PRENOM/QUALITE/FONCTION` | `signataire_nom`, `signataire_fonction` *(nouv.)* OU image | ⚠️/🔴 | config commune (cf. §6) |
| Destination du projet | `S_SEP_STD_DESTINATION` | `destination_projet` *(nouv.)* | 🔴 | CERFA → OCR → manuel |
| Dispositions d'urbanisme (texte) | `S_TXT_STD_DOSDISURB_COMMENT` | `dispositions_urbanisme` *(nouv.)* | 🔴 | moteur réglementaire / manuel |
| Commentaire zone PLU | `S_TXT_STD_DOSZONE_COMMENT` | `zone_plu_comment` *(nouv.)* | 🔴 | moteur réglementaire / manuel |
| Lotissement | `DOSLTNOM` | `lotissement` *(nouv., rare)* | 🔴 | manuel |

### Plomberie supprimée (⚪)
`CommuneInseeCode` (+ tous les `IF` par commune), `INCLUDETEXT` (logos),
`cb_decisionpc`, switches de format Word `\* Caps` / `\* Lower` / `\@ "dd MMMM yyyy"`
(on reformate proprement côté Heureka).

## 4. Variables dynamiques — créées vs. absentes

### 4.a ✅ Créées maintenant (données réellement présentes dans l'outil)

Ajoutées au catalogue `TEMPLATE_VARIABLES` + câblées dans `MairieCourrierScreen` :

| Variable | Source réelle | Vérifié |
|---|---|---|
| `description_projet` | `dossiers.description` (saisi à la création / OCR, renvoyé par la route détail mairie) | route `dossiers.ts:121,219`, capté `dossiers.ts:878,1283` |
| `agent_tel` | `users.telephone` exposé via `user` (auth) | `useAuth` `User.telephone` |
| `agent_email` | `users.email` exposé via `user` (auth) | `useAuth` `User.email` |
| `demandeur_email` *(corrigé)* | `dossier.petitionnaire_email` (était figé à « — ») | `DossierInfo.petitionnaire_email`, route `dossiers.ts:222` |

### 4.b 🔴 Absentes — à alimenter par enrichissement (cf. §11)

Non créées pour l'instant : aucune donnée ne circule encore dans l'outil.

| Variable cible | Champ Operis | Modèle CERFA existant (`CerfaPcmiData`) |
|---|---|---|
| `demandeur_civilite` ✅ *intégré* | `DEMANDQUALITE` | `cerfa_data.civilite` (saisi au dépôt citoyen) |
| `demandeur_adresse` ✅ *intégré* | `DEMANDADR*` | `cerfa_data.adresseDemandeur*` (D3*), fallback adresse terrain |
| `mandataire_nom`, `mandataire_qualite` | `representant`, `REPRES*` | `societe_representant*` (D2*) ✔ |
| `destinataire_bloc` | `destinataire*` | dérivé (mandataire sinon demandeur) |
| `destination_projet` | `S_SEP_STD_DESTINATION` | `destinationActuelle/Future/Usage` ✔ |
| `surface_demolie` | `TotalShonDemoli` | `surfaceSupprimee` ✔ |
| `surface_terrain` | `PROJETSURFACE` | (terrain) |
| `nb_logements`, `nb_batiments` | `lognbcrees`, `totalnbcree` | (logements) |
| `dispositions_urbanisme` | `S_TXT_STD_DOSDISURB_COMMENT` | — (moteur réglementaire / manuel) |
| `zone_plu_comment` | `S_TXT_STD_DOSZONE_COMMENT` | — (moteur réglementaire / `conformite_analysis`) |
| `signataire_nom`, `signataire_fonction` | `COMMUNEINSEERESP*` | — (config commune, cf. §6) |
| `date_incompletude`, `date_debut_affichage` | `incompletudedate`, `datedebaffich` | — (events d'instruction) |

## 5. Nouvelle catégorie de courrier

Ajouter `majoration_delai` à `CATEGORY_CONFIG` (4 modèles concernés).
Proposition d'affichage : libellé « Majoration de délai », teinte ambre/indigo.

## 6. Point à trancher — le signataire

Tours imprime un signataire **texte** (nom + fonction du maire/adjoint, ex.
« Le Conseiller Municipal Délégué à l'Urbanisme »). Heureka gère aujourd'hui la
signature par une **image** (`signature_image`) au niveau commune.

Deux options :
- **(a)** Garder l'image de signature (statu quo) — le nom/fonction est dans l'image.
- **(b)** Ajouter `signataire_nom` + `signataire_fonction` à la config commune
  (`commune-letterhead`) pour un rendu texte + image. Plus fidèle à Tours.

## 7. Jetons internes Operis (`S_SEP_*` / `S_TXT_*`)

Ce sont des blocs de texte tirés de la base ADS d'Operis. Équivalents Heureka :

| Jeton Operis | Sens | Traitement Heureka proposé |
|---|---|---|
| `S_SEP_STD_DESTINATION` | Destination/usage du projet | variable `destination_projet` |
| `S_TXT_STD_DOSDISURB_COMMENT` | Dispositions d'urbanisme (les « Vu le… ») | variable `dispositions_urbanisme` (moteur régl. / manuel) |
| `S_TXT_STD_DOSZONE_COMMENT` | Commentaire zone PLU | variable `zone_plu_comment` |
| `S_TXT_STD_DOSSERVA/DOSOPE/DOSSERVUP` | Servitudes / opérations | zone manuelle (rare) |

## 8. Transformations structurelles

1. **Conditionnels par commune** → supprimés (en-tête/signature par commune Heureka).
2. **Volets « TAXES »** (DP_2, PC_2, PC_Modif) → **modèles séparés** (comme Tours le
   fait déjà), catégorie identique + suffixe « (avec taxes) ». Pas de moteur de
   conditions à introduire.
3. **Conditionnels intra-doc légers** (`IF RepresNom = "" …`) → gérés nativement :
   une variable vide ne s'affiche pas / la ligne se replie.
4. **Mise en page** → reconstruite au format Heureka (en-tête letterhead + corps
   HTML/canvas), pas de reprise du gabarit Word.

## 9. Couverture par modèle (variables 🔴 mobilisées)

| Modèle | adresse demandeur | civilité | mandataire | surfaces détaillées | destination | dispositions urb. |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| Pièces manquantes (×6) | ✔ | ✔ | ✔ | ✔ | | |
| Majoration délai (×4) | ✔ | ✔ | ✔ | ✔ | | |
| Favorables DP/PC/CU (×6) | ✔ | | ✔ | ✔ | ✔ | ✔ |
| Refus PC (×1) | ✔ | | ✔ | ✔ | ✔ | ✔ |

## 10. Points à valider avant développement

- [ ] La table de correspondance §3 est correcte / complète ?
- [ ] On crée bien les variables 🔴 du §4 (vs. en laisser certaines en zone manuelle) ?
- [ ] Catégorie `majoration_delai` : OK pour le libellé/couleur ?
- [ ] Signataire : option (a) image seule ou (b) nom+fonction structurés ?
- [ ] Volets « taxes » en modèles séparés : OK ?
- [ ] Ordre d'intégration des 17 une fois le mapping figé.

## 11bis. Avancement de l'intégration

| Modèle | État | Notes |
|---|---|---|
| **Demande de pièces manquantes** | ✅ **intégré** | Catégorie `pieces_complementaires`. Liste des pièces ← `liste_pieces_a_completer`. Seed `pnpm -F @heureka-v1/api seed:courrier-tours` (idempotent, communes de Tours Métropole). Civilité et adresse du demandeur désormais branchées sur `cerfa_data` (`demandeur_civilite` / `demandeur_adresse`) ; restent manuelles : destinataire (si ≠ demandeur) et signataire. |
| 16 autres modèles | ⏳ à venir | Même gabarit une fois ce 1er modèle validé. |

Données : `apps/api/src/scripts/tours-courrier-templates.ts` (corps des modèles),
runner `seed-courrier-templates-tours.ts`.

## 11. Plan d'enrichissement pour les champs absents (§4.b)

Bonne nouvelle : la quasi-totalité des données absentes est **déjà modélisée**
dans le code, dans `apps/api/src/services/cerfaPcmiFiller.ts` →
`interface CerfaPcmiData` (adresse demandeur `D3*`, représentant société `D2*`,
destination, surfaces créée/supprimée/existante, logements). Le modèle existe ;
ce qui manque, c'est de **persister** cette structure sur le dossier et de
l'**alimenter**.

### Brique commune : persister les données CERFA sur le dossier
Ajouter un `dossiers.cerfa_data jsonb` (typé `CerfaPcmiData`) — ou normaliser
`dossiers.metadata`. Une seule source de vérité, consommée à la fois par le
remplisseur CERFA (déjà existant) **et** par les variables de courrier.

### Les 3 sources d'alimentation (cascade demandée)
1. **Front Citoyen — CERFA complet** *(branchement en cours)* : le wizard de
   dépôt remplit `cerfa_data`. Source primaire, la plus fiable.
2. **Import OCR** : l'OCR du CERFA déposé peuple `cerfa_data` (mêmes champs).
   `dossiers.ts:1283` lit déjà un `parsed.description` → étendre au reste.
3. **Saisie manuelle agent** *(fallback)* : un volet « Données CERFA » éditable
   sur le dossier mairie pour compléter/corriger (CERFA absent, OCR partiel).

➡️ Une fois `cerfa_data` en place, les variables `demandeur_adresse`,
`mandataire_*`, `destination_projet`, `surface_demolie`, `nb_logements`…
se branchent **directement** dessus — sans nouveau modèle de données.

### Cas particuliers
- **Signataire** (`signataire_nom`/`fonction`) : `ROLE_LABELS` (maire, adjoint,
  DGS, responsable ADS, directeur) existe déjà côté décision. Enrichissement =
  exposer le signataire choisi à la décision, ou l'ajouter à la config commune.
- **Dispositions d'urbanisme / zone PLU** : Heureka a un moteur réglementaire +
  interprétation de zonage + `conformite_analysis` sur le dossier. Cible :
  alimenter `zone_plu_comment` depuis la zone déterminée ; `dispositions_urbanisme`
  reste manuel à court terme.
- **Dates `incompletude` / `debut_affichage`** : dérivables des events
  d'instruction (date de demande de pièces ; date de décision/affichage).
