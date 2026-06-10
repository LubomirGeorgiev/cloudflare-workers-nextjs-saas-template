interface RefreshableRouter {
  refresh: () => void;
}

interface PatchRouterRefreshForLoaderOptions {
  router: RefreshableRouter;
  start: () => void;
}

export function patchRouterRefreshForLoader({
  router,
  start,
}: PatchRouterRefreshForLoaderOptions) {
  const originalRefresh = router.refresh;

  router.refresh = () => {
    start();
    originalRefresh.call(router);
  };

  return function restoreRouterRefresh() {
    router.refresh = originalRefresh;
  };
}
