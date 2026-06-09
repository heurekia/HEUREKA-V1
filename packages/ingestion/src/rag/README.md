# RAG — Recherche sémantique sur les documents réglementaires annexes

Phase 1 du plan de consolidation. Permet à un dossier en instruction de
récupérer **les passages réglementaires pertinents** (PPRI, OAP, PEB,
servitudes…) avec leur citation traçable, à la place — ou en plus — d'une
synthèse rédigée à la main.

## Pourquoi pas le PDF complet dans le prompt

Envoyer 200 pages de PLU à chaque verdict coûterait ~0,42 $ par dossier
chez Sonnet 4.6. Le RAG ne coûte que ~0,0075 $ par requête (3-5 chunks de
~500 tokens injectés). 56× moins cher, et **plus précis** — le LLM ne
"perd" pas l'information au milieu de 100k tokens.

## Architecture

```
PDF (base64)
   │
   │  extractPdfPages()   (apps/api/src/services/ragService.ts)
   ▼
pages: string[]
   │
   │  chunkPages()        (packages/ingestion/src/rag/chunker.ts)
   ▼
chunks: { index, page, text }[]
   │
   │  embedTexts(input_type="document")   (Voyage-3)
   ▼
embeddings: number[][]  (1024 dims)
   │
   │  upsert dans document_segments  (pgvector)
   ▼
[ requêtes RAG ]
   │
   │  searchSegments(query, insee, doc_types)
   │   ├─ embed query (input_type="query")
   │   └─ ORDER BY embedding <=> :query_vec LIMIT k
   ▼
SearchHit[] : passages + page + source_id + distance
```

## Coût indicatif (Voyage-3)

| Étape | Coût | Fréquence |
|---|---|---|
| Indexation d'un PLU 200 pages | ~0,005 $ | 1× à l'upload |
| Indexation d'un PPRI 80 pages | ~0,002 $ | 1× à l'upload |
| Requête au moment d'un verdict | ~0,00001 $ | par dossier |

## API

### `chunkPages(pages, opts?)` — pur, sans I/O

Découpe un texte par page en chunks ~1200 chars, respecte les frontières
paragraphe → phrase → mot. Heuristique anti-sommaire incluse.

### `indexDocument(params)` — DB

Idempotent : ré-indexer le même `source_id` remplace ses anciens segments.

### `deleteIndexFor(source_id)` — DB

À appeler quand on supprime un document — sinon segments orphelins.

### `searchSegments(params)` — DB

Recherche cosine pgvector. Renvoie les top-k hits avec leur distance,
page, source_id et metadata.

## Endpoints HTTP exposés (apps/api)

- `POST /api/mairie/documents` — déclenche l'indexation en arrière-plan
  après création du `commune_documents`. Statut `uploaded → indexing →
  indexed | indexing_empty | indexing_error`.
- `DELETE /api/mairie/documents/:id` — nettoie l'index avant suppression.
- `GET /api/mairie/documents/search?q=...&insee=...&doc_types=PPRI,OAP&top_k=5` —
  recherche manuelle (sert au verdict engine + debug).

## Suite naturelle (non livré dans ce commit)

- **Annotations niveau B** : permettre à l'instructeur d'attacher une note
  à un chunk précis ("la cote NGF de référence est celle de 1997, pas
  celle de 2010 reprise par erreur dans cette édition"). L'annotation
  remontera dans le prompt à côté du chunk → l'IA peut intégrer la nuance
  dans son verdict.
- **Intégration dans `ruleVerdicts`** : remplacer (ou compléter) l'injection
  des `commune_documents.synthese` par `searchSegments()` filtré sur la
  zone PLU du dossier.
- **Adapter `PLU_REGLEMENT`** : indexer aussi le règlement PLU lui-même
  pour les citations type "PLU Ballan, zone UB, art. 7, p. 42".
