#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { createClient } from '@supabase/supabase-js';

function loadEnvFromFile(envPath) {
  const env = {};
  if (!fs.existsSync(envPath)) return env;
  const text = fs.readFileSync(envPath, 'utf8');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const idx = line.indexOf('=');
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    env[key] = value;
  }
  return env;
}

const cwd = process.cwd();
const fileEnv = loadEnvFromFile(path.join(cwd, '.env.local'));
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || fileEnv.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || fileEnv.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing env: NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const client = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const STATUS_ORDER = [
  'ASSIGNED',
  'SUBMITTED_TO_DOCCON',
  'DOCCON_REJECTED',
  'PENDING_REVIEW',
  'REVIEWER_REJECTED',
  'WAITING_BOSS_APPROVAL',
  'BOSS_REJECTED',
  'WAITING_SUPER_BOSS_APPROVAL',
  'SUPER_BOSS_REJECTED',
  'COMPLETED',
  'CANCELLED',
];

async function main() {
  const { data, error } = await client
    .from('tasks')
    .select('id, status, is_archived')
    .eq('is_archived', false);

  if (error) {
    console.error('Supabase query failed:', error.message);
    process.exit(1);
  }

  const rows = data ?? [];
  const byStatus = {};
  for (const row of rows) {
    if (!row.status) continue;
    byStatus[row.status] = (byStatus[row.status] ?? 0) + 1;
  }

  const completed = byStatus.COMPLETED ?? 0;
  const cancelled = byStatus.CANCELLED ?? 0;
  const total = rows.length;
  const pending = Math.max(total - completed - cancelled, 0);
  const waitingApproval = (byStatus.WAITING_BOSS_APPROVAL ?? 0) + (byStatus.WAITING_SUPER_BOSS_APPROVAL ?? 0);

  console.log('=== Tracking Stats QA (non-archived) ===');
  console.log(`total            : ${total}`);
  console.log(`pending          : ${pending}`);
  console.log(`waitingApproval  : ${waitingApproval}`);
  console.log(`completed        : ${completed}`);
  console.log(`cancelled        : ${cancelled}`);
  console.log('');
  console.log('byStatus:');
  for (const status of STATUS_ORDER) {
    const count = byStatus[status] ?? 0;
    console.log(`- ${status.padEnd(28, ' ')} ${count}`);
  }
}

main().catch((err) => {
  console.error('qa:stats failed:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});

