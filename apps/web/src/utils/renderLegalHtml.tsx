import { createElement, Fragment, type ReactNode } from "react";
import DOMPurify from "dompurify";
import { ArticleLink } from "../components/ArticleLink";

// Codes supportés côté front (doit rester aligné avec resolveCode côté API).
const SUPPORTED = new Set(["CU", "CCH", "CE"]);

// Attributs HTML autorisés à passer du DOM sanitisé vers le rendu React.
// On laisse DOMPurify retirer le reste ; ici on whiteliste juste ce qu'on
// veut effectivement réutiliser pour ne pas casser le style.
const SAFE_ATTRS_BY_TAG: Record<string, string[]> = {
  a:    ["href"],
  span: ["class"],
  div:  ["class"],
  p:    ["class"],
};

// Scanner unifié : capture soit une référence d'article, soit une mention
// de code à laquelle "ce code" pourra se référer plus loin.
//
// Groupe 1 : lettre L/R/D (référence d'article)
// Groupe 2 : numéro type "525-1"
// Groupe 3 : nom de code en clair (mention de code)
const TOKEN_RE =
  /(?:(?:art(?:icles?)?\.?\s+)?([LRD])\.?\s*(\d+-\d+))|(code\s+(?:de\s+l['’]urbanisme|de\s+la\s+construction\s+et\s+de\s+l['’]habitation|de\s+l['’]environnement|rural(?:\s+et\s+de\s+la\s+p[êe]che\s+maritime)?|g[ée]n[ée]ral\s+des\s+collectivit[ée]s\s+territoriales|civil|p[ée]nal))/gi;

// Renvoie le codeKey supporté à partir d'un libellé "code de l'urbanisme" etc.
// Renvoie `null` pour les codes non supportés (rural, civil, etc.).
function codeKeyFromMention(mention: string): string | null {
  const m = mention.toLowerCase();
  if (m.includes("urbanisme")) return "CU";
  if (m.includes("construction")) return "CCH";
  if (m.includes("environnement")) return "CE";
  return null;
}

// Inspecte le texte qui suit immédiatement une référence d'article pour en
// déduire le code applicable. Met à jour `ctx.last` quand une mention
// explicite de code est trouvée.
function resolveCodeAfterRef(after: string, ctx: { last: string }): string | null {
  const lower = after.toLowerCase().slice(0, 200);
  const codeMatch = lower.match(
    /^\s*(?:du|de\s+la|du\s+pr[ée]sent|de\s+ce)\s+(code(?:\s+(?:de\s+l['’]urbanisme|de\s+la\s+construction\s+et\s+de\s+l['’]habitation|de\s+l['’]environnement|rural(?:\s+et\s+de\s+la\s+p[êe]che\s+maritime)?|civil|p[ée]nal|g[ée]n[ée]ral\s+des\s+collectivit[ée]s\s+territoriales))?)/,
  );
  if (codeMatch) {
    const expr = codeMatch[1] ?? "";
    // "ce code" / "présent code" : reprend le dernier code mentionné.
    if (expr === "code") return ctx.last;
    const key = codeKeyFromMention(expr);
    if (key) ctx.last = key;
    return key;
  }
  // Pas de mention de code juste après → on retombe sur le code en cours.
  return ctx.last;
}

// Linkifie un nœud texte en suivant un contexte partagé (le code « courant »
// utilisé pour résoudre les références sans code explicite et les "ce code").
function linkifyTextNode(
  text: string,
  ctx: { last: string },
  keyPrefix: string,
): ReactNode[] {
  if (!text) return [text];
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  let m: RegExpExecArray | null;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(text)) !== null) {
    const start = m.index;
    const end = start + m[0].length;

    // Cas 1 : mention de code seule → on met à jour le contexte, on laisse le texte tel quel.
    if (m[3]) {
      const key = codeKeyFromMention(m[3]);
      if (key) ctx.last = key;
      continue;
    }

    // Cas 2 : référence d'article.
    const letter = (m[1] ?? "").toUpperCase();
    const number = m[2] ?? "";
    const num = `${letter}${number}`;
    const code = resolveCodeAfterRef(text.slice(end), ctx);
    if (!code || !SUPPORTED.has(code)) {
      // Code non supporté (ex. rural, civil) → on laisse le texte brut.
      continue;
    }
    if (start > last) out.push(text.slice(last, start));
    out.push(
      <ArticleLink
        key={`${keyPrefix}-ref${i++}`}
        codeKey={code}
        num={num}
        label={m[0]}
      />,
    );
    last = end;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

// Convertit récursivement un nœud DOM (déjà sanitisé) en arbre React, en
// linkifiant les nœuds texte au passage.
function nodeToReact(
  node: Node,
  ctx: { last: string },
  keyPrefix: string,
): ReactNode {
  if (node.nodeType === Node.TEXT_NODE) {
    const parts = linkifyTextNode(node.textContent ?? "", ctx, keyPrefix);
    if (parts.length === 0) return null;
    if (parts.length === 1) return parts[0];
    return parts.map((p, i) => <Fragment key={`${keyPrefix}-t${i}`}>{p}</Fragment>);
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return null;

  const el = node as Element;
  const tag = el.tagName.toLowerCase();
  const props: Record<string, unknown> = { key: keyPrefix };
  const allowed = SAFE_ATTRS_BY_TAG[tag] ?? [];
  for (const attr of allowed) {
    const v = el.getAttribute(attr);
    if (v == null) continue;
    if (attr === "class") props.className = v;
    else props[attr] = v;
  }
  if (tag === "a") {
    props.target = "_blank";
    props.rel = "noopener noreferrer";
  }

  const children: ReactNode[] = [];
  el.childNodes.forEach((c, i) => {
    children.push(nodeToReact(c, ctx, `${keyPrefix}-c${i}`));
  });
  return createElement(tag, props, ...children);
}

// Rend un fragment HTML Légifrance avec linkification des références
// d'articles vers d'autres `ArticleLink` (modals imbriqués).
//
// `currentCodeKey` est le code de l'article actuellement consulté ; il sert
// de fallback quand une référence n'indique pas de code explicite, et de
// valeur initiale pour "ce code".
export function renderLegalHtml(html: string, currentCodeKey: string): ReactNode {
  const clean = DOMPurify.sanitize(html);
  const doc = new DOMParser().parseFromString(`<div>${clean}</div>`, "text/html");
  const root = doc.body.firstElementChild;
  if (!root) return null;

  const ctx = { last: currentCodeKey.toUpperCase() };
  const children: ReactNode[] = [];
  root.childNodes.forEach((c, i) => {
    children.push(nodeToReact(c, ctx, `root-${i}`));
  });
  return <>{children}</>;
}
