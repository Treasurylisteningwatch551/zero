import { create } from 'zustand'

interface UIState {
  chatDrawerOpen: boolean
  currentPage: string
  sidebarCollapsed: boolean
  selectedSessionId: string | null
  toggleChatDrawer: () => void
  setCurrentPage: (page: string) => void
  toggleSidebar: () => void
  setSelectedSessionId: (id: string | null) => void
}

export const useUIStore = create<UIState>((set) => ({
  chatDrawerOpen: false,
  currentPage: 'dashboard',
  sidebarCollapsed: false,
  selectedSessionId: null,
  toggleChatDrawer: () => set((s) => ({ chatDrawerOpen: !s.chatDrawerOpen })),
  setCurrentPage: (page) => set({ currentPage: page }),
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setSelectedSessionId: (id) => set({ selectedSessionId: id }),
}))
