/**
 * Extractor — raw document → text.
 *  - .pdf  → pdftotext (poppler-utils). Offline/CLI use; not the Railway runtime.
 *  - .txt  → read as-is (handy for tests / pre-extracted text).
 *  - .docx → TODO (mammoth) — next sprint.
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export function extractText(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === ".txt") return fs.readFileSync(filePath, "utf-8");

  if (ext === ".pdf") {
    try {
      // pdftotext separates pages with form-feed (\f); the cleaner handles it.
      return execSync(`pdftotext "${filePath}" -`, { encoding: "utf-8", maxBuffer: 64 * 1024 * 1024 });
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      throw new Error(
        `Échec d'extraction PDF via pdftotext. Installez poppler-utils (\`apt install poppler-utils\` / \`brew install poppler\`) ` +
          `ou fournissez un .txt pré-extrait. Détail : ${detail}`,
      );
    }
  }

  if (ext === ".docx") {
    throw new Error("Extraction DOCX pas encore supportée (mammoth à venir). Convertissez en PDF ou TXT.");
  }

  throw new Error(`Format non supporté : ${ext || "(aucune extension)"} — attendu .pdf / .txt / .docx`);
}
