import { createE2EEnvironment } from "./e2e-environment.mjs";

export default async function setupE2EPreview(): Promise<() => void> {
  const e2eEnvironment = createE2EEnvironment();

  e2eEnvironment.registerSignalHandlers();
  await e2eEnvironment.prepareAndStart();

  return () => {
    e2eEnvironment.stopAll();
  };
}
