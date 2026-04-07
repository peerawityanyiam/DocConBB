import { google } from 'googleapis';

let driveClient: ReturnType<typeof google.drive> | null = null;

export function getDriveClient() {
  if (driveClient) return driveClient;

  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '{}');

  // Support domain-wide delegation: impersonate a real user so uploads
  // count against their quota (Service Accounts have 0 storage quota).
  // Set GOOGLE_IMPERSONATE_EMAIL in .env to a real Workspace user email.
  const impersonateEmail = process.env.GOOGLE_IMPERSONATE_EMAIL;

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/drive'],
    ...(impersonateEmail ? { clientOptions: { subject: impersonateEmail } } : {}),
  });

  driveClient = google.drive({ version: 'v3', auth });
  return driveClient;
}
