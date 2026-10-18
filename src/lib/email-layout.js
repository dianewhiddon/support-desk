/* HTML shell for client notification emails. Tables and inline styles,
   because that is what every mail client renders the same way. Each template
   returns html and text; plain-text clients, screen readers and spam filters
   read the text version. Change the colors here to match your brand. */

const INK = '#111111';
const INK_SOFT = '#3A3A3A';
const MUTED = '#6B6B6B';
const LINE = '#E2E2E4';
const ACCENT = '#AD8326';
const PAPER = '#F3F3F4';
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";

export const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

export function renderNotificationEmail({
  businessName,
  firstName,
  heading,
  body,
  actionLabel,
  actionUrl,
  files = [],
}) {
  const fileList = files.length
    ? `<p style="margin:0 0 8px;font-family:${FONT};font-size:15px;font-weight:600;color:${INK};">Files</p>
       <ul style="margin:0 0 22px;padding-left:20px;">${files
         .map(
           (file) =>
             `<li style="margin-bottom:8px;font-family:${FONT};font-size:15px;"><a href="${escapeHtml(file.url)}" style="color:${INK};">Download ${escapeHtml(file.name)}</a></li>`,
         )
         .join('')}</ul>`
    : '';
  const html = `<!doctype html>
<html><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="color-scheme" content="light only" />
</head>
<body style="margin:0;padding:0;background:${PAPER};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${PAPER};">
  <tr><td align="center" style="padding:32px 16px;">
    <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px;background:#FFFFFF;border:1px solid ${LINE};">
      <tr><td style="padding:28px 28px 8px;">
        <div style="margin:0 0 18px;font-family:${FONT};font-size:15px;font-weight:600;color:${INK};">${escapeHtml(businessName)}</div>
        <p style="margin:0 0 14px;font-family:${FONT};font-size:15px;line-height:1.65;color:${INK_SOFT};">Hi ${escapeHtml(firstName)},</p>
        <h1 style="margin:0 0 14px;font-family:${FONT};font-size:22px;line-height:1.3;color:${INK};">${escapeHtml(heading)}</h1>
        <p style="margin:0 0 22px;font-family:${FONT};font-size:15px;line-height:1.65;color:${INK_SOFT};">${escapeHtml(body)}</p>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 22px;border-collapse:collapse;">
          <tr><td bgcolor="${ACCENT}" style="background:${ACCENT};border-radius:3px;">
            <a href="${escapeHtml(actionUrl)}" style="display:inline-block;padding:13px 20px;font-family:${FONT};font-size:14px;font-weight:700;color:${INK};text-decoration:none;">${escapeHtml(actionLabel)}</a>
          </td></tr>
        </table>
        ${fileList}
        <p style="margin:0 0 20px;font-family:${FONT};font-size:13px;line-height:1.55;color:${MUTED};">Replies to this email are not monitored. Reply on the desk so your message stays with the request.</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;

  const text = [
    `Hi ${firstName},`,
    '',
    heading,
    '',
    body,
    '',
    `${actionLabel}: ${actionUrl}`,
    ...files.map((file) => `Download ${file.name}: ${file.url}`),
    '',
    'Replies to this email are not monitored. Reply on the desk so your message stays with the request.',
  ].join('\n');

  return { html, text };
}
