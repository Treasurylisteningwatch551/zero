import { useState, useEffect } from 'react'
import { StatusBar } from '../layout/StatusBar'
import { apiFetch } from '../../lib/api'
import { formatUptime } from '../../lib/format'

interface StatusData {
  status: string
  uptime: number
  currentModel: string
  heartbeatAge: number
  activeSessions: number
}

export function SystemStatus() {
  const [data, setData] = useState<StatusData>({
    status: 'running',
    uptime: 0,
    currentModel: 'loading...',
    heartbeatAge: 0,
    activeSessions: 0,
  })

  useEffect(() => {
    function poll() {
      apiFetch<StatusData>('/api/status')
        .then(setData)
        .catch(() => {})
    }
    poll()
    const interval = setInterval(poll, 5000)
    return () => clearInterval(interval)
  }, [])

  return (
    <StatusBar
      status={data.status as 'running' | 'degraded' | 'repairing' | 'fused'}
      model={data.currentModel}
      uptime={formatUptime(data.uptime)}
      heartbeatAge={data.heartbeatAge}
      activeSessions={data.activeSessions}
    />
  )
}
