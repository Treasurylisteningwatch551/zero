import { create } from 'zustand'

export type ToastType = 'success' | 'error' | 'warning' | 'info'

export interface Toast {
  id: string
  type: ToastType
  message: string
  exiting?: boolean
}

interface UIState {
  chatDrawerOpen: boolean
  currentPage: string
  sidebarCollapsed: boolean
  selectedSessionId: string | null
  isMobile: boolean
  isTablet: boolean
  toasts: Toast[]
  toggleChatDrawer: () => void
  setCurrentPage: (page: string) => void
  toggleSidebar: () => void
  setSelectedSessionId: (id: string | null) => void
  setViewport: (width: number) => void
  addToast: (type: ToastType, message: string) => void
  removeToast: (id: string) => void
}

let toastCounter = 0

export const useUIStore = create<UIState>((set) => ({
  chatDrawerOpen: false,
  currentPage: 'dashboard',
  sidebarCollapsed: false,
  selectedSessionId: null,
  isMobile: typeof window !== 'undefined' ? window.innerWidth < 768 : false,
  isTablet:
    typeof window !== 'undefined' ? window.innerWidth >= 768 && window.innerWidth < 1024 : false,
  toasts: [],
  toggleChatDrawer: () => set((s) => ({ chatDrawerOpen: !s.chatDrawerOpen })),
  setCurrentPage: (page) => set({ currentPage: page }),
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setSelectedSessionId: (id) => set({ selectedSessionId: id }),
  setViewport: (width: number) =>
    set({
      isMobile: width < 768,
      isTablet: width >= 768 && width < 1024,
    }),
  addToast: (type, message) => {
    const id = `toast-${++toastCounter}`
    set((s) => ({ toasts: [...s.toasts, { id, type, message }] }))
    // Auto-dismiss after 4 seconds
    setTimeout(() => {
      set((s) => ({
        toasts: s.toasts.map((t) => (t.id === id ? { ...t, exiting: true } : t)),
      }))
      setTimeout(() => {
        set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
      }, 250)
    }, 4000)
  },
  removeToast: (id) => {
    set((s) => ({
      toasts: s.toasts.map((t) => (t.id === id ? { ...t, exiting: true } : t)),
    }))
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
    }, 250)
  },
}))
