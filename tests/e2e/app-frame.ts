import { afterAll, afterEach } from "vitest";
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
  type Request,
} from "playwright";
import { getE2ERuntimeEnv, scaleE2ETimeout } from "./e2e-environment.mjs";

const e2eBaseUrl = getE2ERuntimeEnv().E2E_BASE_URL;
const navigationTimeoutMs = scaleE2ETimeout(8_000);
const navigationRetryDelayMs = 200;
const navigationRetryLimit = 5;
const expectationTimeoutMs = scaleE2ETimeout(5_000);
const absentExpectationTimeoutMs = scaleE2ETimeout(1_500);
const pollIntervalMs = 50;
// A hint only, so not scaled: the value check after each fill is the real guard.
const idleWaitTimeoutMs = 250;

type AppRole = Parameters<Page["getByRole"]>[0];

let browser: Browser | undefined;
let appContext: BrowserContext | undefined;
let appPage: Page | undefined;
let appConsoleErrors: string[] = [];
let appRequestUrls: string[] = [];
let appScriptsDisabled = false;

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

interface NavigateAppFrameOptions {
  waitForHydration?: boolean;
}

interface LoadAppFrameOptions extends NavigateAppFrameOptions {
  // Keeps the page in its server-rendered state, which is what a user sees before hydration.
  scriptsDisabled?: boolean;
}

export async function loadAppFrame(
  path: string,
  options: LoadAppFrameOptions = {}
): Promise<void> {
  await appContext?.close();

  const activeBrowser = await getBrowser();
  appScriptsDisabled = options.scriptsDisabled === true;
  appRequestUrls = [];
  appContext = await activeBrowser.newContext({ javaScriptEnabled: !appScriptsDisabled });
  appPage = await appContext.newPage();
  trackAppPageErrors(appPage);
  appPage.on("request", (request) => {
    appRequestUrls.push(request.url());
  });
  appPage.setDefaultTimeout(expectationTimeoutMs);
  appPage.setDefaultNavigationTimeout(navigationTimeoutMs);

  await gotoAppPath({ page: appPage, path });

  if (options.waitForHydration) {
    await appPage.waitForLoadState("networkidle", { timeout: navigationTimeoutMs });
  }
}

export async function navigateAppFrame(
  path: string,
  options: NavigateAppFrameOptions = {}
): Promise<void> {
  await gotoAppPath({ page: getAppPage(), path });

  if (options.waitForHydration) {
    await getAppPage().waitForLoadState("networkidle", { timeout: navigationTimeoutMs });
  }
}

export async function clickAppRole(
  role: AppRole,
  name: string,
  options?: { exact?: boolean }
): Promise<void> {
  await getAppPage().getByRole(role, { name, exact: options?.exact }).first().click();
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
    timeout: expectationTimeoutMs,
  });
}

export async function expectAppPathnameStartsWith(pathname: string): Promise<void> {
  await getAppPage().waitForURL((url) => url.pathname.startsWith(pathname), {
    timeout: expectationTimeoutMs,
  });
}

export async function expectAppPathnameNot(pathname: string): Promise<void> {
  await getAppPage().waitForURL((url) => url.pathname !== pathname, {
    timeout: expectationTimeoutMs,
  });
}

export function getAppCurrentPathname(): string {
  return new URL(getAppPage().url()).pathname;
}

export function getAppCurrentUrl(): string {
  return getAppPage().url();
}

/** Every URL the app page requested since the last loadAppFrame, redirects included. */
export function getAppRequestUrls(): string[] {
  return [...appRequestUrls];
}

/** Clicks a button that starts a full page navigation, waits until the new page loads, and returns the request. */
export async function clickAppRoleAndWaitForNavigation({
  role,
  name,
}: {
  role: AppRole;
  name: string;
}): Promise<Request> {
  const page = getAppPage();
  const mainFrame = page.mainFrame();
  const navigationRequest = page.waitForRequest(
    (request) => request.isNavigationRequest() && request.frame() === mainFrame,
    { timeout: navigationTimeoutMs }
  );
  // The old page is already loaded, so wait for the new document before the load state.
  const navigated = page.waitForEvent("framenavigated", {
    predicate: (frame) => frame === mainFrame,
    timeout: navigationTimeoutMs,
  });

  await page.getByRole(role, { name, exact: true }).first().click();
  const [request] = await Promise.all([navigationRequest, navigated]);
  await page.waitForLoadState("load", { timeout: navigationTimeoutMs });

  return request;
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
  appRequestUrls = [];
  appScriptsDisabled = false;

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

// Vinext hydrates each route segment in its own React Activity after the root commits (see
// `BfcacheActivitySlotBoundary` in vinext/dist/shims/slot.js). Text typed before that is cleared.
async function fillHydratedField({ field, value }: { field: Locator; value: string }): Promise<void> {
  const page = getAppPage();
  const timeoutAt = Date.now() + expectationTimeoutMs;

  // Without scripts React never owns the field, so the server HTML keeps the typed text.
  if (appScriptsDisabled) {
    await field.fill(value);
    return;
  }

  while (Date.now() < timeoutAt) {
    // Reads the node again on each pass, so a node that React replaced is not a dead end.
    const isHydrated = await field.evaluate(
      (node) => Object.keys(node).some((key) => key.startsWith("__reactProps$")),
      undefined,
      { timeout: expectationTimeoutMs }
    );

    if (isHydrated) {
      // React tags the node in the render phase, so an idle main thread usually shows the commit ran.
      await page.evaluate(
        (timeout) =>
          new Promise<void>((resolve) => {
            requestIdleCallback(() => resolve(), { timeout });
          }),
        idleWaitTimeoutMs
      );
      await field.fill(value);
      await page.waitForTimeout(pollIntervalMs);

      // A hydration render that suspended can still commit now and clear the text, so fill again.
      // Only form controls have a `value` for React to reset. A rich-text editor owns its text,
      // so its DOM can differ from the typed text, and the check skips it.
      const keptValue = await field.evaluate((node) => ("value" in node ? String(node.value) : null));
      if (keptValue === null || keptValue === value) {
        return;
      }
    } else {
      await page.waitForTimeout(pollIntervalMs);
    }
  }

  throw new Error("Expected a form field to keep its value after hydration");
}
