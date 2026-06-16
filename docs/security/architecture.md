# Architecture de sécurité

## Authentification

| Mécanisme | Description |
|-----------|-------------|
| **JWT** | Signé avec `HS256`, secret via `JWT_SECRET` env, durée 7 jours |
| **Cookie HttpOnly** | Token stocké en cookie `HttpOnly; Secure; SameSite=Strict` (pas en localStorage) |
| **Bearer header** | Accepté en fallback pour les clients API/CLI |
| **bcrypt** | Hachage des mots de passe, coût 10 |
| **Endpoint /logout** | `POST /api/auth/logout` — invalide le cookie côté client |

## Transport

| Mécanisme | Description |
|-----------|-------------|
| **HTTPS** | Forcé par nginx (`return 301`) sur le VPS OVH ; certificat Let's Encrypt renouvelé automatiquement par certbot |
| **HSTS** | Activé via Helmet (max-age=15552000) |
| **Compression gzip** | Activé via `compression` middleware |

## Headers HTTP (Helmet)

```
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://data.geopf.fr https://*.basemaps.cartocdn.com https://*.tile.openstreetmap.org; connect-src 'self' https://data.geopf.fr https://api-adresse.data.gouv.fr https://geo.api.gouv.fr; font-src 'self'; frame-ancestors 'none'
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
Permissions-Policy: (géré par Helmet)
```

## Traçabilité

La table `audit_logs` enregistre chaque événement d'authentification :

| Action | Déclencheur |
|--------|-------------|
| `login` | Connexion réussie |
| `login_failed` | Tentative de connexion avec mauvais identifiants |
| `logout` | Déconnexion explicite |
| `register` | Création de compte |

Champs enregistrés : `user_id`, `email`, `action`, `ip`, `user_agent`, `created_at`.  
Rétention recommandée : **12 mois** (exigence CCSC §4.14).

## Validation des données

- Schémas Zod sur tous les endpoints POST/PATCH
- Paramètres SQL via Drizzle ORM (requêtes paramétrées — pas d'injection SQL possible)
- Limite body JSON : 50 MB

## Fichier security.txt

Disponible à `/.well-known/security.txt` (servi depuis `apps/web/public/`).

## Variables d'environnement sensibles

| Variable | Utilisation |
|----------|-------------|
| `JWT_SECRET` | Signature des tokens JWT — **obligatoire en production** |
| `DATABASE_URL` | Connexion PostgreSQL |
| `NODE_ENV` | `production` active `Secure` sur les cookies |
