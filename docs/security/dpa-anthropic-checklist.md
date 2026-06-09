# Checklist DPA Anthropic — Sous-traitance LLM

Liste opérationnelle des points à valider avant la mise en production officielle, pour formaliser la sous-traitance Anthropic dans le respect de l'article 28 RGPD et des exigences DSI Tours Métropole.

| Champ | Valeur |
|-------|--------|
| Version | 1.0 |
| Date | Juin 2026 |
| Pilote | DPD HEUREKIA SAS + DSI collectivité |
| Référence | RGPD art. 28, 44, 46 + CCSC Art. 11.7 |

---

## 1. Avant la signature

### Contrat principal

- [ ] **Type de compte commercial** : confirmer un compte « Anthropic for Enterprise » ou équivalent (l'API key personnelle ne couvre pas la sous-traitance professionnelle).
- [ ] **Volume estimé** : transmettre un volume estimé d'appels/mois et de tokens/mois (voir page admin « Coûts IA » pour les chiffres consolidés).
- [ ] **Modèles utilisés** : préciser que la plateforme utilise actuellement `claude-haiku-4-5` (analyse) et `claude-sonnet-4-6` (extraction + structuration).

### Data Processing Agreement (DPA)

- [ ] Obtenir et signer le DPA officiel d'Anthropic — disponible sur demande auprès du service commercial Anthropic.
- [ ] Vérifier que le DPA :
  - [ ] Désigne Anthropic comme sous-traitant (au sens art. 28).
  - [ ] Liste les sous-traitants ultérieurs autorisés d'Anthropic (AWS, GCP…) et la procédure d'opposition.
  - [ ] Inclut une obligation de notification d'incident de sécurité sous 72 heures.
  - [ ] Permet l'audit (sur demande, avec préavis raisonnable).
  - [ ] Mentionne la durée de conservation des inputs (30 jours par défaut, anti-abus).
  - [ ] Mentionne l'absence de réentraînement sur les données API.

### Clauses Contractuelles Types (SCC)

- [ ] Annexer les SCC version **décision UE 2021/914** au DPA si Anthropic n'est pas auto-certifié sur un cadre adéquat (Data Privacy Framework EU-US).
- [ ] Module à utiliser : **Module 2** (responsable de traitement → sous-traitant établi hors UE).
- [ ] Renseigner les annexes des SCC :
  - [ ] Annexe I.A : parties (responsable = collectivité ; sous-traitant = Anthropic).
  - [ ] Annexe I.B : description du transfert (cf. fiche n°2 du registre).
  - [ ] Annexe II : mesures techniques et organisationnelles (cf. `conformite-dsi.md`).
  - [ ] Annexe III : sous-traitants ultérieurs.
- [ ] Évaluation d'impact des transferts (Transfer Impact Assessment — TIA) conformément à la jurisprudence Schrems II : à documenter, modèle CNIL/CEPD disponible.

### Zero Data Retention (ZDR)

- [ ] **Demander explicitement l'activation du ZDR** : option commerciale qui désactive la rétention 30 jours côté Anthropic. Les inputs ne sont alors PAS conservés au-delà du temps de traitement.
- [ ] Vérifier la confirmation écrite d'Anthropic une fois activé.
- [ ] Tracer la date d'activation dans le registre art. 30 (fiche n°2 → mettre à jour la durée de conservation).

---

## 2. Configuration technique

### Variables d'environnement de production

- [ ] `ANTHROPIC_API_KEY` : clé API d'organisation enterprise (jamais une clé personnelle).
- [ ] `AI_PROVIDER=bedrock` recommandé pour passer en région UE :
  - [ ] `AWS_REGION=eu-central-1` (Francfort)
  - [ ] Credentials AWS via IAM role (préférable) ou `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`
- [ ] `AI_USD_TO_EUR` : à figer sur le taux contractuel négocié si applicable.

### Surveillance

- [ ] Configurer `ai_alert_config` (page admin → Coûts IA) avec :
  - [ ] Seuil par appel (alerte Slack si dépassé)
  - [ ] Seuil journalier (alerte Slack si dépassé)
- [ ] Vérifier le log de boot : `[aiUsage] 🇪🇺 Fournisseur d'inférence : AWS Bedrock (région eu-central-1)`.
- [ ] Vérifier que les `ai_usage_events` sont bien insérés avec le `file_hash` (pas NULL) sur les appels avec contenu utilisateur.

---

## 3. Réponse à incident

### Procédure en cas de fuite suspectée chez Anthropic

- [ ] Recevoir la notification d'Anthropic (obligation contractuelle 72h).
- [ ] Identifier les appels concernés via `ai_usage_events` (filtrer sur la période).
- [ ] Identifier les fichiers concernés via les empreintes SHA-256 stockées (`file_hash`).
- [ ] Identifier les dossiers et donc les pétitionnaires concernés (`dossier_id` → `dossiers.user_id`).
- [ ] Évaluer la gravité : notification CNIL sous 72h (art. 33) si risque pour les droits et libertés.
- [ ] Notifier les personnes concernées (art. 34) si risque élevé.
- [ ] Documenter dans un registre interne des violations.

### Procédure en cas d'indisponibilité Anthropic

- [ ] La plateforme reste fonctionnelle : le dépôt fonctionne sans analyse IA (équivalent au cas où le pétitionnaire a refusé l'analyse).
- [ ] Surveiller la file d'attente d'analyses différées si une telle file est ajoutée ultérieurement.

---

## 4. Revues et obligations récurrentes

| Échéance | Action |
|----------|--------|
| Annuelle | Revue de l'AIPD + revue du registre art. 30 |
| Annuelle | Vérification des sous-traitants ultérieurs d'Anthropic + actualisation du TIA |
| Trimestrielle | Audit d'un échantillon de verdicts IA (cf. plan d'action AIPD §4) |
| Continue | Surveillance des coûts IA et des volumes via la page admin |
| Continue | Mise à jour des modèles dans `BEDROCK_MODEL_MAP` lors de la sortie d'un nouveau modèle Claude |

---

## 5. Contacts utiles

| Sujet | Contact |
|-------|---------|
| Service commercial Anthropic | sales@anthropic.com (entreprise) |
| Privacy Anthropic | privacy@anthropic.com |
| DPD HEUREKIA | dpd@heurekia-urba.fr |
| DPD collectivité | `[À COMPLÉTER]` |
| CNIL — réclamations | https://www.cnil.fr/fr/plaintes |
| CEPD — modèles SCC + TIA | https://edpb.europa.eu |
