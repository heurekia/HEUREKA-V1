import * as Sentry from "@sentry/node";
import type { Express } from "express";

// ── Observabilité : capture d'erreurs Sentry (durcissement § 2.4) ────────────
//
// Activé UNIQUEMENT si `SENTRY_DSN` est défini. Sans DSN, tout est no-op : ce
// module est donc SÛR À MERGER sans projet Sentry — on posera le DSN en variable
// d'env quand il sera prêt, sans changement de code ni redéploiement applicatif.
//
// Périmètre volontairement réduit à la CAPTURE D'EXCEPTIONS :
//  - handlers globaux `uncaughtException` / `unhandledRejection` (intégrations
//    Sentry par défaut) — l'essentiel : on ne rate plus un crash ;
//  - handler d'erreurs Express (erreurs propagées via `next(err)`).
// PAS de tracing de performance (`tracesSampleRate: 0`) : la perf et la
// volumétrie sont déjà couvertes par les métriques Prometheus (§ 2.3), et le
// tracing v8 (basé OpenTelemetry) demanderait une init via `--import` pour
// instrumenter proprement. On garde donc le strict utile, sans cette complexité.

const dsn = process.env.SENTRY_DSN;

// `enabled` reflète l'init RÉELLEMENT réussie, pas seulement la présence d'un DSN.
// Un DSN mal formé fait **throw** `Sentry.init` au chargement du module ; sans le
// try/catch ci-dessous, ce throw remonte jusqu'à l'import dans index.ts et CRASHE
// le process au boot — incident vécu : un DSN placeholder non substitué a mis
// l'API en crash-loop (502). On préfère démarrer SANS Sentry et le signaler.
let enabled = false;

if (dsn) {
  try {
    Sentry.init({
      dsn,
      environment: process.env.NODE_ENV ?? "development",
      release: process.env.SENTRY_RELEASE,
      // Capture d'erreurs uniquement — pas de tracing (cf. en-tête).
      tracesSampleRate: 0,
      // Échantillonnage des ERREURS si un jour le volume l'exige (défaut : tout).
      sampleRate: Number(process.env.SENTRY_SAMPLE_RATE ?? 1),
      // ⚠️ On DÉSACTIVE l'auto-instrumentation par défaut (OpenTelemetry : Http,
      // Express, fetch…). Raisons : (1) on ne fait pas de tracing, elle est donc
      // inutile ; (2) sous notre bundle esbuild elle ne peut pas patcher les
      // modules (d'où le warning « express is not instrumented … --import ») et
      // c'est le suspect n°1 du crash-loop observé en prod à l'activation de
      // Sentry. On ne garde QUE les intégrations de CAPTURE D'ERREURS — elles
      // n'instrumentent aucun module et suffisent à notre usage.
      defaultIntegrations: false,
      integrations: [
        Sentry.onUncaughtExceptionIntegration(),
        Sentry.onUnhandledRejectionIntegration(),
        Sentry.dedupeIntegration(),
        Sentry.linkedErrorsIntegration(),
        Sentry.inboundFiltersIntegration(),
        Sentry.functionToStringIntegration(),
      ],
    });
    enabled = true;
  } catch (err) {
    // Ne JAMAIS laisser une init Sentry ratée tuer l'API : on loggue et on
    // continue sans capture (le reste de l'app n'en dépend pas).
    console.error(
      "[sentry] init échouée (DSN invalide ?) — démarrage SANS Sentry:",
      err instanceof Error ? err.message : err,
    );
  }
}

/** Vrai seulement si l'init Sentry a RÉUSSI (DSN présent ET valide). */
export const sentryEnabled = enabled;

/**
 * Branche le handler d'erreurs Express de Sentry (no-op si DSN absent). À appeler
 * APRÈS l'enregistrement des routes.
 */
export function setupSentryErrorHandler(app: Express): void {
  if (sentryEnabled) Sentry.setupExpressErrorHandler(app);
}

/**
 * Capture explicite d'une exception avec contexte optionnel (no-op si DSN
 * absent). À utiliser dans les `catch` où une erreur serait sinon avalée.
 */
export function captureException(err: unknown, context?: Record<string, unknown>): void {
  if (!sentryEnabled) return;
  Sentry.captureException(err, context ? { extra: context } : undefined);
}
