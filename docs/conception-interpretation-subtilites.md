# Conception — Interprétation des subtilités réglementaires & recoupes inter-documents

| Champ | Valeur |
|-------|--------|
| Statut | Brouillon de conception (à valider) |
| Date | 30 juin 2026 |
| Périmètre | `packages/ingestion` (structuration), `packages/regulatory-engine` (évaluation), `apps/api` (faits, pièces, verdicts LLM), `packages/db` |
| Lecteurs cibles | Équipe technique, produit |
| Compagnon | `docs/conception-interpretation-zonage.md` (résolution multi-documents spatiale), `docs/document-technique.md` |
| Déclencheur | Le cas Boucau (art. 10 UC) : « le faîtage ne peut dépasser **de plus de 4 m** la hauteur de la construction autorisée » était aplati en `value_max = 4` → faux refus systématique. |

> Objectif : passer d'une extraction **scalaire** (un nombre par thème) à une représentation qui porte le **cadre de sens** d'une règle (référence, relativité, conditions, liens), puis **tisser** les recoupes — intra-PLU et inter-documents — dans l'évaluation. « Comprendre les subtilités » et « recouper avec d'autres documents » sont la **même** lacune : un modèle qui perd ce qui ne rentre pas dans un nombre.

---

## 1. Le problème, généralisé depuis la hauteur

Le défaut « hauteur » n'est pas un cas isolé. C'est le symptôme d'un modèle où chaque thème se réduit à `(value_min, value_max, value_exact, unit)`. Cela marche pour « ≤ 9 m » et perd **quatre** dimensions de la prose juridique :

1. **Référence / datum** — par rapport à quoi se mesure la valeur : égout, faîtage, acrotère, terrain naturel, cote NGF, alignement. (« 9 m » n'a pas le même sens à l'égout ou au faîtage.)
2. **Relativité** — la valeur est un *écart* vis-à-vis d'une autre construction : hauteur autorisée, construction voisine, faîtage mitoyen. (Cas Boucau.)
3. **Conditionnalité** — la valeur dépend d'un cas (secteur, nature de travaux, taille du terrain). Partiellement modélisé via `cases`.
4. **Liens** — la règle est *complétée ailleurs* : « sous réserve de l'art. X », « se reporter au plan des hauteurs », une définition du lexique, un renvoi au PPRI.

**Symétrie critique** : le même aplatissement existe **côté faits**. `apps/api/src/services/dossierFacts.ts:153-154` écrit faîtage **et** égout sous la même clé `"hauteur"` (faîtage gagne, priorité 120 > 100). Une règle riche ne sert à rien si le fait du projet reste pauvre. Toute montée en sémantique doit être **bilatérale** (règle ET fait).

**Ça se reproduira** sur d'autres thèmes : recul = `H/2` (relatif à la hauteur !), emprise conditionnée à la taille du terrain, stationnement par logement / par m², espaces verts en pleine terre. La hauteur est juste le premier endroit où ça a mordu.

## 2. État des lieux — les briques existent, le tissage manque

| Brique | Fichier | État |
|---|---|---|
| `height_spec` (référence + relatif, 2 plafonds) | `packages/ingestion/.../structurer.ts` | **Fait** (niveau 2) : posé de bout en bout, pas encore évalué |
| Garde-fou « à vérifier » sur relatif | `structurer.ts` (`neutralizeRelativeHeightRule`) | **Fait** (niveau 1) : plus de faux refus |
| Scanner « ce que le système ne comprend pas » | `structurer/scan-heights.ts` | **Fait** : patron de mesure réutilisable |
| Cross-refs / overrides intra-document | segments (`adapters/interface.ts`, `engine/matchers.ts`) | **Présent** mais non remonté sur les règles |
| Adaptateurs PPRI / OAP | `adapters/ppri.ts`, `plu-oap.ts` | **Stubs** (cf. doc zonage) |
| Résolution spatiale SUP / cote PPRI / plan hauteurs / NGF | `apps/api/.../parcelAnalysis.ts` | **Mature** pour la *présence* ; pas branché sur l'évaluation des règles |
| Verdict LLM (voit égout/faîtage/NGF) | `apps/api/.../ruleVerdicts.ts` | **Présent** : 2ᵉ chemin d'évaluation, non borné/non nourri du contexte résolu |
| Mentions légales (Code urba / Légifrance) | `legal_mentions` | Cache présent, non lié aux règles |

**Constat** : la matière première des recoupes est déjà là (cross_refs, SUP, cote PPRI, plan hauteurs, NGF, mentions légales). Ce qui manque, c'est une **couche qui les résout en une règle effective** consommée par l'évaluateur.

## 3. Cible — trois couches

### A. Représentation sémantique (au-delà du scalaire)
Généraliser `height_spec` en une enveloppe `rule_semantics` par thème :
`{ reference, relative_to, max_delta, cases, related_refs[] }`. La structuration passe d'« extraire un nombre » à « extraire le nombre + son cadre + ses liens ».
**Principe de sécurité** (déjà appliqué) : tant qu'on ne sait pas évaluer une dimension, on rétrograde en *« à vérifier »* — jamais de faux verdict.

### B. Couche de résolution / recoupes (le cœur du sujet)
Pour `(parcelle, règle)`, produire la **règle effective** en résolvant :
- **Intra-PLU** : lexique/définitions (comment *ce* PLU mesure « hauteur »), dispositions générales du titre I (priment sur la zone), `cross_refs`/`overrides`.
- **Inter-documents** : PPRI/SUP (opposables, **supérieurs** au PLU — p. ex. cote NGF de plancher), plan des hauteurs **graphique** (prime sur l'article littéral), PEB, SCoT, Code de l'urbanisme.
- **Précédence** : graphique > littéral ; SUP/PPRI > PLU ; spécial > général.
Sortie = contrainte **fusionnée** + **traçabilité** des documents contributeurs (indispensable pour l'instructeur et l'audit).

### C. Évaluation à deux vitesses, LLM borné
- **Déterministe** (`regulatory-engine`) : évalue les contraintes numériques **résolues** — rapide, auditable, citable. C'est là que `rule_semantics` paie.
- **LLM** (`ruleVerdicts`, qui voit déjà égout/faîtage/NGF) : traite le vraiment qualitatif et le non-résoluble (relatif à la hauteur autorisée, aspect, « harmonie »), mais **nourri** du contexte résolu + liens, et **contraint** à « à vérifier / motivé » plutôt qu'à un verdict libre. Le LLM *lit* les subtilités et propose ; le déterministe *confirme* ce qu'il peut.

## 4. Mesurer d'abord (principe déjà éprouvé)
Le scanner de hauteurs est le patron. Construire le même « ce que le système ne comprend pas » pour les **liens** : combien de règles contiennent « article X », « sous réserve », « se reporter au plan », « PPRI », un terme du lexique. Ça **dimensionne** le chantier recoupe avant de le bâtir (et évite de sur-investir sur un cas rare).

## 5. Séquencement pragmatique (ne pas tout faire d'un coup)
1. **3a — égout/faîtage de bout en bout** : dédoubler les faits (`hauteur_egout`/`hauteur_faitage`) + faire consommer `height_spec` par l'évaluateur. Prouve la couche A sur un thème, côté règle ET fait. *Sûr, non régressif.*
2. **Extraction des liens** : remonter `cross_refs`/renvois documentaires sur les règles (`related_refs`) + un **scanner de liens** pour mesurer.
3. **Première vraie recoupe** : PPRI inondable × hauteur/cote NGF (tu as déjà PPRI dans `commune_documents`, le plan hauteurs, la cote de référence et le NGF côté pièce) → un « effective rule » résolu et tracé. *Le premier croisement réel.*
4. **Lexique/définitions par PLU** : indexer le titre I + le lexique → fournir « comment se mesure X » à l'évaluateur.
5. **Généraliser** `rule_semantics` aux thèmes relatifs (recul `H/2`).

## 6. Risques & garde-fous
- **Sécurité d'abord** : toujours « à vérifier » plutôt qu'un faux verdict ; une déclaration citoyenne ne fonde pas un blocage (déjà en place).
- **Précédence mal résolue = pire que pas de recoupe** : traçabilité obligatoire des documents contributeurs + validation instructeur avant tout verdict bloquant.
- **Coût/latence LLM** : déterministe d'abord, LLM borné au qualitatif et au résiduel.
- **Le cas Boucau lui-même** (relatif à la « hauteur autorisée ») exige de résoudre une hauteur définie par d'autres alinéas : possiblement **non automatisable sûrement** à court terme → reste « à vérifier », bien expliqué.

---

### En une phrase
Le système n'a pas un problème de hauteur ; il a un problème de **perte de sens à l'extraction** et d'**absence de tissage inter-documents**. La hauteur en est le premier symptôme traité ; ce document généralise la réponse — représentation sémantique → résolution des recoupes → évaluation à deux vitesses — en mesurant à chaque étape.
