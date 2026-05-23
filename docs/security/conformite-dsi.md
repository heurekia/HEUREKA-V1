# Conformité DSI — Tours Métropole / Ville de Tours

Analyse d'impact des 5 documents techniques fournis par la DSI.

**Documents analysés :**
- Annexe Technique n°2 (v1.9) — Exigences techniques pour applications hébergées
- Cahier des Clauses Simplifiées de Cybersécurité (CCSC v1.2)
- Plan d'Assurance Sécurité (PAS v1.1) — Modèle à remplir
- PGSSI (v1.1) — Politique Générale de Sécurité des SI
- Annexe Technique n°4 (v1.3) — Livrables attendus

---

## 🔴 CRITIQUE — Bloquant pour la mise en production officielle

### 1. Authentification SSO Microsoft Entra ID
**Source :** Annexe Technique n°2 §3.6 + §4.5  
**Exigence :** Toutes les applications hébergées doivent s'authentifier via Entra ID (Azure AD).

**Points à clarifier avec le DSI :**
- L'obligation s'applique-t-elle aux agents uniquement (mairie, instructeurs) ou aussi aux citoyens ?
- Si agents seulement : intégrer OIDC/OAuth2 (`@azure/msal-node`) pour les rôles `mairie`, `instructeur`, `admin`
- Si tous les utilisateurs : refonte architecturale majeure (les citoyens n'ont pas de compte AD)

**État :** ⚠️ Non conforme — dérogation à négocier ou intégration OIDC à planifier.

### 2. Hébergement France / UE
**Source :** Annexe Technique n°2 §4.12  
**Exigence :** Serveurs en France ou UE.

**État :** Railway.app utilise AWS. Vérifier la région (eu-west-1 = Irlande = UE mais pas France).  
Si France obligatoire : migration vers OVH/Scaleway/3DS Outscale.

---

## 🟠 IMPORTANT — Nécessaire avant validation formelle

### 3. Headers HTTP de sécurité
**Source :** CCSC Art. 11.3  
**État :** ✅ **Implémenté** — Helmet configuré avec CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy.

### 4. Stockage du JWT en cookie HttpOnly
**Source :** PGSSI §2.3  
**État :** ✅ **Implémenté** — Migration localStorage → cookie `HttpOnly; Secure; SameSite=Strict`.

### 5. Traçabilité des connexions (12 mois)
**Source :** Annexe Technique n°2 §4.14  
**État :** ✅ **Implémenté** — Table `audit_logs` enregistre login/logout/login_failed avec IP et user-agent.  
**Reste :** Configurer une rétention 12 mois en base (purge automatique des logs > 12 mois).

### 6. Fichier security.txt
**Source :** CCSC Art. 11.3  
**État :** ✅ **Implémenté** — `/.well-known/security.txt` créé.  
**Reste :** Mettre à jour l'email contact quand l'adresse définitive est connue.

### 7. RGPD — Droits des usagers
**Source :** Annexe Technique n°2 §4.10  
**Exigences :**
- [ ] Suppression de compte (droit à l'effacement)
- [ ] Export des données personnelles (droit à la portabilité)
- [ ] Mentions légales + politique de confidentialité
- [ ] Contact DPD (Délégué à la Protection des Données)
- [ ] Bannière de consentement cookie (si cookies analytiques)

**État :** ⚠️ Non conforme.

### 8. Sauvegardes 3-2-1 documentées
**Source :** CCSC Art. 11.6  
**État :** Railway propose des backups PostgreSQL automatiques.  
**Reste :** Formaliser la politique dans le Dossier d'Exploitation + vérifier fréquence et rétention.

### 9. Dépendances npm à jour
**Source :** CCSC Art. 5  
**État :** À vérifier avec `pnpm audit`.  
**Action :** Intégrer `pnpm audit` dans la CI (GitHub Actions) + patch régulier.

---

## 🟡 MOYEN — À traiter avant déploiement large

### 10. Accessibilité RGAA niveau AA
**Source :** Annexe Technique n°2 §4.7 + §2.1  
**État :** Non audité.  
**Action :** Audit avec axe-core ou Tanaguru, corriger contraste, navigation clavier, attributs ARIA.

### 11. Certificat SSL OV minimum
**Source :** Annexe Technique n°2 §4.9  
**Exigence :** OV (Organization Validation) minimum.  
**État :** Railway utilise Let's Encrypt (DV). À négocier avec le DSI ou migrer vers un certificat OV commercial.

### 12. Export de données en formats ouverts
**Source :** Annexe Technique n°2 §4.15  
**État :** Non implémenté.  
**Action :** Ajouter export CSV/JSON des dossiers dans l'interface mairie.

---

## 📄 LIVRABLES DOCUMENTAIRES À PRODUIRE

| Livrable | Description | Modèle fourni |
|----------|-------------|---------------|
| **DTC** | Dossier Technique de Conception | Non |
| **PAS** | Plan d'Assurance Sécurité | Oui (Annexe 3) |
| **Dossier d'Exploitation** | Procédures backup/restore/mise à jour | Non |
| **Cahier de Recette** | Scénarios de test et critères d'acceptance | Non |

---

## ✅ Déjà conforme

| Point | Référence |
|-------|-----------|
| HTTPS en production | Railway |
| Mots de passe hashés (bcrypt) | auth.ts |
| Compression gzip | app.ts |
| Cache headers corrects | app.ts |
| Requêtes SQL paramétrées (pas d'injection) | Drizzle ORM |
| Pas de Flash, HTML5/CSS3 | — |
| Headers HTTP de sécurité | Helmet (ajouté) |
| Cookie HttpOnly | Migration réalisée |
| Traçabilité connexions | audit_logs (ajouté) |
| security.txt | /.well-known/security.txt (ajouté) |
