import { Fragment, type ReactNode } from "react";
import { ArticleLink } from "../components/ArticleLink";

// Détecte des références type :
//   "art. R431-2 CU", "R421-17 a) CU", "R421-13 al.2 CU", "L410-1 CU",
//   "R.423-24 b)" (variante avec point, code implicite = CU).
// Le suffixe code est optionnel : en l'absence, on retombe sur le Code de l'urbanisme,
// le contexte applicatif étant l'urbanisme.
const ARTICLE_RE = /(art\.?\s+)?([LRD])\.?(\d+-\d+)(\s+[a-z]\))?(\s+al\.\d+)?(?:\s+(CU|CCH|CE))?\b/gi;

// Codes supportés côté front (doit rester aligné avec resolveCode côté API).
const SUPPORTED = new Set(["CU", "CCH", "CE"]);

export function linkifyArticles(text: string): ReactNode {
  if (!text) return text;
  const nodes: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  ARTICLE_RE.lastIndex = 0;
  while ((m = ARTICLE_RE.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const letter  = (m[2] ?? "").toUpperCase();
    const digits  = m[3] ?? "";
    const num     = `${letter}${digits}`;
    const codeKey = (m[6] ?? "CU").toUpperCase();
    // On préserve le texte d'origine (avec ou sans point, avec ou sans suffixe code) pour le label.
    const label   = m[0];
    if (num && SUPPORTED.has(codeKey)) {
      nodes.push(<ArticleLink codeKey={codeKey} num={num} label={label} />);
    } else {
      nodes.push(label);
    }
    last = m.index + m[0].length;
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
