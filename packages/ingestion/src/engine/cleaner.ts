/**
 * Cleaner — strips noise (headers, footers, page numbers, form-feeds) using the
 * adapter's `noise_patterns`, and normalises whitespace. Returns clean lines.
 */

export interface CleanResult {
  lines: string[];
  text: string;
  removed: number;
}

export function clean(rawText: string, noisePatterns: RegExp[]): CleanResult {
  // pdftotext separates pages with form-feed (\f); treat it as a line break.
  const rawLines = rawText.replace(/\f/g, "\n").split(/\r?\n/);

  const lines: string[] = [];
  let removed = 0;

  for (const raw of rawLines) {
    const line = raw.replace(/[ \t]+/g, " ").trimEnd();
    const trimmed = line.trim();
    if (noisePatterns.some((p) => p.test(trimmed))) {
      removed++;
      continue;
    }
    lines.push(line);
  }

  // Collapse runs of 3+ blank lines into a single blank line.
  const collapsed: string[] = [];
  let blanks = 0;
  for (const line of lines) {
    if (line.trim() === "") {
      blanks++;
      if (blanks > 1) continue;
    } else {
      blanks = 0;
    }
    collapsed.push(line);
  }

  return { lines: collapsed, text: collapsed.join("\n"), removed };
}
