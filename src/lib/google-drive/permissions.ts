import { getDriveClient } from './client';

const drive = () => getDriveClient();

export async function setFilePublic(fileId: string): Promise<void> {
  await drive().permissions.create({
    fileId,
    requestBody: {
      role: 'reader',
      type: 'anyone',
    },
  });
}

export async function setFilePrivate(fileId: string): Promise<void> {
  const res = await drive().permissions.list({
    fileId,
    fields: 'permissions(id,type)',
  });

  const anyonePerms = (res.data.permissions ?? []).filter(p => p.type === 'anyone');
  for (const perm of anyonePerms) {
    await drive().permissions.delete({
      fileId,
      permissionId: perm.id!,
    });
  }
}

export async function grantAccess(
  fileId: string,
  email: string,
  role: 'reader' | 'writer' = 'writer'
): Promise<void> {
  await drive().permissions.create({
    fileId,
    requestBody: {
      role,
      type: 'user',
      emailAddress: email,
    },
    sendNotificationEmail: false,
  });
}
