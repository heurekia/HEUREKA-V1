# HEUREKA Canonical PLU — Format d'ingestion JSON

Format de référence pour ingérer un règlement PLU en HEUREKA **sans appeler
l'IA**. Convient à tout outil tiers (bureau d'études, éditeur métier, script
interne) capable de produire un JSON valide.

## Pourquoi ce format

- **Coût** : zéro token LLM consommé.
- **Certitude juridique** : ce que vous écrivez est ce qui sera utilisé pour
  servir les instructions et les citoyens. Aucune interprétation IA possible.
- **Versionnable** : le fichier vit dans Git, audit trail naturel.
- **Échange** : un même JSON peut alimenter plusieurs outils ou être livré
  par un bureau d'études à toutes ses communes clientes.

## Utilisation

```bash
curl -X POST https://votre-instance.heurekia.com/api/mairie/reglementation/import-canonical \
  -H "Content-Type: application/json" \
  -H "Cookie: <votre session mairie>" \
  --data-binary @plu-ballan.canonical.json
```

Réponse en cas de succès :

```json
{
  "ok": true,
  "schema_version": 1,
  "commune_name": "Ballan-Miré",
  "insee": "37018",
  "doc_version": "M5_20180129",
  "zones": 17,
  "rules": 234,
  "warnings": []
}
```

En cas d'erreur de format, le serveur renvoie un 400 avec la liste des
problèmes (chemin JSON + message), par ex. :

```json
{
  "error": "Format canonique invalide",
  "schema_errors": [
    "_meta.insee: _meta.insee invalide (5 caractères, ex: 37018)",
    "zones.0.rules.2.rule_text: rule_text requis"
  ]
}
```

⚠️ **L'import PURGE les zones et règles existantes de la commune** avant de
réinsérer. C'est volontaire (rejouer un import doit être idempotent), mais
prévoyez un export ou un backup si vous voulez pouvoir revenir en arrière.

Les règles sont insérées avec `validation_status = "brouillon"` et doivent
être validées une à une dans l'écran Réglementation avant d'alimenter
l'instruction. C'est le même garde-fou juridique que pour le pipeline IA.

## Structure du document

Voir [`schema.ts`](./schema.ts) pour la définition exacte. Synthèse :

```
{
  schema_version: 1,
  _meta: {
    commune, insee, zip_code?, doc_version,
    adopted_at?, effective_from?, effective_to?,
    source_url?, produced_by?, produced_at?, notes?
  },
  zones: [
    {
      code,                       // ex: "UA", "1AU", "Nh"
      label,                      // ex: "Zone urbaine — centre ancien"
      type,                       // U | AU | A | N
      summary?,                   // caractère de la zone
      rules: [
        {
          article_number,         // 1-14 typiquement
          article_title,
          sub_theme?,
          topic,                  // hauteur, recul_voie, stationnement…
          rule_text,              // texte normatif fidèle
          value_min?, value_max?, value_exact?, unit?,
          conditions?, exceptions?,
          summary,
          instructor_note?,
          citizen_title?, citizen_summary?, citizen_relevant,
          cases: [{condition, value, unit, kind}],
          applies_if: [],
          source?: {document, page, paragraph}
        }
      ]
    }
  ]
}
```

Voir [`canonical-examples/ballan-mire-fragment.canonical.json`](../../canonical-examples/ballan-mire-fragment.canonical.json) pour un exemple complet.

## Valeurs admises

### `topic` (KNOWN_TOPICS)

Recommandés (un warning est émis pour les autres, mais l'import passe) :

`interdictions`, `conditions`, `desserte_voies`, `desserte_reseaux`,
`terrain_min`, `recul_voie`, `recul_limite`, `recul_batiments`,
`emprise_sol`, `hauteur`, `aspect`, `stationnement`, `espaces_verts`,
`cos`, `destinations`, `general`.

### `applies_if` (KNOWN_APPLIES_IF)

Tags d'applicabilité d'une sous-règle à un contexte parcellaire :

`protege_l151_19`, `unesco`, `abf`, `inondable`, `extension`,
`surelevation`, `ravalement`, `demolition`, `cloture_sur_rue`,
`cloture_limite`, `annexe`, `devanture_commerciale`, `equipement_public`.

### `cases[].kind`

- `"condition"` — alternatives EXCLUSIVES (ex: voirie 10 m sens unique
  vs 13 m double sens — une seule s'applique selon le contexte).
- `"parametre"` — valeurs CUMULATIVES (ex: 1 place / 40 m² + 1 place /
  30 m² au-delà de 1000 m² — les paliers s'additionnent).

## Versioning

`schema_version: 1` est la version actuelle. Toute évolution non
rétro-compatible incrémentera ce nombre — un même fichier ne peut
prétendre qu'à une version. Les anciens fichiers continueront d'être
acceptés tant que cela reste raisonnable côté loader.
