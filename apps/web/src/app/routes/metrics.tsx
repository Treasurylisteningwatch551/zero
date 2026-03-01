import { useState, useEffect } from 'react'
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { apiFetch } from '../lib/api'

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

interface ToolStat {
  tool: string
  count: number
  successRate: number
  avgDurationMs: number
}

export function MetricsPage() {
  const [costByDay, setCostByDay] = useState<CostByDay[]>([])
  const [costByModel, setCostByModel] = useState<CostByModel[]>([])
  const [toolStats, setToolStats] = useState<ToolStat[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      apiFetch<{ data: CostByDay[] }>('/api/metrics/cost-by-day'),
      apiFetch<{ byModel: CostByModel[] }>('/api/metrics/cost'),
      apiFetch<{ data: ToolStat[] }>('/api/metrics/tool-stats'),
    ])
      .then(([dayRes, costRes, toolRes]) => {
        setCostByDay(dayRes.data)
        setCostByModel(costRes.byModel)
        setToolStats(toolRes.data)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const chartTheme = {
    stroke: 'rgba(0, 224, 255, 0.8)',
    grid: 'rgba(255, 255, 255, 0.05)',
    text: 'rgba(255, 255, 255, 0.4)',
  }

  // Token usage per day from costByDay
  const tokenData = costByDay.map((d) => ({
    period: d.period,
    tokens: d.totalTokens,
  }))

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <h1 className="text-[20px] font-bold tracking-tight mb-4">Metrics</h1>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Cost Over Time */}
        <div className="card p-5 animate-fade-up">
          <h3 className="text-[14px] font-semibold mb-3 text-[var(--color-text-secondary)]">Cost Over Time</h3>
          <div className="h-[200px]">
            {loading || costByDay.length === 0 ? (
              <div className="h-full flex items-center justify-center text-[var(--color-text-muted)] text-[13px]">
                {loading ? 'Loading...' : 'No cost data yet'}
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={costByDay}>
                  <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} />
                  <XAxis dataKey="period" tick={{ fontSize: 10, fill: chartTheme.text }} />
                  <YAxis tick={{ fontSize: 10, fill: chartTheme.text }} />
                  <Tooltip
                    contentStyle={{ background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }}
                    labelStyle={{ color: 'rgba(255,255,255,0.6)' }}
                  />
                  <Line type="monotone" dataKey="totalCost" stroke={chartTheme.stroke} strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Token Usage */}
        <div className="card p-5 animate-fade-up" style={{ animationDelay: '60ms' }}>
          <h3 className="text-[14px] font-semibold mb-3 text-[var(--color-text-secondary)]">Token Usage</h3>
          <div className="h-[200px]">
            {loading || tokenData.length === 0 ? (
              <div className="h-full flex items-center justify-center text-[var(--color-text-muted)] text-[13px]">
                {loading ? 'Loading...' : 'No token data yet'}
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={tokenData}>
                  <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} />
                  <XAxis dataKey="period" tick={{ fontSize: 10, fill: chartTheme.text }} />
                  <YAxis tick={{ fontSize: 10, fill: chartTheme.text }} />
                  <Tooltip
                    contentStyle={{ background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }}
                  />
                  <Bar dataKey="tokens" fill="rgba(0, 224, 255, 0.6)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Model Distribution */}
        <div className="card p-5 animate-fade-up" style={{ animationDelay: '120ms' }}>
          <h3 className="text-[14px] font-semibold mb-3 text-[var(--color-text-secondary)]">Model Distribution</h3>
          <div className="h-[200px]">
            {loading || costByModel.length === 0 ? (
              <div className="h-full flex items-center justify-center text-[var(--color-text-muted)] text-[13px]">
                {loading ? 'Loading...' : 'No model data yet'}
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={costByModel} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} />
                  <XAxis type="number" tick={{ fontSize: 10, fill: chartTheme.text }} />
                  <YAxis type="category" dataKey="model" tick={{ fontSize: 10, fill: chartTheme.text }} width={120} />
                  <Tooltip
                    contentStyle={{ background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }}
                  />
                  <Bar dataKey="requestCount" fill="rgba(0, 224, 255, 0.5)" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Tool Usage */}
        <div className="card p-5 animate-fade-up" style={{ animationDelay: '180ms' }}>
          <h3 className="text-[14px] font-semibold mb-3 text-[var(--color-text-secondary)]">Tool Usage</h3>
          <div className="h-[200px]">
            {loading || toolStats.length === 0 ? (
              <div className="h-full flex items-center justify-center text-[var(--color-text-muted)] text-[13px]">
                {loading ? 'Loading...' : 'No tool usage data yet'}
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={toolStats}>
                  <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} />
                  <XAxis dataKey="tool" tick={{ fontSize: 10, fill: chartTheme.text }} />
                  <YAxis tick={{ fontSize: 10, fill: chartTheme.text }} />
                  <Tooltip
                    contentStyle={{ background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }}
                  />
                  <Bar dataKey="count" fill="rgba(0, 224, 255, 0.6)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
