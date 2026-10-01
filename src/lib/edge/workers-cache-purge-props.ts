// No imports: `worker-entrypoint.ts` reads this on every request, before the app.

/** The `ctx.props` that `purgeWorkersCacheTags` sets on its loopback call to the Worker. */
interface WorkersCachePurgeProps {
  workersCachePurge: true;
}

export const WORKERS_CACHE_PURGE_PROPS: WorkersCachePurgeProps = { workersCachePurge: true };

// An internet request cannot set `ctx.props`, so this marker is the route's whole authorization.
export function isWorkersCachePurgeLoopback(props: unknown): props is WorkersCachePurgeProps {
  return typeof props === "object"
    && props !== null
    && "workersCachePurge" in props
    && props.workersCachePurge === true;
}
