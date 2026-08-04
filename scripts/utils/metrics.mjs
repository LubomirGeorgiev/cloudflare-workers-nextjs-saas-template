import fs from "node:fs";
import path from "node:path";

const ANSI_PATTERN = /\u001b\[[0-9;]*m/g;
const METRICS_DIR = "metrics";
// Kept from when sizes were the only metric: renaming it would orphan the recorded history.
export const HISTORY_SUFFIX = "deploy-size-history";
const SIZE_UNIT_POWERS = {
  B: 0,
  KB: 1,
  MB: 2,
  GB: 3,
  TB: 4,
  KIB: 1,
  MIB: 2,
  GIB: 3,
  TIB: 4,
};

const SIZE_PAIR_SOURCE = "([0-9.]+)\\s*([KMGT]?i?B)(?:\\s*/\\s*|\\s+)";
const DEPLOY_SIZE_PATTERN = new RegExp(
  `Total Upload:\\s*${SIZE_PAIR_SOURCE}(?:gzip|gzipped)\\s*:\\s*([0-9.]+)\\s*([KMGT]?i?B)`,
  "i"
);
const STARTUP_BUNDLE_PATTERN = new RegExp(
  `Bundle:\\s*${SIZE_PAIR_SOURCE}gzip\\s*:\\s*([0-9.]+)\\s*([KMGT]?i?B)`,
  "i"
);
// The garbage-collection clause is optional: wrangler omits it when nothing was collected.
const STARTUP_ACTIVE_PATTERN =
  /Active:\s*([0-9.]+)\s*ms(?:\s*\(including\s*([0-9.]+)\s*ms\s*garbage collection\))?/i;
const STARTUP_SAMPLES_PATTERN = /Samples:\s*([0-9]+)/i;

export function stripAnsi(text) {
  return text.replace(ANSI_PATTERN, "");
}

export function toBytes(value, unit) {
  const normalizedUnit = unit.toUpperCase();
  const base = normalizedUnit.includes("IB") ? 1024 : 1000;
  const power = SIZE_UNIT_POWERS[normalizedUnit];

  if (power === undefined) {
    throw new Error(`Unsupported size unit: ${unit}`);
  }

  return Math.round(Number(value) * base ** power);
}

function requireMatch({ log, pattern, label }) {
  const match = log.match(pattern);

  if (!match) {
    throw new Error(`Could not find ${label} in startup profile output.`);
  }

  return match;
}

function matchDurationMs(log, label) {
  const pattern = new RegExp(`${label}:\\s*([0-9.]+)\\s*ms`, "i");

  return Number(requireMatch({ log, pattern, label: `"${label}"` })[1]);
}

export function parseDeploySizeMetrics(log) {
  const match = stripAnsi(log).match(DEPLOY_SIZE_PATTERN);

  if (!match) {
    throw new Error("Could not find deploy size metrics in deploy output.");
  }

  const [, totalValue, totalUnit, gzipValue, gzipUnit] = match;

  return {
    totalUploadRaw: `${totalValue} ${totalUnit}`,
    gzipRaw: `${gzipValue} ${gzipUnit}`,
    totalUploadBytes: toBytes(totalValue, totalUnit),
    gzipBytes: toBytes(gzipValue, gzipUnit),
  };
}

export function parseStartupProfileMetrics(log) {
  const sanitizedLog = stripAnsi(log);
  const bundleMatch = requireMatch({
    log: sanitizedLog,
    pattern: STARTUP_BUNDLE_PATTERN,
    label: "bundle size",
  });
  const samplesMatch = requireMatch({
    log: sanitizedLog,
    pattern: STARTUP_SAMPLES_PATTERN,
    label: '"Samples"',
  });
  const activeMatch = requireMatch({
    log: sanitizedLog,
    pattern: STARTUP_ACTIVE_PATTERN,
    label: '"Active"',
  });
  const [, bundleValue, bundleUnit, gzipValue, gzipUnit] = bundleMatch;

  // Startup fields share one history row with the deploy sizes, so they carry a prefix.
  return {
    startupBundleRaw: `${bundleValue} ${bundleUnit}`,
    startupGzipRaw: `${gzipValue} ${gzipUnit}`,
    startupBundleBytes: toBytes(bundleValue, bundleUnit),
    startupGzipBytes: toBytes(gzipValue, gzipUnit),
    startupProfileWindowMs: matchDurationMs(sanitizedLog, "Profile window"),
    startupSampledMs: matchDurationMs(sanitizedLog, "Sampled time"),
    startupActiveMs: Number(activeMatch[1]),
    startupGcMs: activeMatch[2] === undefined ? null : Number(activeMatch[2]),
    startupIdleMs: matchDurationMs(sanitizedLog, "Idle"),
    startupSamples: Number(samplesMatch[1]),
  };
}

export function readRunIdentity(env = process.env) {
  return {
    timestamp: new Date().toISOString(),
    branch: env.GITHUB_REF_NAME ?? "",
    commitSha: (env.GITHUB_SHA ?? "").slice(0, 5),
    runId: env.GITHUB_RUN_ID ?? "",
    runNumber: env.GITHUB_RUN_NUMBER ?? "",
  };
}

/**
 * One row per deploy in one history file, named after the package so a fork records under its own name.
 */
export function appendMetricsEntry({ metrics }) {
  const { name: projectName } = JSON.parse(fs.readFileSync("package.json", "utf8"));
  const metricsPath = path.join(METRICS_DIR, `${projectName}-${HISTORY_SUFFIX}.jsonl`);
  const { timestamp, branch, ...runIdentity } = readRunIdentity();

  fs.mkdirSync(path.dirname(metricsPath), { recursive: true });
  fs.appendFileSync(
    metricsPath,
    `${JSON.stringify({ timestamp, branch, ...metrics, ...runIdentity })}\n`
  );

  return metricsPath;
}
