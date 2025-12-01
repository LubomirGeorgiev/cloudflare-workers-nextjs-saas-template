import { spawn } from 'child_process';
import { parseWranglerConfig } from './utils/parse-wrangler.mjs';

try {
  const config = parseWranglerConfig();
  const dbName = config.d1_databases?.[0]?.database_name;

  if (!dbName) {
    console.error('Database name not found in wrangler.jsonc');
    process.exit(1);
  }

  const args = ['d1', 'migrations', 'apply', dbName, '--local'];
  
  const wrangler = spawn('wrangler', args, {
    stdio: 'inherit',
    shell: true
  });

  wrangler.on('close', (code) => {
    process.exit(code || 0);
  });

  wrangler.on('error', (error) => {
    console.error('Error running wrangler:', error);
    process.exit(1);
  });
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

