// Stands in for `cloudflare:workers` while the API app is imported outside workerd. Only module
// evaluation happens during generation — no handler runs — so nothing here is ever called.
export const env = new Proxy({}, { get: () => undefined });
export const waitUntil = () => {};

export class WorkerEntrypoint {}
export class DurableObject {}
export class RpcTarget {}

const workersRuntimeStub = { env, waitUntil, WorkerEntrypoint, DurableObject, RpcTarget };

export default workersRuntimeStub;
