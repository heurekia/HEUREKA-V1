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
   - PNG ou JPG → accepté nativement par Mistral Pixtral.
   - PDF → Pixtral n'accepte PAS le PDF nativement ; le harnais convertit
     automatiquement la première page via `pdftoppm` (poppler-utils). Pour un
     PDF multi-pages, fournir directement les pages utiles en PNG.
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

## Scénarios de régression métier (Phase 8.2)

Le `manifest.json` inclut des cas-types qui ciblent des défauts d'extraction
historiquement observés. Les fichiers (PNG/PDF) ne sont **pas** versionnés —
chaque équipe doit produire la pièce anonymisée correspondante avant de lancer
le benchmark sur ces entrées.

| Fixture | Régression ciblée |
|---|---|
| `plan-masse-rose-des-vents-01` | Le moteur ne détectait pas la **rose des vents** comme orientation présente (uniquement la flèche Nord). Phase 5 — `graphics.orientation.kind`. |
| `plan-masse-parcelles-partielles-01` | **Multi-parcelles + qualificatif `partie`** (`AI 217 & AI 218p`) noyé dans un seul `text`. Phase 2.3 — `parcelles_observees`. |
| `cerfa-commune-divergente-01` | **Cartouche divergent** (« VENDÔME » vs Ballan-Miré) écrasé silencieusement. Phase 3 — moteur de contradictions ; pour l'instant on mesure la non-correction via les `citations`. |
| `pcmi-composite-2-3-01` | **Pièce composite** (plan de masse + plan de coupe sur la même page) tronquée à un seul type. Phase 4 — schéma multi-vues. |

Ces fixtures servent de **golden de référence métier** : leur réussite sera
mesurée champ par champ (cf. `benchmark/scoring.ts`), pas par un score OCR
global. Quand un instructeur corrige une extraction en production, le delta
correspondant doit alimenter une fixture anonymisée ici (boucle Phase 8).

## RGPD

Les fixtures contiennent des plans potentiellement déposés par des citoyens.
**Ne JAMAIS commiter de pièce non anonymisée**. Ce dossier est dans
`.gitignore` pour `pieces/` afin d'éviter une fuite accidentelle.

Pour partager les fixtures avec un partenaire, utiliser un canal chiffré
(NextCloud collectivité, SecNumCloud) avec accord du DPD.
