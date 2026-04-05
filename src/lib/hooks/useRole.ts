'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { AppRole } from '@/lib/auth/guards';

export function useRoles(projectSlug: string) {
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = createClient();

    async function fetchRoles() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.email) {
        setLoading(false);
        return;
      }

      const { data: dbUser } = await supabase
        .from('users')
        .select('id')
        .eq('email', user.email)
        .single();

      if (!dbUser) {
        setLoading(false);
        return;
      }

      const { data } = await supabase
        .from('user_project_roles')
        .select('role, projects!inner(slug)')
        .eq('user_id', dbUser.id)
        .eq('projects.slug', projectSlug);

      setRoles((data ?? []).map((r: { role: AppRole }) => r.role));
      setLoading(false);
    }

    fetchRoles();
  }, [projectSlug]);

  return { roles, loading, hasRole: (role: AppRole) => roles.includes(role) };
}
