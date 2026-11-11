// JS form of `withinSeatCap` (src/lib/teams/team-writes.ts), for the seat counter and the invite dialog.
export function getTeamSeatUsage({
  activeMembers,
  pendingInvitations,
  seats,
}: {
  activeMembers: number;
  pendingInvitations: number;
  seats: number;
}) {
  const used = activeMembers + pendingInvitations;

  return {
    activeMembers,
    pendingInvitations,
    used,
    limit: seats,
    isFull: used >= seats,
  };
}

export type TeamSeatUsage = ReturnType<typeof getTeamSeatUsage>;
