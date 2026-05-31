interface ShouldLogD1QueriesParams {
  appTestMode: string | undefined;
}

export function shouldLogD1Queries({ appTestMode }: ShouldLogD1QueriesParams): boolean {
  return appTestMode !== "true";
}
