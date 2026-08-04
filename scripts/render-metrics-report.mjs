import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { HISTORY_SUFFIX } from "./utils/metrics.mjs";

const METRICS_DIR = "metrics";
const REPORT_SUFFIX = "metrics-report";
const SHORT_SHA_LENGTH = 5;

/** Report and history files are named after the package so a fork never collides with upstream. */
function readProjectName() {
  return JSON.parse(fs.readFileSync("package.json", "utf8")).name;
}

const METRIC_FIELDS = [
  "totalUploadBytes",
  "gzipBytes",
  "startupBundleBytes",
  "startupGzipBytes",
  "startupActiveMs",
  "startupGcMs",
  "startupIdleMs",
  "startupSampledMs",
];

const RANGES = [
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
  { label: "1y", days: 365 },
  { label: "All", days: 0 },
];

/**
 * Metrics only record a 5-char sha, so titles are resolved by prefix from local history.
 * A prefix shared by two commits resolves to nothing rather than to the wrong title.
 */
function readCommitSubjects() {
  let log = "";
  try {
    log = execFileSync("git", ["log", "--all", "--format=%H%x09%s"], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return new Map();
  }

  const subjects = new Map();
  const ambiguous = new Set();
  for (const line of log.split("\n")) {
    const [sha, subject] = line.split("\t");
    if (!sha || !subject) {
      continue;
    }
    const prefix = sha.slice(0, SHORT_SHA_LENGTH);
    if (subjects.has(prefix) && subjects.get(prefix) !== subject) {
      ambiguous.add(prefix);
    } else {
      subjects.set(prefix, subject);
    }
  }
  for (const prefix of ambiguous) {
    subjects.delete(prefix);
  }
  return subjects;
}

function readHistory(subjects) {
  const historyPath = path.join(METRICS_DIR, `${readProjectName()}-${HISTORY_SUFFIX}.jsonl`);

  if (!fs.existsSync(historyPath)) {
    return [];
  }

  return fs
    .readFileSync(historyPath, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line))
    .map((entry) => {
      const commitSha = entry.commitSha ?? "";
      const row = {
        t: Date.parse(entry.timestamp),
        commitSha,
        commitSubject: subjects.get(commitSha) ?? "",
        runNumber: entry.runNumber ?? "",
        branch: entry.branch ?? "",
      };
      for (const field of METRIC_FIELDS) {
        if (typeof entry[field] === "number" && Number.isFinite(entry[field])) {
          row[field] = entry[field];
        }
      }
      return row;
    })
    .filter((row) => Number.isFinite(row.t))
    .sort((a, b) => a.t - b.t);
}

function renderDocument(data) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Deploy metrics</title>
<style>${STYLES}</style>
</head>
<body>
<main class="viz-root">
  <header class="page-head">
    <div>
      <h1>Deploy metrics</h1>
      <p class="muted">Generated from <code>${METRICS_DIR}/*.jsonl</code> · re-run <code>pnpm metrics:report</code> after a deploy.</p>
    </div>
    <button type="button" class="theme-toggle" id="theme-toggle" aria-label="Toggle dark mode">Theme</button>
  </header>
  <section class="hero" id="hero"></section>
  <div class="filters">
    <span class="filters-label">Range</span>
    <div class="range-group" role="group" aria-label="Time range">
      ${RANGES.map(
        (range, index) =>
          `<button type="button" class="range" data-days="${range.days}" aria-pressed="${index === RANGES.length - 1}">${range.label}</button>`
      ).join("\n      ")}
    </div>
    <button type="button" class="zoom-reset" id="zoom-reset" hidden>Reset zoom</button>
    <span class="filters-hint">Drag across a time chart to zoom</span>
  </div>
  <div id="charts"></div>
</main>
<script type="application/json" id="metrics-data">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>
<script>${SCRIPT}</script>
</body>
</html>
`;
}

const STYLES = `
.viz-root {
  color-scheme: light;
  --surface-1: #fcfcfb;
  --plane: #f9f9f7;
  --text-primary: #0b0b0b;
  --text-secondary: #52514e;
  --text-muted: #898781;
  --gridline: #e1e0d9;
  --baseline: #c3c2b7;
  --border: rgba(11, 11, 11, 0.1);
  --shadow: rgba(11, 11, 11, 0.06);
  --good: #006300;
  --critical: #d03b3b;
  --series-1: #2a78d6;
  --series-2: #eb6834;
  --grow: #e34948;
  --shrink: #2a78d6;
  --track: #cde2fb;
}
@media (prefers-color-scheme: dark) {
  :root:where(:not([data-theme="light"])) .viz-root {
    color-scheme: dark;
    --surface-1: #1a1a19;
    --plane: #0d0d0d;
    --text-primary: #ffffff;
    --text-secondary: #c3c2b7;
    --text-muted: #898781;
    --gridline: #2c2c2a;
    --baseline: #383835;
    --border: rgba(255, 255, 255, 0.1);
    --shadow: rgba(0, 0, 0, 0.5);
    --good: #0ca30c;
    --critical: #d03b3b;
    --series-1: #3987e5;
    --series-2: #d95926;
    --grow: #e66767;
    --shrink: #3987e5;
    --track: #184f95;
  }
}
:root[data-theme="dark"] .viz-root {
  color-scheme: dark;
  --surface-1: #1a1a19;
  --plane: #0d0d0d;
  --text-primary: #ffffff;
  --text-secondary: #c3c2b7;
  --text-muted: #898781;
  --gridline: #2c2c2a;
  --baseline: #383835;
  --border: rgba(255, 255, 255, 0.1);
  --shadow: rgba(0, 0, 0, 0.5);
  --good: #0ca30c;
  --critical: #d03b3b;
  --series-1: #3987e5;
  --series-2: #d95926;
  --grow: #e66767;
  --shrink: #3987e5;
  --track: #184f95;
}
* { box-sizing: border-box; }
html, body { margin: 0; }
body { background: #f9f9f7; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
@media (prefers-color-scheme: dark) {
  :root:where(:not([data-theme="light"])) body { background: #0d0d0d; }
}
:root[data-theme="dark"] body { background: #0d0d0d; }
.viz-root {
  background: var(--plane);
  color: var(--text-primary);
  margin: 0 auto;
  max-width: 1060px;
  padding: 40px 24px 72px;
}
.page-head { align-items: flex-start; display: flex; gap: 16px; justify-content: space-between; }
.page-head h1 { font-size: 24px; font-weight: 600; margin: 0 0 6px; }
.muted { color: var(--text-muted); font-size: 13px; margin: 0; }
code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.92em; }
.theme-toggle, .range, .zoom-reset {
  appearance: none;
  background: var(--surface-1);
  border: 1px solid var(--border);
  color: var(--text-secondary);
  cursor: pointer;
  font: inherit;
  font-size: 13px;
  padding: 5px 12px;
}
.theme-toggle, .zoom-reset { border-radius: 6px; }
.theme-toggle:hover, .range:hover, .zoom-reset:hover { color: var(--text-primary); }
.zoom-reset { border-color: var(--baseline); color: var(--text-primary); }
.filters-hint { color: var(--text-muted); font-size: 12px; }
.hero {
  background: var(--surface-1);
  border: 1px solid var(--border);
  border-radius: 12px;
  display: flex;
  flex-wrap: wrap;
  gap: 32px 48px;
  margin-top: 24px;
  padding: 24px;
}
.hero-figure .stat-label { font-size: 13px; }
.hero-value { font-size: 48px; font-weight: 600; letter-spacing: -0.02em; line-height: 1.1; }
.meter-group { flex: 1 1 260px; min-width: 240px; }
.meter-head { color: var(--text-secondary); display: flex; font-size: 12px; justify-content: space-between; margin-bottom: 6px; }
.meter { background: var(--track); border-radius: 999px; height: 8px; overflow: hidden; width: 100%; }
.meter-fill { background: var(--series-1); border-radius: 999px; height: 100%; width: 0; }
@media (prefers-reduced-motion: no-preference) {
  .meter-fill { transition: width 700ms cubic-bezier(0.22, 1, 0.36, 1); }
}
.filters { align-items: center; display: flex; gap: 12px; margin: 28px 0 20px; }
.filters-label { color: var(--text-secondary); font-size: 13px; }
.range-group { display: flex; gap: 2px; }
.range:first-child { border-radius: 6px 0 0 6px; }
.range:last-child { border-radius: 0 6px 6px 0; }
.range[aria-pressed="true"] { border-color: var(--baseline); color: var(--text-primary); font-weight: 600; }
.card {
  background: var(--surface-1);
  border: 1px solid var(--border);
  border-radius: 12px;
  margin-bottom: 24px;
  padding: 20px 20px 12px;
}
@media (prefers-reduced-motion: no-preference) {
  .card { transition: box-shadow 200ms ease; }
}
.card:hover { box-shadow: 0 2px 12px var(--shadow); }
.card-head { align-items: flex-start; display: flex; flex-wrap: wrap; gap: 12px 24px; justify-content: space-between; }
.card h2 { font-size: 15px; font-weight: 600; margin: 0 0 4px; }
.legend { display: flex; gap: 16px; }
.legend-item { align-items: center; color: var(--text-secondary); display: flex; font-size: 12px; gap: 6px; }
.legend-key { border-radius: 1px; display: inline-block; height: 2px; width: 14px; }
.legend-key[data-shape="rect"] { border-radius: 2px; height: 10px; width: 10px; }
.stats { display: flex; flex-wrap: wrap; gap: 28px; margin: 18px 0 4px; }
.stat { align-items: flex-start; display: flex; gap: 10px; }
.stat-label { color: var(--text-muted); font-size: 12px; margin-bottom: 3px; }
.stat-value { font-size: 22px; font-weight: 600; letter-spacing: -0.01em; }
.stat-delta { color: var(--text-secondary); font-size: 12px; margin-top: 3px; }
.stat-delta[data-dir="up"] { color: var(--critical); }
.stat-delta[data-dir="down"] { color: var(--good); }
.spark { display: block; height: 22px; margin-top: 6px; width: 72px; }
.plot { margin-top: 8px; position: relative; }
.plot:focus-visible { border-radius: 8px; outline: 2px solid var(--series-1); outline-offset: 2px; }
.plot svg { display: block; height: auto; touch-action: none; width: 100%; }
.plot[data-brushable="true"] svg { cursor: col-resize; }
.tick { fill: var(--text-muted); font-size: 11px; font-variant-numeric: tabular-nums; }
.end-label { fill: var(--text-secondary); font-size: 11px; font-weight: 600; font-variant-numeric: tabular-nums; }
.bar { transform-box: fill-box; }
.bar[data-active="true"] { filter: brightness(1.18); }
@media (prefers-reduced-motion: no-preference) {
  .series-line { animation: draw 800ms cubic-bezier(0.22, 1, 0.36, 1) forwards; }
  .bar { animation: grow 500ms cubic-bezier(0.22, 1, 0.36, 1) backwards; }
  .dot { animation: fade 400ms ease 600ms backwards; }
}
@keyframes draw { to { stroke-dashoffset: 0; } }
@keyframes fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes grow { from { transform: scale(1, 0); } to { transform: scale(1, 1); } }
@keyframes grow-x { from { transform: scale(0, 1); } to { transform: scale(1, 1); } }
.tooltip {
  background: var(--surface-1);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 4px 16px var(--shadow);
  font-size: 12px;
  left: 0;
  opacity: 0;
  padding: 8px 10px;
  pointer-events: none;
  position: absolute;
  top: 8px;
  white-space: nowrap;
  z-index: 2;
}
@media (prefers-reduced-motion: no-preference) {
  .tooltip { transition: opacity 120ms ease, transform 120ms ease; }
}
.tooltip[data-visible="true"] { opacity: 1; }
.tooltip-head { color: var(--text-muted); margin-bottom: 4px; }
.tooltip-subject {
  color: var(--text-primary);
  margin-bottom: 6px;
  max-width: 42ch;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.commit-title { color: var(--text-secondary); max-width: 46ch; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tooltip-row { align-items: baseline; display: flex; gap: 8px; }
.tooltip-row + .tooltip-row { margin-top: 3px; }
.tooltip-value { color: var(--text-primary); font-weight: 600; font-variant-numeric: tabular-nums; }
.tooltip-name { color: var(--text-secondary); }
details { margin-top: 8px; }
summary { color: var(--text-secondary); cursor: pointer; font-size: 12px; padding: 6px 0; }
table { border-collapse: collapse; font-size: 12px; font-variant-numeric: tabular-nums; margin-top: 8px; width: 100%; }
th { color: var(--text-muted); font-weight: 500; text-align: left; }
th, td { border-bottom: 1px solid var(--gridline); padding: 5px 8px 5px 0; }
td { color: var(--text-secondary); }
.table-scroll { max-height: 320px; overflow: auto; }
.empty { color: var(--text-muted); font-size: 13px; padding: 8px 0 16px; }
`;

const SCRIPT = `
const SLOT_COLORS = { 1: "var(--series-1)", 2: "var(--series-2)" };
const MARGIN = { top: 16, right: 76, bottom: 28, left: 62 };
const PLOT_WIDTH = 900;
const PLOT_HEIGHT = 260;
const BAR_MAX_THICKNESS = 24;
const BAR_GAP = 2;
const SPARK_POINTS = 12;
const MOVERS_LIMIT = 8;
// Cloudflare Workers Paid: 10 MiB compressed bundle, 400ms startup CPU.
const WORKER_GZIP_LIMIT_BYTES = 10 * 1024 * 1024;
const STARTUP_CPU_LIMIT_MS = 400;
const SVG_NS = "http://www.w3.org/2000/svg";

const DOT_RADIUS = 4;
const MARKER_RADIUS = 6;
const MIN_BRUSH_PX = 8;

const history = JSON.parse(document.getElementById("metrics-data").textContent);
const chartsRoot = document.getElementById("charts");
const heroRoot = document.getElementById("hero");
const zoomReset = document.getElementById("zoom-reset");
let rangeDays = 0;
let zoom = null;

const CHARTS = [
  {
    kind: "line",
    unit: "bytes",
    title: "Worker upload size",
    subtitle: "Bytes uploaded to Cloudflare on every deploy, raw and gzipped.",
    series: [
      { key: "totalUploadBytes", label: "Total upload", slot: 1 },
      { key: "gzipBytes", label: "Gzipped", slot: 2 },
    ],
  },
  {
    kind: "delta",
    unit: "bytes",
    key: "totalUploadBytes",
    title: "Change per deploy",
    subtitle: "Total upload size added or removed by each deploy, against the one before it.",
  },
  {
    kind: "movers",
    unit: "bytes",
    key: "totalUploadBytes",
    title: "Biggest movers",
    subtitle: "The deploys that moved upload size the most, largest first.",
  },
  {
    kind: "cadence",
    title: "Deploy cadence",
    subtitle: "Deploys recorded per calendar week.",
  },
  {
    kind: "line",
    unit: "bytes",
    title: "Startup bundle size",
    subtitle: "Bundle measured by wrangler check startup, raw and gzipped.",
    series: [
      { key: "startupBundleBytes", label: "Bundle", slot: 1 },
      { key: "startupGzipBytes", label: "Gzipped", slot: 2 },
    ],
  },
  {
    kind: "line",
    unit: "ms",
    title: "Startup CPU time",
    subtitle: "Active CPU time in the startup profile window. Cloudflare cuts off at 400ms.",
    series: [
      { key: "startupActiveMs", label: "Active", slot: 1 },
      { key: "startupGcMs", label: "Garbage collection", slot: 2 },
    ],
  },
  {
    kind: "delta",
    unit: "ms",
    key: "startupActiveMs",
    title: "Change in startup CPU",
    subtitle: "Active CPU time added or removed by each deploy, against the one before it.",
  },
];

function formatBytes(bytes) {
  const mib = bytes / 1024 / 1024;
  if (mib >= 10) return mib.toFixed(1) + " MiB";
  if (mib >= 1) return mib.toFixed(2) + " MiB";
  if (bytes >= 1024) return (bytes / 1024).toFixed(0) + " KiB";
  return bytes.toFixed(0) + " B";
}

function formatMs(value) {
  return (value >= 100 ? value.toFixed(0) : value.toFixed(1)) + " ms";
}

function formatValue(value, unit) {
  if (unit === "count") return String(value);
  return unit === "ms" ? formatMs(value) : formatBytes(value);
}

function formatSigned(value, unit) {
  if (value === 0) return "no change";
  return (value > 0 ? "+" : "−") + formatValue(Math.abs(value), unit);
}

function formatPercent(diff, previous) {
  if (!previous || diff === 0) return "";
  const percent = Math.abs((diff / previous) * 100);
  return percent < 0.05 ? " (<0.1%)" : " (" + (diff > 0 ? "+" : "−") + percent.toFixed(1) + "%)";
}

function formatDate(ms) {
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatDateTime(ms) {
  return new Date(ms).toLocaleString(undefined, {
    month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function describeRun(row) {
  if (!row.commitSha) return formatDateTime(row.t);
  return formatDateTime(row.t) + " · " + row.commitSha + (row.runNumber ? " · #" + row.runNumber : "");
}

function commitCell(row) {
  if (!row.commitSha) return "—";
  return row.commitSha + (row.runNumber ? " · #" + row.runNumber : "");
}

function titleCell(row) {
  return { text: row.commitSubject || "—", className: "commit-title" };
}

/** Ticks are stepped in the display unit (MiB, ms, deploys) so labels land on round numbers. */
function buildTicks(max, unit) {
  const divisor = unit !== "bytes" ? 1 : max >= 1024 * 1024 ? 1024 * 1024 : 1024;
  const suffix = unit === "count" ? "" : unit === "ms" ? " ms" : divisor === 1024 ? " KiB" : " MiB";
  const scaledMax = max / divisor;
  const rawStep = scaledMax / 4 || 1;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const steps = unit === "count" ? [1, 2, 5, 10] : [1, 2, 2.5, 5, 10];
  const step = steps.map((m) => m * magnitude).find((candidate) => candidate >= rawStep) || rawStep;
  const decimals = Number.isInteger(step) ? 0 : 1;
  const ticks = [];
  for (let scaled = 0; scaled < scaledMax + step; scaled += step) {
    ticks.push({ value: scaled * divisor, label: scaled === 0 ? "0" : scaled.toFixed(decimals) + suffix });
  }
  return ticks;
}

function svgEl(name, attrs) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function rowsInRange(rows) {
  if (rows.length === 0) return rows;
  let visible = rows;
  if (rangeDays !== 0) {
    const cutoff = rows[rows.length - 1].t - rangeDays * 86400000;
    const withinDays = rows.filter((row) => row.t >= cutoff);
    visible = withinDays.length >= 2 ? withinDays : rows.slice(-2);
  }
  if (zoom) {
    // A zoom window narrower than a dataset's own cadence leaves it unzoomed rather than empty.
    const withinZoom = visible.filter((row) => row.t >= zoom.start && row.t <= zoom.end);
    if (withinZoom.length > 0) visible = withinZoom;
  }
  return visible;
}

function applyZoom(window) {
  zoom = window;
  render();
}

function seriesPoints(rows, key) {
  return rows.filter((row) => typeof row[key] === "number").map((row) => ({ ...row, v: row[key] }));
}

// ---------- shared card chrome ----------

function createCard({ title, subtitle, legendItems }) {
  const card = el("section", "card");
  const head = el("div", "card-head");
  const heading = el("div");
  heading.append(el("h2", null, title), el("p", "muted", subtitle));
  head.append(heading);

  if (legendItems && legendItems.length > 1) {
    const legend = el("div", "legend");
    for (const item of legendItems) {
      const entry = el("div", "legend-item");
      const key = el("span", "legend-key");
      key.dataset.shape = item.shape || "line";
      key.style.background = item.color;
      entry.append(key, el("span", null, item.label));
      legend.append(entry);
    }
    head.append(legend);
  }

  card.append(head);
  return card;
}

function addTable(card, { columns, rows }) {
  const details = el("details");
  details.append(el("summary", null, "Table view"));
  const scroll = el("div", "table-scroll");
  const table = el("table");
  const head = el("tr");
  for (const column of columns) head.append(el("th", null, column));
  table.append(head);
  for (const row of rows) {
    const tr = el("tr");
    for (const cell of row) {
      tr.append(typeof cell === "string" ? el("td", null, cell) : el("td", cell.className, cell.text));
    }
    table.append(tr);
  }
  scroll.append(table);
  details.append(scroll);
  card.append(details);
}

function sparkline(points, color) {
  const tail = points.slice(-SPARK_POINTS);
  if (tail.length < 2) return null;
  const width = 72;
  const height = 22;
  const values = tail.map((point) => point.v);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const svg = svgEl("svg", { class: "spark", viewBox: "0 0 " + width + " " + height, "aria-hidden": "true" });
  const x = (index) => (index / (tail.length - 1)) * (width - 4) + 2;
  const y = (value) => height - 3 - ((value - min) / span) * (height - 8);
  svg.append(svgEl("path", {
    d: tail.map((point, index) => (index === 0 ? "M" : "L") + x(index) + " " + y(point.v)).join(" "),
    fill: "none", stroke: "var(--baseline)", "stroke-width": 1.5, "stroke-linecap": "round", "stroke-linejoin": "round",
  }));
  svg.append(svgEl("circle", { cx: x(tail.length - 1), cy: y(values[values.length - 1]), r: 2.5, fill: color }));
  return svg;
}

function statTile({ label, value, points, unit, color }) {
  const tile = el("div");
  tile.append(el("div", "stat-label", label), el("div", "stat-value", value));
  if (points && points.length >= 2) {
    const latest = points[points.length - 1].v;
    const previous = points[points.length - 2].v;
    const diff = latest - previous;
    const delta = el("div", "stat-delta");
    if (diff !== 0) delta.dataset.dir = diff > 0 ? "up" : "down";
    delta.textContent = diff === 0
      ? "no change vs previous deploy"
      : formatSigned(diff, unit) + formatPercent(diff, previous) + " vs previous deploy";
    tile.append(delta);
    const peak = points.reduce((a, b) => (b.v > a.v ? b : a));
    tile.append(el("div", "stat-delta", "peak " + formatValue(peak.v, unit) + " on " + formatDate(peak.t)));
    const spark = sparkline(points, color);
    if (spark) tile.append(spark);
  }
  return tile;
}

// ---------- plot frame + hover layer ----------

function createPlotFrame({ label }) {
  const wrapper = el("div", "plot");
  wrapper.tabIndex = 0;
  wrapper.setAttribute("role", "group");
  wrapper.setAttribute("aria-label", label);
  const tooltip = el("div", "tooltip");
  const svg = svgEl("svg", { viewBox: "0 0 " + PLOT_WIDTH + " " + PLOT_HEIGHT, role: "img", "aria-label": label });
  wrapper.append(svg, tooltip);
  return {
    wrapper,
    svg,
    tooltip,
    innerWidth: PLOT_WIDTH - MARGIN.left - MARGIN.right,
    innerHeight: PLOT_HEIGHT - MARGIN.top - MARGIN.bottom,
  };
}

function fillTooltip(tooltip, { head, subject, rows }) {
  tooltip.replaceChildren();
  tooltip.append(el("div", "tooltip-head", head));
  if (subject) {
    tooltip.append(el("div", "tooltip-subject", subject));
  }
  for (const row of rows) {
    const line = el("div", "tooltip-row");
    const key = el("span", "legend-key");
    key.dataset.shape = row.shape || "line";
    key.style.background = row.color;
    line.append(key, el("span", "tooltip-value", row.value), el("span", "tooltip-name", row.label));
    tooltip.append(line);
  }
  tooltip.dataset.visible = "true";
}

function placeTooltip({ wrapper, tooltip, plotX }) {
  const offsetX = (plotX / PLOT_WIDTH) * wrapper.clientWidth;
  const flip = offsetX > wrapper.clientWidth - tooltip.offsetWidth - 24;
  tooltip.style.left = Math.max(0, flip ? offsetX - tooltip.offsetWidth - 12 : offsetX + 12) + "px";
}

/** One selection model for pointer, keyboard, and touch — every plot wires into it. */
function attachSelection({ frame, count, onSelect, onClear, positionOf }) {
  let current = -1;

  function select(index) {
    if (index < 0 || index >= count) return;
    current = index;
    onSelect(index);
  }

  function clear() {
    current = -1;
    frame.tooltip.dataset.visible = "false";
    onClear();
  }

  frame.svg.addEventListener("pointermove", (event) => {
    if (frame.dragging) return;
    const bounds = frame.svg.getBoundingClientRect();
    const plotX = ((event.clientX - bounds.left) / bounds.width) * PLOT_WIDTH;
    const plotY = ((event.clientY - bounds.top) / bounds.height) * PLOT_HEIGHT;
    let nearest = 0;
    for (let index = 1; index < count; index += 1) {
      if (Math.abs(positionOf(index) - (positionOf.axis === "y" ? plotY : plotX)) <
          Math.abs(positionOf(nearest) - (positionOf.axis === "y" ? plotY : plotX))) {
        nearest = index;
      }
    }
    select(nearest);
  });
  frame.svg.addEventListener("pointerleave", clear);
  frame.wrapper.addEventListener("keydown", (event) => {
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      select(current < 0 ? 0 : Math.min(count - 1, current + 1));
      event.preventDefault();
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      select(current < 0 ? count - 1 : Math.max(0, current - 1));
      event.preventDefault();
    } else if (event.key === "Escape") {
      clear();
    }
  });
  frame.wrapper.addEventListener("blur", clear);
}

/** Drag across a time-ordered plot to zoom every chart into that window. */
function enableBrush({ frame, resolve }) {
  const band = svgEl("rect", {
    class: "brush", x: 0, y: MARGIN.top, width: 0, height: frame.innerHeight,
    fill: "var(--series-1)", opacity: 0.14, "pointer-events": "none",
  });
  frame.svg.append(band);
  frame.wrapper.dataset.brushable = "true";
  let startX = null;

  function plotX(event) {
    const bounds = frame.svg.getBoundingClientRect();
    const x = ((event.clientX - bounds.left) / bounds.width) * PLOT_WIDTH;
    return Math.min(MARGIN.left + frame.innerWidth, Math.max(MARGIN.left, x));
  }

  function cancel() {
    startX = null;
    frame.dragging = false;
    band.setAttribute("width", 0);
  }

  frame.svg.addEventListener("pointerdown", (event) => {
    startX = plotX(event);
    frame.dragging = true;
    frame.tooltip.dataset.visible = "false";
    frame.svg.setPointerCapture(event.pointerId);
  });

  frame.svg.addEventListener("pointermove", (event) => {
    if (startX === null) return;
    const x = plotX(event);
    band.setAttribute("x", Math.min(startX, x));
    band.setAttribute("width", Math.abs(x - startX));
  });

  frame.svg.addEventListener("pointerup", (event) => {
    if (startX === null) return;
    const x = plotX(event);
    const from = Math.min(startX, x);
    const to = Math.max(startX, x);
    const dragged = to - from;
    cancel();
    if (dragged < MIN_BRUSH_PX) return;
    const window = resolve(from, to);
    if (window && window.end > window.start) applyZoom(window);
  });

  frame.svg.addEventListener("pointercancel", cancel);
}

function drawYAxis({ svg, ticks, scaleY, innerWidth }) {
  for (const tick of ticks) {
    const y = scaleY(tick.value);
    svg.append(svgEl("line", {
      x1: MARGIN.left, x2: MARGIN.left + innerWidth, y1: y, y2: y,
      stroke: tick.value === 0 ? "var(--baseline)" : "var(--gridline)", "stroke-width": 1,
    }));
    const label = svgEl("text", { x: MARGIN.left - 10, y: y + 4, "text-anchor": "end", class: "tick" });
    label.textContent = tick.label;
    svg.append(label);
  }
}

function drawXLabels({ svg, labels }) {
  labels.forEach((entry, index) => {
    const label = svgEl("text", {
      x: entry.x, y: PLOT_HEIGHT - 8, class: "tick",
      "text-anchor": index === 0 ? "start" : index === labels.length - 1 ? "end" : "middle",
    });
    label.textContent = entry.text;
    svg.append(label);
  });
}

// ---------- chart kinds ----------

function renderLineChart(spec, rows) {
  const series = spec.series
    .map((definition) => ({ ...definition, points: seriesPoints(rows, definition.key) }))
    .filter((definition) => definition.points.length > 0)
    .map((definition) => ({
      ...definition,
      color: SLOT_COLORS[definition.slot],
      byTime: new Map(definition.points.map((point) => [point.t, point])),
    }));

  if (series.length === 0) return null;

  const card = createCard({
    title: spec.title,
    subtitle: spec.subtitle,
    legendItems: series.map((definition) => ({ label: definition.label, color: definition.color })),
  });

  const stats = el("div", "stats");
  for (const definition of series) {
    stats.append(statTile({
      label: definition.label + " — latest",
      value: formatValue(definition.points[definition.points.length - 1].v, spec.unit),
      points: definition.points,
      unit: spec.unit,
      color: definition.color,
    }));
  }
  card.append(stats);

  const timeline = [...new Map(rows.map((row) => [row.t, row])).values()].sort((a, b) => a.t - b.t);

  if (timeline.length > 1) {
    const frame = createPlotFrame({ label: spec.title + " over time" });
    const allPoints = series.flatMap((definition) => definition.points);
    const minT = Math.min(...allPoints.map((point) => point.t));
    const maxT = Math.max(...allPoints.map((point) => point.t));
    const ticks = buildTicks(Math.max(...allPoints.map((point) => point.v)), spec.unit);
    const top = ticks[ticks.length - 1].value;
    const scaleX = (t) => MARGIN.left + (maxT === minT ? frame.innerWidth : ((t - minT) / (maxT - minT)) * frame.innerWidth);
    const scaleY = (v) => MARGIN.top + frame.innerHeight - (v / top) * frame.innerHeight;

    drawYAxis({ svg: frame.svg, ticks, scaleY, innerWidth: frame.innerWidth });
    const tickCount = Math.min(6, timeline.length);
    drawXLabels({
      svg: frame.svg,
      labels: Array.from({ length: tickCount }, (unused, index) => {
        const t = minT + ((maxT - minT) * index) / Math.max(1, tickCount - 1);
        return { x: scaleX(t), text: formatDate(t) };
      }),
    });

    const crosshair = svgEl("line", {
      x1: 0, x2: 0, y1: MARGIN.top, y2: MARGIN.top + frame.innerHeight,
      stroke: "var(--baseline)", "stroke-width": 1, opacity: 0,
    });
    frame.svg.append(crosshair);

    const markers = [];
    for (const definition of series) {
      const path = svgEl("path", {
        class: "series-line",
        d: definition.points.map((point, index) => (index === 0 ? "M" : "L") + scaleX(point.t) + " " + scaleY(point.v)).join(" "),
        fill: "none", stroke: definition.color, "stroke-width": 2,
        "stroke-linejoin": "round", "stroke-linecap": "round",
      });
      frame.svg.append(path);
      const length = path.getTotalLength ? path.getTotalLength() : 0;
      if (length > 0) {
        path.style.strokeDasharray = length;
        path.style.strokeDashoffset = length;
      }
      // One dot per recorded deploy, so every commit is a visible point on the line.
      for (const point of definition.points) {
        frame.svg.append(svgEl("circle", {
          class: "dot", cx: scaleX(point.t), cy: scaleY(point.v), r: DOT_RADIUS,
          fill: definition.color, stroke: "var(--surface-1)", "stroke-width": 2,
        }));
      }
      const last = definition.points[definition.points.length - 1];
      frame.svg.append(svgEl("circle", {
        cx: scaleX(last.t), cy: scaleY(last.v), r: MARKER_RADIUS,
        fill: definition.color, stroke: "var(--surface-1)", "stroke-width": 2,
      }));
      const endLabel = svgEl("text", { x: scaleX(last.t) + 10, y: scaleY(last.v) + 4, class: "end-label" });
      endLabel.textContent = formatValue(last.v, spec.unit);
      frame.svg.append(endLabel);
      const marker = svgEl("circle", {
        cx: 0, cy: 0, r: MARKER_RADIUS, fill: definition.color,
        stroke: "var(--surface-1)", "stroke-width": 2, opacity: 0,
      });
      frame.svg.append(marker);
      markers.push({ definition, marker });
    }

    attachSelection({
      frame,
      count: timeline.length,
      positionOf: (index) => scaleX(timeline[index].t),
      onSelect: (index) => {
        const anchor = timeline[index];
        const x = scaleX(anchor.t);
        crosshair.setAttribute("x1", x);
        crosshair.setAttribute("x2", x);
        crosshair.setAttribute("opacity", 1);
        const tooltipRows = [];
        for (const { definition, marker } of markers) {
          const point = definition.byTime.get(anchor.t);
          if (!point) {
            marker.setAttribute("opacity", 0);
            continue;
          }
          marker.setAttribute("cx", scaleX(point.t));
          marker.setAttribute("cy", scaleY(point.v));
          marker.setAttribute("opacity", 1);
          tooltipRows.push({
            color: definition.color,
            value: formatValue(point.v, spec.unit),
            label: definition.label,
          });
        }
        fillTooltip(frame.tooltip, {
          head: describeRun(anchor),
          subject: anchor.commitSubject,
          rows: tooltipRows,
        });
        placeTooltip({ wrapper: frame.wrapper, tooltip: frame.tooltip, plotX: x });
      },
      onClear: () => {
        crosshair.setAttribute("opacity", 0);
        for (const { marker } of markers) marker.setAttribute("opacity", 0);
      },
    });

    const toTime = (x) => minT + ((x - MARGIN.left) / frame.innerWidth) * (maxT - minT);
    enableBrush({ frame, resolve: (from, to) => ({ start: toTime(from), end: toTime(to) }) });

    card.append(frame.wrapper);
  }

  addTable(card, {
    columns: ["Deploy", "Commit", "Title", ...series.map((definition) => definition.label)],
    rows: [...timeline].reverse().map((row) => [
      formatDateTime(row.t),
      commitCell(row),
      titleCell(row),
      ...series.map((definition) => {
        const point = definition.byTime.get(row.t);
        return point ? formatValue(point.v, spec.unit) : "—";
      }),
    ]),
  });

  return card;
}

function buildDeltas(rows, key) {
  const points = seriesPoints(rows, key);
  return points.slice(1).map((point, index) => ({
    ...point,
    diff: point.v - points[index].v,
    previous: points[index].v,
    previousT: points[index].t,
  }));
}

function renderDeltaChart(spec, rows) {
  const deltas = buildDeltas(rows, spec.key);
  if (deltas.length === 0) return null;

  const grew = deltas.filter((entry) => entry.diff > 0).length;
  const card = createCard({
    title: spec.title,
    subtitle: spec.subtitle,
    legendItems: [
      { label: "Grew", color: "var(--grow)", shape: "rect" },
      { label: "Shrank", color: "var(--shrink)", shape: "rect" },
    ],
  });

  const net = deltas.reduce((sum, entry) => sum + entry.diff, 0);
  const stats = el("div", "stats");
  const netTile = el("div");
  netTile.append(el("div", "stat-label", "Net change over range"), el("div", "stat-value", formatSigned(net, spec.unit)));
  netTile.append(el("div", "stat-delta", grew + " of " + deltas.length + " deploys grew it"));
  stats.append(netTile);
  const biggest = deltas.reduce((a, b) => (Math.abs(b.diff) > Math.abs(a.diff) ? b : a));
  const biggestTile = el("div");
  biggestTile.append(
    el("div", "stat-label", "Largest single move"),
    el("div", "stat-value", formatSigned(biggest.diff, spec.unit)),
    el("div", "stat-delta", describeRun(biggest))
  );
  stats.append(biggestTile);
  card.append(stats);

  const frame = createPlotFrame({ label: spec.title });
  const maxAbs = Math.max(...deltas.map((entry) => Math.abs(entry.diff))) || 1;
  const ticks = buildTicks(maxAbs, spec.unit);
  const top = ticks[ticks.length - 1].value;
  const midY = MARGIN.top + frame.innerHeight / 2;
  const scaleY = (v) => midY - (v / top) * (frame.innerHeight / 2);
  const signedTicks = [
    ...ticks.slice(1).map((tick) => ({ value: -tick.value, label: "−" + tick.label })).reverse(),
    ...ticks.map((tick) => ({ value: tick.value, label: tick.value === 0 ? "0" : "+" + tick.label })),
  ];
  drawYAxis({ svg: frame.svg, ticks: signedTicks, scaleY, innerWidth: frame.innerWidth });

  const slot = frame.innerWidth / deltas.length;
  const thickness = Math.max(1, Math.min(BAR_MAX_THICKNESS, slot - BAR_GAP));
  const centerOf = (index) => MARGIN.left + slot * (index + 0.5);
  const bars = deltas.map((entry, index) => {
    const height = Math.max(1, Math.abs(scaleY(entry.diff) - midY));
    const bar = svgEl("rect", {
      class: "bar",
      x: centerOf(index) - thickness / 2,
      y: entry.diff >= 0 ? midY - height : midY,
      width: thickness,
      height,
      rx: Math.min(4, thickness / 2),
      fill: entry.diff === 0 ? "var(--baseline)" : entry.diff > 0 ? "var(--grow)" : "var(--shrink)",
    });
    bar.style.transformOrigin = entry.diff >= 0 ? "bottom" : "top";
    bar.style.animationDelay = Math.min(300, index * 6) + "ms";
    frame.svg.append(bar);
    return bar;
  });

  const labelCount = Math.min(6, deltas.length);
  drawXLabels({
    svg: frame.svg,
    labels: Array.from({ length: labelCount }, (unused, index) => {
      const position = Math.round((index * (deltas.length - 1)) / Math.max(1, labelCount - 1));
      return { x: centerOf(position), text: formatDate(deltas[position].t) };
    }),
  });

  attachSelection({
    frame,
    count: deltas.length,
    positionOf: centerOf,
    onSelect: (index) => {
      const entry = deltas[index];
      for (const bar of bars) bar.dataset.active = "false";
      bars[index].dataset.active = "true";
      fillTooltip(frame.tooltip, {
        head: describeRun(entry),
        subject: entry.commitSubject,
        rows: [
          {
            color: entry.diff === 0 ? "var(--baseline)" : entry.diff > 0 ? "var(--grow)" : "var(--shrink)",
            shape: "rect",
            value: formatSigned(entry.diff, spec.unit) + formatPercent(entry.diff, entry.previous),
            label: "vs previous deploy",
          },
          { color: "var(--text-muted)", value: formatValue(entry.v, spec.unit), label: "after this deploy" },
        ],
      });
      placeTooltip({ wrapper: frame.wrapper, tooltip: frame.tooltip, plotX: centerOf(index) });
    },
    onClear: () => {
      for (const bar of bars) bar.dataset.active = "false";
    },
  });

  const slotAt = (x) => Math.min(deltas.length - 1, Math.max(0, Math.floor((x - MARGIN.left) / slot)));
  enableBrush({
    frame,
    resolve: (from, to) => ({
      start: deltas[slotAt(from)].previousT,
      end: deltas[slotAt(to)].t,
    }),
  });

  card.append(frame.wrapper);
  addTable(card, {
    columns: ["Deploy", "Commit", "Title", "Change", "Size after"],
    rows: [...deltas].reverse().map((entry) => [
      formatDateTime(entry.t),
      commitCell(entry),
      titleCell(entry),
      formatSigned(entry.diff, spec.unit) + formatPercent(entry.diff, entry.previous),
      formatValue(entry.v, spec.unit),
    ]),
  });
  return card;
}

function renderMoversChart(spec, rows) {
  const deltas = buildDeltas(rows, spec.key)
    .filter((entry) => entry.diff !== 0)
    .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))
    .slice(0, MOVERS_LIMIT);

  if (deltas.length === 0) return null;

  const card = createCard({
    title: spec.title,
    subtitle: spec.subtitle,
    legendItems: [
      { label: "Grew", color: "var(--grow)", shape: "rect" },
      { label: "Shrank", color: "var(--shrink)", shape: "rect" },
    ],
  });

  const frame = createPlotFrame({ label: spec.title });
  const maxAbs = Math.max(...deltas.map((entry) => Math.abs(entry.diff)));
  const labelWidth = 130;
  const trackLeft = MARGIN.left + labelWidth;
  const trackWidth = PLOT_WIDTH - trackLeft - MARGIN.right;
  const slot = frame.innerHeight / deltas.length;
  const thickness = Math.max(6, Math.min(BAR_MAX_THICKNESS, slot - BAR_GAP * 3));
  const centerOf = (index) => MARGIN.top + slot * (index + 0.5);

  const bars = deltas.map((entry, index) => {
    const width = Math.max(2, (Math.abs(entry.diff) / maxAbs) * trackWidth);
    const bar = svgEl("rect", {
      class: "bar",
      x: trackLeft, y: centerOf(index) - thickness / 2, width, height: thickness,
      rx: Math.min(4, thickness / 2),
      fill: entry.diff > 0 ? "var(--grow)" : "var(--shrink)",
    });
    bar.style.transformOrigin = "left";
    bar.style.animationName = "grow-x";
    bar.style.animationDelay = index * 40 + "ms";
    frame.svg.append(bar);

    const name = svgEl("text", { x: MARGIN.left - 10, y: centerOf(index) + 4, class: "tick", "text-anchor": "start" });
    name.textContent = formatDate(entry.t) + (entry.commitSha ? " · " + entry.commitSha : "");
    frame.svg.append(name);

    const value = svgEl("text", { x: trackLeft + width + 8, y: centerOf(index) + 4, class: "end-label" });
    value.textContent = formatSigned(entry.diff, spec.unit);
    frame.svg.append(value);
    return bar;
  });

  frame.svg.append(svgEl("line", {
    x1: trackLeft, x2: trackLeft, y1: MARGIN.top, y2: MARGIN.top + frame.innerHeight,
    stroke: "var(--baseline)", "stroke-width": 1,
  }));

  const verticalSelection = (index) => centerOf(index);
  verticalSelection.axis = "y";
  attachSelection({
    frame,
    count: deltas.length,
    positionOf: verticalSelection,
    onSelect: (index) => {
      const entry = deltas[index];
      for (const bar of bars) bar.dataset.active = "false";
      bars[index].dataset.active = "true";
      fillTooltip(frame.tooltip, {
        head: describeRun(entry),
        subject: entry.commitSubject,
        rows: [
          {
            color: entry.diff > 0 ? "var(--grow)" : "var(--shrink)",
            shape: "rect",
            value: formatSigned(entry.diff, spec.unit) + formatPercent(entry.diff, entry.previous),
            label: "vs previous deploy",
          },
          { color: "var(--text-muted)", value: formatValue(entry.v, spec.unit), label: "after this deploy" },
        ],
      });
      placeTooltip({ wrapper: frame.wrapper, tooltip: frame.tooltip, plotX: trackLeft });
    },
    onClear: () => {
      for (const bar of bars) bar.dataset.active = "false";
    },
  });

  card.append(frame.wrapper);
  addTable(card, {
    columns: ["Deploy", "Commit", "Title", "Change", "Size after"],
    rows: deltas.map((entry) => [
      formatDateTime(entry.t),
      commitCell(entry),
      titleCell(entry),
      formatSigned(entry.diff, spec.unit) + formatPercent(entry.diff, entry.previous),
      formatValue(entry.v, spec.unit),
    ]),
  });
  return card;
}

function startOfWeek(ms) {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return date.getTime();
}

function renderCadenceChart(spec, rows) {
  if (rows.length === 0) return null;
  const counts = new Map();
  for (const row of rows) {
    const week = startOfWeek(row.t);
    counts.set(week, (counts.get(week) ?? 0) + 1);
  }
  const weeks = [...counts.entries()].map(([t, count]) => ({ t, v: count })).sort((a, b) => a.t - b.t);
  if (weeks.length < 2) return null;

  const card = createCard({ title: spec.title, subtitle: spec.subtitle });
  const busiest = weeks.reduce((a, b) => (b.v > a.v ? b : a));
  const stats = el("div", "stats");
  const average = rows.length / weeks.length;
  const averageTile = el("div");
  averageTile.append(
    el("div", "stat-label", "Deploys per week"),
    el("div", "stat-value", average.toFixed(1)),
    el("div", "stat-delta", rows.length + " deploys across " + weeks.length + " weeks")
  );
  const busiestTile = el("div");
  busiestTile.append(
    el("div", "stat-label", "Busiest week"),
    el("div", "stat-value", String(busiest.v)),
    el("div", "stat-delta", "week of " + formatDate(busiest.t))
  );
  stats.append(averageTile, busiestTile);
  card.append(stats);

  const frame = createPlotFrame({ label: spec.title });
  const ticks = buildTicks(Math.max(...weeks.map((week) => week.v)), "count");
  const top = ticks[ticks.length - 1].value;
  const scaleY = (v) => MARGIN.top + frame.innerHeight - (v / top) * frame.innerHeight;
  drawYAxis({ svg: frame.svg, ticks, scaleY, innerWidth: frame.innerWidth });

  const slot = frame.innerWidth / weeks.length;
  const thickness = Math.max(2, Math.min(BAR_MAX_THICKNESS, slot - BAR_GAP));
  const centerOf = (index) => MARGIN.left + slot * (index + 0.5);
  const baseline = MARGIN.top + frame.innerHeight;
  const bars = weeks.map((week, index) => {
    const height = Math.max(1, baseline - scaleY(week.v));
    const bar = svgEl("rect", {
      class: "bar", x: centerOf(index) - thickness / 2, y: scaleY(week.v),
      width: thickness, height, rx: Math.min(4, thickness / 2), fill: "var(--series-1)",
    });
    bar.style.transformOrigin = "bottom";
    bar.style.animationDelay = Math.min(300, index * 20) + "ms";
    frame.svg.append(bar);
    return bar;
  });

  const labelCount = Math.min(6, weeks.length);
  drawXLabels({
    svg: frame.svg,
    labels: Array.from({ length: labelCount }, (unused, index) => {
      const position = Math.round((index * (weeks.length - 1)) / Math.max(1, labelCount - 1));
      return { x: centerOf(position), text: formatDate(weeks[position].t) };
    }),
  });

  attachSelection({
    frame,
    count: weeks.length,
    positionOf: centerOf,
    onSelect: (index) => {
      for (const bar of bars) bar.dataset.active = "false";
      bars[index].dataset.active = "true";
      fillTooltip(frame.tooltip, {
        head: "Week of " + formatDate(weeks[index].t),
        rows: [{
          color: "var(--series-1)", shape: "rect",
          value: String(weeks[index].v), label: weeks[index].v === 1 ? "deploy" : "deploys",
        }],
      });
      placeTooltip({ wrapper: frame.wrapper, tooltip: frame.tooltip, plotX: centerOf(index) });
    },
    onClear: () => {
      for (const bar of bars) bar.dataset.active = "false";
    },
  });

  card.append(frame.wrapper);
  addTable(card, {
    columns: ["Week of", "Deploys"],
    rows: [...weeks].reverse().map((week) => [formatDate(week.t), String(week.v)]),
  });
  return card;
}

// ---------- hero ----------

function meter({ label, value, limit, unit, note }) {
  const group = el("div", "meter-group");
  const head = el("div", "meter-head");
  head.append(el("span", null, label), el("span", null, ((value / limit) * 100).toFixed(1) + "%"));
  const track = el("div", "meter");
  const fill = el("div", "meter-fill");
  track.append(fill);
  group.append(head, track, el("div", "stat-delta", note));
  requestAnimationFrame(() => {
    fill.style.width = Math.min(100, (value / limit) * 100) + "%";
  });
  return group;
}

function renderHero() {
  heroRoot.replaceChildren();
  const deploys = rowsInRange(history);
  const latest = [...deploys].reverse().find((row) => typeof row.gzipBytes === "number");

  if (!latest) {
    heroRoot.append(el("p", "empty", "No deploy metrics recorded yet."));
    return;
  }

  const figure = el("div", "hero-figure");
  figure.append(
    el("div", "stat-label", "Latest gzipped Worker upload"),
    el("div", "hero-value", formatBytes(latest.gzipBytes)),
    el("div", "stat-delta", describeRun(latest))
  );
  heroRoot.append(figure);

  heroRoot.append(meter({
    label: "Compressed size vs Workers limit",
    value: latest.gzipBytes,
    limit: WORKER_GZIP_LIMIT_BYTES,
    note: formatBytes(WORKER_GZIP_LIMIT_BYTES - latest.gzipBytes) + " of headroom under the 10 MiB limit",
  }));

  const latestStartup = [...deploys].reverse().find((row) => typeof row.startupActiveMs === "number");
  if (latestStartup) {
    heroRoot.append(meter({
      label: "Startup CPU vs 400ms budget",
      value: latestStartup.startupActiveMs,
      limit: STARTUP_CPU_LIMIT_MS,
      note: formatMs(STARTUP_CPU_LIMIT_MS - latestStartup.startupActiveMs) + " of headroom in the startup budget",
    }));
  }
}

// ---------- wiring ----------

const RENDERERS = {
  line: renderLineChart,
  delta: renderDeltaChart,
  movers: renderMoversChart,
  cadence: renderCadenceChart,
};

function render() {
  renderHero();
  zoomReset.hidden = zoom === null;
  if (zoom) {
    zoomReset.textContent = "Reset zoom · " + formatDate(zoom.start) + " – " + formatDate(zoom.end);
  }
  const rows = rowsInRange(history);
  const cards = CHARTS.map((spec) => (rows.length === 0 ? null : RENDERERS[spec.kind](spec, rows)))
    .filter(Boolean);
  chartsRoot.replaceChildren(...cards);
}

for (const button of document.querySelectorAll(".range")) {
  button.addEventListener("click", () => {
    rangeDays = Number(button.dataset.days);
    zoom = null;
    for (const other of document.querySelectorAll(".range")) {
      other.setAttribute("aria-pressed", String(other === button));
    }
    render();
  });
}

zoomReset.addEventListener("click", () => {
  zoom = null;
  render();
});

document.getElementById("theme-toggle").addEventListener("click", () => {
  const dark = document.documentElement.dataset.theme === "dark" ||
    (!document.documentElement.dataset.theme && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "light" : "dark";
});

render();
`;

const outputPath =
  process.argv[2] ?? path.join(METRICS_DIR, `${readProjectName()}-${REPORT_SUFFIX}.html`);
const history = readHistory(readCommitSubjects());

if (history.length === 0) {
  throw new Error(`No metrics history found in ${METRICS_DIR}/. Deploy at least once first.`);
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, renderDocument(history));

const withStartup = history.filter((row) => typeof row.startupActiveMs === "number").length;

console.log(
  `Wrote ${outputPath} (${history.length} deploys, ${withStartup} with startup profiles).`
);
