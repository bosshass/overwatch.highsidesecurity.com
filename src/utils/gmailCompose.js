// ============================================
// Jovelin — Gmail compose deep-link
// ============================================
// Opens a real Gmail compose window pre-filled with to/subject/body —
// lands in the user's own already-logged-in Gmail tab with their real
// signature and identity, for them to review and send themselves.
// Deliberately NOT automated sending: no API, no SMTP, no third-party
// service. Used everywhere Jovelin needs a human to send an email:
// AR Chase, Send to Customer, and now invites/password resets too.
export function gmailComposeUrl({ to, subject, body }) {
  const params = new URLSearchParams({ view: 'cm', fs: '1', to: to || '', su: subject || '', body: body || '' });
  return `https://mail.google.com/mail/u/0/?${params.toString()}`;
}

export function openGmailCompose(args) {
  window.open(gmailComposeUrl(args), '_blank');
}
