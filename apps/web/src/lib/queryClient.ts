import { QueryClient } from "@tanstack/react-query";

// Client react-query partagé (durcissement § 3.4 — cache de données).
//
// Défauts CONSERVATEURS, choisis pour NE PAS modifier le comportement perçu de
// l'app au moment de l'introduction (adoption incrémentale, écran par écran) :
//
// - `staleTime` 30 s : une donnée relue dans les 30 s ressort du cache sans
//   refetch — supprime le flicker et la requête redondante quand on revient sur
//   un écran déjà visité. Au-delà, refetch en arrière-plan (l'ancienne donnée
//   reste affichée le temps du refetch).
// - `refetchOnWindowFocus` DÉSACTIVÉ par défaut : un refetch global au retour
//   d'onglet déclencherait des rafales de requêtes surprenantes. Les rares vues
//   qui le VEULENT (cloche de notifications) l'activent explicitement, requête
//   par requête.
// - `retry` 1 : une seule reprise. Le client `api` a déjà ses propres timeouts
//   et la plupart de nos erreurs (401/403/422) ne sont pas des transitoires à
//   réessayer.
// - `gcTime` 5 min : durée de rétention d'une donnée devenue inutilisée avant
//   éviction du cache.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});
