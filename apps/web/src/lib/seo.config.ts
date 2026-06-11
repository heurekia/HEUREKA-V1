export const SEO_DEFAULTS = {
  siteName: "Heurekia",
  baseUrl: "https://www.heurekia.com",
  defaultTitle: "Heurekia — L'urbanisme simplifié",
  titleTemplate: "%s | Heurekia",
  defaultDescription:
    "Heurekia simplifie l'urbanisme pour les citoyens et les communes : analyse parcellaire, règles du PLU, dépôt et suivi des demandes d'autorisation en ligne.",
  defaultImage: "https://www.heurekia.com/og-default.png",
  locale: "fr_FR",
  twitterHandle: "@heurekia",
} as const;

export type SeoPageConfig = {
  title?: string;
  description?: string;
  path?: string;
  image?: string;
  noindex?: boolean;
};
