import fs from "node:fs";

import { appendMetricsEntry, parseStartupProfileMetrics } from "./utils/metrics.mjs";

const DEFAULT_LOG_PATH = "startup-profile-output.log";
const HISTORY_SUFFIX = "startup-profile-history";

const logPath = process.argv[2] ?? DEFAULT_LOG_PATH;
const metrics = parseStartupProfileMetrics(fs.readFileSync(logPath, "utf8"));
const metricsPath = appendMetricsEntry({ historySuffix: HISTORY_SUFFIX, metrics });

console.log(
  `Recorded startup profile metrics in ${metricsPath}: bundle=${metrics.bundleBytes}B gzip=${metrics.gzipBytes}B active=${metrics.activeMs}ms samples=${metrics.samples}`
);
