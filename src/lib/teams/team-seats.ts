import { LIMIT_SOURCES, type LimitSource } from "@/constants/limit-overrides";
import type { ActionErrorMessageKey } from "@/lib/action-error";

// JS form of `withinSeatCap` (src/lib/teams/team-writes.ts), for the seat counter and the invite dialog.
export function getTeamSeatUsage({
  activeMembers,
  pendingInvitations,
  seats,
  limitSource,
}: {
  activeMembers: number;
  pendingInvitations: number;
  seats: number;
  limitSource: LimitSource;
}) {
  const used = activeMembers + pendingInvitations;
  // Only the copy goes to the browser: the source would tell the customer about a hidden override.
  const { noticeKey, offersUpgrade } = selectSeatLimitCopy(limitSource);

  return {
    activeMembers,
    pendingInvitations,
    used,
    limit: seats,
    isFull: used >= seats,
    noticeKey,
    offersUpgrade,
  };
}

/** The seat refusal and notice for a seat limit from `limitSource`. A key name must not reveal a hidden override. */
export function selectSeatLimitCopy(limitSource: LimitSource): SeatLimitCopy {
  return SEAT_LIMIT_COPY[limitSource];
}

// A staff override does not grow with the plan, so only the plan copy tells the owner to upgrade.
const SEAT_LIMIT_COPY: Record<LimitSource, SeatLimitCopy> = {
  [LIMIT_SOURCES.PLAN]: {
    refusalKey: "Client.Dashboard.Teams.seatLimitReached",
    noticeKey: "seatLimitNotice",
    offersUpgrade: true,
  },
  [LIMIT_SOURCES.CUSTOM]: {
    refusalKey: "Client.Dashboard.Teams.seatLimitReachedCustom",
    noticeKey: "seatLimitNoticeCustom",
    offersUpgrade: false,
  },
  [LIMIT_SOURCES.HIDDEN_CUSTOM]: {
    refusalKey: "Client.Dashboard.Teams.seatLimitReachedContact",
    noticeKey: "seatLimitNoticeContact",
    offersUpgrade: false,
  },
};

interface SeatLimitCopy {
  /** The ActionError key of the invite refusal. It takes `{ seats }`. */
  refusalKey: ActionErrorMessageKey;
  /** The invite dialog notice in `Client.Dashboard.Teams`. It takes `{ used, limit, pending }`. */
  noticeKey: SeatLimitNoticeKey;
  /** True: the dialog may link to the billing page to upgrade. */
  offersUpgrade: boolean;
}

type SeatLimitNoticeKey = "seatLimitNotice" | "seatLimitNoticeCustom" | "seatLimitNoticeContact";

export type TeamSeatUsage = ReturnType<typeof getTeamSeatUsage>;
