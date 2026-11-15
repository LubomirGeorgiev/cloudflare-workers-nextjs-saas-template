import { execFile } from "node:child_process";
import { promisify } from "node:util";

// One home for the spawn of scripts/generate-openapi.mjs. The Vite plugin in
// tools/openapi-document.ts and the integration runner both call it.

const GENERATOR = "scripts/generate-openapi.mjs";
/** One run evaluates the whole service layer in about 6s; anything slower means the generator is stuck. */
const GENERATE_TIMEOUT_MS = 60_000;
const MAX_DOCUMENT_BYTES = 32 * 1024 * 1024;

/**
 * The path of a file that holds the stdout of one generator run. The integration runner sets it,
 * so its shards read one run instead of each starting its own.
 */
export const PREGENERATED_OPENAPI_ENV = "OPENAPI_PREGENERATED_ENVELOPE_FILE";

const run = promisify(execFile);

/**
 * Runs the generator once. Its stdout is the JSON envelope of both documents.
 * @returns {Promise<string>}
 */
export async function runOpenApiGenerator() {
  const { stdout } = await run(process.execPath, [GENERATOR], {
    maxBuffer: MAX_DOCUMENT_BYTES,
    timeout: GENERATE_TIMEOUT_MS,
  });
  return stdout;
}
