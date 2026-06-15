import { db, regulatory_analyses, regulatory_findings } from "@heureka-v1/db";
import { eq } from "drizzle-orm";
import { ENGINE_VERSION } from "../version.js";
import { buildInstructionContext } from "../context/builder.js";
import { loadEvaluableRulesByIds } from "../evaluators/loader.js";
import { runEvaluation } from "./runEvaluation.js";
import type { EvaluationRun } from "./types.js";

export interface RunAnalysisOptions {
  triggered_by?: string;
}

export interface RunAnalysisResult {
  analysis_id: string;
  run: EvaluationRun;
}

// Pipeline complet pour un dossier :
//
//   1. Insert regulatory_analyses(status='running').
//   2. Build context + load full rules + run pure evaluation.
//   3. Insert findings + update analysis (status='done', summary,
//      context_snapshot, finished_at).
//   4. En cas d'erreur : update analysis (status='failed', summary={error}).
//
// On NE marque PAS les analyses précédentes obsolètes automatiquement. Cela
// se fait via une validation explicite côté UI ("valider cette analyse")
// — sinon une analyse en cours d'exécution éclipserait silencieusement la
// dernière analyse validée.
export async function runAnalysis(
  dossierId: string,
  options: RunAnalysisOptions = {},
): Promise<RunAnalysisResult> {
  const inserted = await db
    .insert(regulatory_analyses)
    .values({
      dossier_id: dossierId,
      status: "running",
      engine_version: ENGINE_VERSION,
      triggered_by: options.triggered_by ?? null,
    })
    .returning({ id: regulatory_analyses.id });
  const analysisId = inserted[0]!.id;

  try {
    const context = await buildInstructionContext(dossierId);
    const fullRules = await loadEvaluableRulesByIds(context.candidate_rule_ids);
    const run = runEvaluation(context, fullRules);

    if (run.findings.length > 0) {
      await db.insert(regulatory_findings).values(
        run.findings.map((f) => ({
          analysis_id: analysisId,
          dossier_id: f.dossier_id,
          topic: f.topic,
          status: f.status,
          severity: f.severity,
          title: f.title,
          explanation: f.explanation ?? null,
          legal_basis: f.legal_basis,
          source_refs: f.source_refs,
          facts_used: f.facts_used,
          missing_facts: f.missing_facts,
          recommended_action: f.recommended_action ?? null,
          citizen_summary: f.citizen_summary ?? null,
          rule_id: f.rule_id ?? null,
        })),
      );
    }

    await db
      .update(regulatory_analyses)
      .set({
        status: "done",
        context_snapshot: run.context,
        summary: run.summary,
        ruleset_version: rulesetFingerprint(fullRules),
        finished_at: new Date(),
      })
      .where(eq(regulatory_analyses.id, analysisId));

    return { analysis_id: analysisId, run };
  } catch (err) {
    await db
      .update(regulatory_analyses)
      .set({
        status: "failed",
        summary: { error: serializeError(err) },
        finished_at: new Date(),
      })
      .where(eq(regulatory_analyses.id, analysisId));
    throw err;
  }
}

// Empreinte synthétique du jeu de règles utilisé : count + IDs triés.
// Pas un hash cryptographique — suffisant pour détecter qu'on a changé de
// ruleset entre deux analyses sans gonfler le payload. Pour de l'audit
// fort on basculera sur un sha256 stable.
function rulesetFingerprint(rules: { rule_id: string }[]): string {
  if (rules.length === 0) return "empty";
  const ids = rules.map((r) => r.rule_id).sort();
  return `n=${ids.length};first=${ids[0]};last=${ids[ids.length - 1]}`;
}

function serializeError(err: unknown): { name?: string; message: string; stack?: string } {
  if (err instanceof Error) {
    return { name: err.name, message: err.message, stack: err.stack };
  }
  return { message: String(err) };
}
