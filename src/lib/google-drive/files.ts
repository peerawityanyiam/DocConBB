import { getDriveClient } from './client';

const drive = () => getDriveClient();

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
