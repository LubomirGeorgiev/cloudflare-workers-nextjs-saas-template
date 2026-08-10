// Renders every transactional email, in every locale in the catalog, to `.email-preview/` and
// serves it, so the templates can be eyeballed without sending anything. Outside production the
// send functions only log a URL, so this is the one way to see the markup a recipient gets.
//
// It serves its own output instead of opening `file://` URLs, because the emails point their logo
// at an absolute `SITE_URL`. From a `file://` page that is a cross-site no-cors `<img>`, which the
// vinext dev server blocks outright (`dist/server/dev-origin-check.js`). Serving the pages and
// `public/` from one origin makes the request same-origin and needs no dev server at all.
//
// The email module is imported outside workerd, which cannot provide `cloudflare:workers`. Only
// module evaluation happens here — `renderTransactionalEmail` reads no bindings — so the stubs in
// ./utils are enough, the same way `generate-openapi.mjs` loads the API app.
//
// `pnpm email:preview` serves and blocks until Ctrl-C; `--no-serve` only writes the files.
import { createReadStream } from "node:fs";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createServer } from "vite";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

const OUTPUT_DIR = ".email-preview";
const DEFAULT_PORT = 4477;

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

// Fixture data per template, keyed by the same `EMAIL_TEMPLATE_TYPES` values the queue sends.
// Deliberately awkward strings: an accented name and an ampersand prove the escaping still holds
// in the rendered page, which a preview of clean data would hide.
const PREVIEW_DATA = {
  PASSWORD_RESET: { resetToken: "preview-reset-token", username: "Ana Müller" },
  EMAIL_VERIFICATION: { verificationToken: "preview-verification-token", username: "Ana Müller" },
  TEAM_INVITATION: {
    invitationToken: "preview-invitation-token",
    inviterName: "Ana Müller",
    teamName: "Acme & Co",
  },
};

/**
 * Contact sheet: every rendered email in an iframe, so one scroll covers the whole matrix.
 * `escapeHtml` is the app's own helper, loaded through vite, so this page cannot drift from the
 * escaping the real templates apply.
 */
function renderIndex({ previews, siteUrl, served, escapeHtml }) {
  const cards = previews
    .map(({ htmlFile, textFile, template, locale, subject }) => {
      const heading = `${escapeHtml(template)} · ${escapeHtml(locale)}`;

      return [
        `    <section>`,
        `      <h2>${heading}</h2>`,
        `      <p class="subject">${escapeHtml(subject)}</p>`,
        // Eager on purpose: lazy frames below the fold stay blank in a full-page screenshot, and
        // six local files cost nothing to load at once.
        `      <iframe src="./${htmlFile}" title="${heading}"></iframe>`,
        `      <p class="links"><a href="./${htmlFile}">HTML</a> · <a href="./${textFile}">plain text</a></p>`,
        `    </section>`,
      ].join("\n");
    })
    .join("\n");

  const note = served
    ? `Rendered against <code>${escapeHtml(siteUrl)}</code>, which this preview also serves — the
       logo below comes from <code>public/</code>.`
    : `Rendered against <code>${escapeHtml(siteUrl)}</code>. Opened over <code>file://</code> the
       logo will not load, so every header falls back to its alt text.`;

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Transactional email preview</title>
    <style>
      body { margin: 0; padding: 24px; background: #eef1f5; font-family: system-ui, sans-serif; color: #1f2933; }
      h1 { font-size: 20px; margin: 0 0 4px; }
      .note { margin: 0 0 24px; font-size: 13px; color: #52606d; }
      .grid { display: grid; gap: 24px; grid-template-columns: repeat(auto-fit, minmax(360px, 1fr)); }
      section { background: #fff; border: 1px solid #d9e2ec; border-radius: 8px; padding: 16px; }
      h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .06em; margin: 0 0 4px; color: #52606d; }
      .subject { margin: 0 0 12px; font-size: 15px; font-weight: 600; }
      iframe { width: 100%; height: 620px; border: 1px solid #e4e9f0; border-radius: 4px; background: #f6f9fc; }
      .links { margin: 12px 0 0; font-size: 13px; }
    </style>
  </head>
  <body>
    <h1>Transactional email preview</h1>
    <p class="note">${note}</p>
    <div class="grid">
${cards}
    </div>
  </body>
</html>
`;
}

async function render({ outputDir, served }) {
  const server = await createServer({
    root,
    configFile: false,
    logLevel: "error",
    resolve: {
      alias: [
        { find: /^@\//, replacement: `${root}/src/` },
        { find: "cloudflare:workers", replacement: path.join(here, "utils/workers-runtime-stub.mjs") },
        { find: /^server-only$/, replacement: path.join(here, "utils/noop-module.mjs") },
      ],
    },
  });

  try {
    const [
      { renderTransactionalEmail },
      { EMAIL_TEMPLATE_TYPES },
      { LOCALES },
      { SITE_URL },
      { escapeHtml },
    ] = await Promise.all([
      server.ssrLoadModule("/src/utils/email.tsx"),
      server.ssrLoadModule("/src/lib/scheduler/jobs.ts"),
      server.ssrLoadModule("/src/i18n/config.ts"),
      server.ssrLoadModule("/src/constants.ts"),
      server.ssrLoadModule("/src/utils/escape-html.ts"),
    ]);

    // The full catalog, not ENABLED_LOCALES: email language follows the recipient's stored
    // preference, so a locale stays reachable by email while public routing is collapsed.
    const jobs = Object.entries(EMAIL_TEMPLATE_TYPES).flatMap(([key, template]) =>
      LOCALES.map((locale) => ({ key, template, locale }))
    );

    // Cleared first, so a renamed template or a dropped locale leaves no stale page behind.
    await rm(outputDir, { recursive: true, force: true });
    await mkdir(outputDir, { recursive: true });

    const previews = [];

    for (const { key, template, locale } of jobs) {
      const data = PREVIEW_DATA[key];

      if (!data) {
        throw new Error(`No preview fixture for ${template} — add one to PREVIEW_DATA.`);
      }

      const rendered = await renderTransactionalEmail({
        to: "preview@example.com",
        template,
        locale,
        data,
      });

      const htmlFile = `${template}-${locale}.html`;
      const textFile = `${template}-${locale}.txt`;

      await writeFile(path.join(outputDir, htmlFile), rendered.html, "utf8");
      await writeFile(path.join(outputDir, textFile), rendered.text, "utf8");

      previews.push({ htmlFile, textFile, template, locale, subject: rendered.subject });
    }

    await writeFile(
      path.join(outputDir, "index.html"),
      renderIndex({ previews, siteUrl: SITE_URL, served, escapeHtml }),
      "utf8"
    );

    return previews.length;
  } finally {
    await server.close();
  }
}

/** Resolves a request path inside `directory`, or null when it escapes or is not a file. */
async function resolveFile({ directory, pathname }) {
  const candidate = path.join(directory, path.normalize(pathname));

  if (candidate !== directory && !candidate.startsWith(`${directory}${path.sep}`)) {
    return null;
  }

  try {
    return (await stat(candidate)).isFile() ? candidate : null;
  } catch {
    return null;
  }
}

/**
 * Serves the rendered pages, falling back to `public/` so the absolute logo URL in each email
 * resolves against this same origin. Same-origin is the whole point: it is what keeps the browser
 * from labelling the <img> a cross-site no-cors request.
 */
function serve({ outputDir, port }) {
  const directories = [outputDir, path.join(root, "public")];

  const httpServer = createHttpServer(async (request, response) => {
    const { pathname } = new URL(request.url, `http://localhost:${port}`);
    const requested = pathname === "/" ? "/index.html" : decodeURIComponent(pathname);

    for (const directory of directories) {
      const file = await resolveFile({ directory, pathname: requested });

      if (file) {
        response.writeHead(200, {
          "content-type": CONTENT_TYPES[path.extname(file)] ?? "application/octet-stream",
          "cache-control": "no-store",
        });
        createReadStream(file).pipe(response);

        return;
      }
    }

    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end(`Not found: ${requested}\n`);
  });

  return new Promise((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(port, "127.0.0.1", () => resolve(httpServer));
  });
}

async function main() {
  const served = !process.argv.includes("--no-serve");
  const port = Number(process.env.EMAIL_PREVIEW_PORT ?? DEFAULT_PORT);
  const outputDir = path.join(root, OUTPUT_DIR);

  // Read at module-eval time by `src/constants.ts`, so it has to be set before the render loads it.
  // Only when serving, and never over an explicit value: the hostname also reaches the copy through
  // SITE_DOMAIN, and a scheme without one (file://) renders every `{siteDomain}` blank.
  if (served && !process.env.NEXT_PUBLIC_SITE_URL) {
    process.env.NEXT_PUBLIC_SITE_URL = `http://localhost:${port}`;
  }

  const count = await render({ outputDir, served });

  if (!served) {
    process.stdout.write(`${count} emails rendered\n${OUTPUT_DIR}/index.html\n`);

    return;
  }

  await serve({ outputDir, port });
  process.stdout.write(`${count} emails rendered\nhttp://localhost:${port}\nCtrl-C to stop\n`);
}

try {
  await main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
