interface PulseDotProps {
  status: 'active' | 'idle' | 'error' | 'warning'
  size?: number
}

const dotColors = {
  active: 'bg-emerald-400',
  idle: 'bg-slate-500',
  error: 'bg-red-400',
  warning: 'bg-amber-400',
}

export function PulseDot({ status, size = 8 }: PulseDotProps) {
  return (
    <span
      className={`inline-block rounded-full ${dotColors[status]} ${status === 'active' ? 'pulse-active' : ''}`}
      style={{ width: size, height: size }}
    />
  )
}
