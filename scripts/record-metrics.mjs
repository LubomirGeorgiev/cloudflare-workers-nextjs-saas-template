import fs from "node:fs";

import {
  appendMetricsEntry,
  parseDeploySizeMetrics,
  parseStartupProfileMetrics,
  parseTtfbMetrics,
} from "./utils/metrics.mjs";

const DEFAULT_DEPLOY_LOG = "deploy-output.log";
const DEFAULT_STARTUP_LOG = "startup-profile-output.log";
const DEFAULT_TTFB_LOG = "ttfb-output.log";

const [
  deployLogPath = DEFAULT_DEPLOY_LOG,
  startupLogPath = DEFAULT_STARTUP_LOG,
  ttfbLogPath = DEFAULT_TTFB_LOG,
] = process.argv.slice(2);

const deployMetrics = parseDeploySizeMetrics(fs.readFileSync(deployLogPath, "utf8"));

/** Diagnostics never gate a deploy, so a missing or unreadable log only warns. */
function readOptionalMetrics({ logPath, parse, label }) {
  if (!fs.existsSync(logPath)) {
    console.warn(`Skipping ${label} metrics: ${logPath} not found.`);

    return {};
  }

  try {
    return parse(fs.readFileSync(logPath, "utf8"));
  } catch (error) {
    console.warn(`Skipping ${label} metrics: ${error.message}`);

    return {};
  }
}

const startupMetrics = readOptionalMetrics({
  logPath: startupLogPath,
  parse: parseStartupProfileMetrics,
  label: "startup profile",
});
const ttfbMetrics = readOptionalMetrics({
  logPath: ttfbLogPath,
  parse: parseTtfbMetrics,
  label: "TTFB",
});

const metricsPath = appendMetricsEntry({
  metrics: { ...deployMetrics, ...startupMetrics, ...ttfbMetrics },
});

console.log(
  `Recorded deploy metrics in ${metricsPath}: total=${deployMetrics.totalUploadBytes}B gzip=${deployMetrics.gzipBytes}B` +
    (startupMetrics.startupActiveMs === undefined
      ? ""
      : ` startupActive=${startupMetrics.startupActiveMs}ms startupSamples=${startupMetrics.startupSamples}`) +
    (ttfbMetrics.ttfbHomeWarmMs === undefined
      ? ""
      : ` ttfbHomeWarm=${ttfbMetrics.ttfbHomeWarmMs}ms`)
);
