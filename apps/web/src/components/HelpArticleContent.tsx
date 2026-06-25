import { sanitizeHelpHtml } from "../utils/renderHelpHtml";

// Rend le HTML d'un article du Centre d'aide après assainissement. Utilisé à la
// fois pour l'aperçu côté super-admin et pour la lecture côté agent mairie, afin
// que la mise en page soit strictement identique des deux côtés.
export function HelpArticleContent({ html }: { html: string }) {
  return (
    <div
      className="help-article-content"
      dangerouslySetInnerHTML={{ __html: sanitizeHelpHtml(html || "") }}
    />
  );
}
