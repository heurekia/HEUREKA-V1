# Sécurité — HEUREKA V1

Ce dossier documente l'architecture de sécurité, les exigences de conformité et les chantiers en cours.

## Sommaire

| Document | Contenu |
|----------|---------|
| [architecture.md](./architecture.md) | Mécanismes de sécurité actuellement en place |
| [conformite-dsi.md](./conformite-dsi.md) | Analyse des exigences DSI Tours Métropole / Ville de Tours |
| [aipd.md](./aipd.md) | Analyse d'Impact relative à la Protection des Données — RGPD art. 35 |
| [registre-traitements.md](./registre-traitements.md) | Fiches de registre des traitements pré-remplies — RGPD art. 30 |
| [dpa-anthropic-checklist.md](./dpa-anthropic-checklist.md) | Checklist opérationnelle de la sous-traitance LLM Anthropic |
| [benchmark-llm.md](./benchmark-llm.md) | Méthodologie de comparaison des fournisseurs d'inférence LLM (souveraineté / qualité / coût) — harnais dans `packages/ingestion/src/benchmark/` |
| [todo.md](./todo.md) | Chantiers de sécurité par priorité |

## Périmètre

- Application : HEUREKA V1 (gestion des autorisations d'urbanisme)
- Hébergeur : Railway.app
- Référentiels : PGSSI, CCSC, Annexe Technique n°2 et n°4 (DSI Tours Métropole)
- RGPD : Données personnelles de citoyens et agents publics
