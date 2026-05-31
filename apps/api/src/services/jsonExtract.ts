/**
 * Robust JSON-array extraction from LLM responses.
 *
 * Handles in order :
 *   1. Markdown code fences  (```json [...] ```)
 *   2. Preamble text         ("Voici la réponse: [...]")
 *   3. Trailing content      ("[...] merci")
 *   4. Object wrapping       ({"rules": [...]} or {"data": [...]})
 *   5. Truncated responses   (LLM hit max_tokens mid-array) — recovers every
 *      complete top-level object up to the last safely-closed one.
 *
 * String literals and escape sequences are tracked when walking brackets so
 * "{" and "}" inside strings are not mistaken for object boundaries.
 */
export function parseLooseArray(raw: string): unknown[] {
  // 1. Strip a markdown code fence if present. The first capturing group keeps
  //    only the content between the fences ; anything outside is discarded.
  let s = raw;
  const fence = s.match(/```(?:json|JSON)?\s*([\s\S]*?)```/);
  if (fence?.[1]) s = fence[1];

  // 2. Find the first '['. If none, the response may be a wrapper object
  //    like { "rules": [...] } — try to parse and return its first array.
  const start = s.indexOf("[");
  if (start < 0) return extractArrayFromObject(s);

  // 3. Try a balanced parse first (the happy path).
  const end = findMatchingClose(s, start);
  if (end > 0) {
    try {
      const v = JSON.parse(s.slice(start, end + 1));
      if (Array.isArray(v)) return v;
    } catch { /* may be truncated mid-string — fall through to salvage */ }
  }

  // 4. Salvage : keep every top-level object that closes cleanly inside the
  //    array, drop whatever comes after the last safe point.
  const lastSafe = findLastSafeObjectEnd(s, start);
  if (lastSafe > 0) {
    try {
      const v = JSON.parse(s.slice(start, lastSafe + 1) + "]");
      if (Array.isArray(v)) return v;
    } catch { /* give up */ }
  }

  // 5. Last resort : object wrapper that contained markdown fences or other
  //    noise that confused steps above.
  return extractArrayFromObject(s);
}

// Walk bracket pairs ignoring strings ; return the index of the ']' that
// closes the '[' at `start`, or -1 if unbalanced (truncation, malformed input).
function findMatchingClose(s: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (escape) { escape = false; continue; }
    if (c === "\\") { escape = true; continue; }
    if (c === "\"") { inString = !inString; continue; }
    if (inString) continue;
    if (c === "[") depth++;
    else if (c === "]") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// Truncation salvage : index of the last '}' that closed a TOP-LEVEL object
// inside the array (arrayDepth === 1, objDepth back to 0). Strings/escapes are
// properly tracked so braces inside string values don't confuse the count.
function findLastSafeObjectEnd(s: string, start: number): number {
  let arrDepth = 0;
  let objDepth = 0;
  let inString = false;
  let escape = false;
  let lastSafe = -1;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (escape) { escape = false; continue; }
    if (c === "\\") { escape = true; continue; }
    if (c === "\"") { inString = !inString; continue; }
    if (inString) continue;
    if (c === "[") arrDepth++;
    else if (c === "]") arrDepth--;
    else if (c === "{") objDepth++;
    else if (c === "}") {
      objDepth--;
      if (arrDepth === 1 && objDepth === 0) lastSafe = i;
    }
  }
  return lastSafe;
}

// When the LLM ignored the instruction to return a bare array and wrapped its
// payload in { "rules": [...] } or { "data": [...] }, dig out the first array
// value present.
function extractArrayFromObject(s: string): unknown[] {
  try {
    const obj = JSON.parse(s);
    if (obj && typeof obj === "object" && !Array.isArray(obj)) {
      for (const v of Object.values(obj)) {
        if (Array.isArray(v)) return v;
      }
    }
    if (Array.isArray(obj)) return obj;
  } catch { /* not JSON */ }
  return [];
}
