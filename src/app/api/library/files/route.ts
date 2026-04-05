import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { getAuthUser, handleAuthError } from '@/lib/auth/guards';

// GET /api/library/files?standardId=xxx — ดึงไฟล์ที่ไม่ถูกลบ
export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser('library');
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const standardId = request.nextUrl.searchParams.get('standardId');
    const admin = await createServiceRoleClient();

    let query = admin
      .from('uploaded_files')
      .select('id, drive_file_id, drive_file_name, file_type, file_size_bytes, uploaded_at, uploader_id, users!uploader_id(display_name, email)')
      .eq('is_deleted', false)
      .order('uploaded_at', { ascending: false });

    if (standardId) {
      // uploaded_files.task_id maps to standard_id for library files
      // ใช้ metadata column แทน — store standard_id in task_id field
      query = query.eq('task_id', standardId);
    }

    const { data, error } = await query;
    if (error) throw error;
    return NextResponse.json(data ?? []);
  } catch (err) {
    return handleAuthError(err);
  }
}
