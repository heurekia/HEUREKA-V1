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
| **Civilité / qualité demandeur** | `DEMANDQUALITE`, `Demandcategorie` | `demandeur_civilite` *(nouv.)* | 🔴 | CERFA → OCR → manuel |
| **Adresse postale demandeur** | `DEMANDADRNUMVOIE/TYPEVOIE/LIBVOIE/BTVOIE/EXCIPIENT`, `DemandAdrComplement`, `DemandAdrBP`, `DemandAdrCodePostal`, `DemandAdrCommune`, `DemandAdrCedex` | `demandeur_adresse` *(nouv., composé)* | 🔴 | CERFA → OCR → manuel |
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

## 4. Nouvelles variables dynamiques à créer

Regroupées par famille (s'ajoutent au catalogue `TEMPLATE_VARIABLES`) :

**Demandeur / destinataire** (source : CERFA → OCR → saisie agent)
- `demandeur_civilite` — M. / Mme / Société…
- `demandeur_adresse` — bloc adresse complet (composé des sous-champs)
- `mandataire_nom`, `mandataire_qualite`
- `destinataire_bloc` — résolu : mandataire si présent, sinon demandeur

**Projet** (source : CERFA / OCR / dossier existant)
- `description_projet` — depuis `dossiers.description` (déjà en base)
- `destination_projet`
- `surface_demolie`, `nb_logements`, `nb_batiments`, `surface_terrain`

**Instruction / agent**
- `agent_tel`, `agent_email` — depuis `users` (déjà en base)
- `date_incompletude`, `date_debut_affichage`

**Réglementaire** (source : moteur réglementaire Heureka / manuel)
- `dispositions_urbanisme`, `zone_plu_comment`

**Signataire** (cf. §6 — décision à prendre)
- `signataire_nom`, `signataire_fonction`

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
