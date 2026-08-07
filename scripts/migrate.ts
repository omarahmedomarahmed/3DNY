/**
 * Applies db/schema.sql to the database in DATABASE_URL.
 *
 *   npm run db:migrate
 *
 * The schema is idempotent, so this is safe to re-run.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { neon } from '@neondatabase/serverless';

/**
 * Splits a SQL file into executable statements, ignoring semicolons inside
 * dollar-quoted blocks (`$$ ... $$`, `$tag$ ... $tag$`), string literals,
 * quoted identifiers and comments. A naive split on ';' would tear the
 * `DO $$ ... $$` block and the `CREATE FUNCTION` body in half.
 */
function splitSqlStatements(sqlText: string): string[] {
  const statements: string[] = [];
  let current = '';
  let i = 0;

  while (i < sqlText.length) {
    const rest = sqlText.slice(i);

    if (rest.startsWith('--')) {
      const end = sqlText.indexOf('\n', i);
      i = end === -1 ? sqlText.length : end;
      continue;
    }

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

/** First line of a statement, trimmed — enough to identify it in the log. */
function summarize(statement: string): string {
  const line = statement.split('\n')[0].trim();
  return line.length > 72 ? `${line.slice(0, 69)}...` : line;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error(
      'DATABASE_URL is not set.\n' +
        'Copy .env.example to .env.local and paste your Neon connection string, ' +
        'or run: DATABASE_URL=postgres://... npm run db:migrate',
    );
    process.exit(1);
  }

  const schemaPath = path.join(process.cwd(), 'db', 'schema.sql');
  let schema: string;
  try {
    schema = readFileSync(schemaPath, 'utf8');
  } catch {
    console.error(`Could not read ${schemaPath}. Run this from the project root.`);
    process.exit(1);
  }

  const statements = splitSqlStatements(schema);
  console.log(`Applying ${statements.length} statements from db/schema.sql`);

  const db = neon(url);
  for (let i = 0; i < statements.length; i++) {
    const statement = statements[i];
    process.stdout.write(`  [${i + 1}/${statements.length}] ${summarize(statement)} ... `);
    try {
      await db(statement);
      console.log('ok');
    } catch (err) {
      console.log('failed');
      console.error(`\n${(err as Error).message}\n\nStatement:\n${statement}`);
      process.exit(1);
    }
  }

  console.log('\nMigration complete.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
