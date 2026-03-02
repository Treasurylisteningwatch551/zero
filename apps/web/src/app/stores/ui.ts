import { create } from 'zustand'

interface UIState {
  chatDrawerOpen: boolean
  currentPage: string
  sidebarCollapsed: boolean
  selectedSessionId: string | null
  isMobile: boolean
  isTablet: boolean
  toggleChatDrawer: () => void
  setCurrentPage: (page: string) => void
  toggleSidebar: () => void
  setSelectedSessionId: (id: string | null) => void
  setViewport: (width: number) => void
}

export const useUIStore = create<UIState>((set) => ({
  chatDrawerOpen: false,
  currentPage: 'dashboard',
  sidebarCollapsed: false,
  selectedSessionId: null,
  isMobile: typeof window !== 'undefined' ? window.innerWidth < 768 : false,
  isTablet: typeof window !== 'undefined' ? window.innerWidth >= 768 && window.innerWidth < 1024 : false,
  toggleChatDrawer: () => set((s) => ({ chatDrawerOpen: !s.chatDrawerOpen })),
  setCurrentPage: (page) => set({ currentPage: page }),
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setSelectedSessionId: (id) => set({ selectedSessionId: id }),
  setViewport: (width: number) => set({
    isMobile: width < 768,
    isTablet: width >= 768 && width < 1024,
  }),
}))
