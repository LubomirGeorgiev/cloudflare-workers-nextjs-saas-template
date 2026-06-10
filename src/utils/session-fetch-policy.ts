type SessionFetchReason =
  | "focus"
  | "initial"
  | "manual"
  | "mutation"
  | "visibility";

export interface FetchSessionOptions {
  reason?: SessionFetchReason;
}

interface SessionFetchReasonPolicy {
  passive: boolean;
  showLoading: boolean;
  refreshOnBoundaryChange: boolean;
}

export const SESSION_FETCH_REASON_POLICIES = {
  focus: {
    passive: true,
    showLoading: false,
    refreshOnBoundaryChange: true,
  },
  initial: {
    passive: false,
    showLoading: true,
    refreshOnBoundaryChange: false,
  },
  manual: {
    passive: false,
    showLoading: true,
    refreshOnBoundaryChange: false,
  },
  mutation: {
    passive: false,
    showLoading: true,
    refreshOnBoundaryChange: false,
  },
  visibility: {
    passive: true,
    showLoading: false,
    refreshOnBoundaryChange: true,
  },
} satisfies Record<SessionFetchReason, SessionFetchReasonPolicy>;

export function getSessionFetchPolicy(reason: SessionFetchReason) {
  return SESSION_FETCH_REASON_POLICIES[reason];
}

export function shouldFetchSession({
  hasHydratedSessionFromServer,
  lastFetched,
  reason,
}: {
  hasHydratedSessionFromServer: boolean;
  lastFetched: Date | null;
  reason: SessionFetchReason;
}) {
  if (reason === "initial" && lastFetched && !hasHydratedSessionFromServer) {
    return false;
  }

  return true;
}
