import { CheckCircle, Info, Warning, X, XCircle } from '@phosphor-icons/react'
import { useUIStore } from '../../stores/ui'
import type { ToastType } from '../../stores/ui'

const ICON_MAP: Record<ToastType, typeof CheckCircle> = {
  success: CheckCircle,
  error: XCircle,
  warning: Warning,
  info: Info,
}

const COLOR_MAP: Record<ToastType, { bg: string; border: string; icon: string }> = {
  success: {
    bg: 'bg-emerald-400/[0.08]',
    border: 'border-emerald-400/20',
    icon: 'text-emerald-400',
  },
  error: {
    bg: 'bg-red-400/[0.08]',
    border: 'border-red-400/20',
    icon: 'text-red-400',
  },
  warning: {
    bg: 'bg-amber-400/[0.08]',
    border: 'border-amber-400/20',
    icon: 'text-amber-400',
  },
  info: {
    bg: 'bg-cyan-400/[0.08]',
    border: 'border-cyan-400/20',
    icon: 'text-cyan-400',
  },
}

export function ToastContainer() {
  const { toasts, removeToast } = useUIStore()

  if (toasts.length === 0) return null

  return (
    <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 max-w-[380px]">
      {toasts.map((toast) => {
        const Icon = ICON_MAP[toast.type]
        const colors = COLOR_MAP[toast.type]

        return (
          <div
            key={toast.id}
            className={`flex items-start gap-3 px-4 py-3 rounded-xl border backdrop-blur-md ${colors.bg} ${colors.border} ${
              toast.exiting ? 'toast-exit' : 'toast-enter'
            }`}
            style={{
              boxShadow: '0 4px 24px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.06)',
            }}
          >
            <Icon size={18} weight="fill" className={`shrink-0 mt-0.5 ${colors.icon}`} />
            <span className="text-[13px] text-[var(--color-text-primary)] flex-1 leading-relaxed">
              {toast.message}
            </span>
            <button
              type="button"
              onClick={() => removeToast(toast.id)}
              className="shrink-0 p-0.5 rounded hover:bg-white/[0.08] text-[var(--color-text-disabled)] hover:text-[var(--color-text-muted)] transition-colors"
            >
              <X size={14} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
