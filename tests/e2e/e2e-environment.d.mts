export interface E2EEnvironment {
  baseUrl: string;
  previewLogFile: string;
  projectRoot: string;
  runtimeEnv: Record<string, string>;
  stateDir: string;
  tmpDir: string;
  prepareAndStart(): Promise<void>;
  registerSignalHandlers(): void;
  stopAll(): void;
}

export function scaleE2ETimeout(timeoutMs: number): number;

export function getE2EMaxWorkers(): number;

export function getE2ERuntimeEnv(): Record<string, string>;

export function createE2EEnvironment(): E2EEnvironment;
