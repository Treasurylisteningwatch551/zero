import { SystemStatus } from '../components/dashboard/SystemStatus'
import { CostOverview } from '../components/dashboard/CostOverview'
import { ActivityFeed } from '../components/dashboard/ActivityFeed'

export function DashboardPage() {
  return (
    <div>
      <SystemStatus />

      <div className="p-6 space-y-4 max-w-[1400px] mx-auto">
        <h1 className="text-[20px] font-bold tracking-tight">Dashboard</h1>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <CostOverview />
          <ActivityFeed />
        </div>

        {/* Empty state */}
        <div className="card p-8 text-center animate-fade-up" style={{ animationDelay: '300ms' }}>
          <h2 className="text-[16px] font-semibold mb-2 text-[var(--color-text-primary)]">
            ZeRo OS Ready
          </h2>
          <p className="text-[13px] text-[var(--color-text-muted)] max-w-md mx-auto">
            Send a message via the Chat Drawer, Feishu, or Telegram to start your first session.
            Or configure scheduled tasks in Config.
          </p>
        </div>
      </div>
    </div>
  )
}
