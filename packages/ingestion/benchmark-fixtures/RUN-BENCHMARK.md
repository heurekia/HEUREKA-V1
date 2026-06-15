# Lancer le benchmark exploratoire Anthropic vs Mistral

Guide pas-à-pas pour comparer Claude (Anthropic) et Pixtral (Mistral) sur la
tâche d'analyse + extraction de pièces d'urbanisme HEUREKA. Suit la
méthodologie de la section "Recommandation" de l'estimation de migration.

## Pré-requis

| Élément | Comment l'obtenir |
|---|---|
| Clé API Anthropic | console.anthropic.com → Settings → API Keys |
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

## Étape 2 — Configurer les clés API

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
export MISTRAL_API_KEY="..."

# Optionnel : pour passer Anthropic via AWS Bedrock UE (souveraineté)
export AI_PROVIDER=bedrock
export AWS_REGION=eu-central-1
export AWS_ACCESS_KEY_ID="..."
export AWS_SECRET_ACCESS_KEY="..."

# Optionnel : taux EUR/USD pour le calcul de coût (par défaut 0.93)
export AI_USD_TO_EUR=0.93
```

## Étape 3 — Smoke test (3 fixtures, ~30 s)

Vérifier que le harnais tourne avant de payer une exécution complète :

```bash
cd packages/ingestion
pnpm benchmark:llm --limit 3 --providers anthropic,mistral
```

Le rapport est écrit dans `docs/security/benchmark-llm-resultats.md`.
Vérifier qu'il contient une ligne par provider et par fixture avec F1,
latence, coût.

## Étape 4 — Run complet

```bash
pnpm benchmark:llm
```

Durée typique : ~2 min pour 10 fixtures × 3 modèles (Haiku + Sonnet + Pixtral Large).
Coût typique : < 0,50 € pour 10 fixtures.

## Étape 5 — Comparaisons ciblées (optionnel)

Comparer Pixtral 12B (low cost) vs Pixtral Large (premium) :

```bash
pnpm benchmark:llm --providers mistral --mistral-models pixtral-12b,pixtral-large
```

Comparer Haiku uniquement (modèle utilisé pour `pieceAnalyzer`) :

```bash
pnpm benchmark:llm --providers anthropic --anthropic-models haiku
```

## Étape 6 — Lire le rapport

Le rapport Markdown contient :

- **Récapitulatif** : F1 extraction, % type correct, % JSON valide,
  latence p50/p95, coût total par provider.
- **Gagnant par critère** : qualité, latence, coût, robustesse JSON.
- **Détail par fixture** : valeurs incorrectes, hallucinations, erreurs.
- **Recommandation** : grille de décision avec seuil F1 > 85 % et écart < 5 pts.

### Lecture critique

| Indicateur | Lecture |
|---|---|
| F1 < 70 % | Modèle pas exploitable pour la tâche — réécriture prompt requise |
| F1 ∈ [70 %, 85 %] | Zone d'amélioration — itérer sur le prompt avant décision |
| F1 > 85 % et écart Anthropic-Mistral < 5 pts | Choix dominé par souveraineté/coût |
| Taux hallucinations > 10 % | Risque juridique — l'IA invente des cotes |
| JSON valide < 95 % | Parser à durcir ou activer JSON mode strict |
| Latence p95 > 30 s | Risque timeout HTTP 502 sur Railway — activer SSE |

## Étape 7 — Décision

Critères de Go/No-Go pour basculer un service de prod sur Mistral :

1. **Quality gate** : F1 Mistral ≥ 85 % ET écart vs Claude < 5 points
2. **Robustness gate** : 0 hallucination critique (cote inventée) sur ≥ 10 fixtures
3. **Cost gate** : coût Mistral ≤ 50 % de Claude (sinon l'argument souveraineté seul)
4. **Latency gate** : p95 ≤ 20 s sur Mistral

Si **les 4 gates passent** → migrer `pieceAnalyzer` (le moins risqué) en
premier, sous flag `AI_PROVIDER=mistral`, observer pendant 2 semaines avant
de propager.

Si **3/4 gates passent** → re-tuner les prompts, refaire un run.

Si **< 3/4** → rester sur Anthropic, documenter la décision dans la DPA.

## Dépannage

- **`MISTRAL_API_KEY requis`** → variable d'env non chargée. `export MISTRAL_API_KEY=...`
- **`Conversion PDF→PNG impossible`** → installer `poppler-utils` (cf. pré-requis)
- **`HTTP 429` sur Mistral** → rate limit La Plateforme. Ajouter un délai entre fixtures
  (à venir : `--throttle-ms 500`)
- **JSON parse failed** systématique sur Pixtral 12B → modèle trop petit pour
  la tâche, garder Pixtral Large pour la décision contractuelle.
- **`AnthropicBedrock` erreur d'auth** → vérifier que la région UE active bien
  Claude (`eu-central-1` pour le moment).

## Aller plus loin

- Ajouter `--throttle-ms 500` pour les API en rate limit serré
- Ajouter Anthropic Bedrock comme provider séparé pour comparer
  Anthropic direct vs Anthropic Bedrock (souveraineté pure)
- Ajouter Mistral Medium 3 quand le support vision sera GA
- Faire varier le prompt par run pour mesurer la sensibilité aux modifs prompt
