import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Splits a SQL file into executable statements.
 *
 * A naive `split(';')` breaks the schema: the `DO $$ ... $$` block and the
 * `CREATE FUNCTION ... $$ ... $$` body both contain semicolons. This scanner
 * tracks dollar-quoted blocks (`$$` and `$tag$`), ordinary string literals,
 * quoted identifiers and comments, and only splits at top level.
 */
function splitSqlStatements(sqlText: string): string[] {
  const statements: string[] = [];
  let current = '';
  let i = 0;

  while (i < sqlText.length) {
    const rest = sqlText.slice(i);

    // -- line comment
    if (rest.startsWith('--')) {
      const end = sqlText.indexOf('\n', i);
      i = end === -1 ? sqlText.length : end;
      continue;
    }

    // /* block comment */ (nestable in Postgres)
    if (rest.startsWith('/*')) {
      let depth = 1;
      i += 2;
      while (i < sqlText.length && depth > 0) {
        if (sqlText.startsWith('/*', i)) {
          depth++;
          i += 2;
        } else if (sqlText.startsWith('*/', i)) {
          depth--;
          i += 2;
        } else {
          i++;
        }
      }
      continue;
    }

    // $$ ... $$ or $tag$ ... $tag$
    const dollar = rest.match(/^\$([A-Za-z_][A-Za-z0-9_]*)?\$/);
    if (dollar) {
      const tag = dollar[0];
      const end = sqlText.indexOf(tag, i + tag.length);
      const stop = end === -1 ? sqlText.length : end + tag.length;
      current += sqlText.slice(i, stop);
      i = stop;
      continue;
    }

    const ch = sqlText[i];

    // '...' string literal, '' escapes a quote
    if (ch === "'" || ch === '"') {
      let j = i + 1;
      while (j < sqlText.length) {
        if (sqlText[j] === ch) {
          if (sqlText[j + 1] === ch) j += 2;
          else {
            j++;
            break;
          }
        } else if (ch === "'" && sqlText[j] === '\\') {
          j += 2;
        } else {
          j++;
        }
      }
      current += sqlText.slice(i, j);
      i = j;
      continue;
    }

    if (ch === ';') {
      if (current.trim()) statements.push(current.trim());
      current = '';
      i++;
      continue;
    }

    current += ch;
    i++;
  }

  if (current.trim()) statements.push(current.trim());
  return statements;
}

async function readSchema(): Promise<string> {
  const candidates = [
    path.join(process.cwd(), 'db', 'schema.sql'),
    path.join(process.cwd(), '..', 'db', 'schema.sql'),
  ];
  for (const file of candidates) {
    try {
      return await readFile(file, 'utf8');
    } catch {
      // try the next location
    }
  }
  throw new Error(
    `Could not read db/schema.sql (looked in ${candidates.join(', ')}). ` +
      'Run `npm run db:migrate` locally instead.',
  );
}

export async function POST() {
  try {
    const schema = await readSchema();
    const statements = splitSqlStatements(schema);
    const db = sql();
    for (const statement of statements) {
      await db(statement);
    }
    return NextResponse.json({ ok: true, statements: statements.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Migration failed.';
    if (message.includes('DATABASE_URL')) {
      return NextResponse.json({ error: message, needsSetup: true }, { status: 503 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
