import { create } from 'zustand'

interface SessionState {
  activeSessions: { id: string; source: string; model: string; status: string }[]
  setActiveSessions: (sessions: SessionState['activeSessions']) => void
}

export const useSessionStore = create<SessionState>((set) => ({
  activeSessions: [],
  setActiveSessions: (sessions) => set({ activeSessions: sessions }),
}))
