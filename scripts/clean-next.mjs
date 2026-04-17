import { promises as fs } from 'node:fs';
import path from 'node:path';

const target = path.resolve(process.cwd(), '.next');
const maxAttempts = 5;
const delayMs = 500;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function cleanNextDir() {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await fs.rm(target, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 });
      return;
    } catch (error) {
      if (attempt === maxAttempts) {
        throw error;
      }
      await sleep(delayMs * attempt);
    }
  }
}

try {
  await cleanNextDir();
  console.log('✅ Cleaned .next directory');
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`❌ Failed to clean .next: ${message}`);
  process.exitCode = 1;
}
