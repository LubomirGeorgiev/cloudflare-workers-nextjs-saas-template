import fs from "node:fs";

import { appendMetricsEntry, parseDeploySizeMetrics } from "./utils/metrics.mjs";

const DEFAULT_LOG_PATH = "deploy-output.log";
const HISTORY_SUFFIX = "deploy-size-history";

const logPath = process.argv[2] ?? DEFAULT_LOG_PATH;
const metrics = parseDeploySizeMetrics(fs.readFileSync(logPath, "utf8"));
const metricsPath = appendMetricsEntry({ historySuffix: HISTORY_SUFFIX, metrics });

console.log(
  `Recorded deploy size metrics in ${metricsPath}: total=${metrics.totalUploadBytes}B gzip=${metrics.gzipBytes}B`
);
