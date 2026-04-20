import { google } from 'googleapis';
import { getDriveClient } from './client';

const drive = () => getDriveClient();

/**
 * Create a resumable upload session under the service account.
 *
 * Returns a pre-authorized uploadUrl that the browser can PUT file bytes
 * to directly — bypassing the 4.5MB Vercel serverless body limit. The
 * resulting file is owned by the service account exactly as if we had
 * uploaded it server-side.
 *
 * The uploadUrl embeds a short-lived upload_id (valid ~1 week) and
 * requires no additional auth header on the browser-side PUT.
 */
export async function createResumableSession(
  folderId: string,
  fileName: string,
  mimeType: string,
  fileSize: number,
): Promise<{ uploadUrl: string }> {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '{}');
  const impersonateEmail = process.env.GOOGLE_IMPERSONATE_EMAIL?.trim();
  const enableImpersonation = process.env.GOOGLE_ENABLE_IMPERSONATION === 'true';
  const shouldImpersonate = enableImpersonation && Boolean(impersonateEmail);

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/drive'],
    ...(shouldImpersonate ? { clientOptions: { subject: impersonateEmail } } : {}),
  });
  const client = await auth.getClient();
  const accessTokenResponse = await client.getAccessToken();
  const accessToken =
    typeof accessTokenResponse === 'string'
      ? accessTokenResponse
      : accessTokenResponse.token;
  if (!accessToken) throw new Error('Failed to acquire service account access token');

  const res = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': mimeType,
        'X-Upload-Content-Length': String(fileSize),
      },
      body: JSON.stringify({
        name: fileName,
        parents: [folderId],
        mimeType,
      }),
    },
  );

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to create resumable session: HTTP ${res.status} ${text}`);
  }

  const uploadUrl = res.headers.get('Location') || res.headers.get('location');
  if (!uploadUrl) {
    throw new Error('Drive did not return a resumable upload URL');
  }

  return { uploadUrl };
}

/** Check if a folder ID exists and is accessible in Shared Drive */
export async function checkFolderExists(folderId: string): Promise<boolean> {
  try {
    const res = await drive().files.get({
      fileId: folderId,
      fields: 'id,trashed',
      supportsAllDrives: true,
    });
    return !res.data.trashed;
  } catch {
    return false;
  }
}

export async function assertFolderAccessible(folderId: string): Promise<void> {
  try {
    const res = await drive().files.get({
      fileId: folderId,
      fields: 'id,name,trashed',
      supportsAllDrives: true,
    });
    if (res.data.trashed) {
      throw new Error(`โฟลเดอร์ถูกย้ายไปถังขยะแล้ว (${folderId})`);
    }
  } catch (err) {
    const apiMessage =
      typeof err === 'object' &&
      err !== null &&
      'response' in err &&
      typeof (err as { response?: { data?: { error?: { message?: string } } } }).response?.data?.error?.message === 'string'
        ? (err as { response: { data: { error: { message: string } } } }).response.data.error.message
        : null;
    const fallbackMessage =
      err instanceof Error ? err.message : 'ไม่สามารถเข้าถึงโฟลเดอร์ได้';
    throw new Error(apiMessage || fallbackMessage);
  }
}

export async function getOrCreateFolder(parentId: string, name: string): Promise<string> {
  // Escape single quotes in folder name for Drive query
  const safeName = name.replace(/'/g, "\\'");
  const res = await drive().files.list({
    q: `'${parentId}' in parents and name='${safeName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id)',
    spaces: 'drive',
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  if (res.data.files && res.data.files.length > 0) {
    return res.data.files[0].id!;
  }

  const folder = await drive().files.create({
    requestBody: {
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId],
    },
    fields: 'id',
    supportsAllDrives: true,
  });

  return folder.data.id!;
}

export async function copyTemplate(
  templateId: string,
  name: string,
  folderId: string
): Promise<{ id: string; url: string }> {
  const copy = await drive().files.copy({
    fileId: templateId,
    requestBody: {
      name,
      parents: [folderId],
    },
    fields: 'id,webViewLink',
    supportsAllDrives: true,
  });

  return {
    id: copy.data.id!,
    url: copy.data.webViewLink!,
  };
}

export async function trashFile(fileId: string): Promise<void> {
  await drive().files.update({
    fileId,
    requestBody: { trashed: true },
    supportsAllDrives: true,
  });
}

export async function deleteFilePermanent(fileId: string): Promise<void> {
  await drive().files.delete({
    fileId,
    supportsAllDrives: true,
  });
}

export async function uploadFile(
  folderId: string,
  fileName: string,
  mimeType: string,
  body: Buffer | ReadableStream,
  options?: {
    appProperties?: Record<string, string>;
    description?: string;
  }
): Promise<{ id: string; name: string }> {
  const { Readable } = await import('stream');
  const readable = Buffer.isBuffer(body) ? Readable.from(body) : Readable.fromWeb(body as never);

  const res = await drive().files.create({
    requestBody: {
      name: fileName,
      parents: [folderId],
      appProperties: options?.appProperties,
      description: options?.description,
    },
    media: {
      mimeType,
      body: readable,
    },
    fields: 'id,name',
    supportsAllDrives: true,
  });

  return { id: res.data.id!, name: res.data.name! };
}

/**
 * Verify a file exists in Drive, lives inside the expected parent folder,
 * and return its canonical name/size/mimeType.
 *
 * Used after a client-direct resumable upload to confirm the file is where
 * we told Drive to put it before we commit metadata to our DB.
 */
export async function verifyUploadedFile(
  fileId: string,
  expectedParentId: string,
): Promise<{ id: string; name: string; mimeType: string; size: number; parents: string[] }> {
  const res = await drive().files.get({
    fileId,
    fields: 'id,name,mimeType,size,parents,trashed',
    supportsAllDrives: true,
  });
  if (res.data.trashed) throw new Error('Uploaded file is in trash');
  const parents = res.data.parents ?? [];
  if (!parents.includes(expectedParentId)) {
    throw new Error(
      `Uploaded file is not in the expected folder (expected ${expectedParentId}, got ${parents.join(',') || 'none'})`,
    );
  }
  return {
    id: res.data.id!,
    name: res.data.name ?? '',
    mimeType: res.data.mimeType ?? 'application/octet-stream',
    size: Number(res.data.size ?? 0),
    parents,
  };
}

export async function getFileMetadata(fileId: string): Promise<{
  id: string;
  name: string;
  appProperties: Record<string, string>;
  webViewLink: string | null;
}> {
  const res = await drive().files.get({
    fileId,
    fields: 'id,name,appProperties,webViewLink',
    supportsAllDrives: true,
  });

  return {
    id: res.data.id!,
    name: res.data.name ?? '',
    appProperties: (res.data.appProperties ?? {}) as Record<string, string>,
    webViewLink: res.data.webViewLink ?? null,
  };
}

export async function convertExcelToSpreadsheet(
  folderId: string,
  fileName: string,
  mimeType: string,
  body: Buffer | ReadableStream
): Promise<{ id: string; name: string; webViewLink: string | null }> {
  const { Readable } = await import('stream');
  const readable = Buffer.isBuffer(body) ? Readable.from(body) : Readable.fromWeb(body as never);
  const normalizedName = fileName.replace(/\.(xlsx|xls)$/i, '');

  const res = await drive().files.create({
    requestBody: {
      name: normalizedName,
      parents: [folderId],
      mimeType: 'application/vnd.google-apps.spreadsheet',
    },
    media: {
      mimeType,
      body: readable,
    },
    fields: 'id,name,webViewLink',
    supportsAllDrives: true,
  });

  return {
    id: res.data.id!,
    name: res.data.name ?? normalizedName,
    webViewLink: res.data.webViewLink ?? null,
  };
}

export async function listFilesInFolder(folderId: string) {
  const res = await drive().files.list({
    q: `'${folderId}' in parents and trashed=false`,
    fields: 'files(id,name,mimeType,size,createdTime,webViewLink)',
    orderBy: 'createdTime desc',
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  return res.data.files ?? [];
}
