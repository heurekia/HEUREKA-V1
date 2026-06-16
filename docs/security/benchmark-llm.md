# Benchmark LLM — Méthodologie

Document décrivant **comment** et **pourquoi** comparer plusieurs fournisseurs d'inférence (LLM multimodaux) avant de basculer en production. Le harnais technique se trouve dans `packages/ingestion/src/benchmark/`.

## Pourquoi un benchmark ?

L'arbitrage souveraineté / qualité / coût ne peut pas se faire à la lecture des datasheets. Sur la tâche réelle d'HEUREKA (analyse de plans cotés, CERFA scannés, photos de façades), les écarts entre modèles peuvent atteindre 20-30 points de F1, dans un sens parfois contre-intuitif. Le benchmark est donc **un prérequis** à toute bascule de provider.

## Providers candidats

> **Contexte (juin 2026) :** HEUREKA est en production sur **Mistral La Plateforme**
> (Pixtral Large). Le benchmark sert désormais à comparer des variantes Mistral
> (Pixtral 12B vs Pixtral Large vs futurs modèles) et, ponctuellement, à
> challenger Mistral face à d'autres providers UE si un cas d'usage le justifie.

| Provider | Souveraineté | Qualité (vision multimodale) | Effort d'intégration |
|---|---|---|---|
| **Mistral Pixtral Large** (en prod) | 🇫🇷 France (Paris) | ⭐⭐⭐⭐ référence actuelle | ✅ déjà implémenté |
| Mistral Pixtral 12B | 🇫🇷 France | ⭐⭐⭐ low-cost | ✅ déjà implémenté |
| Mistral Medium 3 (vision, à venir) | 🇫🇷 France | ⭐⭐⭐⭐⭐ attendue | ~10 lignes |
| Llama Vision via Scaleway | 🇫🇷 France | ⭐⭐⭐ à valider | ~30 lignes (à ajouter) |

## Métriques mesurées

### Qualité (le plus important)

| Métrique | Définition | Seuil acceptable |
|---|---|---|
| **F1 extraction** | Moyenne harmonique précision × rappel sur les valeurs cotées | ≥ 0,80 |
| **Précision** | Champs corrects / champs extraits | ≥ 0,85 |
| **Rappel** | Champs corrects / champs attendus | ≥ 0,75 |
| **Type accuracy** | % de pièces dont le type est correctement identifié | ≥ 0,90 |
| **JSON validity** | % de réponses parsables en JSON | ≥ 0,98 |
| **Hallucinations** | Champs extraits absents du golden (non-null) | ≤ 1 / pièce |

### Performance

| Métrique | Définition | Seuil acceptable |
|---|---|---|
| **Latence p50** | Médiane | ≤ 8 s |
| **Latence p95** | 95e percentile | ≤ 20 s |
| **Coût par pièce** | Tokens × tarif | ≤ 0,02 € / pièce |
| **Taux d'erreur** | Timeouts + refus + erreurs HTTP | ≤ 2 % |

### Souveraineté (binaire)

- Pays du fournisseur : UE / USA / autre
- Région d'inférence : pays exact (Francfort, Paris, Londres…)
- Statut contractuel : DPA signé / SCC actives / ZDR activable
- Certification : SecNumCloud ? HDS ? ISO 27001 ?

## Protocole d'exécution

### Pré-requis

1. **Fixtures réelles anonymisées** dans `packages/ingestion/benchmark-fixtures/pieces/` (voir le README du dossier). **Minimum 15 fixtures** pour une décision technique fiable.
2. **Clés API** pour chaque provider candidat (variables d'environnement).
3. **Quota suffisant** sur chaque provider (15-30 appels × 2 endpoints × N modèles).

### Exécution

```bash
# Smoke test sur 3 fixtures pour vérifier que tout fonctionne
MISTRAL_API_KEY=... \
pnpm --filter @heureka-v1/ingestion benchmark:llm --limit 3

# Run complet (Pixtral Large par défaut)
MISTRAL_API_KEY=... \
pnpm --filter @heureka-v1/ingestion benchmark:llm \
  --out docs/security/benchmark-llm-resultats-2026-06.md

# Comparaison Pixtral Large vs Pixtral 12B (qualité vs coût)
MISTRAL_API_KEY=... \
pnpm --filter @heureka-v1/ingestion benchmark:llm \
  --mistral-models pixtral-large,pixtral-12b \
  --out docs/security/benchmark-llm-pixtral-comparison.md
```

Cf. `packages/ingestion/benchmark-fixtures/RUN-BENCHMARK.md` pour le guide pas-à-pas (anonymisation, golden, lecture du rapport, Go/No-Go).

### Lecture des résultats

Le rapport généré est un fichier Markdown à 3 sections :

1. **Récapitulatif comparatif** : tableau global pour décision rapide.
2. **Gagnant par critère** : qui gagne sur F1, latence, coût, etc.
3. **Détail par fixture** : pour comprendre les cas d'échec spécifiques (utile pour itérer sur le prompt ou écarter une fixture mal cadrée).

## Règles de décision

Inspirées des règles de la CNIL sur le choix d'un sous-traitant :

1. **Critère éliminatoire** : un provider qui dépasse 5 % de taux d'erreur ou qui descend sous 0,70 de F1 est éliminé.
2. **Souveraineté à qualité comparable** : si un provider UE est à moins de 5 points de F1 du meilleur (US), choisir l'UE — l'écart n'est pas significatif sur un échantillon < 30, et l'argument RGPD prime.
3. **Coût décisif** uniquement à qualité comparable (< 3 points de F1). Sinon, la qualité prime — le coût d'une décision d'urbanisme erronée dépasse largement la facture LLM.
4. **Latence** : critère secondaire sauf si > 30 s en p95 (UX dégradée).
5. **Documenter la décision** : le rapport généré + le commentaire de choix doivent être archivés au registre art. 30 et joints à l'AIPD.

## Cadence

| Fréquence | Action |
|---|---|
| Avant chaque bascule de provider | Benchmark complet |
| À chaque nouveau modèle (Pixtral 2, Mistral Medium 3 vision, …) | Benchmark partiel sur le nouveau modèle uniquement |
| Annuelle | Benchmark complet pour la revue d'AIPD |
| Sur demande DSI / DPD | Benchmark à la volée pour audit |

## Limites du benchmark

- **Taille d'échantillon** : 15-30 fixtures restent peu pour des conclusions statistiquement robustes. Les tendances de fond se voient, mais pas les écarts fins.
- **Représentativité** : choisir des fixtures vraiment représentatives de la production. Une seule mairie / un seul style de plans pénalise la généralisation.
- **Drift** : les modèles évoluent silencieusement (mise à jour, A/B testing côté provider). Re-benchmarker au minimum annuellement.
- **Coût caché** : ce harnais ne mesure pas le coût de réécriture des prompts pour s'adapter à un nouveau modèle. Les prompts actuels ont été ajustés pour Pixtral Large — toute bascule vers un autre modèle (Mistral Medium 3, Llama Vision, …) demandera une nouvelle passe d'ajustement et un re-benchmark.

## Sécurité du benchmark

- Les fixtures `pieces/` sont en `.gitignore` — ne jamais commiter de pièce réelle même anonymisée.
- Les clés API ne doivent **jamais** être commitées. Utiliser un `.env.local` non versionné.
- Les rapports générés peuvent contenir des extraits de citations IA → relire avant de partager publiquement.
