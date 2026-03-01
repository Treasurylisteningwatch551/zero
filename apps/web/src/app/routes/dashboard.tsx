import { SystemStatus } from '../components/dashboard/SystemStatus'
import { AttentionCard } from '../components/dashboard/AttentionCard'
import { ChannelStatus } from '../components/dashboard/ChannelStatus'
import { CostOverview } from '../components/dashboard/CostOverview'
import { ActiveSessions } from '../components/dashboard/ActiveSessions'
import { ActivityFeed } from '../components/dashboard/ActivityFeed'

export function DashboardPage() {
  return (
    <div>
      <SystemStatus />
      <div className="p-6 space-y-4 max-w-[1400px] mx-auto">
        <h1 className="text-[20px] font-bold tracking-tight">Dashboard</h1>
        <AttentionCard />
        <ChannelStatus />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <CostOverview />
          <ActiveSessions />
        </div>
        <ActivityFeed />
      </div>
    </div>
  )
}
