import { ChatCircle, Gauge, ClockCounterClockwise, Brain, ClipboardText, Terminal, Gear, ChartBar, Wrench, List } from '@phosphor-icons/react'
import { useUIStore } from '../../stores/ui'
import { useNavigate, useLocation } from '@tanstack/react-router'

const navItems = [
  { name: 'Dashboard', icon: Gauge, path: '/' },
  { name: 'Sessions', icon: ClockCounterClockwise, path: '/sessions' },
  { name: 'Memory', icon: Brain, path: '/memory' },
  { name: 'Memo', icon: ClipboardText, path: '/memo' },
  { name: 'Tools', icon: Wrench, path: '/tools' },
  { name: 'Logs', icon: Terminal, path: '/logs' },
  { name: 'Config', icon: Gear, path: '/config' },
  { name: 'Metrics', icon: ChartBar, path: '/metrics' },
]

interface SidebarProps {
  collapsed?: boolean
}

export function Sidebar({ collapsed = false }: SidebarProps) {
  const { toggleChatDrawer, toggleSidebar, sidebarCollapsed } = useUIStore()
  const navigate = useNavigate()
  const location = useLocation()

  const isCollapsed = collapsed || sidebarCollapsed
  const width = isCollapsed ? 44 : 220

  return (
    <aside
      className="fixed left-0 top-0 h-full flex flex-col bg-[var(--color-main-bg)] border-r border-[var(--color-border)] z-40 transition-[width] duration-200"
      style={{ width }}
    >
      {/* Logo / hamburger */}
      <div className={`flex items-center ${isCollapsed ? 'justify-center py-3' : 'px-5 py-5'}`}>
        {isCollapsed ? (
          <button
            onClick={toggleSidebar}
            className="p-1 rounded-md hover:bg-white/[0.05] text-[var(--color-text-muted)]"
          >
            <List size={20} />
          </button>
        ) : (
          <span className="text-[14px] font-bold tracking-tight text-[var(--color-text-primary)]">
            ZeRo
          </span>
        )}
      </div>

      {/* Navigation */}
      <nav className={`flex-1 ${isCollapsed ? 'px-1' : 'px-3'} space-y-0.5`}>
        {navItems.map((item) => {
          const isActive = location.pathname === item.path ||
            (item.path !== '/' && location.pathname.startsWith(item.path + '/'))
          return (
            <button
              key={item.path}
              onClick={() => navigate({ to: item.path })}
              title={isCollapsed ? item.name : undefined}
              className={`w-full flex items-center ${isCollapsed ? 'justify-center px-0 py-2' : 'gap-3 px-3 py-2'} rounded-lg text-[13px] transition-colors ${
                isActive
                  ? 'text-[var(--color-text-primary)] bg-[var(--color-accent-glow)] border-l-2 border-[var(--color-accent)]'
                  : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-white/[0.03]'
              }`}
            >
              <item.icon size={18} weight={isActive ? 'fill' : 'regular'} />
              {!isCollapsed && item.name}
            </button>
          )
        })}
      </nav>

      {/* Bottom section: status + chat button */}
      <div className={`${isCollapsed ? 'px-1' : 'px-4'} py-4 space-y-3 border-t border-[var(--color-border)]`}>
        {!isCollapsed && (
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-[var(--color-success)] pulse-active" />
              <span className="text-[11px] text-[var(--color-text-secondary)]">Running</span>
            </div>
            <p className="text-[11px] font-mono text-[var(--color-text-muted)]">gpt-5.3-codex-medium</p>
            <p className="text-[11px] font-mono text-[var(--color-text-disabled)]">v0.1 stable</p>
          </div>
        )}

        <button
          onClick={toggleChatDrawer}
          title={isCollapsed ? 'Chat' : undefined}
          className={`w-full flex items-center justify-center gap-2 py-2 rounded-lg border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] hover:border-[var(--color-border-hover)] transition-colors`}
        >
          <ChatCircle size={18} />
          {!isCollapsed && <span className="text-[12px]">Chat</span>}
        </button>
      </div>
    </aside>
  )
}
