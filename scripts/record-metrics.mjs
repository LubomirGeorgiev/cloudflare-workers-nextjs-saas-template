import fs from "node:fs";

import {
  appendMetricsEntry,
  parseDeploySizeMetrics,
  parseStartupProfileMetrics,
} from "./utils/metrics.mjs";

const DEFAULT_DEPLOY_LOG = "deploy-output.log";
const DEFAULT_STARTUP_LOG = "startup-profile-output.log";

const [deployLogPath = DEFAULT_DEPLOY_LOG, startupLogPath = DEFAULT_STARTUP_LOG] =
  process.argv.slice(2);

const deployMetrics = parseDeploySizeMetrics(fs.readFileSync(deployLogPath, "utf8"));

// Startup profiling is a diagnostic that never gates a deploy, so a missing or unreadable log only warns.
let startupMetrics = {};

if (fs.existsSync(startupLogPath)) {
  try {
    startupMetrics = parseStartupProfileMetrics(fs.readFileSync(startupLogPath, "utf8"));
  } catch (error) {
    console.warn(`Skipping startup profile metrics: ${error.message}`);
  }
} else {
  console.warn(`Skipping startup profile metrics: ${startupLogPath} not found.`);
}

const metricsPath = appendMetricsEntry({ metrics: { ...deployMetrics, ...startupMetrics } });

console.log(
  `Recorded deploy metrics in ${metricsPath}: total=${deployMetrics.totalUploadBytes}B gzip=${deployMetrics.gzipBytes}B` +
    (startupMetrics.startupActiveMs === undefined
      ? ""
      : ` startupActive=${startupMetrics.startupActiveMs}ms startupSamples=${startupMetrics.startupSamples}`)
);
