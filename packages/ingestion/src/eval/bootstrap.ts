/**
 * Bootstrap d'un golden file.
 *
 * Annoter à la main 14 articles × 20 zones est invivable. À la place :
 *   1. on lance le pipeline actuel sur le PDF
 *   2. on écrit ce qu'il a trouvé dans un golden.json marqué `annotated_by:
 *      "bootstrap (à relire)"` — la commune ne valide rien tant qu'un humain
 *      n'a pas relu/corrigé.
 *   3. l'humain édite le JSON pour retirer les faux positifs et ajouter les
 *      vrais manquants, puis met `annotated_by: <son nom>`.
 *
 * Cette stratégie inverse l'effort : on corrige une diff plutôt que de
 * partir d'une page blanche. C'est aussi le seul moyen réaliste d'obtenir un
 * corpus or sur 100 documents.
 */
import fs from "node:fs";
import path from "node:path";
import { runIngestion } from "../engine/pipeline.ts";
import type { GoldenFixture } from "./types.ts";

export interface BootstrapParams {
  pdfPath: string;
  adapter: string;
  insee: string;
  commune: string;
  doc_version: string;
  outPath: string;
  /** Chemin du PDF tel qu'écrit dans le golden (relatif). */
  sourcePdfRef?: string;
}

export function bootstrapGolden(p: BootstrapParams): { fixture: GoldenFixture; outPath: string } {
  const { segments } = runIngestion({
    file: p.pdfPath,
    adapter: p.adapter,
    insee: p.insee,
    commune: p.commune,
    version: p.doc_version,
    write: false,
  });

  const zones = segments.filter((s) => s.segment_type === "zone").map((s) => s.segment_code);
  const articlesPerZone: Record<string, number[]> = {};
  for (const seg of segments) {
    if (seg.segment_type !== "article") continue;
    const m = /^(.+)_ART_(\d+)$/.exec(seg.segment_code);
    if (!m) continue;
    const zone = m[1]!;
    const num = parseInt(m[2]!, 10);
    if (!articlesPerZone[zone]) articlesPerZone[zone] = [];
    if (!articlesPerZone[zone].includes(num)) articlesPerZone[zone].push(num);
  }
  for (const z of Object.keys(articlesPerZone)) articlesPerZone[z]!.sort((a, b) => a - b);

  const fixture: GoldenFixture = {
    _meta: {
      fixture_version: 1,
      source_pdf: p.sourcePdfRef ?? path.basename(p.pdfPath),
      adapter: p.adapter,
      insee: p.insee,
      commune: p.commune,
      doc_version: p.doc_version,
      annotated_by: "bootstrap (à relire)",
      annotated_at: new Date().toISOString().slice(0, 10),
      notes:
        "Fixture générée automatiquement depuis le pipeline. À relire à la main : retirer les zones/articles erronés, ajouter ce qui manque, puis remplacer annotated_by par votre nom.",
    },
    expected: {
      zones,
      articles_per_zone: articlesPerZone,
    },
    tolerances: {
      // Démarrer permissif tant que l'humain n'a pas relu. À durcir après.
      extra_zones_allowed: 0,
      missing_zones_allowed: 0,
      min_zone_f1: 0.9,
      min_article_f1: 0.85,
    },
  };

  fs.mkdirSync(path.dirname(p.outPath), { recursive: true });
  fs.writeFileSync(p.outPath, JSON.stringify(fixture, null, 2) + "\n");
  return { fixture, outPath: p.outPath };
}
