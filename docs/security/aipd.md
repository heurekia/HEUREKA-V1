# Analyse d'Impact relative à la Protection des Données (AIPD)

**Traitement :** Analyse automatisée des pièces déposées par les usagers dans le cadre des autorisations d'urbanisme — HEUREKA V1.

| Champ | Valeur |
|-------|--------|
| Version | 1.0 |
| Date de rédaction | Juin 2026 |
| Rédacteur | DPD HEUREKIA SAS |
| Validé par | _(DPD de la collectivité responsable de traitement)_ |
| Prochaine revue | À chaque évolution majeure du modèle, des sous-traitants ou des finalités ; revue annuelle au minimum. |

> ⚠️ Une AIPD est obligatoire au titre de l'article 35 RGPD pour ce traitement, car il combine plusieurs critères listés par la CNIL (liste WP248rev.01) : traitement à grande échelle, données concernant des personnes vulnérables potentiellement, croisement automatisé de données et innovation technologique (recours à un LLM).

---

## 1. Description du traitement

### 1.1. Finalité

Aider le pétitionnaire à déposer un dossier d'urbanisme complet et lisible dès la première soumission, et aider l'instructeur à pré-évaluer la conformité PLU des pièces fournies. **Aucune décision juridique n'est rendue par le traitement automatisé** (art. 22 RGPD).

### 1.2. Description fonctionnelle

Lors du dépôt d'une pièce justificative dans le wizard de demande d'urbanisme, le contenu binaire du fichier (PDF, JPG, PNG…) est transmis à un modèle de langage multimodal (**Pixtral Large de Mistral AI**, Paris) qui produit :

1. Un **score qualitatif** : `conforme | acceptable | incomplet | non_conforme`.
2. Une **extraction structurée** de valeurs cotées sur les plans (recul, hauteur NGF, surface, échelle…).
3. Le cas échéant, une liste de **non-conformités PLU détectables** avec gravité.

Ces résultats sont stockés en base et présentés au pétitionnaire (au dépôt) et à l'instructeur (à l'instruction). L'instructeur reste **seul décideur** sur la complétude et la conformité du dossier.

### 1.3. Données traitées

| Catégorie | Exemples |
|-----------|----------|
| Identité directe | Nom, prénom, e-mail, téléphone du pétitionnaire (compte) |
| Identité indirecte | Adresse du projet, parcelle cadastrale, IP, user-agent |
| Contenu | Plans, CERFA, photos, notice — peuvent contenir des données personnelles incidentes (signature, ID joint, voisinage visible sur photo) |
| Données générées | Score IA, extraction structurée, empreinte SHA-256, journal d'appels |

**Ce qui est transmis au LLM** (après minimisation) : contenu du fichier + zone PLU + nature des travaux + commune. Pas de nom, e-mail, adresse postale, ni numéro de parcelle complet (tronqué).

### 1.4. Acteurs

| Rôle | Entité |
|------|--------|
| Responsable de traitement | La collectivité destinataire du dossier (commune ou EPCI) |
| Sous-traitant principal | HEUREKIA SAS (éditeur de la plateforme) |
| Sous-traitant ultérieur | Mistral AI SAS (Paris, France) — modèle Pixtral Large, DPA art. 28, pas de transfert hors UE |
| Sous-traitant ultérieur | OVH SAS (hébergement VPS + Object Storage, datacenters France) |
| Sous-traitant ultérieur | Resend (e-mails transactionnels) |

### 1.5. Cycle de vie

1. Dépôt de la pièce → upload chiffré HTTPS, fichier stocké sur disque UE.
2. Minimisation (suppression du nom de fichier, masquage de la parcelle).
3. Envoi au modèle Pixtral Large via Mistral La Plateforme (API directe, datacenters France).
4. Stockage du résultat + empreinte SHA-256 dans `ai_usage_events`.
5. Conservation 10 ans pour le dossier (obligation légale urbanisme). Côté Mistral : pas de réentraînement, politique de rétention contractuelle (à formaliser au DPA).
6. Effacement automatique à la suppression du compte (art. 17) OU à l'expiration de la rétention.

---

## 2. Nécessité et proportionnalité

### 2.1. Base légale

| Base légale | Justification |
|-------------|---------------|
| Art. 6-1-e (mission d'intérêt public) | Instruction des autorisations d'urbanisme = compétence de service public. |
| Art. 6-1-a (consentement) | Consentement explicite révocable du pétitionnaire pour la SOUS-finalité d'analyse automatisée (case à cocher au dépôt). |

### 2.2. Conformité aux principes (art. 5 RGPD)

| Principe | Mise en œuvre |
|----------|---------------|
| Licéité | Mission de service public + consentement révocable |
| Loyauté | Bandeau d'information détaillé au dépôt, présence dans la politique de confidentialité |
| Transparence | Mentions légales + politique de confidentialité publiques + section dédiée IA |
| Limitation des finalités | Aucun usage des données pour de l'entraînement, du marketing ou du profilage |
| Minimisation | `sanitizePieceName` + `maskParcelle` + absence d'identifiants directs dans le prompt |
| Exactitude | L'IA produit un avis indicatif, vérifié par l'instructeur humain |
| Limitation de la conservation | Cron de purge audit_logs (12 m) + brouillons (180 j) ; rétention Mistral selon DPA (à formaliser, idéale 0) |
| Intégrité et confidentialité | HTTPS, CSP, bcrypt, cookies HttpOnly, Drizzle paramétré, SHA-256 trace |
| Responsabilité | Registre art. 30, AIPD, journal des appels IA traçable |

### 2.3. Droits des personnes (art. 12 à 22)

| Droit | Modalité |
|-------|----------|
| Information | Bandeau au dépôt + mentions légales + politique de confidentialité |
| Accès (art. 15) | Bouton « Télécharger mes données » → JSON enrichi (consentement, journal IA, audit) |
| Rectification (art. 16) | Espace « Profil » |
| Effacement (art. 17) | Bouton « Supprimer mon compte » → effacement DB + fichiers physiques |
| Portabilité (art. 20) | Export JSON structuré |
| Opposition (art. 21) | Case à cocher décochable au dépôt (refus de l'analyse IA) |
| Intervention humaine (art. 22) | Décision finale toujours rendue par un instructeur |
| Réclamation | DPD mairie / CNIL |

---

## 3. Risques sur les droits et libertés

### 3.1. Atteinte à la confidentialité

| Risque | Probabilité | Gravité | Mesures |
|--------|-------------|---------|---------|
| Fuite des fichiers depuis Mistral (datacenters France) | Faible | Modérée | DPA art. 28 + politique no-training/no-retention contractuelle |
| Fuite depuis le VPS OVH (Gravelines 🇫🇷) | Faible | Élevée | Chiffrement disque LUKS, sauvegardes 3-2-1 chiffrées GPG (cf. [dossier-exploitation.md](./dossier-exploitation.md)), accès SSH par clés uniquement, audit_logs applicatif, DPA OVH |
| Vol de session côté navigateur | Faible | Modérée | Cookie HttpOnly / Secure / SameSite=Strict, CSP stricte |
| Injection SQL | Très faible | Élevée | Drizzle ORM paramétré |
| Exfiltration via XSS | Très faible | Modérée | CSP `script-src 'self'`, Helmet |

### 3.2. Atteinte à l'intégrité

| Risque | Probabilité | Gravité | Mesures |
|--------|-------------|---------|---------|
| Modification non autorisée d'un dossier | Faible | Élevée | JWT signé, rôles, audit_logs, requêtes paramétrées |
| Hallucination du LLM injectant une non-conformité fausse | Modérée | Faible | Décision humaine systématique, prompts contraints, rejet des verdicts non sourcés |

### 3.3. Atteinte à la disponibilité

| Risque | Probabilité | Gravité | Mesures |
|--------|-------------|---------|---------|
| Indisponibilité Mistral | Modérée | Faible | Le dépôt reste possible sans analyse (opt-out fonctionnel) |
| Indisponibilité VPS OVH | Faible | Modérée | Sauvegardes 3-2-1 chiffrées (quotidien Postgres + uploads, miroir OVH Object Storage) — RPO 24h, RTO 4h. Procédure de reprise documentée dans [`dossier-exploitation.md`](./dossier-exploitation.md). |

### 3.4. Risques spécifiques IA

| Risque | Probabilité | Gravité | Mesures |
|--------|-------------|---------|---------|
| Décision injuste rendue par l'IA | N/A — exclue par conception | Élevée | Aucune décision automatisée (art. 22) — instructeur humain |
| Biais du modèle pénalisant certains pétitionnaires | Faible | Modérée | Score indicatif, instructeur en dernier ressort, audit a posteriori des verdicts |
| Réentraînement du modèle sur les pièces | Très faible | Élevée | Mistral ne ré-entraîne pas sur les données API entreprise ; confirmation contractuelle au DPA |

---

## 4. Plan d'action

| Action | Priorité | Statut | Échéance |
|--------|----------|--------|----------|
| Signer le DPA Mistral AI (Paris) | Haute | À faire | Avant mise en production |
| Vérifier en prod : `[aiUsage] 🇫🇷 Fournisseur d'inférence : Mistral La Plateforme (fr-paris)` au boot | Haute | Implémenté | Au déploiement |
| Inscrire le traitement au registre art. 30 de la collectivité | Haute | Modèle fourni | Avant mise en production |
| Publier la déclaration d'accessibilité RGAA | Moyenne | À faire | Sous 3 mois post-prod |
| Revue annuelle de l'AIPD | Moyenne | Récurrent | T+12 mois |
| Audit a posteriori d'un échantillon de verdicts IA | Moyenne | À planifier | Trimestriel |

---

## 5. Avis du DPD

À renseigner par le DPD de la collectivité responsable de traitement après examen du présent document et des éléments techniques fournis (`docs/security/conformite-dsi.md`, page admin « Conformité RGPD »).

```
Avis :   ☐ Favorable    ☐ Favorable avec réserves    ☐ Défavorable

Réserves / observations :

Signature DPD :                                              Date :
```

## 6. Décision de la personne responsable de traitement

```
Décision : ☐ Mise en œuvre autorisée    ☐ Suspension demandée

Signature :                                                  Date :
```
