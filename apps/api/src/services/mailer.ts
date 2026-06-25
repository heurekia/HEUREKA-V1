import { Resend } from "resend";

// Lazy init — avoids crash at startup when RESEND_API_KEY is not set (dev/test)
let _resend: Resend | null = null;
function getResend(): Resend {
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY ?? "");
  return _resend;
}

const FROM = process.env.SMTP_FROM ?? "Heurekia <notifications@mail.heurekia.com>";
const BASE_URL = process.env.FRONTEND_URL ?? "https://app.heurekia.com";
// Portail citoyen (www) — distinct du portail pro (app). Les emails destinés à
// un pétitionnaire doivent renvoyer ici pour que l'activation pose le bon
// cookie de session (token_www) et atterrisse dans l'espace citoyen.
const CITIZEN_BASE_URL = process.env.CITIZEN_URL ?? "https://www.heurekia.com";

// Échappe les valeurs interpolées dans le HTML des emails (anti-injection de
// balises via prénom / nom de service / commune / n° de dossier).
function esc(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );
}

// Garde-fou : `to` doit être UNE adresse simple. Rejette listes / CRLF /
// virgules qui permettraient d'ajouter des destinataires non voulus.
function assertEmail(to: string): void {
  if (typeof to !== "string" || !/^[^\s,;<>"]+@[^\s,;<>"]+\.[^\s,;<>"]+$/.test(to)) {
    throw new Error(`Adresse email invalide pour l'envoi : ${JSON.stringify(to)}`);
  }
}

function formatCommuneList(names: string[]): { html: string; text: string } {
  if (names.length === 0) return { html: "", text: "" };
  if (names.length === 1) return {
    html: `de <strong>${esc(names[0]!)}</strong>`,
    text: `de ${names[0]}`,
  };
  const rest = names.slice(0, -1);
  const last = names[names.length - 1]!;
  return {
    html: `de <strong>${rest.map(esc).join("</strong>, <strong>")}</strong> et <strong>${esc(last)}</strong>`,
    text: `de ${rest.join(", ")} et ${last}`,
  };
}

export async function sendActivationEmail(opts: {
  to: string;
  prenom: string;
  serviceName: string;
  token: string;
  roleLabel?: string;
  communeNames?: string[];
}) {
  assertEmail(opts.to);
  const link = `${BASE_URL}/activer-compte?token=${opts.token}`;

  let identity: string;
  let identityText: string;
  if (opts.roleLabel) {
    identity = `<strong>${esc(opts.roleLabel)}</strong> pour le compte de <strong>${esc(opts.serviceName)}</strong>`;
    identityText = `${opts.roleLabel} pour le compte de ${opts.serviceName}`;
  } else if (opts.communeNames && opts.communeNames.length > 0) {
    const { html, text } = formatCommuneList(opts.communeNames);
    identity = `agent du service urbanisme ${html}`;
    identityText = `agent du service urbanisme ${text}`;
  } else {
    identity = `agent du service urbanisme de <strong>${esc(opts.serviceName)}</strong>`;
    identityText = `agent du service urbanisme de ${opts.serviceName}`;
  }

  await getResend().emails.send({
    from: FROM,
    to: opts.to,
    subject: "Activez votre accès Heurekia",
    html: `
<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F0F0F0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F0F0F0;padding:40px 0">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:white;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08)">
        <tr>
          <td style="background:#000020;padding:24px 32px">
            <table cellpadding="0" cellspacing="0">
              <tr>
                <td style="width:32px;height:32px;background:#4F46E5;border-radius:8px;text-align:center;vertical-align:middle">
                  <span style="color:white;font-weight:800;font-size:14px">H</span>
                </td>
                <td style="padding-left:12px;color:white;font-size:18px;font-weight:700">HEUREKIA</td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:40px 32px 32px">
            <h1 style="margin:0 0 20px;font-size:22px;font-weight:800;color:#0F172A">Activez votre accès Heurekia</h1>
            <p style="margin:0 0 20px;font-size:15px;color:#374151">Bonjour ${esc(opts.prenom)},</p>
            <p style="margin:0 0 28px;font-size:15px;color:#374151;line-height:1.7">
              Un accès sécurisé à la plateforme Heurekia vient d'être créé pour vous en tant qu'${identity}.<br><br>
              Afin de finaliser l'activation de votre compte et définir votre mot de passe personnel, cliquez sur le bouton ci-dessous.
            </p>
            <table cellpadding="0" cellspacing="0" style="margin:0 0 32px">
              <tr>
                <td style="background:#4F46E5;border-radius:8px;padding:14px 32px">
                  <a href="${link}" style="color:white;text-decoration:none;font-size:15px;font-weight:600">Activer mon accès →</a>
                </td>
              </tr>
            </table>
            <p style="margin:0 0 8px;font-size:13px;color:#94a3b8">Ce lien d'activation est personnel, valable <strong>7 jours</strong> et utilisable une seule fois.</p>
            <p style="margin:0;font-size:13px;color:#94a3b8">Si vous n'êtes pas à l'origine de cette invitation, vous pouvez ignorer cet email.</p>
          </td>
        </tr>
        <tr>
          <td style="padding:20px 32px;border-top:1px solid #F1F5F9;background:#FAFAFA">
            <p style="margin:0 0 4px;font-size:12px;color:#94a3b8">Heurekia — Plateforme intelligente de gestion des autorisations d'urbanisme</p>
            <p style="margin:0;font-size:12px;color:#94a3b8">© Heurekia — Tous droits réservés</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
    text: `Bonjour ${opts.prenom},\n\nUn accès sécurisé à la plateforme Heurekia vient d'être créé pour vous en tant qu'${identityText}.\n\nAfin de finaliser l'activation de votre compte et définir votre mot de passe personnel, cliquez sur ce lien :\n${link}\n\nCe lien d'activation est personnel, valable 7 jours et utilisable une seule fois.\n\nSi vous n'êtes pas à l'origine de cette invitation, vous pouvez ignorer cet email.\n\nHeurekia — Plateforme intelligente de gestion des autorisations d'urbanisme`,
  });
}

// Invitation envoyée à un pétitionnaire dont le dossier a été enregistré au
// comptoir (saisie manuelle ou import OCR) sans qu'il dispose d'un compte
// activé. Le lien d'activation pointe vers le portail citoyen (www) et réutilise
// le flux /activate, qui pose le mot de passe ET vérifie l'email. L'espace est
// optionnel : le dossier est instruit normalement même sans activation.
export async function sendPetitionnaireInvitationEmail(opts: {
  to: string;
  prenom: string;
  numeroDossier: string;
  communeName?: string;
  token: string;
}) {
  assertEmail(opts.to);
  const link = `${CITIZEN_BASE_URL}/activer-compte?token=${opts.token}`;
  const communeHtml = opts.communeName
    ? `par le service urbanisme de <strong>${esc(opts.communeName)}</strong>`
    : "par votre service urbanisme";
  const communeText = opts.communeName
    ? `par le service urbanisme de ${opts.communeName}`
    : "par votre service urbanisme";

  await getResend().emails.send({
    from: FROM,
    to: opts.to,
    subject: "Suivez votre dossier d'urbanisme en ligne — Heurekia",
    html: `
<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F0F0F0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F0F0F0;padding:40px 0">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:white;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08)">
        <tr>
          <td style="background:#000020;padding:24px 32px">
            <table cellpadding="0" cellspacing="0">
              <tr>
                <td style="width:32px;height:32px;background:#4F46E5;border-radius:8px;text-align:center;vertical-align:middle">
                  <span style="color:white;font-weight:800;font-size:14px">H</span>
                </td>
                <td style="padding-left:12px;color:white;font-size:18px;font-weight:700">HEUREKIA</td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:40px 32px 32px">
            <h1 style="margin:0 0 20px;font-size:22px;font-weight:800;color:#0F172A">Suivez votre dossier en ligne</h1>
            <p style="margin:0 0 20px;font-size:15px;color:#374151">Bonjour ${esc(opts.prenom)},</p>
            <p style="margin:0 0 28px;font-size:15px;color:#374151;line-height:1.7">
              Votre dossier d'urbanisme <strong>${esc(opts.numeroDossier)}</strong> a été enregistré ${communeHtml}.<br><br>
              Activez votre espace personnel pour suivre son avancement, échanger avec le service instructeur et consulter les décisions. Il vous suffit de définir votre mot de passe.
            </p>
            <table cellpadding="0" cellspacing="0" style="margin:0 0 32px">
              <tr>
                <td style="background:#4F46E5;border-radius:8px;padding:14px 32px">
                  <a href="${link}" style="color:white;text-decoration:none;font-size:15px;font-weight:600">Activer mon espace →</a>
                </td>
              </tr>
            </table>
            <p style="margin:0 0 8px;font-size:13px;color:#94a3b8">Ce lien est personnel, valable <strong>7 jours</strong> et utilisable une seule fois.</p>
            <p style="margin:0;font-size:13px;color:#94a3b8">Créer cet espace est facultatif : votre dossier est instruit normalement par le service même si vous n'activez pas votre compte.</p>
          </td>
        </tr>
        <tr>
          <td style="padding:20px 32px;border-top:1px solid #F1F5F9;background:#FAFAFA">
            <p style="margin:0 0 4px;font-size:12px;color:#94a3b8">Heurekia — Plateforme intelligente de gestion des autorisations d'urbanisme</p>
            <p style="margin:0;font-size:12px;color:#94a3b8">© Heurekia — Tous droits réservés</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
    text: `Bonjour ${opts.prenom},\n\nVotre dossier d'urbanisme ${opts.numeroDossier} a été enregistré ${communeText}.\n\nActivez votre espace personnel pour suivre son avancement, échanger avec le service instructeur et consulter les décisions. Définissez votre mot de passe via ce lien :\n${link}\n\nCe lien est personnel, valable 7 jours et utilisable une seule fois.\n\nCréer cet espace est facultatif : votre dossier est instruit normalement même sans activation.\n\nHeurekia — Plateforme intelligente de gestion des autorisations d'urbanisme`,
  });
}

export async function sendVerificationEmail(opts: {
  to: string;
  prenom: string;
  token: string;
  // Portail d'origine de l'inscription (www pour les citoyens). Fourni par la
  // route à partir de l'Origin de la requête pour que le lien renvoie vers le
  // bon sous-domaine ; à défaut on retombe sur BASE_URL.
  baseUrl?: string;
}) {
  assertEmail(opts.to);
  const base = opts.baseUrl ?? BASE_URL;
  const link = `${base}/verifier-email?token=${opts.token}`;
  await getResend().emails.send({
    from: FROM,
    to: opts.to,
    subject: "Confirmez votre adresse email — Heurekia",
    html: `
<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F0F0F0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F0F0F0;padding:40px 0">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:white;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08)">
        <tr>
          <td style="background:#000020;padding:24px 32px">
            <table cellpadding="0" cellspacing="0">
              <tr>
                <td style="width:32px;height:32px;background:#4F46E5;border-radius:8px;text-align:center;vertical-align:middle">
                  <span style="color:white;font-weight:800;font-size:14px">H</span>
                </td>
                <td style="padding-left:12px;color:white;font-size:18px;font-weight:700">HEUREKIA</td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:40px 32px 32px">
            <h1 style="margin:0 0 20px;font-size:22px;font-weight:800;color:#0F172A">Confirmez votre adresse email</h1>
            <p style="margin:0 0 20px;font-size:15px;color:#374151">Bonjour ${esc(opts.prenom)},</p>
            <p style="margin:0 0 28px;font-size:15px;color:#374151;line-height:1.7">
              Merci d'avoir créé votre compte Heurekia. Pour finaliser votre inscription et
              accéder à votre espace, confirmez votre adresse email en cliquant sur le bouton ci-dessous.
            </p>
            <table cellpadding="0" cellspacing="0" style="margin:0 0 32px">
              <tr>
                <td style="background:#4F46E5;border-radius:8px;padding:14px 32px">
                  <a href="${link}" style="color:white;text-decoration:none;font-size:15px;font-weight:600">Confirmer mon adresse →</a>
                </td>
              </tr>
            </table>
            <p style="margin:0 0 8px;font-size:13px;color:#94a3b8">Ce lien est personnel, valable <strong>24 heures</strong> et utilisable une seule fois.</p>
            <p style="margin:0;font-size:13px;color:#94a3b8">Si vous n'êtes pas à l'origine de cette inscription, vous pouvez ignorer cet email.</p>
          </td>
        </tr>
        <tr>
          <td style="padding:20px 32px;border-top:1px solid #F1F5F9;background:#FAFAFA">
            <p style="margin:0 0 4px;font-size:12px;color:#94a3b8">Heurekia — Plateforme intelligente de gestion des autorisations d'urbanisme</p>
            <p style="margin:0;font-size:12px;color:#94a3b8">© Heurekia — Tous droits réservés</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
    text: `Bonjour ${opts.prenom},\n\nMerci d'avoir créé votre compte Heurekia. Pour finaliser votre inscription, confirmez votre adresse email en cliquant sur ce lien :\n${link}\n\nCe lien est personnel, valable 24 heures et utilisable une seule fois.\n\nSi vous n'êtes pas à l'origine de cette inscription, vous pouvez ignorer cet email.\n\nHeurekia — Plateforme intelligente de gestion des autorisations d'urbanisme`,
  });
}

export async function sendPasswordResetEmail(opts: {
  to: string;
  prenom: string;
  token: string;
}) {
  assertEmail(opts.to);
  const link = `${BASE_URL}/activer-compte?token=${opts.token}&mode=reset`;
  await getResend().emails.send({
    from: FROM,
    to: opts.to,
    subject: "Réinitialisation de votre mot de passe Heurekia",
    html: `
<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#F0F0F0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F0F0F0;padding:40px 0">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:white;border-radius:12px;overflow:hidden">
        <tr><td style="background:#000020;padding:24px 32px">
          <table cellpadding="0" cellspacing="0">
            <tr>
              <td style="width:32px;height:32px;background:#4F46E5;border-radius:8px;text-align:center;vertical-align:middle">
                <span style="color:white;font-weight:800;font-size:14px">H</span>
              </td>
              <td style="padding-left:12px;color:white;font-size:18px;font-weight:700">HEUREKIA</td>
            </tr>
          </table>
        </td></tr>
        <tr><td style="padding:40px 32px 32px">
          <h1 style="margin:0 0 24px;font-size:22px;color:#0F172A">Réinitialisez votre mot de passe</h1>
          <p style="margin:0 0 24px;font-size:15px;color:#374151;line-height:1.6">Bonjour ${esc(opts.prenom)},<br><br>Une demande de réinitialisation de mot de passe a été effectuée pour votre compte.</p>
          <table cellpadding="0" cellspacing="0" style="margin:0 0 32px">
            <tr><td style="background:#4F46E5;border-radius:8px;padding:14px 28px">
              <a href="${link}" style="color:white;text-decoration:none;font-size:15px;font-weight:600">Définir un nouveau mot de passe →</a>
            </td></tr>
          </table>
          <p style="margin:0;font-size:13px;color:#94a3b8">Ce lien est valable 1 heure. Si vous n'avez pas fait cette demande, ignorez cet email.</p>
        </td></tr>
        <tr><td style="padding:20px 32px;border-top:1px solid #F1F5F9;background:#FAFAFA">
          <p style="margin:0;font-size:12px;color:#94a3b8">Heurekia — Plateforme de gestion des autorisations d'urbanisme</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
    text: `Bonjour ${opts.prenom},\n\nRéinitialisez votre mot de passe : ${link}\n\nCe lien est valable 1 heure.\n\nHeurekia`,
  });
}
