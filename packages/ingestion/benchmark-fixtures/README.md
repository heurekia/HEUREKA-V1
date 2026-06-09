# Fixtures du benchmark LLM

Ce dossier accueille les pièces réelles (anonymisées) utilisées pour comparer les fournisseurs d'inférence.

## Structure

```
benchmark-fixtures/
├── manifest.json      ← description + vérité-terrain de chaque cas
├── pieces/            ← les fichiers (PDF, PNG, JPG) — à fournir
└── README.md
```

## Comment ajouter une fixture

1. **Choisir une pièce représentative** d'un cas réel rencontré en instruction. Par ex. : un plan de masse coté correctement, un plan de coupe avec NGF lisibles, un CERFA scanné, un plan illisible, un PDF multi-pages.
2. **L'anonymiser** : retirer nom/prénom/email/téléphone/adresse exacte du pétitionnaire et des voisins. Outils : Adobe Acrobat Redact, ou export PNG avec masquage manuel.
3. **Choisir un format compatible** :
   - PNG ou JPG → tous les providers (Anthropic, Mistral Pixtral).
   - PDF → Anthropic natif. Mistral Pixtral n'accepte PAS le PDF → convertir page par page en PNG.
4. **Le déposer** dans `pieces/` avec un nom court parlant (`plan-masse-01.png`).
5. **Renseigner le manifest** : ajouter une entrée avec id, mime, label, contexte (zone PLU, nature des travaux) et **vérité-terrain** (valeurs exactes lisibles sur le plan).

## Conseils sur la vérité-terrain (`golden`)

- **Ne noter QUE ce qu'un instructeur humain lirait sans hésitation** sur la pièce. Si une cote est ambiguë → ne pas la mettre dans le golden.
- **Tolérance numérique** : par défaut ±10 %. Adapter par fixture via `numeric_tolerance` si vos plans sont très précis (5 %) ou peu cotés (15 %).
- **Hallucinations** : tout champ extrait par l'IA mais absent du golden est compté en hallucination — sauf si c'est manifestement bénin (l'IA voit une info supplémentaire qu'on a juste oublié). Ne pas hésiter à compléter le golden après une première passe.
- **Non-conformités** : noter en français court (ex. "recul voie insuffisant"), la comparaison se fait par concordance partielle de chaîne.

## Volume recommandé

| Volume | Usage |
|---|---|
| 3-5 fixtures | Smoke test pour vérifier que le harnais fonctionne |
| 15-20 fixtures | Première décision technique |
| 30+ fixtures | Décision contractuelle / DSI Tours / publication |

## RGPD

Les fixtures contiennent des plans potentiellement déposés par des citoyens.
**Ne JAMAIS commiter de pièce non anonymisée**. Ce dossier est dans
`.gitignore` pour `pieces/` afin d'éviter une fuite accidentelle.

Pour partager les fixtures avec un partenaire, utiliser un canal chiffré
(NextCloud collectivité, SecNumCloud) avec accord du DPD.
