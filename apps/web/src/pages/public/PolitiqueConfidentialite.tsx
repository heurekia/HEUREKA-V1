export function PolitiqueConfidentialite() {
  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12">
      <h1 className="text-3xl font-bold text-[#000020] mb-2">Politique de confidentialité</h1>
      <p className="text-sm text-gray-400 mb-10">Dernière mise à jour : mai 2026</p>

      <section className="mb-8">
        <h2 className="text-lg font-semibold text-[#000020] mb-3">1. Responsable du traitement</h2>
        <p className="text-sm text-gray-600 leading-relaxed">
          HEUREKIA SAS, [adresse], est responsable du traitement de vos données personnelles collectées via la plateforme HEUREKIA.
        </p>
        <p className="text-sm text-gray-600 mt-2">
          Délégué à la Protection des Données (DPD) :{" "}
          <a href="mailto:dpd@heurekia-urba.fr" className="text-heureka-500 hover:underline">dpd@heurekia-urba.fr</a>
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold text-[#000020] mb-3">2. Données collectées</h2>
        <div className="text-sm text-gray-600 leading-relaxed space-y-2">
          <p><strong>Données de compte :</strong> nom, prénom, adresse e-mail, numéro de téléphone, commune.</p>
          <p><strong>Données de dossier :</strong> adresse du projet, description des travaux, surface, documents joints, correspondances avec la mairie.</p>
          <p><strong>Données techniques :</strong> adresse IP, user-agent, horodatages de connexion (conservés 12 mois à des fins de traçabilité de sécurité).</p>
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
            </tbody>
          </table>
        </div>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold text-[#000020] mb-3">4. Durée de conservation</h2>
        <div className="text-sm text-gray-600 leading-relaxed space-y-2">
          <p><strong>Données de compte :</strong> durée de vie du compte + 3 ans après la dernière connexion.</p>
          <p><strong>Dossiers :</strong> 10 ans à compter de la décision (obligations légales en matière d'urbanisme).</p>
          <p><strong>Logs de connexion :</strong> 12 mois.</p>
        </div>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold text-[#000020] mb-3">5. Vos droits</h2>
        <p className="text-sm text-gray-600 mb-3 leading-relaxed">
          Conformément au RGPD, vous disposez des droits suivants sur vos données :
        </p>
        <ul className="text-sm text-gray-600 space-y-1 list-disc list-inside">
          <li><strong>Droit d'accès</strong> — consulter vos données (section "Mon profil")</li>
          <li><strong>Droit de rectification</strong> — corriger vos informations (section "Mon profil")</li>
          <li><strong>Droit à l'effacement</strong> — supprimer votre compte (section "Mon profil" → "Supprimer mon compte")</li>
          <li><strong>Droit à la portabilité</strong> — exporter vos données en JSON (section "Mon profil" → "Télécharger mes données")</li>
          <li><strong>Droit d'opposition</strong> — s'opposer à un traitement</li>
          <li><strong>Droit à la limitation</strong> — demander la suspension d'un traitement</li>
        </ul>
        <p className="text-sm text-gray-600 mt-3">
          Pour exercer ces droits ou pour toute question, contactez le DPD :{" "}
          <a href="mailto:dpd@heurekia-urba.fr" className="text-heureka-500 hover:underline">dpd@heurekia-urba.fr</a>.
          En cas de réclamation non résolue, vous pouvez saisir la <strong>CNIL</strong> ({" "}
          <a href="https://www.cnil.fr" target="_blank" rel="noopener noreferrer" className="text-heureka-500 hover:underline">www.cnil.fr</a>).
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold text-[#000020] mb-3">6. Sécurité</h2>
        <p className="text-sm text-gray-600 leading-relaxed">
          Vos données sont protégées par chiffrement HTTPS (TLS), stockage des mots de passe par hachage bcrypt,
          cookies de session sécurisés (HttpOnly, Secure, SameSite=Strict) et des en-têtes HTTP de sécurité (CSP, HSTS).
          Les accès sont journalisés et contrôlés.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-[#000020] mb-3">7. Transferts hors UE</h2>
        <p className="text-sm text-gray-600 leading-relaxed">
          Vos données sont hébergées au sein de l'Union Européenne. Aucun transfert vers des pays tiers n'est effectué
          sans garanties appropriées conformément au RGPD.
        </p>
      </section>
    </div>
  );
}
