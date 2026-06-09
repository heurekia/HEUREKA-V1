# Registre des activités de traitement (RGPD art. 30)

Fiches pré-remplies pour la collectivité responsable de traitement utilisant HEUREKA. À recopier dans le registre tenu par le DPD de la collectivité. Chaque commune doit personnaliser les sections marquées `[À COMPLÉTER]`.

| Champ | Valeur |
|-------|--------|
| Version | 1.0 |
| Date de rédaction | Juin 2026 |
| Rédacteur | DPD HEUREKIA SAS |
| Prochaine revue | Annuelle ou à chaque évolution majeure |

---

## Fiche n°1 — Gestion des demandes d'autorisation d'urbanisme

| Champ | Contenu |
|-------|---------|
| **Nom du traitement** | Instruction des autorisations d'urbanisme via HEUREKA |
| **Responsable de traitement** | `[À COMPLÉTER : nom + adresse de la collectivité]` |
| **Représentant** | Maire / Président d'EPCI |
| **DPD** | `[À COMPLÉTER : email DPD collectivité]` |
| **Sous-traitant principal** | HEUREKIA SAS, `[adresse]`, contact : `dpd@heurekia-urba.fr` |
| **Sous-traitants ultérieurs** | Railway Corporation (hébergement UE), Anthropic PBC (analyse IA), Resend (e-mails) |
| **Finalités** | Dépôt, instruction et décision sur les autorisations d'urbanisme (PC, DP, PA, PD, CU) ; communication avec le pétitionnaire ; consultation des services annexes ; archivage légal |
| **Base légale** | Mission d'intérêt public (RGPD art. 6-1-e — Code de l'urbanisme L.421-1 et suivants) |
| **Catégories de personnes concernées** | Pétitionnaires (citoyens, professionnels), agents instructeurs, élus signataires, agents de services consultés (ABF, SDIS, etc.) |
| **Catégories de données** | Identité (nom, prénom, e-mail, téléphone), adresse du projet, parcelle cadastrale, contenu des pièces déposées (plans, CERFA, photos, notice), correspondances, décisions, signatures électroniques |
| **Données sensibles** | Aucune (en principe) — vigilance sur les pièces qui pourraient contenir une copie de pièce d'identité |
| **Destinataires** | Agents instructeurs de la collectivité, services annexes consultés (ABF, SDIS, DDT…), signataires habilités, pétitionnaire (notification) |
| **Transferts hors UE** | Aucun pour les données de dossier en base (hébergement UE). Voir Fiche n°2 pour l'analyse IA. |
| **Durée de conservation** | Dossiers : 10 ans à compter de la décision (instruction n°2009-018 archives départementales). Comptes : durée de vie du compte + 3 ans inactivité. |
| **Mesures de sécurité** | HTTPS forcé, Helmet (CSP, HSTS, X-Frame-Options), bcrypt, cookies HttpOnly/Secure/SameSite=Strict, Drizzle paramétré (anti-injection), audit_logs (12 mois), rôles + permissions, sauvegardes PostgreSQL |
| **Procédure d'exercice des droits** | Espace « Mon profil » du citoyen (export JSON, suppression de compte). DPD de la collectivité en contact principal. |

---

## Fiche n°2 — Analyse automatisée des pièces déposées (IA)

| Champ | Contenu |
|-------|---------|
| **Nom du traitement** | Analyse automatisée par intelligence artificielle des pièces d'urbanisme |
| **Responsable de traitement** | `[À COMPLÉTER : nom + adresse de la collectivité]` |
| **Sous-traitant principal** | HEUREKIA SAS — exploite la plateforme et l'orchestration des appels IA |
| **Sous-traitant ultérieur** | **Anthropic PBC**, 548 Market St PMB 90375, San Francisco, CA 94104, USA — modèle Claude. Encadré par DPA + clauses contractuelles types (SCC, décision UE 2021/914). |
| **Finalités** | (1) Vérification automatisée de la complétude et de la lisibilité des pièces déposées. (2) Extraction structurée des valeurs cotées (recul, hauteur NGF, surface). (3) Détection préliminaire de non-conformités PLU. **Aucune décision automatisée au sens de l'art. 22 RGPD.** |
| **Base légale** | Mission d'intérêt public (art. 6-1-e) + consentement explicite et révocable du pétitionnaire (art. 6-1-a) — case à cocher au dépôt avec opt-out. |
| **Catégories de personnes concernées** | Pétitionnaires ayant accepté l'analyse IA (consentement par défaut, révocable) |
| **Catégories de données transmises au LLM** | Contenu binaire du fichier (pièce justificative), zone PLU, nature des travaux, surface, commune. **Pas d'identité directe** : nom de fichier sanitizé, parcelle cadastrale tronquée, aucun nom/prénom/e-mail/adresse postale transmis. |
| **Destinataires** | Anthropic PBC (traitement éphémère pour produire la réponse), serveurs HEUREKA pour stockage du résultat, agents instructeurs de la collectivité. |
| **Transferts hors UE** | Si `AI_PROVIDER=anthropic` (défaut) : transfert vers les États-Unis encadré par DPA + SCC. Si `AI_PROVIDER=bedrock` : aucun transfert hors UE (inférence sur AWS Bedrock région eu-central-1 / Francfort). |
| **Garanties pour les transferts** | DPA Anthropic + SCC (clauses 2021/914), option Zero Data Retention (suppression de la rétention 30 j côté Anthropic). |
| **Durée de conservation** | Résultats stockés en base : pour la durée du dossier (10 ans). Empreinte SHA-256 + métadonnées (modèle, coût, durée) : pour la durée du dossier. **Côté Anthropic : 30 jours maximum (logs anti-abus), désactivable contractuellement.** |
| **Mesures de sécurité spécifiques** | Minimisation (sanitizePieceName, maskParcelle), trace SHA-256 (ai_usage_events.file_hash), trace par pièce (ai_processed), trace par dossier (ai_consent + ai_consent_at), décision finale humaine, journal complet des appels (date, modèle, coût, empreinte). |
| **Procédure d'exercice des droits** | Droit d'opposition au dépôt (case à cocher décochable) ; droit d'accès via l'export JSON enrichi avec le journal des appels IA ; droit à une intervention humaine (art. 22) toujours garanti par défaut. |
| **AIPD** | Conduite — voir `docs/security/aipd.md`. |

---

## Fiche n°3 — Gestion des comptes et authentification

| Champ | Contenu |
|-------|---------|
| **Nom du traitement** | Création et gestion des comptes utilisateurs |
| **Responsable de traitement** | `[À COMPLÉTER : nom + adresse de la collectivité]` (citoyens) — HEUREKIA SAS (comptes mairie/instructeur/admin selon contrat) |
| **Sous-traitants** | Railway (hébergement UE), Resend (envoi e-mails activation / réinitialisation) |
| **Finalités** | Authentification, gestion des rôles et permissions, communication avec les utilisateurs |
| **Base légale** | Exécution du contrat / mesures précontractuelles (art. 6-1-b) |
| **Catégories de personnes concernées** | Citoyens pétitionnaires, agents de mairie, instructeurs, agents de services externes, administrateurs |
| **Catégories de données** | E-mail, nom, prénom, téléphone, mot de passe (haché bcrypt), commune, rôle, date de création, dernière connexion |
| **Destinataires** | Service technique HEUREKIA, agents de la collectivité disposant des droits administrateur |
| **Transferts hors UE** | Aucun |
| **Durée de conservation** | Durée de vie du compte + 3 ans après dernière connexion |
| **Mesures de sécurité** | bcrypt coût 10, rate-limit sur login (10/15min), JWT signé HS256 + cookie HttpOnly/Secure/SameSite=Strict, audit_logs (login, login_failed, logout, register), tokens d'activation et de reset à usage unique avec expiration |

---

## Fiche n°4 — Journaux de sécurité (audit_logs)

| Champ | Contenu |
|-------|---------|
| **Nom du traitement** | Traçabilité des accès et événements de sécurité |
| **Responsable de traitement** | HEUREKIA SAS (en tant qu'exploitant) |
| **Finalités** | Détection des tentatives d'intrusion, traçabilité légale, réponse à incident |
| **Base légale** | Obligation légale (art. 6-1-c) — exigence CCSC Art. 4.14 de la DSI Tours Métropole + bonne pratique CNIL |
| **Catégories de données** | user_id, e-mail, action (login/login_failed/logout/register/data_export/account_deleted/profile_update/password_change/account_activated/password_reset), IP, user-agent, horodatage |
| **Destinataires** | Administrateurs HEUREKIA, DSI collectivité, autorités sur réquisition |
| **Transferts hors UE** | Aucun |
| **Durée de conservation** | **12 mois maximum** — purge automatique quotidienne (`jobs/scheduler.ts`) |
| **Mesures de sécurité** | Index dédié pour la purge, FK `ON DELETE SET NULL` (préservé même après suppression de compte pour la sécurité) |
