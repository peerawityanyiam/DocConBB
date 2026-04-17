#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const requiredEnv = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'GOOGLE_UPLOAD_FOLDER_ID',
];

const cwd = process.cwd();
const envPath = path.join(cwd, '.env.local');

const envMap = new Map();
if (fs.existsSync(envPath)) {
  const text = fs.readFileSync(envPath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const idx = trimmed.indexOf('=');
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    envMap.set(key, value);
  }
}

const missing = requiredEnv.filter((key) => {
  const processValue = process.env[key];
  if (processValue && processValue.length > 0) return false;
  const fileValue = envMap.get(key);
  return !fileValue || fileValue.length === 0;
});

if (missing.length > 0) {
  console.error('❌ Preflight failed. Missing required env keys:');
  for (const key of missing) {
    console.error(`- ${key}`);
  }
  process.exit(1);
}

console.log('✅ Preflight passed. Required env keys are present.');
