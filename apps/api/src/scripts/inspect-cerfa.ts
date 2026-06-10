// Outil d'audit des champs AcroForm d'un CERFA.
//
// Usage :
//   pnpm --filter @heureka-v1/api exec tsx src/scripts/inspect-cerfa.ts \
//     src/data/cerfa/13406-16.pdf
//
// Écrit côté à côté un fichier `<pdf>.fields.json` avec :
//   - index ordinal du champ dans le PDF
//   - nom AcroForm (clé utilisée par pdf-lib pour le remplissage)
//   - type (PDFTextField | PDFCheckBox | PDFDropdown | …)
//
// Sert à reconstruire la table de mapping `cerfaPcmiFiller.ts` quand on
// change de millésime de formulaire (13406*17, *18…), sans avoir à
// re-binder les champs à la main.

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PDFDocument } from "pdf-lib";

async function main() {
  const input = process.argv[2];
  if (!input) {
    console.error("Usage : tsx src/scripts/inspect-cerfa.ts <chemin.pdf>");
    process.exit(1);
  }
  const bytes = readFileSync(input);
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const form = doc.getForm();
  const fields = form.getFields();
  const out = fields.map((f, i) => ({
    i,
    name: f.getName(),
    type: f.constructor.name,
  }));

  const outputPath = `${path.dirname(input)}/${path.basename(input, ".pdf")}.fields.json`;
  writeFileSync(outputPath, JSON.stringify(out, null, 2));

  const checkboxes = out.filter((f) => f.type === "PDFCheckBox").length;
  console.log(`PDF : ${input}`);
  console.log(`Total champs : ${out.length} (${checkboxes} cases à cocher)`);
  console.log(`Référence écrite : ${outputPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
