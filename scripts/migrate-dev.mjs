import { execSync } from 'node:child_process';
import { parseWranglerConfig } from './utils/parse-wrangler.mjs';

try {
  const config = parseWranglerConfig();
  const dbName = config.d1_databases?.[0]?.database_name;

  if (!dbName) {
    console.error('Database name not found in wrangler.jsonc');
    process.exit(1);
  }

  console.log(`Applying migrations to database: ${dbName}`);
  execSync(`echo y | wrangler d1 migrations apply ${dbName} --local`, {
    stdio: 'inherit',
    cwd: process.cwd(),
    shell: true
  });
} catch (error) {
  console.error('Migration failed:', error.message);
  process.exit(1);
}

