import { useCallback, useEffect, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { apiFetch } from '../lib/api'
import { formatCost, formatNumber } from '../lib/format'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Tab = 'cost' | 'operations' | 'health'
type TimeRange = '7d' | '30d' | '90d' | 'custom'

interface CostByDay {
  period: string
  totalCost: number
  totalTokens: number
}
interface CostByModel {
  model: string
  provider: string
  totalCost: number
  totalInput: number
  totalOutput: number
  requestCount: number
}
interface CostByDayModel {
  period: string
  model: string
  cost: number
}
interface CostDetail {
  date: string
  model: string
  input: number
  output: number
  cacheRead: number
  cost: number
}
interface CacheHitRate {
  period: string
  hitRate: number
}
interface ToolStat {
  tool: string
  count: number
  successRate: number
  avgDurationMs: number
}
interface TaskSuccess {
  period: string
  successRate: number
  total: number
}
interface AvgDuration {
  period: string
  avgMs: number
}
interface ToolErrorByDay {
  period: string
  tool: string
  total: number
  errors: number
}
interface HealthData {
  repairs: { total: number; successCount: number; successRate: number }
  repairTrend: { period: string; total: number; success: number }[]
}
interface LogEntry {
  ts: string
  event?: string
  [key: string]: unknown
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MODEL_COLORS = [
  '#22d3ee',
  '#06b6d4',
  '#0891b2',
  '#0e7490',
  '#155e75',
  '#164e63',
  '#083344',
  '#67e8f9',
]
const CHART_GRID = 'rgba(255, 255, 255, 0.05)'
const CHART_TEXT = 'rgba(255, 255, 255, 0.4)'
const TOOLTIP_STYLE = {
  contentStyle: {
    background: '#1a1a2e',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 8,
    fontSize: 12,
  },
  labelStyle: { color: 'rgba(255,255,255,0.6)' },
}

const TABS: { key: Tab; label: string }[] = [
  { key: 'cost', label: 'Cost' },
  { key: 'operations', label: 'Operations' },
  { key: 'health', label: 'Health' },
]

const RANGES: TimeRange[] = ['7d', '30d', '90d', 'custom']

// ---------------------------------------------------------------------------
// Shared UI helpers
// ---------------------------------------------------------------------------

function ChartCard({
  title,
  delay = 0,
  children,
}: { title: string; delay?: number; children: React.ReactNode }) {
  return (
    <div className="card p-5 animate-fade-up" style={{ animationDelay: `${delay}ms` }}>
      <h3 className="text-[14px] font-semibold mb-3 text-[var(--color-text-secondary)]">{title}</h3>
      {children}
    </div>
  )
}

function ChartEmpty({ loading, message = 'No data' }: { loading: boolean; message?: string }) {
  return (
    <div className="h-full flex items-center justify-center text-[var(--color-text-muted)] text-[13px]">
      {loading ? 'Loading...' : message}
    </div>
  )
}

function StatCard({
  label,
  value,
  delay = 0,
}: { label: string; value: string | number; delay?: number }) {
  return (
    <div className="card p-4 animate-fade-up" style={{ animationDelay: `${delay}ms` }}>
      <p className="text-[11px] text-[var(--color-text-muted)] mb-1">{label}</p>
      <p className="text-[28px] font-bold tracking-tight">{value}</p>
    </div>
  )
}

function pctFormatter(v: number): string {
  return `${(v * 100).toFixed(0)}%`
}

function pctTickFormatter(v: number): string {
  return `${(v * 100).toFixed(0)}%`
}

// ---------------------------------------------------------------------------
// Pivot helper — turns array of { period, key, value } into pivoted rows
// ---------------------------------------------------------------------------

function pivotBy<T extends object>(
  rows: T[],
  periodKey: keyof T,
  groupKey: keyof T,
  valueKey: keyof T,
): { data: Record<string, unknown>[]; keys: string[] } {
  const grouped = new Map<string, Record<string, unknown>>()
  const keySet = new Set<string>()

  for (const row of rows) {
    const period = String(row[periodKey])
    const group = String(row[groupKey])
    const value = row[valueKey] as unknown
    keySet.add(group)
    if (!grouped.has(period)) grouped.set(period, { period })
    grouped.get(period)![group] = value
  }

  return { data: Array.from(grouped.values()), keys: Array.from(keySet) }
}

// ---------------------------------------------------------------------------
// CostTab
// ---------------------------------------------------------------------------

function CostTab({ range }: { range: TimeRange }) {
  const [loading, setLoading] = useState(true)
  const [costByDayModel, setCostByDayModel] = useState<CostByDayModel[]>([])
  const [costByModel, setCostByModel] = useState<CostByModel[]>([])
  const [costDetail, setCostDetail] = useState<CostDetail[]>([])
  const [cacheHitRate, setCacheHitRate] = useState<CacheHitRate[]>([])

  const fetchData = useCallback((r: TimeRange) => {
    setLoading(true)
    Promise.all([
      apiFetch<{ data: CostByDayModel[] }>(`/api/metrics/cost-by-day-model?range=${r}`),
      apiFetch<{ byModel: CostByModel[] }>(`/api/metrics/cost?range=${r}`),
      apiFetch<{ data: CostDetail[] }>(`/api/metrics/cost-detail?range=${r}`),
      apiFetch<{ data: CacheHitRate[] }>(`/api/metrics/cache-hit-rate?range=${r}`),
    ])
      .then(([dayModelRes, costRes, detailRes, cacheRes]) => {
        setCostByDayModel(dayModelRes.data)
        setCostByModel(costRes.byModel)
        setCostDetail(detailRes.data)
        setCacheHitRate(cacheRes.data)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    fetchData(range)
  }, [range, fetchData])

  // Pivoted cost-by-day-model for stacked bar chart
  const { data: costTrendData, keys: costModels } = pivotBy(
    costByDayModel,
    'period',
    'model',
    'cost',
  )

  // Token usage: group cost-detail by date for stacked input/output bars
  const tokenUsageMap = new Map<string, { period: string; input: number; output: number }>()
  for (const d of costDetail) {
    const existing = tokenUsageMap.get(d.date)
    if (existing) {
      existing.input += d.input
      existing.output += d.output
    } else {
      tokenUsageMap.set(d.date, { period: d.date, input: d.input, output: d.output })
    }
  }
  const tokenUsageData = Array.from(tokenUsageMap.values())

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* 1. Cost Trend — stacked BarChart by model */}
      <ChartCard title="Cost Trend" delay={0}>
        <div className="h-[240px]">
          {loading || costTrendData.length === 0 ? (
            <ChartEmpty loading={loading} />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={costTrendData}>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
                <XAxis dataKey="period" tick={{ fontSize: 10, fill: CHART_TEXT }} />
                <YAxis
                  tick={{ fontSize: 10, fill: CHART_TEXT }}
                  tickFormatter={(v: number) => `$${formatCost(v)}`}
                />
                <Tooltip
                  {...TOOLTIP_STYLE}
                  formatter={(value: number) => `$${formatCost(value)}`}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {costModels.map((model, i) => (
                  <Bar
                    key={model}
                    dataKey={model}
                    stackId="cost"
                    fill={MODEL_COLORS[i % MODEL_COLORS.length]}
                    radius={i === costModels.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </ChartCard>

      {/* 2. Token Usage — stacked BarChart input/output */}
      <ChartCard title="Token Usage" delay={60}>
        <div className="h-[240px]">
          {loading || tokenUsageData.length === 0 ? (
            <ChartEmpty loading={loading} />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={tokenUsageData}>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
                <XAxis dataKey="period" tick={{ fontSize: 10, fill: CHART_TEXT }} />
                <YAxis
                  tick={{ fontSize: 10, fill: CHART_TEXT }}
                  tickFormatter={(v: number) => formatNumber(v)}
                />
                <Tooltip {...TOOLTIP_STYLE} formatter={(value: number) => formatNumber(value)} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar
                  dataKey="input"
                  name="Input"
                  stackId="tokens"
                  fill="#22d3ee"
                  radius={[0, 0, 0, 0]}
                />
                <Bar
                  dataKey="output"
                  name="Output"
                  stackId="tokens"
                  fill="#0891b2"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </ChartCard>

      {/* 3. Model Distribution — PieChart */}
      <ChartCard title="Model Distribution" delay={120}>
        <div className="h-[240px]">
          {loading || costByModel.length === 0 ? (
            <ChartEmpty loading={loading} />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={costByModel}
                  dataKey="totalCost"
                  nameKey="model"
                  cx="50%"
                  cy="50%"
                  outerRadius={80}
                  label={({ name, percent }: { name: string; percent: number }) =>
                    `${name} (${(percent * 100).toFixed(0)}%)`
                  }
                  labelLine={{ stroke: CHART_TEXT }}
                >
                  {costByModel.map((_, i) => (
                    <Cell key={i} fill={MODEL_COLORS[i % MODEL_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  {...TOOLTIP_STYLE}
                  formatter={(value: number) => `$${formatCost(value)}`}
                />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>
      </ChartCard>

      {/* 4. Cache Hit Rate — LineChart */}
      <ChartCard title="Cache Hit Rate" delay={180}>
        <div className="h-[240px]">
          {loading || cacheHitRate.length === 0 ? (
            <ChartEmpty loading={loading} />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={cacheHitRate}>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
                <XAxis dataKey="period" tick={{ fontSize: 10, fill: CHART_TEXT }} />
                <YAxis
                  tick={{ fontSize: 10, fill: CHART_TEXT }}
                  tickFormatter={pctTickFormatter}
                  domain={[0, 1]}
                />
                <Tooltip {...TOOLTIP_STYLE} formatter={(value: number) => pctFormatter(value)} />
                <Line
                  type="monotone"
                  dataKey="hitRate"
                  stroke="#22d3ee"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </ChartCard>

      {/* 5. Detail Records — HTML table */}
      <div className="lg:col-span-2">
        <ChartCard title="Detail Records" delay={240}>
          {loading ? (
            <div className="text-center text-[13px] text-[var(--color-text-muted)] py-6">
              Loading...
            </div>
          ) : costDetail.length === 0 ? (
            <div className="text-center text-[13px] text-[var(--color-text-muted)] py-6">
              No detail records
            </div>
          ) : (
            <div className="overflow-x-auto" style={{ maxHeight: 320 }}>
              <table className="w-full text-[12px] font-mono">
                <thead>
                  <tr className="text-left text-[10px] text-[var(--color-text-disabled)] tracking-wide border-b border-[var(--color-border)]">
                    <th className="pb-2 pr-4">Date</th>
                    <th className="pb-2 pr-4">Model</th>
                    <th className="pb-2 pr-4 text-right">Input Tokens</th>
                    <th className="pb-2 pr-4 text-right">Output Tokens</th>
                    <th className="pb-2 pr-4 text-right">Cache Read</th>
                    <th className="pb-2 text-right">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {costDetail.map((d, i) => (
                    <tr
                      key={i}
                      className="border-b border-[var(--color-border)] last:border-0 hover:bg-white/[0.03] transition-colors"
                    >
                      <td className="py-1.5 pr-4 text-[var(--color-text-muted)]">{d.date}</td>
                      <td className="py-1.5 pr-4 text-[var(--color-accent)]">{d.model}</td>
                      <td className="py-1.5 pr-4 text-right text-[var(--color-text-secondary)]">
                        {formatNumber(d.input)}
                      </td>
                      <td className="py-1.5 pr-4 text-right text-[var(--color-text-secondary)]">
                        {formatNumber(d.output)}
                      </td>
                      <td className="py-1.5 pr-4 text-right text-[var(--color-text-muted)]">
                        {formatNumber(d.cacheRead)}
                      </td>
                      <td className="py-1.5 text-right">${formatCost(d.cost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </ChartCard>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// OperationsTab
// ---------------------------------------------------------------------------

function OperationsTab({ range }: { range: TimeRange }) {
  const [loading, setLoading] = useState(true)
  const [taskSuccess, setTaskSuccess] = useState<TaskSuccess[]>([])
  const [toolStats, setToolStats] = useState<ToolStat[]>([])
  const [avgDuration, setAvgDuration] = useState<AvgDuration[]>([])
  const [toolErrorByDay, setToolErrorByDay] = useState<ToolErrorByDay[]>([])

  const fetchData = useCallback((r: TimeRange) => {
    setLoading(true)
    Promise.all([
      apiFetch<{ data: TaskSuccess[] }>(`/api/metrics/task-success-rate?range=${r}`),
      apiFetch<{ data: ToolStat[] }>(`/api/metrics/tool-stats?range=${r}`),
      apiFetch<{ data: AvgDuration[] }>(`/api/metrics/avg-duration?range=${r}`),
      apiFetch<{ data: ToolErrorByDay[] }>(`/api/metrics/tool-error-by-day?range=${r}`),
    ])
      .then(([taskRes, toolRes, durRes, errRes]) => {
        setTaskSuccess(taskRes.data)
        setToolStats(toolRes.data)
        setAvgDuration(durRes.data)
        setToolErrorByDay(errRes.data)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    fetchData(range)
  }, [range, fetchData])

  // Pivoted tool errors for stacked bar chart
  const { data: toolErrorData, keys: errorTools } = pivotBy(
    toolErrorByDay,
    'period',
    'tool',
    'errors',
  )

  // Sort tool stats descending by count for horizontal bar chart
  const sortedToolStats = [...toolStats].sort((a, b) => b.count - a.count)

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* 1. Task Completion Rate */}
      <ChartCard title="Task Completion Rate" delay={0}>
        <div className="h-[240px]">
          {loading || taskSuccess.length === 0 ? (
            <ChartEmpty loading={loading} />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={taskSuccess}>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
                <XAxis dataKey="period" tick={{ fontSize: 10, fill: CHART_TEXT }} />
                <YAxis
                  tick={{ fontSize: 10, fill: CHART_TEXT }}
                  tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`}
                  domain={[0, 1]}
                />
                <Tooltip {...TOOLTIP_STYLE} formatter={(value: number) => pctFormatter(value)} />
                <Line
                  type="monotone"
                  dataKey="successRate"
                  stroke="#22d3ee"
                  strokeWidth={2}
                  dot={false}
                  name="Success Rate"
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </ChartCard>

      {/* 2. Tool Call Distribution — horizontal BarChart */}
      <ChartCard title="Tool Call Distribution" delay={60}>
        <div className="h-[240px]">
          {loading || sortedToolStats.length === 0 ? (
            <ChartEmpty loading={loading} />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={sortedToolStats} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
                <XAxis
                  type="number"
                  tick={{ fontSize: 10, fill: CHART_TEXT }}
                  tickFormatter={(v: number) => formatNumber(v)}
                />
                <YAxis
                  type="category"
                  dataKey="tool"
                  tick={{ fontSize: 10, fill: CHART_TEXT }}
                  width={80}
                />
                <Tooltip {...TOOLTIP_STYLE} formatter={(value: number) => formatNumber(value)} />
                <Bar dataKey="count" fill="#22d3ee" radius={[0, 4, 4, 0]} name="Calls" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </ChartCard>

      {/* 3. Avg Execution Time — LineChart in seconds */}
      <ChartCard title="Avg Execution Time" delay={120}>
        <div className="h-[240px]">
          {loading || avgDuration.length === 0 ? (
            <ChartEmpty loading={loading} />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={avgDuration.map((d) => ({ period: d.period, avgSec: d.avgMs / 1000 }))}
              >
                <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
                <XAxis dataKey="period" tick={{ fontSize: 10, fill: CHART_TEXT }} />
                <YAxis
                  tick={{ fontSize: 10, fill: CHART_TEXT }}
                  tickFormatter={(v: number) => `${v.toFixed(1)}s`}
                />
                <Tooltip {...TOOLTIP_STYLE} formatter={(value: number) => `${value.toFixed(2)}s`} />
                <Line
                  type="monotone"
                  dataKey="avgSec"
                  stroke="#22d3ee"
                  strokeWidth={2}
                  dot={false}
                  name="Avg Duration"
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </ChartCard>

      {/* 4. Tool Error Rate — stacked BarChart by tool */}
      <ChartCard title="Tool Error Rate" delay={180}>
        <div className="h-[240px]">
          {loading || toolErrorData.length === 0 ? (
            <ChartEmpty loading={loading} />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={toolErrorData}>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
                <XAxis dataKey="period" tick={{ fontSize: 10, fill: CHART_TEXT }} />
                <YAxis tick={{ fontSize: 10, fill: CHART_TEXT }} />
                <Tooltip {...TOOLTIP_STYLE} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {errorTools.map((tool, i) => (
                  <Bar
                    key={tool}
                    dataKey={tool}
                    stackId="errors"
                    fill={MODEL_COLORS[i % MODEL_COLORS.length]}
                    radius={i === errorTools.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </ChartCard>
    </div>
  )
}

// ---------------------------------------------------------------------------
// HealthTab
// ---------------------------------------------------------------------------

function HealthTab({ range }: { range: TimeRange }) {
  const [loading, setLoading] = useState(true)
  const [health, setHealth] = useState<HealthData | null>(null)
  const [fuseEvents, setFuseEvents] = useState<LogEntry[]>([])

  const fetchData = useCallback((r: TimeRange) => {
    setLoading(true)
    Promise.all([
      apiFetch<HealthData>(`/api/metrics/health?range=${r}`),
      apiFetch<{ entries: LogEntry[] }>('/api/logs?type=operations&limit=50'),
    ])
      .then(([healthRes, logsRes]) => {
        setHealth(healthRes)
        setFuseEvents(
          logsRes.entries.filter((e) => e.event && String(e.event).toLowerCase().includes('fuse')),
        )
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    fetchData(range)
  }, [range, fetchData])

  const repairs = health?.repairs
  const repairTrend = health?.repairTrend ?? []

  // System availability placeholder: 100% constant line using repairTrend periods
  const availabilityData =
    repairTrend.length > 0 ? repairTrend.map((d) => ({ period: d.period, availability: 1 })) : []

  return (
    <div className="space-y-4">
      {/* 1. Self-Repair Stats */}
      <ChartCard title="Self-Repair Stats" delay={0}>
        {/* Top: 3 stat cards */}
        <div className="grid grid-cols-3 gap-3 mb-4">
          <StatCard
            label="Total Repairs"
            value={loading ? '...' : formatNumber(repairs?.total ?? 0)}
          />
          <StatCard
            label="Success Count"
            value={loading ? '...' : formatNumber(repairs?.successCount ?? 0)}
            delay={30}
          />
          <StatCard
            label="Success Rate"
            value={loading ? '...' : `${((repairs?.successRate ?? 0) * 100).toFixed(1)}%`}
            delay={60}
          />
        </div>

        {/* Bottom: repair trend line chart */}
        <div className="h-[200px]">
          {loading || repairTrend.length === 0 ? (
            <ChartEmpty loading={loading} />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={repairTrend}>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
                <XAxis dataKey="period" tick={{ fontSize: 10, fill: CHART_TEXT }} />
                <YAxis tick={{ fontSize: 10, fill: CHART_TEXT }} />
                <Tooltip {...TOOLTIP_STYLE} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line
                  type="monotone"
                  dataKey="total"
                  stroke="#64748b"
                  strokeWidth={2}
                  dot={false}
                  name="Total Repairs"
                />
                <Line
                  type="monotone"
                  dataKey="success"
                  stroke="#22d3ee"
                  strokeWidth={2}
                  dot={false}
                  name="Successful"
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </ChartCard>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* 2. System Availability */}
        <ChartCard title="System Availability" delay={60}>
          <div className="h-[200px]">
            {loading || availabilityData.length === 0 ? (
              <ChartEmpty loading={loading} message="No data" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={availabilityData}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
                  <XAxis dataKey="period" tick={{ fontSize: 10, fill: CHART_TEXT }} />
                  <YAxis
                    tick={{ fontSize: 10, fill: CHART_TEXT }}
                    tickFormatter={pctTickFormatter}
                    domain={[0, 1]}
                  />
                  <Tooltip {...TOOLTIP_STYLE} formatter={(value: number) => pctFormatter(value)} />
                  <Line
                    type="monotone"
                    dataKey="availability"
                    stroke="#22d3ee"
                    strokeWidth={2}
                    dot={false}
                    name="Availability"
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </ChartCard>

        {/* 3. Fuse Events */}
        <ChartCard title="Fuse Events" delay={120}>
          <div style={{ maxHeight: 200, overflowY: 'auto' }}>
            {loading ? (
              <div className="text-center text-[13px] text-[var(--color-text-muted)] py-6">
                Loading...
              </div>
            ) : fuseEvents.length === 0 ? (
              <div className="text-center text-[13px] text-[var(--color-text-muted)] py-6">
                No fuse events
              </div>
            ) : (
              <table className="w-full text-[12px] font-mono">
                <thead>
                  <tr className="text-left text-[10px] text-[var(--color-text-disabled)] tracking-wide border-b border-[var(--color-border)]">
                    <th className="pb-2 pr-4">Time</th>
                    <th className="pb-2">Event</th>
                  </tr>
                </thead>
                <tbody>
                  {fuseEvents.map((e, i) => (
                    <tr
                      key={i}
                      className="border-b border-[var(--color-border)] last:border-0 hover:bg-white/[0.03] transition-colors"
                    >
                      <td className="py-1.5 pr-4 text-[var(--color-text-muted)] whitespace-nowrap">
                        {e.ts
                          ? new Date(e.ts).toLocaleString([], {
                              month: 'short',
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            })
                          : '-'}
                      </td>
                      <td className="py-1.5 text-[var(--color-text-secondary)]">
                        {String(e.event ?? '')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </ChartCard>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// MetricsPage
// ---------------------------------------------------------------------------

export function MetricsPage() {
  const [activeTab, setActiveTab] = useState<Tab>('cost')
  const [range, setRange] = useState<TimeRange>('30d')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')

  // For custom range, compute a matching preset-style range to pass to tabs
  // (Tabs already accept range as a string for API calls)
  const effectiveRange = range === 'custom' ? 'custom' : range

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <h1 className="text-[20px] font-bold tracking-tight mb-4">Metrics</h1>

      {/* Tab bar + time range selector */}
      <div className="flex items-center justify-between mb-4">
        {/* Tabs */}
        <div className="flex gap-1.5">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-1.5 rounded-md text-[13px] transition-colors ${
                activeTab === tab.key
                  ? 'bg-[var(--color-accent-glow)] text-[var(--color-accent)]'
                  : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Time range */}
        <div className="flex gap-1">
          {RANGES.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRange(r)}
              className={`px-3 py-1 rounded-md text-[12px] transition-colors ${
                range === r
                  ? 'bg-[var(--color-accent-glow)] text-[var(--color-accent)]'
                  : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'
              }`}
            >
              {r === 'custom' ? 'Custom' : r}
            </button>
          ))}
        </div>
      </div>

      {/* Custom time range picker */}
      {range === 'custom' && (
        <div className="card p-3 mb-4 flex items-center gap-3 animate-fade-up">
          <span className="text-[12px] text-[var(--color-text-muted)]">From</span>
          <input
            type="date"
            className="input-field text-[12px]"
            value={customStart}
            onChange={(e) => setCustomStart(e.target.value)}
          />
          <span className="text-[12px] text-[var(--color-text-muted)]">To</span>
          <input
            type="date"
            className="input-field text-[12px]"
            value={customEnd}
            onChange={(e) => setCustomEnd(e.target.value)}
          />
        </div>
      )}

      {/* Tab content */}
      {activeTab === 'cost' && <CostTab range={effectiveRange} />}
      {activeTab === 'operations' && <OperationsTab range={effectiveRange} />}
      {activeTab === 'health' && <HealthTab range={effectiveRange} />}
    </div>
  )
}
