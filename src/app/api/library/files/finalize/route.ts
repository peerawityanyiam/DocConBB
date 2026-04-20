import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { getAuthUser, handleAuthError, requireRole } from '@/lib/auth/guards';
import {
  deleteFilePermanent,
  trashFile,
  verifyUploadedFile,
} from '@/lib/google-drive/files';
import { setFilePublic } from '@/lib/google-drive/permissions';
import { getRequestIdFromHeaders, logEvent } from '@/lib/ops/observability';
import { MAX_RESUMABLE_UPLOAD_FILE_SIZE_BYTES } from '@/lib/files/upload-limits';

const LIBRARY_UPLOAD_FOLDER_ID = '10Ithv7g75Sd0he6IuVP6Nwk0IIVCFw1i';

function errorResponse(
  status: number,
  error: string,
  message: string,
  requestId: string,
) {
  return NextResponse.json({ error, message, requestId }, { status });
}

// POST /api/library/files/finalize
// Body: { standardId, driveFileId }
// Verifies the uploaded file landed in the library folder, sets public,
// trashes the previous file bound to this standard, and updates the row.
export async function POST(request: NextRequest) {
  const requestId = getRequestIdFromHeaders(request.headers);
  try {
    const user = await getAuthUser('library');
    if (!user) return errorResponse(401, 'unauthorized', 'Please sign in first.', requestId);
    requireRole(user, ['DOCCON', 'SUPER_ADMIN']);

    const body = (await request.json()) as {
      standardId?: string;
      driveFileId?: string;
    };

    const standardId = typeof body.standardId === 'string' ? body.standardId.trim() : '';
    const driveFileId = typeof body.driveFileId === 'string' ? body.driveFileId.trim() : '';
    if (!standardId) return errorResponse(400, 'missing_standard', 'Missing standardId.', requestId);
    if (!driveFileId) return errorResponse(400, 'missing_drive_file_id', 'driveFileId is required.', requestId);

    const admin = await createServiceRoleClient();
    const { data: standard, error: stdError } = await admin
      .from('standards')
      .select('id, name, drive_file_id, is_link')
      .eq('id', standardId)
      .single();
    if (stdError) throw stdError;
    if (!standard) return errorResponse(404, 'standard_not_found', 'ไม่พบเอกสารในระบบ', requestId);
    if (standard.is_link) {
      return errorResponse(400, 'standard_is_link', 'เอกสารนี้เป็นลิงก์ภายนอก', requestId);
    }

    let meta;
    try {
      meta = await verifyUploadedFile(driveFileId, LIBRARY_UPLOAD_FOLDER_ID);
    } catch (err) {
      logEvent('warn', 'library_upload_finalize', requestId, 'Verification failed', {
        driveFileId,
        error: err instanceof Error ? err.message : String(err),
      });
      return errorResponse(
        400,
        'uploaded_file_not_verified',
        'Uploaded file could not be verified. Please retry.',
        requestId,
      );
    }

    if (meta.size > MAX_RESUMABLE_UPLOAD_FILE_SIZE_BYTES) {
      try {
        await deleteFilePermanent(driveFileId);
      } catch {
        // ignore
      }
      return errorResponse(400, 'file_too_large', 'Uploaded file exceeds allowed size.', requestId);
    }

    let permissionWarning: string | null = null;
    try {
      await setFilePublic(driveFileId);
    } catch (permErr) {
      permissionWarning = permErr instanceof Error ? permErr.message : String(permErr);
      logEvent('warn', 'library_upload_finalize', requestId, 'setFilePublic failed', {
        driveFileId,
        error: permissionWarning,
      });
    }

    // Remove the previous file bound to this standard (if any).
    if (standard.drive_file_id && standard.drive_file_id !== driveFileId) {
      try {
        await trashFile(standard.drive_file_id);
      } catch (trashErr) {
        logEvent('warn', 'library_upload_finalize', requestId, 'Failed to trash old file', {
          oldDriveFileId: standard.drive_file_id,
          error: trashErr instanceof Error ? trashErr.message : String(trashErr),
        });
      }
    }

    const viewUrl = `https://drive.google.com/file/d/${driveFileId}/view`;
    const { error: updateError } = await admin
      .from('standards')
      .update({
        drive_file_id: driveFileId,
        url: viewUrl,
        is_link: false,
        updated_at: new Date().toISOString(),
      })
      .eq('id', standardId);
    if (updateError) throw updateError;

    return NextResponse.json(
      {
        ok: true,
        requestId,
        driveFileId,
        driveFileName: meta.name,
        viewUrl,
        warning: permissionWarning,
      },
      { status: 201 },
    );
  } catch (err) {
    logEvent('error', 'library_upload_finalize', requestId, 'Finalize failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return handleAuthError(err, { scope: 'library.files.finalize', requestId });
  }
}
