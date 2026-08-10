import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Reads `.env.local` into `process.env`, the way Next already does for the app.
 *
 * A script run outside Next gets none of that, and the obvious workaround —
 * `set -a; . .env.local` — quietly corrupts the value: a Neon connection
 * string contains `?channel_binding=require&sslmode=…`, and the shell reads
 * that `&` as "run the rest in the background". The variable ends up holding
 * half a URL, or nothing.
 *
 * So the file is parsed here rather than by a shell, and anything already
 * exported wins, so `DATABASE_URL=… npm run …` still overrides the file.
 */
export function loadEnvLocal(file = '.env.local'): void {
  let text: string;
  try {
    text = readFileSync(path.join(process.cwd(), file), 'utf8');
  } catch {
    return;
  }

  for (const line of text.split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    if (process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, '');
  }
}
