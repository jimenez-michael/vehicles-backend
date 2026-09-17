const { Client } = require('@microsoft/microsoft-graph-client');

// App registration EHS_AZURE_* propia (distinta a la de vehicles), con el permiso de
// aplicacion Calendars.ReadWrite consentido solo sobre el buzon EHS_GRAPH_ORGANIZER_MAILBOX.
let cachedToken = null;
let tokenExpiry = 0;

function graphInviteEnabled() {
  return Boolean(
    process.env.EHS_AZURE_TENANT_ID &&
      process.env.EHS_AZURE_CLIENT_ID &&
      process.env.EHS_AZURE_CLIENT_SECRET &&
      process.env.EHS_GRAPH_ORGANIZER_MAILBOX,
  );
}

async function getEhsAppToken() {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;

  const tenantId = process.env.EHS_AZURE_TENANT_ID;
  const clientId = process.env.EHS_AZURE_CLIENT_ID;
  const clientSecret = process.env.EHS_AZURE_CLIENT_SECRET;
  const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;

  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  });
  const res = await fetch(tokenUrl, { method: 'POST', body: params });
  if (!res.ok) {
    const errBody = await res.text();
    console.error('[getEhsAppToken] Token request failed:', res.status, errBody);
    throw new Error('Failed to acquire EHS app token');
  }
  const data = await res.json();
  cachedToken = data.access_token;
  tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
  return cachedToken;
}

function createEhsGraphClient() {
  return Client.init({
    authProvider: async (done) => {
      try {
        done(null, await getEhsAppToken());
      } catch (err) {
        done(err, null);
      }
    },
  });
}

// Crea el evento en el calendario del buzon organizador con el empleado como
// asistente. Exchange envia la invitacion de reunion automaticamente, lo cual
// tambien sirve como la notificacion por correo de la reservacion.
async function sendTrainingInvite(training, user) {
  if (!graphInviteEnabled()) return;

  const organizerMailbox = process.env.EHS_GRAPH_ORGANIZER_MAILBOX;
  const toIsoNoZ = (date) => new Date(date).toISOString().slice(0, 19);
  const descriptionHtml = training.description ? `<p>${training.description}</p>` : '';

  const event = {
    subject: `Adiestramiento EHS: ${training.title}`,
    body: {
      contentType: 'HTML',
      content: `<p>Tu cupo para <strong>${training.title}</strong> ha sido confirmado.</p>${descriptionHtml}<p>Lugar: ${training.location || 'Por confirmar'}</p>`,
    },
    start: { dateTime: toIsoNoZ(training.startAt), timeZone: 'UTC' },
    end: { dateTime: toIsoNoZ(training.endAt || training.startAt), timeZone: 'UTC' },
    location: { displayName: training.location || '' },
    attendees: [
      {
        emailAddress: { address: user.email, name: user.name },
        type: 'required',
      },
    ],
  };

  try {
    const client = createEhsGraphClient();
    await client.api(`/users/${organizerMailbox}/events`).post(event);
    console.log(`[sendTrainingInvite] Invitacion enviada a ${user.email} para "${training.title}"`);
  } catch (err) {
    console.error('[sendTrainingInvite] Failed to send:', err.message || err);
  }
}

module.exports = { sendTrainingInvite, graphInviteEnabled };
