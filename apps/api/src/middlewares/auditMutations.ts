import type { Response, NextFunction } from "express";
import type { AuthRequest } from "./auth.js";
import { logAudit, sanitizeMetadataValue } from "../services/audit.js";

// Préfixe de l'action : "mairie_request" ou "citoyen_request". Sert au filtre
// rapide côté UI super admin. Le détail (route, méthode, params) est dans
// metadata.
type ActionLabel = string;

interface Options {
  // Préfixe lisible pour l'action enregistrée (ex. "mairie", "citoyen").
  actor: string;
  // Routes à ignorer (peuvent être bruyantes ou non significatives) — match
  // sur le path template (req.route?.path). Ex: "/conversations/:dossierId/read".
  ignorePaths?: Set<string>;
}

const MUTATING_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);

// Détermine la cible métier à partir des params : un dossier si :id ou
// :dossierId est présent. Permet au super admin de retrouver "toutes les
// actions sur le dossier X".
function extractTarget(params: Record<string, string>): { type: string | null; id: string | null } {
  const dossierId = params["dossierId"] ?? params["id"];
  if (dossierId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(dossierId)) {
    return { type: "dossier", id: dossierId };
  }
  return { type: null, id: null };
}

// Wrap `res.json` / `res.send` pour logger UNE FOIS, après que la réponse
// soit produite (succès comme erreur — on capture le status code). On
// log fire-and-forget pour ne pas ralentir la réponse.
export function auditMutations(opts: Options) {
  const ignorePaths = opts.ignorePaths ?? new Set<string>();
  return function (req: AuthRequest, res: Response, next: NextFunction) {
    if (!MUTATING_METHODS.has(req.method)) return next();

    let logged = false;
    const log = () => {
      if (logged) return;
      logged = true;
      // À ce stade, req.route est résolu (Express l'a posé après matching).
      const routePath = req.route?.path ?? req.path;
      const fullPath = `${req.baseUrl ?? ""}${routePath}`;
      if (ignorePaths.has(routePath) || ignorePaths.has(fullPath)) return;

      // Ne logguer que les succès et les erreurs métier (4xx). On exclut
      // les 5xx (déjà loggés ailleurs) et les redirects qui ne sont pas
      // des actions terminées.
      const status = res.statusCode;
      if (status >= 500) return;

      const target = extractTarget((req.params ?? {}) as Record<string, string>);
      const metadata: Record<string, unknown> = {
        method: req.method,
        route: fullPath,
        status,
      };
      const sanitizedParams = sanitizeMetadataValue(req.params) as Record<string, unknown> | undefined;
      if (sanitizedParams && Object.keys(sanitizedParams).length > 0) metadata["params"] = sanitizedParams;
      // Pour les uploads (multipart), req.body est vide — pas grave, le
      // nom de fichier est typiquement dans req.params/route.
      if (req.body && typeof req.body === "object" && Object.keys(req.body as object).length > 0) {
        metadata["body"] = sanitizeMetadataValue(req.body);
      }

      // Action stable : "<actor>_request". Le filtre fin côté UI se fait sur
      // metadata.route, ce qui évite d'exploser le set d'actions distinctes.
      const action: ActionLabel = `${opts.actor}_request`;
      void logAudit(req, action, {
        targetType: target.type,
        targetId: target.id,
        metadata,
      });
    };

    res.on("finish", log);
    res.on("close", log);
    next();
  };
}
