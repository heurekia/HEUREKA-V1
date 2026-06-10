import { Fragment, type ReactNode } from "react";
import { ArticleLink } from "../components/ArticleLink";

// Détecte des références type :
//   "art. R431-2 CU", "R421-17 a) CU", "R421-13 al.2 CU", "L410-1 CU"
// L'optionnel "art." est conservé dans le label affiché si présent dans la source.
const ARTICLE_RE = /(art\.?\s+)?([LRD]?\d+-\d+)(\s+[a-z]\))?(\s+al\.\d+)?\s+(CU|CCH|CE)\b/gi;

// Codes supportés côté front (doit rester aligné avec resolveCode côté API).
const SUPPORTED = new Set(["CU", "CCH", "CE"]);

export function linkifyArticles(text: string): ReactNode {
  if (!text) return text;
  const nodes: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  ARTICLE_RE.lastIndex = 0;
  let i = 0;
  while ((m = ARTICLE_RE.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const prefix  = m[1] ?? "";
    const num     = (m[2] ?? "").toUpperCase();
    const suffix1 = m[3] ?? "";
    const suffix2 = m[4] ?? "";
    const codeKey = (m[5] ?? "").toUpperCase();
    const label   = `${prefix}${num}${suffix1}${suffix2} ${codeKey}`;
    if (num && codeKey && SUPPORTED.has(codeKey)) {
      nodes.push(<ArticleLink codeKey={codeKey} num={num} label={label} />);
    } else {
      nodes.push(label);
    }
    last = m.index + m[0].length;
    i++;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return (
    <>
      {nodes.map((n, idx) => (
        <Fragment key={idx}>{n}</Fragment>
      ))}
    </>
  );
}
