import type { SessionValidationResult } from '@/types';
import { create } from 'zustand'
import { combine } from 'zustand/middleware'
import type { KVSession } from '@/utils/kv-session';

// Team member type extracted from KVSession for type safety
type TeamMember = NonNullable<KVSession['teams']>[number];

interface SessionState {
  session: SessionValidationResult | null;
  isLoading: boolean;
  lastFetched: Date | null;
  hasHydratedSessionFromServer: boolean;
}

interface SessionActions {
  setSession: (session: SessionValidationResult | null) => void;
  hydrateSessionFromServer: (session: SessionValidationResult) => void;
  clearSession: () => void;
  refetchSession: () => void;
  setSelectedTeam: (teamId: string | undefined) => void;

  // Team related selectors
  teams: () => KVSession['teams'] | undefined;
  selectedTeam: () => string | undefined;
  isTeamMember: (teamId: string) => boolean;
  hasTeamRole: (teamId: string, roleId: string, isSystemRole?: boolean) => boolean;
  hasTeamPermission: (teamId: string, permission: string) => boolean;
  getTeam: (teamId: string) => TeamMember | undefined;
}

function getLoadedSessionState(session: SessionValidationResult | null) {
  return {
    session,
    isLoading: false,
    lastFetched: new Date(),
  };
}

export const useSessionStore = create(
  combine(
    {
      session: null as SessionValidationResult | null,
      isLoading: true,
      lastFetched: null as Date | null,
      hasHydratedSessionFromServer: false,
    } as SessionState,
    (set, get) => ({
      setSession: (session: SessionValidationResult | null) => set(getLoadedSessionState(session)),
      hydrateSessionFromServer: (session: SessionValidationResult) => set({
        ...getLoadedSessionState(session),
        hasHydratedSessionFromServer: true,
      }),
      clearSession: () => set({
        session: null,
        isLoading: false,
        lastFetched: null,
        hasHydratedSessionFromServer: false,
      }),
      refetchSession: () => set({ isLoading: true }),

      setSelectedTeam: (teamId: string | undefined) => {
        const currentSession = get().session;
        if (currentSession) {
          set({
            session: {
              ...currentSession,
              selectedTeam: teamId,
            }
          });
        }
      },

      // Team related selectors
      teams: () => get().session?.teams,

      selectedTeam: () => get().session?.selectedTeam,

      isTeamMember: (teamId: string) => {
        return !!get().session?.teams?.some(team => team.id === teamId);
      },

      hasTeamRole: (teamId: string, roleId: string, isSystemRole: boolean = false) => {
        const team = get().session?.teams?.find(t => t.id === teamId);
        if (!team) return false;

        if (isSystemRole) {
          return team.role.isSystemRole && team.role.id === roleId;
        }

        return !team.role.isSystemRole && team.role.id === roleId;
      },

      hasTeamPermission: (teamId: string, permission: string) => {
        const team = get().session?.teams?.find(t => t.id === teamId);
        if (!team) return false;

        return team.permissions.includes(permission);
      },

      getTeam: (teamId: string) => {
        return get().session?.teams?.find(t => t.id === teamId);
      }
    } as SessionActions)
  )
)
