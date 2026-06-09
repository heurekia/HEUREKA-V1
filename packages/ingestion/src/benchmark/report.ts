/**
 * Génère un rapport Markdown à partir d'un BenchmarkRun.
 * Sortie ouvrable directement dans GitHub ou GitLab pour partage avec la
 * DSI / le DPD.
 */
import type { BenchmarkRun, ProviderAggregate } from "./types.js";

function pct(n: number): string {
  return (n * 100).toFixed(1) + " %";
}

function eur(n: number): string {
  if (n < 0.01) return (n * 100).toFixed(2) + " c€";
  return n.toFixed(n < 1 ? 4 : 3) + " €";
}

function ms(n: number): string {
  if (n < 1000) return `${Math.round(n)} ms`;
  return `${(n / 1000).toFixed(1)} s`;
}

function pickWinner(providers: ProviderAggregate[], key: keyof ProviderAggregate, higher = true): string {
  if (providers.length === 0) return "—";
  const sorted = [...providers].sort((a, b) => {
    const av = a[key] as number;
    const bv = b[key] as number;
    return higher ? bv - av : av - bv;
  });
  return sorted[0]!.provider.name;
}

export function renderMarkdownReport(run: BenchmarkRun): string {
  const sections: string[] = [];
  sections.push(`# Benchmark LLM — HEUREKA Analyse de pièces`);
  sections.push("");
  sections.push(`**Date** : ${new Date(run.finished_at).toLocaleString("fr-FR")}`);
  sections.push(`**Fixtures évaluées** : ${run.fixtures_count}`);
  sections.push(`**Providers comparés** : ${run.providers.length}`);
  sections.push("");

  // ─ Récapitulatif global ─
  sections.push(`## Récapitulatif comparatif`);
  sections.push("");
  sections.push(`| Provider | Pays / Région | F1 extraction | Type OK | JSON valide | Latence p50 | Latence p95 | Coût total | Erreurs |`);
  sections.push(`|---|---|---|---|---|---|---|---|---|`);
  for (const p of run.providers) {
    sections.push(
      `| **${p.provider.name}** | ${p.provider.country} / ${p.provider.region} | ${pct(p.avg_f1)} | ${pct(p.type_accuracy)} | ${pct(p.json_validity)} | ${ms(p.p50_latency_ms)} | ${ms(p.p95_latency_ms)} | ${eur(p.total_cost_eur)} | ${p.errors} |`,
    );
  }
  sections.push("");

  // ─ Verdicts par critère ─
  sections.push(`## Gagnant par critère`);
  sections.push("");
  sections.push(`- **Qualité extraction (F1)** : ${pickWinner(run.providers, "avg_f1")}`);
  sections.push(`- **Identification du type de pièce** : ${pickWinner(run.providers, "type_accuracy")}`);
  sections.push(`- **Latence** : ${pickWinner(run.providers, "p50_latency_ms", false)}`);
  sections.push(`- **Coût** : ${pickWinner(run.providers, "total_cost_eur", false)}`);
  sections.push(`- **Robustesse JSON** : ${pickWinner(run.providers, "json_validity")}`);
  sections.push("");

  // ─ Détail par fixture ─
  sections.push(`## Détail par fixture`);
  sections.push("");
  for (const item of run.per_piece) {
    sections.push(`### ${item.fixture.id} — ${item.fixture.label}`);
    sections.push("");
    sections.push(`Type attendu : \`${item.fixture.golden.piece_type}\` · ${item.fixture.context.zone ? `Zone PLU \`${item.fixture.context.zone}\`` : ""}`);
    sections.push("");
    sections.push(`| Provider | Type détecté | F1 | P | R | Hallucinations | Manquants | Latence | Coût |`);
    sections.push(`|---|---|---|---|---|---|---|---|---|`);
    for (const r of item.results) {
      const got_type = (r.extraction.parsed?.piece_type as string) ?? "—";
      const typeMark = r.score_extraction.type_match ? "✓" : "✗";
      sections.push(
        `| ${r.provider} | ${typeMark} \`${got_type}\` | ${pct(r.score_extraction.f1)} | ${pct(r.score_extraction.precision)} | ${pct(r.score_extraction.recall)} | ${r.score_extraction.hallucinations.length} | ${r.score_extraction.missing.length} | ${ms(r.extraction.duration_ms)} | ${eur(r.extraction.cost_eur + r.analysis.cost_eur)} |`,
      );
      if (r.extraction.error) {
        sections.push(`> ⚠️ erreur ${r.provider} : ${r.extraction.error}`);
      }
      if (r.score_extraction.wrong_values.length > 0) {
        sections.push(`> Valeurs incorrectes ${r.provider} :`);
        for (const w of r.score_extraction.wrong_values) {
          sections.push(`> - \`${w.field}\` : attendu \`${JSON.stringify(w.expected)}\`, obtenu \`${JSON.stringify(w.got)}\``);
        }
      }
    }
    sections.push("");
  }

  // ─ Recommandation ─
  sections.push(`## Recommandation`);
  sections.push("");
  sections.push(`> ⚠️ **Lecture du résultat** : un écart de F1 < 5 points entre providers n'est pas significatif sur un faible échantillon (n < 30). Privilégier les autres critères (souveraineté, coût, latence) dans ce cas.`);
  sections.push("");
  sections.push(`Critères de décision suggérés :`);
  sections.push(`1. Si la qualité **F1 extraction** d'un provider UE dépasse 85 % et reste à moins de 5 points du meilleur provider US → basculer sur le provider UE.`);
  sections.push(`2. Sinon, conserver le meilleur provider en privilégiant la qualité, et documenter le choix au DPD avec la présente AIPD.`);
  sections.push(`3. Pour les CERFA et plans très techniques où la qualité chute trop, prévoir une voie de secours (instructeur humain direct, ou seconde passe sur le meilleur modèle).`);
  return sections.join("\n");
}
