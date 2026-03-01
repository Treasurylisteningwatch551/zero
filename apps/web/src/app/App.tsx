import { Sidebar } from './components/layout/Sidebar'
import { ChatDrawer } from './components/layout/ChatDrawer'
import { DashboardPage } from './routes/dashboard'
import { SessionsPage } from './routes/sessions'
import { SessionDetailPage } from './routes/session-detail'
import { MemoryPage } from './routes/memory'
import { MemoPage } from './routes/memo'
import { ToolsPage } from './routes/tools'
import { LogsPage } from './routes/logs'
import { ConfigPage } from './routes/config'
import { MetricsPage } from './routes/metrics'
import { useUIStore } from './stores/ui'

const pages: Record<string, () => JSX.Element> = {
  dashboard: DashboardPage,
  sessions: SessionsPage,
  'session-detail': SessionDetailPage,
  memory: MemoryPage,
  memo: MemoPage,
  tools: ToolsPage,
  logs: LogsPage,
  config: ConfigPage,
  metrics: MetricsPage,
}

export function App() {
  const { currentPage } = useUIStore()
  const PageComponent = pages[currentPage] ?? DashboardPage

  return (
    <div className="min-h-screen">
      <Sidebar />

      {/* Main content area */}
      <main className="ml-[220px]">
        <PageComponent />
      </main>

      {/* Chat drawer overlay */}
      <ChatDrawer />
    </div>
  )
}
