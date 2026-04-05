import { getDriveClient } from './client';

const drive = () => getDriveClient();

export async function getOrCreateFolder(parentId: string, name: string): Promise<string> {
  const res = await drive().files.list({
    q: `'${parentId}' in parents and name='${name}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id)',
    spaces: 'drive',
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
  });
}

export async function createResumableUpload(
  folderId: string,
  fileName: string,
  mimeType: string
): Promise<string> {
  const res = await drive().files.create(
    {
      requestBody: {
        name: fileName,
        parents: [folderId],
      },
      media: {
        mimeType,
        body: '',
      },
      fields: 'id',
    },
    {
      headers: {
        'X-Upload-Content-Type': mimeType,
      },
    }
  );

  return res.data.id!;
}

export async function uploadFile(
  folderId: string,
  fileName: string,
  mimeType: string,
  body: Buffer | ReadableStream
): Promise<{ id: string; name: string }> {
  const { Readable } = await import('stream');
  const readable = Buffer.isBuffer(body) ? Readable.from(body) : Readable.fromWeb(body as never);

  const res = await drive().files.create({
    requestBody: {
      name: fileName,
      parents: [folderId],
    },
    media: {
      mimeType,
      body: readable,
    },
    fields: 'id,name',
  });

  return { id: res.data.id!, name: res.data.name! };
}

export async function listFilesInFolder(folderId: string) {
  const res = await drive().files.list({
    q: `'${folderId}' in parents and trashed=false`,
    fields: 'files(id,name,mimeType,size,createdTime,webViewLink)',
    orderBy: 'createdTime desc',
  });

  return res.data.files ?? [];
}
