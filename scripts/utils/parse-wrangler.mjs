import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'jsonc-parser';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));

export function parseWranglerConfig() {
  const wranglerPath = path.join(scriptDir, '..', '..', 'wrangler.jsonc');
  const wranglerContent = fs.readFileSync(wranglerPath, 'utf8');

  try {
    return parse(wranglerContent);
  } catch (error) {
    throw new Error(`Failed to parse wrangler.jsonc: ${error.message}`);
  }
}

export function getD1Database() {
  const config = parseWranglerConfig();
  const d1Config = config.d1_databases?.[0];

  if (!d1Config) {
    return null;
  }

  return {
    name: d1Config.database_name,
    id: d1Config.database_id
  };
}
