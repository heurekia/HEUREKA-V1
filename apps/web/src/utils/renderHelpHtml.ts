import DOMPurify from "dompurify";

// Hôtes d'iframe autorisés pour les vidéos embarquées dans les articles du
// Centre d'aide. DOIT rester aligné avec la directive CSP `frameSrc` posée
// dans apps/api/src/app.ts — sinon le navigateur bloquera le chargement.
export const ALLOWED_EMBED_HOSTS = [
  "www.youtube.com",
  "www.youtube-nocookie.com",
  "player.vimeo.com",
];

// Convertit une URL « grand public » YouTube/Vimeo en URL d'embed autorisée.
// Renvoie null si l'URL n'est pas reconnue (l'appelant refuse alors l'insertion).
export function toEmbedUrl(raw: string): string | null {
  const url = raw.trim();
  if (!url) return null;
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^m\./, "");

    // YouTube — formats : watch?v=, youtu.be/<id>, /embed/<id>, /shorts/<id>.
    if (host === "youtu.be") {
      const id = u.pathname.slice(1).split("/")[0];
      if (id) return `https://www.youtube.com/embed/${id}`;
    }
    if (host === "youtube.com" || host === "www.youtube.com" || host === "youtube-nocookie.com" || host === "www.youtube-nocookie.com") {
      if (u.pathname === "/watch") {
        const id = u.searchParams.get("v");
        if (id) return `https://www.youtube.com/embed/${id}`;
      }
      const m = u.pathname.match(/^\/(?:embed|shorts)\/([^/?#]+)/);
      if (m) return `https://www.youtube.com/embed/${m[1]}`;
    }

    // Vimeo — formats : vimeo.com/<id>, player.vimeo.com/video/<id>.
    if (host === "vimeo.com" || host === "www.vimeo.com") {
      const id = u.pathname.split("/").filter(Boolean)[0];
      if (id && /^\d+$/.test(id)) return `https://player.vimeo.com/video/${id}`;
    }
    if (host === "player.vimeo.com") {
      const m = u.pathname.match(/^\/video\/(\d+)/);
      if (m) return `https://player.vimeo.com/video/${m[1]}`;
    }
  } catch {
    return null;
  }
  return null;
}

// Durcit les attributs des nœuds sensibles APRÈS l'assainissement DOMPurify :
//   • iframe : on supprime ceux dont l'hôte n'est pas dans l'allow-list, et on
//     fige les attributs de sécurité sur ceux qui restent ;
//   • a : ouverture en nouvel onglet sans fuite de referrer ni d'opener.
function hardenNode(node: Element) {
  if (node.nodeName === "IFRAME") {
    const src = node.getAttribute("src") ?? "";
    const ok = ALLOWED_EMBED_HOSTS.some((h) => src.startsWith(`https://${h}/`));
    if (!ok) {
      node.remove();
      return;
    }
    node.setAttribute("allowfullscreen", "");
    node.setAttribute("loading", "lazy");
    node.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
    node.setAttribute("allow", "accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture");
  }
  if (node.nodeName === "A") {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer nofollow");
  }
}

// Assainit le HTML d'un article du Centre d'aide pour rendu (dangerouslySet…).
// Autorise les balises de mise en page riche + img (data URL / https) + iframe
// vidéo restreinte. Les hooks sont ajoutés/retirés autour de l'appel pour ne
// PAS polluer les autres usages de DOMPurify dans l'app (sanitize est
// synchrone, donc cette portée est sûre).
export function sanitizeHelpHtml(html: string): string {
  DOMPurify.addHook("afterSanitizeAttributes", hardenNode);
  try {
    return DOMPurify.sanitize(html, {
      ADD_TAGS: ["iframe"],
      ADD_ATTR: ["allow", "allowfullscreen", "frameborder", "scrolling", "loading", "referrerpolicy", "target"],
    });
  } finally {
    DOMPurify.removeHook("afterSanitizeAttributes");
  }
}
