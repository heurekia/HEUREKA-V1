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

/** Vrai seulement si un DSN est configuré (sinon Sentry est entièrement no-op). */
export const sentryEnabled = !!dsn;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? "development",
    release: process.env.SENTRY_RELEASE,
    // Capture d'erreurs uniquement — pas de tracing (cf. en-tête).
    tracesSampleRate: 0,
    // Échantillonnage des ERREURS si un jour le volume l'exige (défaut : tout).
    sampleRate: Number(process.env.SENTRY_SAMPLE_RATE ?? 1),
  });
  // NB : au boot, Sentry loggue « [Sentry] express is not instrumented … --import ».
  // C'est ATTENDU et sans conséquence : ce message concerne l'auto-instrumentation
  // de PERFORMANCE (tracing), qu'on désactive volontairement (tracesSampleRate 0,
  // métriques Prometheus à la place). La capture d'exceptions — handlers globaux
  // + handler Express — fonctionne sans cette instrumentation. (Activer le tracing
  // demanderait de lancer node avec `--import ./instrument.mjs`.)
}

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
