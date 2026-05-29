import { afterAll, afterEach } from "vitest";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { getE2ERuntimeEnv } from "./e2e-environment.mjs";

const e2eBaseUrl = getE2ERuntimeEnv().E2E_BASE_URL;
const navigationTimeoutMs = 8_000;
const navigationRetryDelayMs = 200;
const navigationRetryLimit = 5;
const expectationTimeoutMs = 5_000;
const absentExpectationTimeoutMs = 1_500;
const pollIntervalMs = 50;

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
  waitForHydration?: boolean;
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

  if (options.waitForHydration) {
    await appPage.waitForLoadState("networkidle", { timeout: navigationTimeoutMs });
  }
}

export async function navigateAppFrame(
  path: string,
  options: LoadAppFrameOptions = {}
): Promise<void> {
  await gotoAppPath({ page: getAppPage(), path });

  if (options.waitForHydration) {
    await getAppPage().waitForLoadState("networkidle", { timeout: navigationTimeoutMs });
  }
}

export async function clickAppRole(
  role: string,
  name: string,
  options?: { exact?: boolean }
): Promise<void> {
  await getAppPage().getByRole(role as never, { name, exact: options?.exact }).first().click();
}

export async function fillAppPlaceholder(placeholder: string, value: string): Promise<void> {
  await getAppPage().getByPlaceholder(placeholder).fill(value);
}

export async function fillAppLabel({
  label,
  value,
}: {
  label: string;
  value: string;
}): Promise<void> {
  await getAppPage().getByLabel(label, { exact: true }).fill(value);
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
  role: string,
  name: string,
  options?: { exact?: boolean }
): Promise<void> {
  await getAppPage()
    .getByRole(role as never, { name, exact: options?.exact })
    .first()
    .waitFor({ state: "visible", timeout: expectationTimeoutMs });
}

export async function expectAppText(
  text: string,
  options?: { exact?: boolean }
): Promise<void> {
  await getAppPage()
    .getByText(text, { exact: options?.exact })
    .first()
    .waitFor({ state: "visible", timeout: expectationTimeoutMs });
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

export function fetchAppPath(path: string, init?: RequestInit): Promise<Response> {
  return fetch(new URL(path, e2eBaseUrl), init);
}

export async function reloadAppFrame(): Promise<void> {
  await getAppPage().reload({ waitUntil: "networkidle", timeout: navigationTimeoutMs });
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
    throw closeError;
  }

  if (errors.length > 0) {
    throw new Error(`Browser console/page errors were emitted:\n${errors.join("\n")}`);
  }
});

afterAll(async () => {
  await appContext?.close();
  await browser?.close();
});
