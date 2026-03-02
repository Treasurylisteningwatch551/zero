import {
  createRouter,
  createRootRoute,
  createRoute,
  Outlet,
} from '@tanstack/react-router'
import { RootLayout } from './RootLayout'
import { DashboardPage } from './routes/dashboard'
import { SessionsPage } from './routes/sessions'
import { SessionDetailPage } from './routes/session-detail'
import { MemoryPage } from './routes/memory'
import { MemoPage } from './routes/memo'
import { ToolsPage } from './routes/tools'
import { LogsPage } from './routes/logs'
import { ConfigPage } from './routes/config'
import { MetricsPage } from './routes/metrics'

const rootRoute = createRootRoute({
  component: RootLayout,
})

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: DashboardPage,
})

const sessionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/sessions',
  component: SessionsPage,
})

const sessionDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/sessions/$id',
  component: SessionDetailPage,
})

const memoryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/memory',
  component: MemoryPage,
})

const memoRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/memo',
  component: MemoPage,
})

const toolsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/tools',
  component: ToolsPage,
})

const logsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/logs',
  component: LogsPage,
})

const configRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/config',
  component: ConfigPage,
})

const metricsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/metrics',
  component: MetricsPage,
})

const routeTree = rootRoute.addChildren([
  indexRoute,
  sessionsRoute,
  sessionDetailRoute,
  memoryRoute,
  memoRoute,
  toolsRoute,
  logsRoute,
  configRoute,
  metricsRoute,
])

export const router = createRouter({ routeTree })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
