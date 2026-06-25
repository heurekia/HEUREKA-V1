/**
 * fetch résilient pour les appels sortants (Mistral chat non-streaming).
 *
 * Node ne pose AUCUN timeout par défaut sur `fetch` : un appel qui pend bloque
 * la requête HTTP appelante indéfiniment et, dans le worker OCR / l'analyse de
 * conformité, laisse une ligne en statut `running` impossible à rejouer. Mistral
 * renvoie par ailleurs régulièrement des 429/503 transitoires.
 *
 * Ce helper pose un timeout par tentative (`AbortSignal.timeout`) et réessaie sur
 * les statuts transitoires + erreurs réseau, avec back-off exponentiel + jitter
 * et respect du `Retry-After`. Il renvoie la `Response` telle quelle (succès OU
 * échec définitif) : l'appelant garde sa gestion de `res.ok`.
 *
 * NB : réservé au NON-streaming. Le streaming SSE (`streamAi`) utilise un timeout
 * d'inactivité dédié, car un timeout global couperait une génération active.
 */
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

export interface FetchRetryOptions {
  /** Timeout par tentative (ms). Défaut : MISTRAL_TIMEOUT_MS ou 60 s. */
  timeoutMs?: number;
  /** Nombre de RÉ-essais (tentatives totales = retries + 1). Défaut : 3. */
  retries?: number;
  /** Préfixe des messages d'erreur. Défaut : "Mistral". */
  label?: string;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function backoffMs(attempt: number): number {
  return Math.min(8000, 500 * 2 ** attempt) + Math.floor(Math.random() * 250);
}

function retryAfterMs(res: Response): number | null {
  const header = res.headers.get("retry-after");
  if (!header) return null;
  const asSeconds = Number(header);
  if (Number.isFinite(asSeconds)) return Math.min(20_000, Math.max(0, asSeconds) * 1000);
  const asDate = Date.parse(header);
  if (Number.isFinite(asDate)) return Math.max(0, Math.min(20_000, asDate - Date.now()));
  return null;
}

export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  opts: FetchRetryOptions = {},
): Promise<Response> {
  const timeoutMs = opts.timeoutMs ?? Number(process.env.MISTRAL_TIMEOUT_MS ?? 60_000);
  const retries = opts.retries ?? 3;
  const label = opts.label ?? "Mistral";

  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      if (res.ok || !RETRYABLE_STATUS.has(res.status) || attempt === retries) return res;
      await sleep(retryAfterMs(res) ?? backoffMs(attempt));
    } catch (err) {
      lastErr = err;
      if (attempt === retries) {
        const reason = err instanceof Error ? err.message : String(err);
        throw new Error(`${label} : échec après ${retries + 1} tentative(s) — ${reason}`);
      }
      await sleep(backoffMs(attempt));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(`${label} : échec inattendu`);
}
