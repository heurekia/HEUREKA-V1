# Lancer le benchmark Mistral sur les pièces d'urbanisme

Guide pas-à-pas pour mesurer la qualité d'extraction de **Pixtral** (Mistral La
Plateforme) sur la tâche d'analyse + extraction de pièces d'urbanisme HEUREKA.

Depuis la bascule juin 2026, seul Mistral est en production — le harnais sert
désormais à comparer entre eux les modèles Mistral (Pixtral 12B vs Pixtral
Large), à détecter les régressions après un changement de prompt, et à
alimenter les fixtures Phase 8.2.

## Pré-requis

| Élément | Comment l'obtenir |
|---|---|
| Clé API Mistral La Plateforme | console.mistral.ai → API Keys |
| `poppler-utils` (pour PDF) | `apt install poppler-utils` (Debian/Ubuntu) ou `brew install poppler` (macOS) |
| Node 22+ et pnpm 9+ | déjà requis par le repo |
| 5 à 10 pièces réelles **anonymisées** | export PDF/PNG depuis vos dossiers d'instruction |

> ⚠️ **RGPD** : `pieces/` est gitignoré. Ne JAMAIS pousser les fixtures
> réelles. Anonymiser (nom, prénom, adresse, téléphone) avant import.
> Voir `benchmark-fixtures/README.md` pour la check-list d'anonymisation.

## Étape 1 — Préparer les fixtures

1. Copier 5 à 10 pièces représentatives dans `packages/ingestion/benchmark-fixtures/pieces/`.
   Mix conseillé :
   - 2 plans de masse (un coté correctement, un partiellement coté)
   - 2 plans de coupe avec NGF
   - 1 CERFA scanné
   - 1 plan de façade
   - 1 photo d'insertion paysagère
   - 1 plan illisible (cas négatif — vérifier que le modèle le détecte)

2. Compléter `manifest.json` avec une entrée par pièce. Chaque entrée fournit
   le **golden** (ce qu'un instructeur humain lit sans ambiguïté). Voir le
   `manifest.json` existant pour le format.

3. **Bien noter** dans le golden uniquement ce qui est **lisible à l'œil nu**.
   Une cote ambiguë → ne pas la mettre. Sinon on pénalise injustement les
   modèles qui répondent honnêtement "non lisible".

## Étape 2 — Configurer la clé API

```bash
export MISTRAL_API_KEY="..."
```

## Étape 3 — Smoke test (3 fixtures, ~30 s)

Vérifier que le harnais tourne avant de payer une exécution complète :

```bash
cd packages/ingestion
pnpm benchmark:llm --limit 3
```

Le rapport est écrit dans `docs/security/benchmark-llm-resultats.md`.
Vérifier qu'il contient une ligne par fixture avec F1, latence, coût.

## Étape 4 — Run complet

```bash
pnpm benchmark:llm
```

Par défaut le benchmark tourne avec `pixtral-large-latest` (modèle production).
Durée typique : ~1 min pour 10 fixtures. Coût typique : < 0,30 € pour 10 fixtures.

## Étape 5 — Comparer Pixtral 12B vs Pixtral Large (optionnel)

Pour arbitrer si on peut basculer `ai-fast` vers Pixtral 12B (cf.
`docs/document-technique.md`, économies ×10) :

```bash
pnpm benchmark:llm --mistral-models pixtral-12b,pixtral-large
```

## Étape 6 — Lire le rapport

Le rapport Markdown contient :

- **Récapitulatif** : F1 extraction, % type correct, % JSON valide,
  latence p50/p95, coût total par modèle.
- **Détail par fixture** : valeurs incorrectes, hallucinations, erreurs.

### Lecture critique

| Indicateur | Lecture |
|---|---|
| F1 < 70 % | Modèle pas exploitable pour la tâche — réécriture prompt requise |
| F1 ∈ [70 %, 85 %] | Zone d'amélioration — itérer sur le prompt avant décision |
| F1 > 85 % | Modèle exploitable |
| Taux hallucinations > 10 % | Risque juridique — l'IA invente des cotes |
| JSON valide < 95 % | Parser à durcir ou activer JSON mode strict |
| Latence p95 > 30 s | Risque timeout HTTP 502 sur passerelle — activer SSE |

## Étape 7 — Décision

Critères de Go pour repointer `ai-fast` (50 % du volume) vers Pixtral 12B :

1. **Quality gate** : F1 Pixtral 12B ≥ 80 % sur les usages `ai-fast`
2. **Robustness gate** : 0 hallucination critique (cote inventée) sur ≥ 10 fixtures
3. **Latency gate** : p95 ≤ 20 s

Si les 3 gates passent → modifier `MODEL_MAP` dans
`apps/api/src/services/aiUsage.ts`, observer pendant 2 semaines.

## Dépannage

- **`MISTRAL_API_KEY requis`** → variable d'env non chargée. `export MISTRAL_API_KEY=...`
- **`Conversion PDF→PNG impossible`** → installer `poppler-utils` (cf. pré-requis)
- **`HTTP 429` sur Mistral** → rate limit La Plateforme. Espacer les fixtures
  ou réduire la concurrence côté runner.
- **JSON parse failed** systématique sur Pixtral 12B → modèle trop petit pour
  la tâche, garder Pixtral Large.

## Aller plus loin

- Ajouter Mistral Medium 3 quand le support vision sera GA.
- Faire varier le prompt par run pour mesurer la sensibilité aux modifs.
- Alimenter les fixtures Phase 8.2 (cas-types de régression) au fil des
  corrections instructeur en production.
