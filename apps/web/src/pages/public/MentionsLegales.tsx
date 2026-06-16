import { Seo } from "../../components/Seo";

export function MentionsLegales() {
  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12">
      <Seo
        title="Mentions légales"
        description="Mentions légales de Heurekia : éditeur, hébergeur et informations légales du service."
        path="/mentions-legales"
      />
      <h1 className="text-3xl font-bold text-[#000020] mb-2">Mentions légales</h1>
      <p className="text-sm text-gray-400 mb-10">Dernière mise à jour : juin 2026</p>

      <section className="mb-8">
        <h2 className="text-lg font-semibold text-[#000020] mb-3">Éditeur</h2>
        <p className="text-sm text-gray-600 leading-relaxed">
          HEUREKIA est une solution logicielle éditée par <strong>HEUREKIA SAS</strong>, société par actions simplifiée au capital de [X] €,
          immatriculée au Registre du Commerce et des Sociétés de Tours sous le numéro SIRET [SIRET],
          dont le siège social est situé [adresse].
        </p>
        <p className="text-sm text-gray-600 mt-2">
          Directeur de la publication : [Nom du directeur]<br />
          Contact : <a href="mailto:contact@heurekia-urba.fr" className="text-heureka-500 hover:underline">contact@heurekia-urba.fr</a>
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold text-[#000020] mb-3">Responsable de traitement</h2>
        <p className="text-sm text-gray-600 leading-relaxed">
          Lorsque vous déposez un dossier d'urbanisme via la plateforme, le responsable de traitement est
          <strong> la collectivité destinataire du dossier</strong> (commune ou EPCI), agissant dans le cadre
          de sa mission de service public d'instruction des autorisations d'urbanisme.
        </p>
        <p className="text-sm text-gray-600 mt-2">
          HEUREKIA SAS agit en qualité de <strong>sous-traitant</strong> au sens de l'article 28 du RGPD,
          dans le cadre d'un contrat de prestation de services conclu avec chaque collectivité.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold text-[#000020] mb-3">Hébergement</h2>
        <p className="text-sm text-gray-600 leading-relaxed">
          La plateforme est hébergée par <strong>Railway Corporation</strong>, 548 Market St PMB 59449,
          San Francisco, CA 94104, États-Unis. Les bases de données et fichiers déposés par les usagers
          sont stockés sur des serveurs situés <strong>dans l'Union Européenne (région eu-west-1, Irlande)</strong>.
          Voir la politique de confidentialité pour le détail des sous-traitants techniques.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold text-[#000020] mb-3">Recours à l'intelligence artificielle</h2>
        <p className="text-sm text-gray-600 leading-relaxed">
          Pour aider les pétitionnaires à déposer un dossier complet du premier coup, la plateforme soumet chaque
          pièce déposée à une <strong>analyse automatique opérée par Mistral AI SAS</strong> (entreprise française
          basée à Paris), au moyen de son modèle Pixtral Large, dans le cadre d'un contrat de sous-traitance RGPD
          (Data Processing Agreement, article 28). <strong>L'inférence est réalisée en France</strong> — aucun
          transfert hors UE. L'usager peut s'opposer à cette analyse à tout moment lors du dépôt.
          <strong> La décision sur le dossier est toujours prise par un instructeur humain.</strong> Le détail
          figure dans la politique de confidentialité.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold text-[#000020] mb-3">Propriété intellectuelle</h2>
        <p className="text-sm text-gray-600 leading-relaxed">
          L'ensemble du contenu de cette plateforme (textes, graphismes, logos, icônes, images, structure, code source)
          est la propriété exclusive de HEUREKIA SAS ou de ses partenaires. Toute reproduction, distribution ou
          utilisation sans autorisation préalable est interdite. Les données publiques utilisées (cadastre, GPU, BAN)
          restent soumises à leurs licences respectives.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold text-[#000020] mb-3">Données personnelles et RGPD</h2>
        <p className="text-sm text-gray-600 leading-relaxed">
          Le traitement de vos données personnelles est effectué conformément au Règlement Général sur la Protection
          des Données (RGPD — UE 2016/679) et à la loi Informatique et Libertés du 6 janvier 1978 modifiée.
        </p>
        <p className="text-sm text-gray-600 mt-2">
          Délégué à la Protection des Données (DPD) :{" "}
          <a href="mailto:dpd@heurekia-urba.fr" className="text-heureka-500 hover:underline">dpd@heurekia-urba.fr</a>
          {" "}— pour les questions liées à un dossier en cours, contactez en priorité le DPD de la commune destinataire.
        </p>
        <p className="text-sm text-gray-600 mt-2">
          Voir la <a href="/politique-confidentialite" className="text-heureka-500 hover:underline">Politique de confidentialité</a>
          {" "}pour le détail des traitements, des sous-traitants, des durées de conservation et de l'exercice de vos droits.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold text-[#000020] mb-3">Cookies</h2>
        <p className="text-sm text-gray-600 leading-relaxed">
          Cette plateforme utilise uniquement des cookies <strong>strictement nécessaires</strong> au fonctionnement
          du service (cookie de session d'authentification, signé et stocké en HttpOnly / Secure / SameSite=Strict).
          Aucun cookie analytique, publicitaire ou de mesure tierce n'est déposé. Aucun bandeau de consentement
          cookie n'est requis au titre de l'article 82 de la loi Informatique et Libertés.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold text-[#000020] mb-3">Signalement de vulnérabilité</h2>
        <p className="text-sm text-gray-600 leading-relaxed">
          Si vous découvrez une vulnérabilité de sécurité, merci de la signaler de manière responsable à{" "}
          <a href="mailto:securite@heurekia-urba.fr" className="text-heureka-500 hover:underline">securite@heurekia-urba.fr</a>{" "}
          avant toute divulgation publique. Un fichier{" "}
          <a href="/.well-known/security.txt" className="text-heureka-500 hover:underline">security.txt</a>{" "}
          est mis à disposition à cet effet. Nous nous engageons à traiter votre signalement dans les meilleurs délais.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold text-[#000020] mb-3">Accessibilité</h2>
        <p className="text-sm text-gray-600 leading-relaxed">
          HEUREKIA est conçu pour respecter les exigences du Référentiel Général d'Amélioration de l'Accessibilité
          (RGAA) niveau AA. Une déclaration d'accessibilité formelle est en cours de production. Pour signaler une
          difficulté d'accès, contactez <a href="mailto:contact@heurekia-urba.fr" className="text-heureka-500 hover:underline">contact@heurekia-urba.fr</a>.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-[#000020] mb-3">Litiges</h2>
        <p className="text-sm text-gray-600 leading-relaxed">
          En cas de litige, la juridiction compétente est le Tribunal de Commerce de Tours.
          La loi applicable est la loi française. Vous disposez par ailleurs du droit de saisir la CNIL
          (<a href="https://www.cnil.fr" target="_blank" rel="noopener noreferrer" className="text-heureka-500 hover:underline">www.cnil.fr</a>)
          pour toute réclamation relative à vos données personnelles.
        </p>
      </section>
    </div>
  );
}
