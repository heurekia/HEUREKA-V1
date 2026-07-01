# Conception — PLUi & groupements de communes (porteur EPCI)

| Champ | Valeur |
|-------|--------|
| Statut | Implémenté (Lots 1a → 4) — dette transitoire documentée §7 |
| Date | 1er juillet 2026 |
| Périmètre | `packages/db`, `packages/ingestion`, `packages/regulatory-engine`, `apps/api`, `apps/web` |
| Lecteurs cibles | Équipe technique, produit |
| Compagnon | `docs/conception-interpretation-zonage.md` (moteur multi-documents), `docs/document-technique.md` (architecture) |

> Objectif : permettre qu'un **PLU intercommunal (PLUi)** — porté par un groupement de communes (EPCI) et non par une commune unique — soit ingéré **une seule fois** et s'applique automatiquement à **toutes les communes membres** qu'il couvre, sans dupliquer zones ni règles.

---

## 1. Contexte & problème

Le modèle initial posait un axiome simple : **un document réglementaire appartient à une commune**. La table s'appelait `commune_documents`, ses zones et ses règles étaient rattachées à `commune_id`, et le moteur résolvait les règles applicables par `zones.commune_id`.

Cet axiome tombe avec le PLUi. Un PLUi est :
- **porté par un EPCI** (communauté de communes, communauté d'agglomération, métropole…), pas par une commune ;
- **applicable à N communes membres** simultanément — souvent plusieurs dizaines ;
- **livré comme un corpus unique** (un règlement, un zonage), parfois éclaté en plusieurs PDF (par tome ou par type de zone).

Rattacher naïvement un PLUi à « une commune » forcerait à :
- dupliquer le document, les zones et les règles pour chaque commune membre (44 copies d'un même règlement pour une CC de 44 communes) ;
- re-ingérer et re-valider N fois le même texte ;
- désynchroniser les copies à la moindre correction.

La refonte généralise le modèle **« document communal »** en **« document réglementaire à porteur polymorphe »** : commune **ou** EPCI, avec un périmètre d'applicabilité explicite et partagé.

## 2. Vocabulaire

- **EPCI** — Établissement Public de Coopération Intercommunale. Le « groupement de communes » : CC, CA, CU, métropole. Table `epci`.
- **Porteur** — l'entité juridique propriétaire d'un document réglementaire. Exactement une commune **ou** un EPCI.
- **Commune membre** — commune rattachée à un EPCI (`communes.epci_id`).
- **Commune couverte** — commune membre effectivement soumise à un document donné (via `document_communes`). Permet un **déploiement progressif** : un PLUi peut ne couvrir que 3 communes pilotes sur 44.
- **PLUi / PLUm** — PLU intercommunal / métropolitain. Membres de la « famille PLU » (`PLU_FAMILY_TYPES = plu | plui | plum`), celle qui produit un zonage + des règles structurées.

## 3. Modèle de données

### 3.1 Porteur polymorphe

`regulatory_documents` (anciennement `commune_documents`) porte trois colonnes de rattachement :

| Colonne | Rôle |
|---|---|
| `porteur_commune_id` | Renseigné pour un document **communal**. |
| `porteur_epci_id` | Renseigné pour un document **intercommunal** (PLUi). |
| `commune_id` | **Rétro-compat** — commune « propriétaire » historique. Voir §7. |

**Invariant clé (contrainte SQL `regulatory_documents_porteur_xor`)** :

```sql
CHECK ((porteur_commune_id IS NOT NULL) <> (porteur_epci_id IS NOT NULL))
```

Exactement **un** des deux porteurs est renseigné. Le XOR est garanti en base, pas seulement côté application.

### 3.2 Périmètre d'applicabilité — `document_communes`

Table de jointure N:N **source de vérité** du périmètre :

| Cas | Lignes dans `document_communes` |
|---|---|
| PLU strictement communal | 1 (le document → sa commune) |
| PLUi | N (le document → chaque commune couverte) |

Contrainte d'unicité `(document_id, commune_id)`, index sur les deux colonnes. FK `ON DELETE CASCADE` des deux côtés.

### 3.3 Zones partagées

En mode PLUi, les `zones` sont insérées **une seule fois** avec :
- `commune_id = NULL` (la zone n'appartient à aucune commune en particulier) ;
- `source_document_id` = l'id du document PLUi.

La résolution « quelles zones pour la commune X » ne passe donc **pas** par `zones.commune_id` mais par la chaîne `document_communes → source_document_id` (cf. §5). C'est ce qui évite la duplication : une zone `UA` du PLUi existe une fois, vue par les N communes couvertes.

### 3.4 Schéma relationnel

```
        epci ──────────────┐ porteur_epci_id
          │ id             │
          │ epci_id        ▼
     communes ◄──── regulatory_documents ──── porteur_commune_id (XOR)
          ▲                │ id
          │                │
          │        ┌───────┴────────┐  source_document_id
          │        ▼                ▼
   document_communes            zones ──────► zone_regulatory_rules
   (document_id,               (commune_id NULL       (source_document_id)
    commune_id)                 en mode PLUi)
```

## 4. Ingestion — `packages/ingestion/src/db/rules-loader.ts`

`loadRules()` est **document-centric** (Lot 3) : la purge avant réinsertion est indexée sur `source_document_id`, pas sur `commune_id`. Conséquence : ré-ingérer un PLU ne touche plus aux zones/règles d'un autre document de la même commune (PPRI, OAP…).

Deux régimes selon l'option `epci` :

| | Mode communal (défaut) | Mode PLUi (`opts.epci` fourni) |
|---|---|---|
| Porteur | `porteur_commune_id` = la commune | `porteur_epci_id` = l'EPCI |
| Communes rattachées | 1 (la porteuse) | N membres (`EpciPorteur.communes[]`, upsert par INSEE) |
| `zones.commune_id` | la commune | **NULL** |
| Type par défaut | `plu` | `plui` |

Les communes membres sont **upsertées par code INSEE** (`upsertCommune`) puis rattachées via `document_communes`.

## 5. Résolution côté moteur — `packages/regulatory-engine/src/context/builder.ts`

`loadCandidateRuleIds()` résout les règles applicables à une commune par **union de deux chemins** :

1. **Voie moderne (document-centric)** — `document_communes` → `zone_regulatory_rules.source_document_id`. Couvre nativement les PLUi (1 document → N communes) *et* les PLU communaux (1 document → 1 commune). Toute règle ingérée depuis le Lot 3 passe par là.

2. **Fallback (commune-centric)** — `zones.commune_id`, restreint à `source_document_id IS NULL`. Rattrape les règles **créées à la main** via `POST /reglementation/zones/:zoneId/rules`, qui ne posent pas de `source_document_id`.

Les deux ensembles sont filtrés sur `validation_status = 'valide'` puis unionnés (dédup par `Set<id>`). Pendant la cohabitation, l'union est **strictement ≥** la requête historique unique : aucun risque de masquer une règle existante.

> **Pourquoi deux chemins.** La voie moderne seule perdrait les règles manuelles non taguées. Le fallback seul ne verrait pas les zones PLUi (dont `commune_id` est NULL). L'union est la seule forme correcte tant que le corpus n'est pas intégralement tagué — cf. condition de retrait §7.

## 6. API & UI

### 6.1 Routes (`apps/api/src/routes/superAdmin.ts`)

CRUD des documents portés par un EPCI, tout dérivé du modèle documentaire (rien stocké en double) :

| Verbe & route | Rôle |
|---|---|
| `GET /admin/epci/:id/documents` | Liste les documents du groupement + couverture (`N/M communes`). |
| `POST /admin/epci/:id/documents` | Crée un document PLUi. `commune_ids` optionnel → toutes les membres par défaut, sinon sous-ensemble (déploiement progressif). |
| `PATCH /admin/epci/:id/documents/:docId` | Métadonnées + `validation_status` (horodate/impute le validateur au passage à `valide`). |
| `PUT /admin/epci/:id/documents/:docId/communes` | Remplace **l'intégralité** du périmètre (sync atomique add/remove). Refuse une liste vide (« supprimez le document plutôt »). |
| `DELETE /admin/epci/:id/documents/:docId` | Supprime le document **et** les zones/règles dérivées (même transaction). |

**Garde-fou transversal** : toute commune passée en paramètre est filtrée contre les membres réels de l'EPCI (`communes.epci_id`). Une commune externe est rejetée en 400 — signal de bug côté appelant.

### 6.2 Ingestion PDF EPCI-aware (`apps/api/src/routes/mairie/admin.ts`)

Le flux `POST /admin/ingest-plu-pdf/start` accepte un `doc_id` (créé en amont) et **plusieurs PDF** (`pdfs_base64[]` — un PLUi peut être livré en plusieurs tomes). Il détecte le mode via `doc.porteur_epci_id` :

- `isEpciDoc = true` → `zoneCommuneId = null`, zones partagées, `source_document_id` propagé.
- Repli **sommaire manuel** (`no_toc`, 422) quand la détection auto échoue sur un mono-PDF volumineux.

### 6.3 Web (`apps/web/src/pages/admin/SuperAdminApp.tsx`)

Encart « documents » dans la fiche EPCI du SuperAdmin : upload multi-PDF, suivi d'extraction avec reprise (jobId en `localStorage`), affichage de la couverture *« 3 / 44 communes couvertes »*, édition du périmètre et du statut de validation.

## 7. Dette transitoire & conditions de retrait

Trois éléments de rétro-compat subsistent **volontairement**. Ils ne bloquent pas le fonctionnement mais devront être retirés — **pas à l'aveugle**.

| Élément | Où | Condition de retrait |
|---|---|---|
| `regulatory_documents.commune_id` | schéma + backfills | Tous les documents ont un `porteur_*` renseigné et plus aucun consommateur ne lit `commune_id`. |
| Fallback chemin 2 de `loadCandidateRuleIds()` | `builder.ts` | **Toutes** les règles `valide` ont un `source_document_id` non NULL. |
| Note rétro-compat `document_communes` | `documentCommunes.ts` | Idem : `loadRules()` et le moteur ne s'appuient plus que sur `document_communes`. |

**Requête de contrôle avant tout retrait du fallback** — combien de règles validées restent non taguées :

```sql
SELECT count(*)
FROM zone_regulatory_rules
WHERE validation_status = 'valide'
  AND source_document_id IS NULL;
```

Tant que ce compte est > 0, retirer le chemin 2 **fait disparaître silencieusement ces règles** de l'analyse. Le retrait doit être précédé d'un backfill (rattacher ces règles à un document) ou d'une acceptation explicite.

## 8. Correspondance des « Lots »

Nomenclature interne des commentaires de migration (`packages/db/src/migrate.ts`) :

| Lot | Contenu | Statut |
|---|---|---|
| **1a** | Colonnes `porteur_commune_id` / `porteur_epci_id` + XOR + table `document_communes` + backfill 1:1 | ✅ |
| **1b** | Rename `commune_documents` → `regulatory_documents` (+ objets dépendants, idempotent) | ✅ |
| **2** | `zone_regulatory_rules.source_document_id` + backfill (PLU le + récent de la commune) | ✅ |
| **3** | `zones.source_document_id` + `loadRules()` document-centric (purge par document, mode EPCI) | ✅ |
| **4** | Résolution moteur par `document_communes` (union des deux chemins) | ✅ |

## 9. Comment déployer un PLUi (bout en bout)

1. Créer l'EPCI et importer ses communes membres (`POST /admin/epci/import`).
2. Créer le document PLUi (`POST /admin/epci/:id/documents`, type `plui`) — couverture totale ou pilote.
3. Uploader le(s) PDF depuis l'encart EPCI du SuperAdmin → extraction des règles (statut `brouillon`).
4. Valider les synthèses / règles (`validation_status = 'valide'`) — gate juridique avant lecture par le moteur.
5. À l'analyse d'une parcelle, le moteur résout les règles de la commune via `document_communes`, sans qu'aucune donnée n'ait été dupliquée.
