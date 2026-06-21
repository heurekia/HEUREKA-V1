import { db } from "../../db.js";
import { communes } from "@heureka-v1/db";
import { eq } from "drizzle-orm";
import { type AuthRequest } from "../../middlewares/auth.js";
import path from "path";
import { fileURLToPath } from "url";
import { PDFDocument } from "pdf-lib";
import {
  computeInstructionDelay,
  type DeadlineMetadata,
  type DeadlineServitude,
} from "../../services/instructionDelays.js";

export const __dirname_mairie = path.dirname(fileURLToPath(import.meta.url));
export const UPLOADS_DIR_MAIRIE = path.resolve(__dirname_mairie, "../../../uploads");

// Les gros règlements PLU (200+ pages) sont découpés en tronçons ≤ maxPages
// avant rendu page-à-page en PNG (Pixtral n'accepte pas le PDF natif). Léger
// chevauchement pour ne pas couper en deux la section d'une zone à cheval sur
// deux tronçons. Un PLU court (≤ 100 pages) reste en un seul tronçon.
export async function splitPdfBase64(base64: string, maxPages = 90, overlap = 8): Promise<string[]> {
  const src = await PDFDocument.load(Buffer.from(base64, "base64"), { ignoreEncryption: true });
  const total = src.getPageCount();
  if (total <= 100) return [base64];

  const chunks: string[] = [];
  const stride = Math.max(1, maxPages - overlap);
  for (let start = 0; start < total; start += stride) {
    const end = Math.min(start + maxPages, total);
    const out = await PDFDocument.create();
    const indices = Array.from({ length: end - start }, (_, i) => start + i);
    const pages = await out.copyPages(src, indices);
    pages.forEach(p => out.addPage(p));
    chunks.push(await out.saveAsBase64());
    if (end >= total) break;
  }
  return chunks;
}

// Résout l'UUID de commune à partir de l'INSEE du user connecté (cache LRU
// simple : la map ne grossit jamais au-delà du nombre de communes actives).
export const _communeIdByInsee = new Map<string, string | null>();
export async function resolveCommuneIdFromUser(req: AuthRequest): Promise<string | null> {
  const insee = req.user?.commune_insee;
  if (!insee) return null;
  if (_communeIdByInsee.has(insee)) return _communeIdByInsee.get(insee) ?? null;
  const [row] = await db.select({ id: communes.id }).from(communes).where(eq(communes.insee_code, insee)).limit(1);
  const id = row?.id ?? null;
  _communeIdByInsee.set(insee, id);
  return id;
}

// Délais réglementaires d'instruction (Code de l'Urbanisme)
// Implémentation détaillée et auditable : voir services/instructionDelays.ts.
// Le tableau ci-dessous reste pour le retour "rules_defaut" de l'admin.
export const DELAI_INSTRUCTION_MOIS_DEFAUT: Record<string, number> = {
  permis_de_construire: 3,
  permis_de_construire_mi: 2,
  declaration_prealable: 1,
  permis_amenager: 3,
  permis_demolir: 2,
  permis_lotir: 3,
  certificat_urbanisme: 2,
  certificat_urbanisme_a: 1,
  certificat_urbanisme_b: 2,
};

// Façade legacy (call sites internes encore présents). Préférer computeInstructionDelay
// pour récupérer le breakdown auditable.
export function computeDelaiMois(
  type: string,
  metadata: DeadlineMetadata | null | undefined,
  servitudes: DeadlineServitude[] | null | undefined,
): number {
  return computeInstructionDelay(type, metadata, servitudes).total_mois;
}
