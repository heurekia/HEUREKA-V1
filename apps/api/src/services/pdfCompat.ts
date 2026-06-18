/**
 * Conversion PDF "compat" pour le viewer pdf.js.
 *
 * Contexte (3.C.3 / juin 2026) : certains PDF déposés (notamment plans
 * d'architecte au format A3 avec rendus photoréalistes intégrés) utilisent
 * le filtre /JPXDecode (JPEG 2000) pour les calques raster. Le décodeur
 * interne de pdf.js échoue silencieusement sur ces images — pdf.js
 * affiche correctement le squelette vectoriel et les labels, mais omet
 * les renders photo. Aucune erreur en console : c'est un comportement
 * documenté de Mozilla pdf.js.
 *
 * Solution : on génère côté serveur une variante "compat" en passant
 * l'original par pdftocairo (poppler-utils, déjà sur le VPS). pdftocairo
 * relit le PDF et ré-encode les images dans des formats que pdf.js sait
 * rendre (JPEG, FlateDecode), tout en préservant la structure logique
 * (texte sélectionnable, vecteurs).
 *
 * Coût : ~1-5 s par PDF, fait une fois à l'upload. La conversion est
 * fire-and-forget : le citoyen reçoit la confirmation de l'upload sans
 * attendre, et la version compat est posée en arrière-plan.
 */
import { spawn } from "node:child_process";
import { Buffer } from "node:buffer";

/** Marqueur de la conversion compat sur la clé de stockage. La route
 *  /api/uploads/:key essaie d'abord <uuid>.compat.pdf, puis tombe sur
 *  <uuid>.pdf si la conversion n'a pas (encore) eu lieu. */
export function compatKeyFor(originalKey: string): string {
  // Suffixe avant l'extension. `<uuid>.pdf` → `<uuid>.compat.pdf`.
  const m = originalKey.match(/^(.+)\.([^.]+)$/);
  if (!m) return `${originalKey}.compat`;
  return `${m[1]}.compat.${m[2]}`;
}

/** Détecte si un PDF contient un filtre /JPXDecode (JPEG 2000).
 *  Heuristique simple — on cherche le littéral dans les bytes. Suffisant
 *  pour le cas qui nous intéresse (images embeddées par les logiciels de
 *  CAO d'architecte qui stockent les renders en JP2). */
export function containsJpx(buffer: Buffer): boolean {
  return buffer.includes(Buffer.from("/JPXDecode"));
}

/** Lance pdftocairo en mode PDF→PDF via stdin/stdout. Le binaire fait
 *  partie de `poppler-utils`, déjà installé sur le VPS pour la chaîne
 *  Pixtral (cf. nixpacks.toml historique / apt install).
 *
 *  Timeout 30 s par sécurité : sur un PDF malformé pdftocairo peut
 *  rester bloqué indéfiniment, on préfère renoncer et garder
 *  l'original que de bloquer la queue d'uploads. */
export async function convertToCompatPdf(buffer: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const proc = spawn("pdftocairo", ["-pdf", "-", "-"], { stdio: ["pipe", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    let stderr = "";
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new Error("pdftocairo timeout (30s)"));
    }, 30_000);

    proc.stdout.on("data", (c: Buffer) => chunks.push(c));
    proc.stderr.on("data", (c: Buffer) => { stderr += c.toString(); });
    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`pdftocairo introuvable ou erreur de lancement : ${err.message}`));
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve(Buffer.concat(chunks));
      } else {
        reject(new Error(`pdftocairo exit ${code}: ${stderr.slice(0, 200)}`));
      }
    });

    proc.stdin.end(buffer);
  });
}

/** Pipeline complet utilisé après un upload : si le PDF contient du
 *  JPEG 2000, on lance la conversion et on retourne le buffer. Sinon
 *  on renvoie null — le caller sait qu'aucune action n'est requise. */
export async function maybeBuildCompatPdf(buffer: Buffer, mime: string): Promise<Buffer | null> {
  if (mime !== "application/pdf") return null;
  if (!containsJpx(buffer)) return null;
  return convertToCompatPdf(buffer);
}
