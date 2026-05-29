/**
 * Adapter registry — maps a CLI adapter name to its implementation.
 * Adding a document type = add one entry here + one adapter file.
 */
import type { DocumentAdapter } from "./interface.ts";
import { PLUReglementAdapter } from "./plu-reglement.ts";
import { PLUOAPAdapter } from "./plu-oap.ts";
import { PPRIAdapter } from "./ppri.ts";

export const ADAPTERS: Record<string, DocumentAdapter> = {
  "plu-reglement": PLUReglementAdapter,
  "plu-oap": PLUOAPAdapter,
  "ppri": PPRIAdapter,
};

export function getAdapter(name: string): DocumentAdapter {
  const a = ADAPTERS[name];
  if (!a) {
    throw new Error(`Adaptateur inconnu : « ${name} ». Disponibles : ${Object.keys(ADAPTERS).join(", ")}.`);
  }
  return a;
}
