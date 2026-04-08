import { google } from 'googleapis';

let sheetsClient: ReturnType<typeof google.sheets> | null = null;

export function getSheetsClient() {
  if (sheetsClient) return sheetsClient;

  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '{}');
  const impersonateEmail = process.env.GOOGLE_IMPERSONATE_EMAIL;

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive',
    ],
    ...(impersonateEmail ? { clientOptions: { subject: impersonateEmail } } : {}),
  });

  sheetsClient = google.sheets({ version: 'v4', auth });
  return sheetsClient;
}

