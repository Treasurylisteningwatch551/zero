import { useState, useEffect } from 'react'
import { FlipNumber } from '../shared/FlipNumber'
import { apiFetch } from '../../lib/api'

interface CostData {
  today: { cost: number; tokens: number }
  week: { cost: number; tokens: number }
  month: { cost: number; tokens: number }
  byModel: { model: string; cost: number; percent: number }[]
}

export function CostOverview() {
  const [data, setData] = useState<CostData>({
    today: { cost: 0, tokens: 0 },
    week: { cost: 0, tokens: 0 },
    month: { cost: 0, tokens: 0 },
    byModel: [],
  })

  useEffect(() => {
    Promise.all([
      apiFetch<{ today: { cost: number; tokens: number }; week: { cost: number; tokens: number }; month: { cost: number; tokens: number } }>('/api/metrics/summary'),
      apiFetch<{ byModel: { model: string; totalCost: number }[] }>('/api/metrics/cost'),
    ])
      .then(([summary, cost]) => {
        const totalCost = cost.byModel.reduce((s, m) => s + m.totalCost, 0)
        const byModel = cost.byModel.map((m) => ({
          model: m.model,
          cost: m.totalCost,
          percent: totalCost > 0 ? Math.round((m.totalCost / totalCost) * 100) : 0,
        }))
        setData({
          today: summary.today,
          week: summary.week,
          month: summary.month,
          byModel,
        })
      })
      .catch(() => {})
  }, [])

  return (
    <div className="card p-5 animate-fade-up" style={{ animationDelay: '120ms' }}>
      <h3 className="text-[14px] font-semibold mb-4 text-[var(--color-text-secondary)]">
        Cost Overview
      </h3>

      <div className="grid grid-cols-3 gap-4 mb-4">
        <div>
          <p className="text-[11px] text-[var(--color-text-muted)] tracking-wide mb-1">Today</p>
          <FlipNumber value={`$${data.today.cost.toFixed(2)}`} className="text-[28px] text-[var(--color-text-primary)]" />
          <p className="text-[11px] font-mono text-[var(--color-text-disabled)]">
            {formatTokens(data.today.tokens)} tokens
          </p>
        </div>
        <div>
          <p className="text-[11px] text-[var(--color-text-muted)] tracking-wide mb-1">This Week</p>
          <FlipNumber value={`$${data.week.cost.toFixed(2)}`} className="text-[28px] text-[var(--color-text-primary)]" />
          <p className="text-[11px] font-mono text-[var(--color-text-disabled)]">
            {formatTokens(data.week.tokens)} tokens
          </p>
        </div>
        <div>
          <p className="text-[11px] text-[var(--color-text-muted)] tracking-wide mb-1">This Month</p>
          <FlipNumber value={`$${data.month.cost.toFixed(2)}`} className="text-[28px] text-[var(--color-text-primary)]" />
          <p className="text-[11px] font-mono text-[var(--color-text-disabled)]">
            {formatTokens(data.month.tokens)} tokens
          </p>
        </div>
      </div>

      {/* Model breakdown */}
      {data.byModel.length > 0 && (
        <div className="space-y-2">
          {data.byModel.map((m) => (
            <div key={m.model} className="flex items-center gap-3">
              <span className="text-[12px] font-mono text-[var(--color-text-secondary)] w-40 truncate">
                {m.model}
              </span>
              <div className="flex-1 h-1.5 bg-white/[0.04] rounded-full overflow-hidden">
                <div
                  className="h-full bg-[var(--color-accent)] rounded-full"
                  style={{ width: `${m.percent}%` }}
                />
              </div>
              <span className="text-[11px] font-mono text-[var(--color-text-muted)] w-16 text-right">
                ${m.cost.toFixed(2)}
              </span>
              <span className="text-[11px] text-[var(--color-text-disabled)] w-10 text-right">
                {m.percent}%
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return n.toString()
}
