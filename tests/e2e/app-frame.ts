import { afterAll, afterEach } from "vitest";
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from "playwright";
import { getE2ERuntimeEnv, scaleE2ETimeout } from "./e2e-environment.mjs";

const e2eBaseUrl = getE2ERuntimeEnv().E2E_BASE_URL;
const navigationTimeoutMs = scaleE2ETimeout(8_000);
const navigationRetryDelayMs = 200;
const navigationRetryLimit = 5;
const expectationTimeoutMs = scaleE2ETimeout(5_000);
// Only a navigation changes the URL. A soft navigation after a server action also loads the target
// route's RSC payload and client chunks, so a URL wait gets the navigation budget.
const urlChangeTimeoutMs = navigationTimeoutMs;
const absentExpectationTimeoutMs = scaleE2ETimeout(1_500);
const pollIntervalMs = 50;
// A hint only, so not scaled: the value check after each fill is the real guard.
const idleWaitTimeoutMs = 250;

type AppRole = Parameters<Page["getByRole"]>[0];

let browser: Browser | undefined;
let appContext: BrowserContext | undefined;
let appPage: Page | undefined;
let appConsoleErrors: string[] = [];

async function getBrowser(): Promise<Browser> {
  browser ??= await chromium.launch({ headless: true });
  return browser;
}

function getAppPage(): Page {
  if (!appPage) {
    throw new Error("Call loadAppFrame before interacting with the app page.");
  }

  return appPage;
}

function trackAppPageErrors(page: Page): void {
  page.on("console", (message) => {
    if (message.type() !== "error") {
      return;
    }

    const location = message.location();
    const source = location.url
      ? `${location.url}:${location.lineNumber}:${location.columnNumber}`
      : page.url();

    appConsoleErrors.push(`[console.error] ${message.text()} (${source})`);
  });

  page.on("pageerror", (error) => {
    appConsoleErrors.push(`[pageerror] ${error.stack || error.message}`);
  });

  page.on("crash", () => {
    appConsoleErrors.push(`[pagecrash] ${page.url()}`);
  });
}

async function gotoAppPath({
  page,
  path,
}: {
  page: Page;
  path: string;
}): Promise<void> {
  const url = new URL(path, e2eBaseUrl).toString();

  for (let attempt = 0; attempt <= navigationRetryLimit; attempt++) {
    try {
      await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: navigationTimeoutMs,
      });

      return;
    } catch (error) {
      if (!isConnectionRefusedError(error) || attempt === navigationRetryLimit) {
        throw error;
      }

      await page.waitForTimeout(navigationRetryDelayMs);
    }
  }

  throw new Error("Unreachable navigation retry state.");
}

function isConnectionRefusedError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("ERR_CONNECTION_REFUSED");
}

interface LoadAppFrameOptions {
  // Waits for client fetches after load (see `SessionClientSync`). It does not prove hydration:
  // the click and fill helpers wait for React to own each element.
  waitForNetworkIdle?: boolean;
}

export async function loadAppFrame(
  path: string,
  options: LoadAppFrameOptions = {}
): Promise<void> {
  await appContext?.close();

  const activeBrowser = await getBrowser();
  appContext = await activeBrowser.newContext();
  appPage = await appContext.newPage();
  trackAppPageErrors(appPage);
  appPage.setDefaultTimeout(expectationTimeoutMs);
  appPage.setDefaultNavigationTimeout(navigationTimeoutMs);

  await gotoAppPath({ page: appPage, path });

  if (options.waitForNetworkIdle) {
    await appPage.waitForLoadState("networkidle", { timeout: navigationTimeoutMs });
  }
}

export async function navigateAppFrame(
  path: string,
  options: LoadAppFrameOptions = {}
): Promise<void> {
  await gotoAppPath({ page: getAppPage(), path });

  if (options.waitForNetworkIdle) {
    await getAppPage().waitForLoadState("networkidle", { timeout: navigationTimeoutMs });
  }
}

export async function clickAppRole(
  role: AppRole,
  name: string,
  options?: { exact?: boolean }
): Promise<void> {
  const target = getAppPage().getByRole(role, { name, exact: options?.exact }).first();
  // A click on server HTML does nothing or starts a native form submit.
  const timeoutAt = Date.now() + expectationTimeoutMs;
  await waitForReactOwnership({ target, timeoutAt });
  await target.click({ timeout: remainingMs(timeoutAt) });
}

export async function fillAppPlaceholder(placeholder: string, value: string): Promise<void> {
  await fillHydratedField({ field: getAppPage().getByPlaceholder(placeholder), value });
}

export async function fillAppLabel({
  label,
  value,
}: {
  label: string;
  value: string;
}): Promise<void> {
  await fillHydratedField({ field: getAppPage().getByLabel(label, { exact: true }), value });
}

export async function expectAppLabelValue({
  label,
  value,
}: {
  label: string;
  value: string;
}): Promise<void> {
  const input = getAppPage().getByLabel(label, { exact: true });
  await input.waitFor({ state: "visible", timeout: expectationTimeoutMs });

  const timeoutAt = Date.now() + expectationTimeoutMs;
  while (Date.now() < timeoutAt) {
    if ((await input.inputValue()) === value) {
      return;
    }

    await getAppPage().waitForTimeout(pollIntervalMs);
  }

  throw new Error(`Expected ${label} to have value ${value}`);
}

export async function expectAppRole(
  role: AppRole,
  name: string,
  options?: { exact?: boolean }
): Promise<void> {
  await getAppPage()
    .getByRole(role, { name, exact: options?.exact })
    .first()
    .waitFor({ state: "visible", timeout: expectationTimeoutMs });
}

export async function expectAppRoleText({
  exact,
  name,
  role,
  text,
}: {
  exact?: boolean;
  name: string;
  role: AppRole;
  text: string;
}): Promise<void> {
  await getAppPage()
    .getByRole(role, { name })
    .getByText(text, { exact })
    .first()
    .waitFor({ state: "visible", timeout: expectationTimeoutMs });
}

export async function expectAppText(
  text: string,
  options?: { exact?: boolean }
): Promise<void> {
  await getAppPage()
    .getByText(text, { exact: options?.exact })
    .filter({ visible: true })
    .first()
    .waitFor({ state: "visible", timeout: expectationTimeoutMs });
}

// Wait until at least `count` elements match `text`. Use when several fields share
// one central validation message, so a single `.first()` check can't prove each field
// rendered its own error.
export async function expectAppTextCount(
  text: string,
  count: number,
  options?: { exact?: boolean }
): Promise<void> {
  const matches = getAppPage().getByText(text, { exact: options?.exact });
  await matches.first().waitFor({ state: "visible", timeout: expectationTimeoutMs });

  const timeoutAt = Date.now() + expectationTimeoutMs;
  while (Date.now() < timeoutAt) {
    if ((await matches.count()) >= count) {
      return;
    }

    await getAppPage().waitForTimeout(pollIntervalMs);
  }

  throw new Error(`Expected at least ${count} elements matching "${text}"`);
}

export async function expectNoAppText(
  text: string,
  options?: { exact?: boolean }
): Promise<void> {
  await getAppPage()
    .getByText(text, { exact: options?.exact })
    .first()
    .waitFor({ state: "detached", timeout: absentExpectationTimeoutMs });
}

// Distinct from expectNoAppText on purpose: use this where the markup must stay in the document
// and only be hidden, like the server-rendered API reference under its client-side filter.
export async function expectAppTextHidden(
  text: string,
  options?: { exact?: boolean }
): Promise<void> {
  await getAppPage()
    .getByText(text, { exact: options?.exact })
    .first()
    .waitFor({ state: "hidden", timeout: absentExpectationTimeoutMs });
}

export async function expectAppToast(text: string): Promise<void> {
  await getAppPage()
    .locator("[data-sonner-toast]")
    .filter({ hasText: text })
    .first()
    .waitFor({ state: "visible", timeout: expectationTimeoutMs });
}

export async function expectNoAppToast(text: string): Promise<void> {
  await getAppPage()
    .locator("[data-sonner-toast]")
    .filter({ hasText: text })
    .first()
    .waitFor({ state: "detached", timeout: absentExpectationTimeoutMs });
}

export async function expectAppPathname(pathname: string): Promise<void> {
  await getAppPage().waitForURL((url) => url.pathname === pathname, {
    timeout: urlChangeTimeoutMs,
  });
}

export async function expectAppPathnameStartsWith(pathname: string): Promise<void> {
  await getAppPage().waitForURL((url) => url.pathname.startsWith(pathname), {
    timeout: urlChangeTimeoutMs,
  });
}

export async function expectAppPathnameNot(pathname: string): Promise<void> {
  await getAppPage().waitForURL((url) => url.pathname !== pathname, {
    timeout: urlChangeTimeoutMs,
  });
}

export function getAppCurrentPathname(): string {
  return new URL(getAppPage().url()).pathname;
}

export function getAppCurrentUrl(): string {
  return getAppPage().url();
}

/** The value of one cookie in the app page's browser context, or `undefined` when it is absent. */
export async function getAppCookie(name: string): Promise<string | undefined> {
  const cookies = await getAppPage().context().cookies();
  return cookies.find((cookie) => cookie.name === name)?.value;
}

export function fetchAppPath(path: string, init?: RequestInit): Promise<Response> {
  return fetch(new URL(path, e2eBaseUrl), init);
}

afterEach(async () => {
  if (appPage && !appPage.isClosed()) {
    await appPage.waitForTimeout(100);
  }

  const errors = [...appConsoleErrors];
  let closeError: unknown;

  if (appContext) {
    try {
      await appContext.close();
    } catch (error) {
      closeError = error;
    }
  }

  appContext = undefined;
  appPage = undefined;
  appConsoleErrors = [];

  if (closeError) {
    throw closeError instanceof Error ? closeError : new Error(String(closeError));
  }

  if (errors.length > 0) {
    throw new Error(`Browser console/page errors were emitted:\n${errors.join("\n")}`);
  }
});

afterAll(async () => {
  await appContext?.close();
  await browser?.close();
});

// Text typed into server HTML is cleared when React hydrates the field.
async function fillHydratedField({ field, value }: { field: Locator; value: string }): Promise<void> {
  const page = getAppPage();
  const timeoutAt = Date.now() + expectationTimeoutMs;

  while (Date.now() < timeoutAt) {
    await waitForReactOwnership({ target: field, timeoutAt });
    await field.fill(value, { timeout: remainingMs(timeoutAt) });
    await page.waitForTimeout(pollIntervalMs);

    // A hydration render that suspended can still commit now and clear the text, so fill again.
    // Only form controls have a `value` for React to reset. A rich-text editor owns its text,
    // so its DOM can differ from the typed text, and the check skips it.
    const keptValue = await field.evaluate(
      (node) => ("value" in node ? String(node.value) : null),
      undefined,
      { timeout: remainingMs(timeoutAt) }
    );
    if (keptValue === null || keptValue === value) {
      return;
    }
  }

  throw new Error("Expected a form field to keep its value after hydration");
}

// Vinext hydrates each route segment in its own React Activity after the root commits (see
// `BfcacheActivitySlotBoundary` in vinext/dist/shims/slot.js), so `networkidle` is not enough.
async function waitForReactOwnership({
  target,
  timeoutAt,
}: {
  target: Locator;
  timeoutAt: number;
}): Promise<void> {
  const page = getAppPage();

  while (Date.now() < timeoutAt) {
    // Reads the node again on each pass, so a node that React replaced is not a dead end.
    const isOwned = await target.evaluate(isOwnedByReact, undefined, {
      timeout: remainingMs(timeoutAt),
    });

    if (isOwned) {
      // React tags the node in the render phase, so an idle main thread usually shows the commit ran.
      await page.evaluate(
        (timeout) =>
          new Promise<void>((resolve) => {
            requestIdleCallback(() => resolve(), { timeout });
          }),
        idleWaitTimeoutMs
      );
      return;
    }

    await page.waitForTimeout(pollIntervalMs);
  }

  throw new Error(`Expected React to hydrate ${String(target)} before the test acts on it`);
}

// Runs in the browser. CMS HTML (`dangerouslySetInnerHTML`) and DOM that a library adds never get
// React keys, so they count as owned once the nearest React element that renders no children hydrates.
function isOwnedByReact(node: Element): boolean {
  for (let element: Element | null = node; element; element = element.parentElement) {
    const propsKey = Object.keys(element).find((key) => key.startsWith("__reactProps$"));
    if (propsKey) {
      const props = (element as unknown as Record<string, { children?: unknown }>)[propsKey];
      // React renders nothing for undefined, null, booleans, and arrays of only those.
      const rendersNoChildren = [props.children]
        .flat(Infinity)
        .every((child) => child === undefined || child === null || typeof child === "boolean");
      return element === node || rendersNoChildren;
    }
  }

  return false;
}

// One deadline per helper call: each Playwright step gets only the time that is left.
function remainingMs(timeoutAt: number): number {
  return Math.max(timeoutAt - Date.now(), pollIntervalMs);
}
