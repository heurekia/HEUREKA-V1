const API_BASE = "/api";

// Erreur HTTP enrichie : expose le status et le corps JSON parsé pour que les
// call-sites puissent réagir spécifiquement (ex. 423 « dossier en cours d'OCR »
// → redirection avec toast plutôt qu'alerte générique).
export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

async function request<T>(path: string, options?: RequestInit & { timeoutMs?: number }): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options?.headers as Record<string, string> ?? {}),
  };

  // Garde-fou : sans cela, une requête qui ne revient jamais (génération IA très
  // longue, passerelle réseau qui coupe sans réponse) laisse l'UI tourner à l'infini.
  const timeoutMs = options?.timeoutMs ?? 120_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers,
      credentials: "include",
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error("La requête a expiré (délai dépassé). Réessayez.");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const message = (body as { error?: string }).error ?? `Erreur ${res.status}`;
    throw new ApiError(message, res.status, body);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown, opts?: { timeoutMs?: number }) =>
    request<T>(path, { method: "POST", body: JSON.stringify(body), timeoutMs: opts?.timeoutMs }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PUT", body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};
