// Clés de cache react-query partagées (durcissement § 3.4).
//
// Centralisées ici pour que n'importe quel composant puisse invalider/relire la
// même donnée sans dupliquer la clé (ex. après une action qui crée une
// notification : `queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_QUERY_KEY })`).
// `as const` fige le tuple pour le typage des clés react-query.
export const NOTIFICATIONS_QUERY_KEY = ["notifications"] as const;
