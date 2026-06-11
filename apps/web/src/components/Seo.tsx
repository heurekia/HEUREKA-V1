import { Helmet } from "react-helmet-async";
import { SEO_DEFAULTS, type SeoPageConfig } from "../lib/seo.config";

type SeoProps = SeoPageConfig & {
  jsonLd?: Record<string, unknown> | Array<Record<string, unknown>>;
};

export function Seo({ title, description, path, image, noindex, jsonLd }: SeoProps) {
  const fullTitle = title
    ? SEO_DEFAULTS.titleTemplate.replace("%s", title)
    : SEO_DEFAULTS.defaultTitle;
  const desc = description ?? SEO_DEFAULTS.defaultDescription;
  const canonical = path ? `${SEO_DEFAULTS.baseUrl}${path}` : SEO_DEFAULTS.baseUrl;
  const ogImage = image ?? SEO_DEFAULTS.defaultImage;
  const jsonLdArray = jsonLd ? (Array.isArray(jsonLd) ? jsonLd : [jsonLd]) : [];

  return (
    <Helmet>
      <html lang="fr" />
      <title>{fullTitle}</title>
      <meta name="description" content={desc} />
      <link rel="canonical" href={canonical} />
      {noindex && <meta name="robots" content="noindex, nofollow" />}

      <meta property="og:type" content="website" />
      <meta property="og:site_name" content={SEO_DEFAULTS.siteName} />
      <meta property="og:locale" content={SEO_DEFAULTS.locale} />
      <meta property="og:title" content={fullTitle} />
      <meta property="og:description" content={desc} />
      <meta property="og:url" content={canonical} />
      <meta property="og:image" content={ogImage} />

      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:site" content={SEO_DEFAULTS.twitterHandle} />
      <meta name="twitter:title" content={fullTitle} />
      <meta name="twitter:description" content={desc} />
      <meta name="twitter:image" content={ogImage} />

      {jsonLdArray.map((data, i) => (
        <script key={i} type="application/ld+json">
          {JSON.stringify(data)}
        </script>
      ))}
    </Helmet>
  );
}

export const ORGANIZATION_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: SEO_DEFAULTS.siteName,
  url: SEO_DEFAULTS.baseUrl,
  logo: `${SEO_DEFAULTS.baseUrl}/favicon.svg`,
};

export const WEBSITE_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: SEO_DEFAULTS.siteName,
  url: SEO_DEFAULTS.baseUrl,
  inLanguage: "fr-FR",
};
