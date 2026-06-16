# Checklist DPA Mistral AI — Sous-traitance LLM

Liste opérationnelle des points à valider avant la mise en production officielle, pour formaliser la sous-traitance Mistral AI (Paris, France) dans le respect de l'article 28 RGPD et des exigences DSI Tours Métropole.

| Champ | Valeur |
|-------|--------|
| Version | 2.0 (refonte post-bascule Anthropic → Mistral) |
| Date | Juin 2026 |
| Pilote | DPD HEUREKIA SAS + DSI collectivité |
| Référence | RGPD art. 28 + CCSC Art. 11.7 |

> **Pourquoi cette refonte ?** L'intégralité des appels IA HEUREKA passe désormais par **Mistral La Plateforme** (entité Mistral AI SAS, Paris). Aucun transfert hors UE → les sections SCC / TIA / Zero Data Retention du précédent DPA Anthropic ne s'appliquent plus. Cette checklist conserve l'esprit (art. 28) mais simplifie significativement le formalisme.

---

## 1. Avant la signature

### Contrat principal

- [ ] **Type de compte commercial** : confirmer un compte Mistral AI Entreprise (l'API key personnelle gratuite ne couvre pas la sous-traitance professionnelle ni les volumes prévus).
- [ ] **Volume estimé** : transmettre un volume estimé d'appels/mois et de tokens/mois (voir page admin « Coûts IA » pour les chiffres consolidés).
- [ ] **Modèles utilisés** : préciser que la plateforme utilise actuellement **Pixtral Large** (vision + extraction + structuration). Les noms abstraits côté code (`ai-fast`, `ai-smart`) sont mappés vers Pixtral Large par défaut — le détail est centralisé dans `apps/api/src/services/aiUsage.ts` (`MODEL_MAP`).

### Data Processing Agreement (DPA)

- [ ] Obtenir et signer le DPA officiel de Mistral AI — disponible sur la console Mistral (`Settings → Legal`) ou auprès du service commercial.
- [ ] Vérifier que le DPA :
  - [ ] Désigne Mistral AI SAS (Paris) comme sous-traitant (au sens art. 28).
  - [ ] Liste les sous-traitants ultérieurs autorisés de Mistral (infrastructures cloud UE) et la procédure d'opposition.
  - [ ] Inclut une obligation de notification d'incident de sécurité sous 72 heures.
  - [ ] Permet l'audit (sur demande, avec préavis raisonnable).
  - [ ] Mentionne la durée de conservation des inputs (politique « zero training, no log retention » pour les comptes entreprise — à confirmer par écrit).
  - [ ] Mentionne l'absence de réentraînement sur les données API.

### Pas de SCC ni de TIA requis

- [x] Inférence en **France métropolitaine** (Mistral AI SAS, datacenters UE).
- [x] Pas de transfert hors UE → **les Clauses Contractuelles Types ne s'appliquent pas** (art. 44 RGPD non engagé).
- [x] Pas de Transfer Impact Assessment (TIA) requis (jurisprudence Schrems II non applicable à une sous-traitance intra-UE).

> Cette simplification — par rapport au précédent DPA Anthropic qui nécessitait SCC module 2 + TIA — est le bénéfice opérationnel direct du choix Mistral.

### Rétention et non-entraînement

- [ ] Confirmer par écrit auprès de Mistral :
  - [ ] Aucune utilisation des données API pour l'entraînement des modèles.
  - [ ] Politique de rétention des inputs (idéalement 0 — à défaut, durée minimale anti-abus avec garantie de non-accès humain hors incident).
- [ ] Tracer la confirmation dans le registre art. 30 (fiche n°2).

---

## 2. Configuration technique

### Variables d'environnement de production

- [ ] `MISTRAL_API_KEY` : clé API d'organisation entreprise (jamais une clé personnelle).
- [ ] `MISTRAL_API_BASE` : laissé par défaut (`https://api.mistral.ai/v1`) sauf si proxy entreprise documenté.

> Toutes les variables `ANTHROPIC_*`, `AWS_*` (pour l'IA) et `AI_PROVIDER` du précédent setup ont été retirées de l'environnement applicatif (cf. PR #117, bascule VPS OVH).

### Surveillance

- [ ] Configurer `ai_alert_config` (page admin → Coûts IA) avec :
  - [ ] Seuil par appel (alerte Slack si dépassé)
  - [ ] Seuil journalier (alerte Slack si dépassé)
- [ ] Vérifier le log de boot : `[aiUsage] 🇫🇷 Fournisseur d'inférence : Mistral La Plateforme (fr-paris)`.
- [ ] Vérifier que les `ai_usage_events` sont bien insérés avec le `file_hash` (pas NULL) sur les appels avec contenu utilisateur, et avec `model = pixtral-large-latest`.

---

## 3. Réponse à incident

### Procédure en cas de fuite suspectée chez Mistral

- [ ] Recevoir la notification de Mistral (obligation contractuelle 72h).
- [ ] Identifier les appels concernés via `ai_usage_events` (filtrer sur la période).
- [ ] Identifier les fichiers concernés via les empreintes SHA-256 stockées (`file_hash`).
- [ ] Identifier les dossiers et donc les pétitionnaires concernés (`dossier_id` → `dossiers.user_id`).
- [ ] Évaluer la gravité : notification CNIL sous 72h (art. 33) si risque pour les droits et libertés.
- [ ] Notifier les personnes concernées (art. 34) si risque élevé.
- [ ] Documenter dans un registre interne des violations.

### Procédure en cas d'indisponibilité Mistral

- [ ] La plateforme reste fonctionnelle : le dépôt fonctionne sans analyse IA (équivalent au cas où le pétitionnaire a refusé l'analyse).
- [ ] Surveiller la file d'attente d'analyses différées si une telle file est ajoutée ultérieurement.

---

## 4. Revues et obligations récurrentes

| Échéance | Action |
|----------|--------|
| Annuelle | Revue de l'AIPD + revue du registre art. 30 |
| Annuelle | Vérification des sous-traitants ultérieurs de Mistral (infrastructures cloud) |
| Trimestrielle | Audit d'un échantillon de verdicts IA (cf. plan d'action AIPD §4) |
| Continue | Surveillance des coûts IA et des volumes via la page admin |
| Continue | Mise à jour des modèles dans `MODEL_MAP` (`aiUsage.ts`) lors de la sortie d'un nouveau modèle Mistral (ex: Mistral Medium 3 vision quand disponible) |

---

## 5. Contacts utiles

| Sujet | Contact |
|-------|---------|
| Service commercial Mistral AI | https://mistral.ai/contact/ |
| Privacy Mistral AI | privacy@mistral.ai |
| DPD HEUREKIA | dpd@heurekia-urba.fr |
| DPD collectivité | `[À COMPLÉTER]` |
| CNIL — réclamations | https://www.cnil.fr/fr/plaintes |
