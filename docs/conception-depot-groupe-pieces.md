# Conception — Dépôt groupé : éclatement d'un dossier déposé en un seul fichier

## Problème

Un pétitionnaire (ou un agent au comptoir) dépose fréquemment un dossier complet
**scanné en un seul PDF** (CERFA + plans + notice + photos) plutôt que pièce par
pièce. Aujourd'hui le système applique la règle « 1 fichier = 1 pièce » : le PDF
entier devient une seule `dossier_pieces_jointes`, ce qui empêche l'analyse de
conformité pièce par pièce et le suivi du bordereau.

**Objectif** : reconnaître automatiquement les pièces réglementaires contenues
dans le PDF, proposer un découpage, et — après validation de l'instructeur —
créer une pièce par document détecté, rangée dans le bon emplacement.

> **Non-régression** : le flux historique « 1 fichier = 1 pièce »
> (`POST /pieces/upload`) reste l'unique chemin par défaut et n'est **pas
> modifié**. Le dépôt groupé est un **endpoint distinct et optionnel**.

## Flux cible

```
Dépôt d'UN PDF complet
  └─[1] POST /pieces/upload-bundle      → stocke le PDF source, crée un « bundle »
        └─[2] segmentBundle() (async)   → texte-d'abord puis vision (Pixtral)
              → classe chaque page, déduit emplacement + type + confiance
        └─[3] status = pending_review   (proposition stockée, AUCUNE pièce créée)
  └─[4] Écran de validation (instructeur) : fusionne / réaffecte / renomme
        └─[5] POST /pieces/bundles/:id/apply → découpe le PDF (pdf-lib),
              crée 1 pièce/segment, relance l'OCR existant (queuePieceOcr)
  └─[6] Correction a posteriori : PATCH /pieces/:pieceId/classification
```

À partir de l'étape [6] tout le pipeline existant (analyse + extraction +
conformité + bordereau) est réutilisé tel quel.

## Modèle de données (additif)

### Table `dossier_piece_bundles`
Conserve le fichier source (artefact auditable) et la proposition de découpage
jusqu'à validation.

| Colonne | Rôle |
|---|---|
| `id`, `dossier_id`, `user_id` | identité, rattachement |
| `nom`, `url`, `storage_key`, `type`, `taille` | fichier source |
| `page_count` | nb de pages du PDF |
| `status` | `segmenting` → `pending_review` → `applied` \| `discarded` \| `failed` |
| `proposed_segments` (jsonb) | proposition IA, éditable avant application |
| `created_at`, `segmented_at`, `applied_at`, `applied_by`, `error` | cycle de vie |

### Colonnes ajoutées sur `dossier_pieces_jointes` (toutes nullable)
| Colonne | Rôle |
|---|---|
| `source_bundle_id` | bundle d'origine (NULL = upload individuel classique) |
| `source_pages` (jsonb) | pages du PDF source couvertes (gère les pages partagées) |
| `code_piece_source` | `auto` \| `instructeur` \| `manuel` — empêche un retraitement IA d'écraser une correction manuelle |
| `nom_origine` | nom du fichier d'origine avant renommage (audit) |
| `classification_confidence` | score 0..1 de la classification |

## Backend

- **`services/pieceSegmenter.ts`**
  - `segmentBundle(buffer, mime, dossierType, trace)` → proposition.
    Texte natif d'abord (`pdftotext`, gratuit) ; à défaut vision
    (`pdftoppm` basse résolution + Pixtral, par lots de 6 pages). Classification
    **par page** (un type peut en porter deux → page partagée), puis
    **regroupement déterministe** (1 segment = 1 code).
  - `applySegmentation(...)` → découpe `pdf-lib`, crée les pièces
    (`code_piece_source = "auto"`), relance `queuePieceOcr`.
- **`services/pieceExtractor.ts`** : `expectedTypeFromCode` étendu aux codes
  **PCMI** (additif) ; ajout du mapping inverse `codeFromType(type, dossierType)`
  et du nommage `defaultPieceName(code, type, pages)`.
- **Routes (`routes/mairie/pieces.ts`)**
  | Méthode | Route | Rôle |
  |---|---|---|
  | POST | `/dossiers/:id/pieces/upload-bundle` | dépose le PDF, lance la segmentation (async) |
  | GET | `/dossiers/:id/pieces/bundles/:bundleId` | proposition + statut (polling) |
  | POST | `/dossiers/:id/pieces/bundles/:bundleId/apply` | applique le découpage validé |
  | POST | `/dossiers/:id/pieces/bundles/:bundleId/discard` | abandonne la proposition |
  | PATCH | `/dossiers/:id/pieces/:pieceId/classification` | recatégorise une pièce (correction) |

  Toutes héritent de l'auth + contrôle IDOR via `enforceDossierAccess`.

## Réponses aux exigences

1. **Catégorisation automatique** — oui : le type est détecté (Pixtral), puis
   converti en emplacement (`codeFromType`) selon `dossiers.type`
   (PCMI / PC / DP). Mapping par défaut : PCMI pour le permis maison individuelle.
2. **Renommage** — oui : « PCMI2 – Plan de masse (p. 3-4) », le nom d'origine
   étant conservé dans `nom_origine`.
3. **Recatégorisation manuelle** — `PATCH .../classification` : met à jour le
   code/type/nom, pose `code_piece_source = "instructeur"`, trace l'action dans
   `instruction_events` (`piece_reclassifiee`). Vaut aussi pour les pièces
   déposées individuellement.
4. **Pages partagées (ex. PCMI2 / PCMI5)** — la classification autorise deux
   types par page ; au regroupement, la page est rattachée à **chaque** pièce
   concernée (dupliquée dans les deux sous-PDF) et signalée `shared`. Aucune
   modification du viewer/extracteur (chaque pièce reste un fichier autonome).

## Fiabilité / coût / RGPD

- **Confiance** : seuil 0,7 ; sous le seuil, ou page partagée, ou photo
  (proche/lointaine ambigu), ou code non déduit → `needs_review` (jamais
  d'application silencieuse).
- **Coût** : texte d'abord (gratuit) ; vision en vignettes basse résolution.
  Tracé dans `ai_usage_events` (`purpose = "bundle_segment"`).
- **Non destructif** : PDF source conservé ; une pièce mal créée est archivée
  (jamais supprimée). Audit via `instruction_events`.

## Lots

- **Lot 1 (livré)** : modèle de données, segmentation texte+vision, application,
  routes, helpers de catégorisation/nommage, écran de validation, recatégorisation.
- **Lot 2** : affinage des pages partagées (édition fine), split/merge avancés.
- **Lot 3** : mode automatique au-dessus d'un seuil de confiance, modèle de
  classification moins cher, re-segmentation d'un bundle existant.
