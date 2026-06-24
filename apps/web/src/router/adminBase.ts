// Sous-domaine dédié au portail super-admin.
export const ADMIN_HOST = "admin.heurekia.com";

// Base path du SPA super-admin.
// - Sur le sous-domaine dédié (admin.heurekia.com), le portail est servi à la
//   RACINE : admin.heurekia.com/communes, /utilisateurs…
// - Partout ailleurs (localhost en dev), il reste préfixé par /admin pour
//   cohabiter avec les portails www/app sur une seule origine.
export const ADMIN_BASE =
  typeof window !== "undefined" && window.location.hostname === ADMIN_HOST ? "" : "/admin";

// Construit un chemin interne au portail admin en tenant compte de la base.
// adminPath()            → "/"            (sous-domaine) | "/admin"            (local)
// adminPath("/communes") → "/communes"   (sous-domaine) | "/admin/communes"  (local)
export const adminPath = (sub = ""): string => `${ADMIN_BASE}${sub}` || "/";
