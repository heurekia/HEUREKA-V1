// Seed initial des articles du Code de l'urbanisme cités par le moteur de
// classification déterministe (apps/api/src/services/classificationEngine.ts).
// Usage : `pnpm --filter @heureka-v1/api seed:legal-articles`
//
// Sans credentials PISTE en environnement, le script échoue proprement
// article par article (un warn par article) — les références déjà en base
// ne sont pas touchées.

import "dotenv/config";
import { refreshArticle } from "../services/legifrance.js";

const ARTICLES: { code: string; num: string }[] = [
  { code: "CU", num: "L410-1" },
  { code: "CU", num: "R421-1"  },
  { code: "CU", num: "R421-9"  },
  { code: "CU", num: "R421-12" },
  { code: "CU", num: "R421-13" },
  { code: "CU", num: "R421-14" },
  { code: "CU", num: "R421-17" },
  { code: "CU", num: "R421-19" },
  { code: "CU", num: "R421-23" },
  { code: "CU", num: "R421-27" },
  { code: "CU", num: "R421-28" },
  { code: "CU", num: "R431-2"  },
  { code: "CU", num: "R442-1"  },
];

async function main() {
  let ok = 0;
  let ko = 0;
  for (const { code, num } of ARTICLES) {
    const a = await refreshArticle(code, num);
    if (a) {
      ok++;
      console.log(`✓ ${code} ${num} — ${a.article_title ?? "(sans titre)"}`);
    } else {
      ko++;
      console.warn(`✗ ${code} ${num} — non récupéré`);
    }
  }
  console.log(`\nDone. ${ok} ok, ${ko} échec(s).`);
  process.exit(ko === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
