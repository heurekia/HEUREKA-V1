import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

const FROM = process.env.SMTP_FROM ?? "Heurekia <notifications@heurekia.com>";
const BASE_URL = process.env.FRONTEND_URL ?? "https://heurekia.com";

export async function sendActivationEmail(opts: {
  to: string;
  prenom: string;
  serviceName: string;
  token: string;
}) {
  const link = `${BASE_URL}/activer-compte?token=${opts.token}`;
  await resend.emails.send({
    from: FROM,
    to: opts.to,
    subject: "Activez votre compte Heurekia",
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
            <h1 style="margin:0 0 8px;font-size:22px;font-weight:800;color:#0F172A">Activez votre compte</h1>
            <p style="margin:0 0 24px;font-size:15px;color:#64748b">Bonjour ${opts.prenom},</p>
            <p style="margin:0 0 24px;font-size:15px;color:#374151;line-height:1.6">
              Un accès à la plateforme Heurekia a été créé pour vous en tant qu'agent du service <strong>${opts.serviceName}</strong>.
              Cliquez sur le bouton ci-dessous pour activer votre compte et définir votre mot de passe.
            </p>
            <table cellpadding="0" cellspacing="0" style="margin:0 0 32px">
              <tr>
                <td style="background:#4F46E5;border-radius:8px;padding:14px 28px">
                  <a href="${link}" style="color:white;text-decoration:none;font-size:15px;font-weight:600">Activer mon compte →</a>
                </td>
              </tr>
            </table>
            <p style="margin:0 0 8px;font-size:13px;color:#94a3b8">Ce lien est valable <strong>7 jours</strong> et ne peut être utilisé qu'une seule fois.</p>
            <p style="margin:0;font-size:13px;color:#94a3b8">Si vous n'attendiez pas cet email, ignorez-le.</p>
          </td>
        </tr>
        <tr>
          <td style="padding:20px 32px;border-top:1px solid #F1F5F9;background:#FAFAFA">
            <p style="margin:0;font-size:12px;color:#94a3b8">
              Heurekia — Plateforme de gestion des autorisations d'urbanisme<br>
              <a href="${BASE_URL}/politique-confidentialite" style="color:#94a3b8">Politique de confidentialité</a>
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
    text: `Bonjour ${opts.prenom},\n\nUn accès Heurekia a été créé pour vous (${opts.serviceName}).\n\nActivez votre compte : ${link}\n\nCe lien est valable 7 jours.\n\nHeurekia`,
  });
}

export async function sendPasswordResetEmail(opts: {
  to: string;
  prenom: string;
  token: string;
}) {
  const link = `${BASE_URL}/activer-compte?token=${opts.token}&mode=reset`;
  await resend.emails.send({
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
          <p style="margin:0 0 24px;font-size:15px;color:#374151;line-height:1.6">Bonjour ${opts.prenom},<br><br>Une demande de réinitialisation de mot de passe a été effectuée pour votre compte.</p>
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
