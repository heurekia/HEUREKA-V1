export function MentionsLegales() {
  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12">
      <h1 className="text-3xl font-bold text-[#000020] mb-2">Mentions légales</h1>
      <p className="text-sm text-gray-400 mb-10">Dernière mise à jour : mai 2026</p>

      <section className="mb-8">
        <h2 className="text-lg font-semibold text-[#000020] mb-3">Éditeur</h2>
        <p className="text-sm text-gray-600 leading-relaxed">
          HEUREKA est une solution logicielle éditée par <strong>HEUREKA SAS</strong>, société par actions simplifiée au capital de [X] €,
          immatriculée au Registre du Commerce et des Sociétés de Tours sous le numéro SIRET [SIRET],
          dont le siège social est situé [adresse].
        </p>
        <p className="text-sm text-gray-600 mt-2">
          Directeur de la publication : [Nom du directeur]<br />
          Contact : <a href="mailto:contact@heureka-urba.fr" className="text-heureka-500 hover:underline">contact@heureka-urba.fr</a>
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold text-[#000020] mb-3">Hébergement</h2>
        <p className="text-sm text-gray-600 leading-relaxed">
          La plateforme est hébergée par <strong>Railway Corporation</strong>, 548 Market St PMB 59449, San Francisco, California 94104, États-Unis.
          Les données sont stockées sur des serveurs situés dans l'Union Européenne (région eu-west-1, Irlande).
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold text-[#000020] mb-3">Propriété intellectuelle</h2>
        <p className="text-sm text-gray-600 leading-relaxed">
          L'ensemble du contenu de cette plateforme (textes, graphismes, logos, icônes, images, données) est la propriété exclusive de HEUREKA SAS
          ou de ses partenaires. Toute reproduction, distribution ou utilisation sans autorisation préalable est interdite.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold text-[#000020] mb-3">Données personnelles et RGPD</h2>
        <p className="text-sm text-gray-600 leading-relaxed">
          Le traitement de vos données personnelles est effectué conformément au Règlement Général sur la Protection des Données (RGPD — UE 2016/679)
          et à la loi Informatique et Libertés du 6 janvier 1978 modifiée.
        </p>
        <p className="text-sm text-gray-600 mt-2">
          Responsable de traitement : [Nom de la collectivité ou de HEUREKA SAS selon le contexte]<br />
          Délégué à la Protection des Données (DPD) :{" "}
          <a href="mailto:dpd@heureka-urba.fr" className="text-heureka-500 hover:underline">dpd@heureka-urba.fr</a>
        </p>
        <p className="text-sm text-gray-600 mt-2">
          Pour plus d'informations sur le traitement de vos données, consultez notre{" "}
          <a href="/politique-confidentialite" className="text-heureka-500 hover:underline">Politique de confidentialité</a>.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold text-[#000020] mb-3">Cookies</h2>
        <p className="text-sm text-gray-600 leading-relaxed">
          Cette plateforme utilise uniquement des cookies strictement nécessaires au fonctionnement du service (cookie de session d'authentification).
          Aucun cookie analytique ou publicitaire n'est utilisé.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold text-[#000020] mb-3">Signalement de vulnérabilité</h2>
        <p className="text-sm text-gray-600 leading-relaxed">
          Si vous découvrez une vulnérabilité de sécurité, merci de la signaler de manière responsable à{" "}
          <a href="mailto:securite@heureka-urba.fr" className="text-heureka-500 hover:underline">securite@heureka-urba.fr</a>{" "}
          avant toute divulgation publique. Nous nous engageons à traiter votre signalement dans les meilleurs délais.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-[#000020] mb-3">Litiges</h2>
        <p className="text-sm text-gray-600 leading-relaxed">
          En cas de litige, la juridiction compétente est le Tribunal de Commerce de Tours.
          La loi applicable est la loi française.
        </p>
      </section>
    </div>
  );
}
