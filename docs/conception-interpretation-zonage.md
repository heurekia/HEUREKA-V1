# Conception — Interprétation de zonage & moteur multi-documents

| Champ | Valeur |
|-------|--------|
| Statut | Brouillon de conception (à valider) |
| Date | 22 juin 2026 |
| Périmètre | `apps/api` (services zonage / parcelle / faits), `packages/regulatory-engine`, `packages/ingestion`, `packages/db`, `packages/shared` |
| Lecteurs cibles | Équipe technique, produit |
| Compagnon | `docs/document-technique.md` (architecture), `docs/plan-deploiement.md` (roadmap) |

> Objectif : passer d'un moteur centré PLU à un moteur **multi-documents** (PPRI, PEB, PPRT, OAP, SCOT…), en généralisant l'**interprétation de zonage** : pour une parcelle donnée, résoudre toutes les zones réglementaires applicables, en extraire les attributs décisifs (cote de référence, constructibilité…), puis croiser ces zones avec les règlements pour alimenter le moteur de conformité.

---

## 1. Contexte & problème

Aujourd'hui, les documents type PPRI, OAP, PEB sont **stockés mais peu exploités** : pas d'indexation utilisable, pas de résolution de zone, pas d'évaluation. Le moteur ne sait raisonner que sur le **PLU**.

Or l'instruction d'un dossier exige de croiser plusieurs zonages superposés :
- le **PLU** (zones U/AU/A/N) — *conformité* à des seuils,
- les **servitudes / risques** (PPRI, PPRT, PPRN, PEB) — *constructibilité* et prescriptions par zone d'aléa, **opposables et supérieures au PLU**,
- les **OAP** — rapport de *compatibilité* (qualitatif), pas de conformité.

## 2. État des lieux (ce qui existe)

| Brique | Fichier | État |
|---|---|---|
| Résolution de zonage **PLU** | `apps/api/src/services/pluZones.ts` | **Mature** : sonde multi-conventions GPU → cache GeoJSON commune (`communes.plu_zones_geojson`) → point-in-polygon local (`findZoneAtPoint`, ~L.507) |
| Cache GPU parcelle (SUP, prescriptions) | `packages/db/src/schema/gpuCache.ts` | **Présent mais sous-exploité** : `sup_surf` (`/assiette-sup-s`, dont PM1 = PPRI), `prescriptions` (`/prescription-surf`), `generateurs` déjà mis en cache, mais utilisés pour la **détection de présence** seulement |
| Lecture « instruction » des risques | `packages/shared/src/riskTriage.ts` | **Bon** : traduit l'aléa en conséquence actionnable (3 niveaux opposable / PAC / informatif) ; `PM1` → « appliquer le règlement de zone (cote, prescriptions) » mais reste de l'**affichage** |
| Tags d'applicabilité | `packages/regulatory-engine/src/context/applicability_tags.ts` | `inondable`, `zone_<code>`, `oap`… déjà dérivés |
| Table `zones` | `packages/db/src/schema/zones.ts` | **Générique** : `geometry`, `zone_type`, `source_document_id`, `constraints`, `parent_zone_code` — peut accueillir des zones non-PLU sans migration |
| Faits dossier | `packages/db/src/schema/dossier_facts.ts` | `source` + `confidence` + `superseded_at` — modèle idéal pour porter la provenance d'une zone résolue |
| Adaptateurs d'ingestion | `packages/ingestion/src/adapters/` | `plu-reglement` complet ; `plu-oap` et `ppri` = **stubs** (`detectSegments() → []`) |
| RAG | `packages/db/src/schema/documentSegments.ts` | `doc_type` agnostique (`ppri` accepté) mais vide faute d'adaptateur |
| Évaluateurs | `packages/regulatory-engine/src/evaluators/` | `hauteur`, `recul_voie`, `recul_limite`, `emprise`, `stationnement` — **aucun** évaluateur risque |

**Constat clé** : la matière première spatiale du PPRI est déjà en cache. « Interpréter le zonage » consiste largement à **promouvoir ces géométries brutes en une couche de zonage résolue, multi-documents et requêtable**.

## 3. Décisions actées

### 3.1 Sens de « interprétation de zonage » — séquencement

1. **Résolution spatiale multi-couches** (socle) — réutilise le patron PLU + les géométries déjà en cache.
2. **Croisement zonage × règlement** (finalité) — la zone résolue déclenche les règles applicables et le moteur.
3. **Lecture des plans PDF par vision** (*fallback* uniquement) — pour les communes sans géométrie dans le GPU, en mode **assisté** (la vision propose, l'instructeur valide ; jamais opposable en automatique).

### 3.2 Maille de décision

- **Baseline = parcelle + gestion « à cheval »** : résoudre **toutes** les zones touchées avec leur **% de couverture**, lever un drapeau `zone_a_cheval`. Lecture juridiquement correcte (la règle la plus stricte s'applique par partie).
- **Raffinement = emprise du projet** quand l'implantation est extraite (plan de masse) : précise la zone réellement sous le bâti, décisive pour le verdict.
- **Centroïde : écarté** (faux pour les parcelles à cheval — limite actuelle de `findZoneAtPoint`).

### 3.3 Hiérarchie des sources (qualité décroissante)

Le résolveur essaie les sources dans l'ordre et **porte la provenance + la confiance** sur chaque fait :

1. GeoJSON de zonage fourni par la commune (SIG) — confiance haute.
2. Prescription / SUP du GPU (`/prescription-surf`, `/assiette-sup-s`) — bon, mais l'assiette PM1 est souvent le **périmètre global**, pas le sous-zonage rouge/bleue.
3. Zonage ingéré depuis le PDF (vision assistée) — confiance moyenne, validation requise.
4. Désignation manuelle de l'instructeur — confiance haute mais coût humain.

### 3.4 Nature juridique par famille de document

| Logique | Documents | Sortie moteur |
|---|---|---|
| Conformité (seuils) | PLU règlement | Verdict conforme / non conforme |
| Zonage → constructibilité / prescriptions | PPRI, PPRT, PPRN, PEB | Verdict + prime sur le PLU (SUP) |
| Compatibilité (qualitatif) | OAP, SCOT | **Assistance** (citation + aide à la motivation), pas de verdict binaire |

## 4. Architecture cible

### 4.1 Résolveur de zonage générique

Nouveau service `apps/api/src/services/zonageResolver.ts`, au-dessus des sources existantes :

```
parcelle (géométrie cadastrale)
   │
   ├─ couche PLU      ← communes.plu_zones_geojson (existant)
   ├─ couche SUP/PPRI ← gpu_parcel_cache.sup_surf / prescriptions (existant)
   ├─ couche OAP      ← zones (source_document_id) / prescription-surf typepsc 18
   └─ couche ingérée  ← zones produites par l'ingestion PDF (PPRI/OAP)
   │
   ▼
intersection polygone-polygone + % d'aire (polygon-clipping, déjà dispo)
   │
   ▼
ParcelZoning normalisé  →  dossier_facts (source=external_data, confidence, provenance)
                        →  zones (persistance des zones non-PLU résolues)
```

- Généraliser le point-in-polygon en **intersection avec calcul d'aire** (réutilise `polygon-clipping`).
- Faits produits : `zone_plu`, `zone_ppri`, `ppri_couverture_pct`, `cote_reference_ngf`, `zone_a_cheval`, etc.
- Provenance & confiance portées par `dossier_facts` (existant).

### 4.2 Extraction d'attributs (cote NGF…)

Par ordre : propriétés du générateur SUP → règles PPRI ingérées (par zone) → sinon fait marqué « à vérifier ». L'altimétrie terrain (RGE ALTI, `data.geopf.fr`) reste un point ouvert (cf. §6).

### 4.3 Croisement zonage × règlement

Les codes de zone résolus deviennent la clé pour récupérer les `zone_regulatory_rules` applicables (PLU) **et** les nouvelles règles PPRI. Les tags `zone_<code>` / `inondable` existent déjà ; ajouter `ppri_zone_<rouge|bleue>`. La primauté SUP > PLU est gérée par un **mode d'opposabilité** porté sur la règle et le constat (cf. §4.4).

### 4.4 Généralisation transverse : mode d'opposabilité

Ajouter au modèle de règle / `RegulatoryFinding` un champ `mode` ∈ `{ conformite, compatibilite, porter_a_connaissance }` et un `niveau_norme` (`SUP > PLU > …`). Brique conceptuelle déjà présente dans `riskTriage.ts` (`Opposabilite`, tiers). Bénéfice : primauté SUP (PPRI), traitement « compatibilité » de l'OAP/SCOT, et PAC des aléas — **sans cas particulier par document**.

## 5. Lots de livraison

| Lot | Contenu | Dépend de |
|---|---|---|
| **1. Résolveur spatial multi-couches** | `zonageResolver.ts` (parcelle + à cheval + % + provenance/confiance), faits, persistance `zones` | — |
| **2. Ingestion + RAG PPRI** | Sortir `adapters/ppri.ts` du stub (frontières rouge/bleue/secteur), chunk → embed → `document_segments` ; extraction cote NGF | calage sur un vrai PPRI |
| **3. Croisement × règlement** | Schéma de règles risque, évaluateur `risque_inondation` (patron réutilisé PEB/PPRT), mode d'opposabilité, primauté SUP>PLU | Lots 1 & 2 |
| **4. OAP** | Adaptateur `plu-oap`, résolution secteurs, mode *compatibilité* (assistance, pas verdict) | Lot 1, socle §4.4 |
| **5. Fallback vision PDF** | Lecture assistée des plans de zonage scannés (proposition + validation instructeur) | Lot 1 |

Ordre recommandé : **1 → 2 → 3 → 4 → 5**. Le lot 1 débloque tous les autres.

## 6. Points ouverts

- **Sous-zonage rouge/bleue** : le GPU ne fournit souvent que le périmètre PPRI global. Le détail vient du SIG communal, de l'ingestion PDF ou de la saisie manuelle → d'où la hiérarchie de sources (§3.3).
- **Cote de référence (NGF)** : nécessite l'altimétrie terrain (intégration **RGE ALTI** IGN à prévoir) + le niveau de plancher projeté (extraction du plan de coupe par vision Pixtral, déjà en place).
- **Hétérogénéité des règlements PPR** : moins normalisés que les PLU → le calage de l'adaptateur PPRI doit se faire sur des cas réels.
- **Garde-fous** : tout reste soumis à validation humaine (`validation_status = brouillon`, override Art. 22 RGPD) — inchangé.
