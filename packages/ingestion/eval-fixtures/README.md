# Eval fixtures — corpus or pour l'ingestion réglementaire

Chaque fichier `<insee>/<doc>.golden.json` décrit ce qu'on s'attend à voir
sortir du pipeline d'ingestion pour un document donné. Le harnais (`pnpm
eval:ingestion`) exécute le pipeline réel et compare au golden : toute
régression future est mesurable.

## Workflow recommandé pour ajouter un document

1. **Bootstrap automatique** — laisser le pipeline générer le brouillon :

   ```bash
   pnpm eval:ingestion --bootstrap docs/reglementation/ballan-mire/PLU-Ballan-Reglement.pdf \
     --adapter plu-reglement --insee 37018 --commune "Ballan-Miré" \
     --version v1 --out packages/ingestion/eval-fixtures/37018/plu-reglement.golden.json
   ```

   Le fichier contient ce que le pipeline a trouvé, avec
   `annotated_by: "bootstrap (à relire)"`.

2. **Relecture humaine** — ouvrir le JSON, et :
   - supprimer les zones / articles que le pipeline a inventés (faux positifs)
   - ajouter ce qui manque (faux négatifs)
   - remplacer `annotated_by` par votre nom
   - ajuster `tolerances` si une marge d'erreur est acceptable

3. **Vérifier** — lancer le harnais :

   ```bash
   pnpm eval:ingestion
   ```

   Doit passer en vert sur ce que vous avez validé.

## Format du golden

```json
{
  "_meta": {
    "fixture_version": 1,
    "source_pdf": "docs/reglementation/ballan-mire/PLU-Ballan-Reglement.pdf",
    "adapter": "plu-reglement",
    "insee": "37018",
    "commune": "Ballan-Miré",
    "doc_version": "v1",
    "annotated_by": "Evi Deletang",
    "annotated_at": "2026-06-08",
    "notes": "Zone UCa = secteur protégé centre-bourg, à différencier de UC."
  },
  "expected": {
    "zones": ["UA", "UB", "UC", "UCa", "1AU", "2AU", "A", "N", "Nh"],
    "articles_per_zone": {
      "UA": [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14],
      "UB": [1, 2, 6, 7, 10, 11, 12]
    }
  },
  "tolerances": {
    "extra_zones_allowed": 0,
    "missing_zones_allowed": 0,
    "min_zone_f1": 1.0,
    "min_article_f1": 0.95
  }
}
```

### Champs

- `source_pdf` : chemin relatif à la racine du repo OU à côté du golden
- `adapter` : nom dans `src/adapters/registry.ts` (`plu-reglement`, `plu-oap`, `ppri`…)
- `zones` : codes exacts attendus (sensible à la casse). Ordre indifférent.
- `articles_per_zone` : optionnel. Si présent, vérification fine.
- `tolerances` : tous les seuils par défaut sont stricts (F1 = 1) — relâcher cas par cas.

## Stratégie d'annotation par type de doc

| Type | Bootstrap suffit ? | Effort relecture |
|---|---|---|
| PLU règlement | Souvent oui | 15-30 min |
| PPRI | Non (adapter stub) | À écrire d'abord |
| OAP | Non (adapter stub) | À écrire d'abord |
| Servitudes / plans zonage | Non (adapter stub) | À écrire d'abord |

Pour les adapters non-implémentés (PPRI/OAP), créer un golden avec les zones
attendues **avant** d'écrire l'adapter : le harnais sert alors de cahier des
charges exécutable.

## CI

Exit code `2` si une fixture échoue → utilisable comme garde-fou avant
déploiement :

```bash
pnpm --filter @heureka-v1/ingestion eval:ingestion
```
