import { Seo } from "../../components/Seo";

export function PolitiqueConfidentialite() {
  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12">
      <Seo
        title="Politique de confidentialité"
        description="Politique de confidentialité Heurekia : traitement de vos données personnelles et respect du RGPD."
        path="/politique-confidentialite"
      />
      <h1 className="text-3xl font-bold text-[#000020] mb-2">Politique de confidentialité</h1>
      <p className="text-sm text-gray-400 mb-10">Dernière mise à jour : juin 2026</p>

      <section className="mb-8">
        <h2 className="text-lg font-semibold text-[#000020] mb-3">1. Responsable du traitement</h2>
        <p className="text-sm text-gray-600 leading-relaxed">
          Le responsable du traitement de vos données personnelles est <strong>la collectivité destinataire de votre
          dossier d'urbanisme</strong> (commune ou EPCI). HEUREKIA SAS intervient en qualité de sous-traitant au sens
          de l'article 28 du RGPD.
        </p>
        <p className="text-sm text-gray-600 mt-2">
          Contact technique HEUREKIA / DPD plateforme :{" "}
          <a href="mailto:dpd@heurekia.com" className="text-heureka-500 hover:underline">dpd@heurekia.com</a>
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold text-[#000020] mb-3">2. Données collectées</h2>
        <div className="text-sm text-gray-600 leading-relaxed space-y-2">
          <p><strong>Données de compte :</strong> nom, prénom, adresse e-mail, numéro de téléphone, commune,
            mot de passe (haché par bcrypt — jamais stocké en clair).</p>
          <p><strong>Données de dossier :</strong> adresse du projet, parcelle cadastrale, description des travaux,
            surface, documents joints (plans, CERFA, photos, notice), correspondances avec la mairie.</p>
          <p><strong>Données générées par l'analyse IA :</strong> score qualitatif et extraction structurée
            (dimensions, surfaces, hauteurs NGF…), empreinte SHA-256 de chaque fichier soumis à l'IA.</p>
          <p><strong>Données techniques :</strong> adresse IP, user-agent, horodatages de connexion
            (conservés 12 mois à des fins de traçabilité de sécurité — exigence CCSC Art. 4.14).</p>
        </div>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold text-[#000020] mb-3">3. Finalités et base légale</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-gray-600 border-collapse">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left py-2 pr-4 font-medium text-gray-700">Finalité</th>
                <th className="text-left py-2 font-medium text-gray-700">Base légale</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              <tr>
                <td className="py-2 pr-4">Gestion des demandes d'autorisation d'urbanisme</td>
                <td className="py-2">Mission d'intérêt public (art. 6-1-e RGPD)</td>
              </tr>
              <tr>
                <td className="py-2 pr-4">Analyse automatisée des pièces déposées (vérification de complétude et de conformité PLU indicative)</td>
                <td className="py-2">Mission d'intérêt public + consentement explicite révocable du pétitionnaire (art. 6-1-a et 6-1-e)</td>
              </tr>
              <tr>
                <td className="py-2 pr-4">Authentification et sécurité du compte</td>
                <td className="py-2">Exécution du contrat (art. 6-1-b)</td>
              </tr>
              <tr>
                <td className="py-2 pr-4">Traçabilité des connexions (logs de sécurité)</td>
                <td className="py-2">Obligation légale (art. 6-1-c)</td>
              </tr>
              <tr>
                <td className="py-2 pr-4">Notifications sur l'avancement des dossiers</td>
                <td className="py-2">Exécution du contrat (art. 6-1-b)</td>
              </tr>
              <tr>
                <td className="py-2 pr-4">Mémorisation de votre état civil pour pré-remplir vos prochaines demandes (facultatif)</td>
                <td className="py-2">Consentement explicite et révocable (art. 6-1-a)</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold text-[#000020] mb-3">4. Analyse automatisée par intelligence artificielle</h2>
        <p className="text-sm text-gray-600 leading-relaxed mb-3">
          Au moment du dépôt d'une pièce justificative, le contenu du fichier est transmis à un modèle d'IA opéré
          par <strong>Mistral AI SAS</strong> (entreprise française basée à Paris) afin d'évaluer sa lisibilité,
          sa complétude et de détecter d'éventuelles non-conformités PLU manifestes.
        </p>
        <ul className="text-sm text-gray-600 space-y-2 list-disc list-inside mb-3">
          <li><strong>Sous-traitant :</strong> Mistral AI SAS (Paris, France), lié par un Data Processing
            Agreement (DPA) au titre de l'article 28 du RGPD. <strong>Aucun transfert hors UE</strong> :
            l'inférence est réalisée en France métropolitaine.</li>
          <li><strong>Aucun réentraînement :</strong> Mistral ne ré-entraîne pas ses modèles sur les données
            transmises par API (compte entreprise), conformément aux conditions contractuelles.</li>
          <li><strong>Données transmises au modèle :</strong> contenu du fichier + zone PLU + nature des
            travaux + commune. <strong>Aucune donnée d'identification directe</strong> (nom, prénom, e-mail,
            adresse postale, numéro de parcelle complet) n'est transmise au modèle — le nom de fichier
            d'origine est remplacé par la rubrique métier et le numéro de parcelle est tronqué.</li>
          <li><strong>Traçabilité :</strong> chaque appel est journalisé avec l'empreinte SHA-256 du fichier,
            le modèle utilisé et le coût, sans dupliquer le contenu du fichier.</li>
          <li><strong>Décision finale humaine (art. 22 RGPD) :</strong> aucune décision juridique n'est rendue
            par l'IA ; un instructeur humain examine chaque dossier et chaque pièce.</li>
          <li><strong>Droit d'opposition :</strong> vous pouvez refuser l'analyse IA à tout moment lors du
            dépôt via la case dédiée — vos pièces sont alors transmises sans aucun appel au modèle.</li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold text-[#000020] mb-3">5. Sous-traitants</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-gray-600 border-collapse">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left py-2 pr-4 font-medium text-gray-700">Sous-traitant</th>
                <th className="text-left py-2 pr-4 font-medium text-gray-700">Rôle</th>
                <th className="text-left py-2 font-medium text-gray-700">Localisation des données</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              <tr>
                <td className="py-2 pr-4">OVH SAS (France)</td>
                <td className="py-2 pr-4">Hébergement applicatif, base de données et sauvegardes</td>
                <td className="py-2">France — datacenters OVH (VPS + Object Storage)</td>
              </tr>
              <tr>
                <td className="py-2 pr-4">Mistral AI SAS (France)</td>
                <td className="py-2 pr-4">Analyse automatisée des pièces (modèle Pixtral Large)</td>
                <td className="py-2">France — Paris</td>
              </tr>
              <tr>
                <td className="py-2 pr-4">Resend (USA)</td>
                <td className="py-2 pr-4">Envoi d'e-mails transactionnels (activation, notifications)</td>
                <td className="py-2">UE / USA</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold text-[#000020] mb-3">6. Durée de conservation</h2>
        <div className="text-sm text-gray-600 leading-relaxed space-y-2">
          <p><strong>Données de compte :</strong> durée de vie du compte + 3 ans après la dernière connexion.</p>
          <p><strong>Dossiers d'urbanisme :</strong> 10 ans à compter de la décision (obligations légales en matière d'urbanisme).</p>
          <p><strong>Logs de connexion (audit_logs) :</strong> 12 mois (purge automatique).</p>
          <p><strong>Journal des appels IA (ai_usage_events) :</strong> conservé pour la durée du dossier, à des fins d'auditabilité.</p>
          <p><strong>Profil CERFA mémorisé (facultatif) :</strong> conservé tant que vous le souhaitez, chiffré et lié à votre seul compte. Supprimé dès le retrait de votre consentement (bouton « Oublier ces informations » dans « Mon profil ») et à la suppression de votre compte.</p>
          <p><strong>Inputs côté Mistral AI :</strong> politique de rétention contractuelle (compte entreprise, no-training), à formaliser au DPA Mistral.</p>
        </div>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold text-[#000020] mb-3">7. Vos droits</h2>
        <p className="text-sm text-gray-600 mb-3 leading-relaxed">
          Conformément aux articles 15 à 22 du RGPD, vous disposez des droits suivants sur vos données :
        </p>
        <ul className="text-sm text-gray-600 space-y-1 list-disc list-inside">
          <li><strong>Droit d'accès</strong> — consulter et télécharger l'intégralité de vos données
            (espace « Mon profil » → « Télécharger mes données » — export JSON enrichi avec journal IA).</li>
          <li><strong>Droit de rectification</strong> — corriger vos informations (espace « Mon profil »).</li>
          <li><strong>Droit à l'effacement</strong> — supprimer définitivement votre compte, vos dossiers et
            l'ensemble des fichiers déposés (espace « Mon profil » → « Supprimer mon compte »).</li>
          <li><strong>Droit à la portabilité</strong> — récupérer vos données dans un format structuré
            (export JSON).</li>
          <li><strong>Droit d'opposition au traitement automatisé</strong> — refuser l'analyse IA des pièces
            au moment du dépôt (case à cocher dédiée).</li>
          <li><strong>Droit à la limitation</strong> — demander la suspension d'un traitement.</li>
          <li><strong>Droit à une intervention humaine</strong> (art. 22) — vous pouvez à tout moment demander
            à un instructeur humain de réexaminer un avis indicatif rendu par l'IA.</li>
        </ul>
        <p className="text-sm text-gray-600 mt-3">
          Pour exercer ces droits, contactez en priorité le DPD de la commune destinataire de votre dossier,
          ou à défaut <a href="mailto:dpd@heurekia.com" className="text-heureka-500 hover:underline">dpd@heurekia.com</a>.
          En cas de réclamation non résolue, vous pouvez saisir la <strong>CNIL</strong> (
          <a href="https://www.cnil.fr" target="_blank" rel="noopener noreferrer" className="text-heureka-500 hover:underline">www.cnil.fr</a>).
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold text-[#000020] mb-3">8. Sécurité</h2>
        <p className="text-sm text-gray-600 leading-relaxed">
          Vos données sont protégées par chiffrement HTTPS (TLS) en transit, hachage bcrypt des mots de passe,
          cookies de session sécurisés (HttpOnly, Secure, SameSite=Strict), en-têtes HTTP de sécurité
          (CSP stricte, HSTS, X-Frame-Options, X-Content-Type-Options) et requêtes SQL paramétrées (Drizzle ORM).
          Tous les accès sont journalisés. Le détail des mesures techniques figure dans la documentation de
          conformité accessible aux administrateurs de la plateforme.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-[#000020] mb-3">9. Transferts hors Union Européenne</h2>
        <p className="text-sm text-gray-600 leading-relaxed">
          <strong>Aucun transfert de vos données hors de l'Union Européenne n'est effectué dans le cadre de
          l'analyse IA.</strong> L'inférence est réalisée par Mistral AI SAS sur des datacenters situés en
          France métropolitaine. Les articles 44 et suivants du RGPD ne sont donc pas engagés pour ce traitement.
        </p>
        <p className="text-sm text-gray-600 mt-2">
          L'hébergement applicatif et la base de données sont assurés depuis juin 2026 par OVH SAS, sur des
          datacenters situés en France métropolitaine — aucune donnée ne quitte le territoire français pour
          l'opération de la plateforme.
        </p>
      </section>
    </div>
  );
}
