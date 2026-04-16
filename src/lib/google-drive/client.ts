import { google } from 'googleapis';

let driveClient: ReturnType<typeof google.drive> | null = null;

export function getDriveClient() {
  if (driveClient) return driveClient;

  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '{}');
  const impersonateEmail = process.env.GOOGLE_IMPERSONATE_EMAIL?.trim();
  const enableImpersonation = process.env.GOOGLE_ENABLE_IMPERSONATION === 'true';
  const shouldImpersonate = enableImpersonation && Boolean(impersonateEmail);

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/drive'],
    ...(shouldImpersonate ? { clientOptions: { subject: impersonateEmail } } : {}),
  });

  driveClient = google.drive({ version: 'v3', auth });
  return driveClient;
}

export async function getDriveAccessToken(): Promise<string> {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '{}');
  const impersonateEmail = process.env.GOOGLE_IMPERSONATE_EMAIL?.trim();
  const enableImpersonation = process.env.GOOGLE_ENABLE_IMPERSONATION === 'true';
  const shouldImpersonate = enableImpersonation && Boolean(impersonateEmail);

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/drive'],
    ...(shouldImpersonate ? { clientOptions: { subject: impersonateEmail } } : {}),
  });

  const result = await auth.getAccessToken();
  const token = typeof result === 'string' ? result : (result as { token?: string | null } | null)?.token;
  if (!token) throw new Error('Unable to obtain Google Drive access token');
  return token;
}
