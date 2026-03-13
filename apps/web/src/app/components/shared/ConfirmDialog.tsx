import { Warning } from '@phosphor-icons/react'
import { useState } from 'react'

interface ConfirmDialogProps {
  open: boolean
  title: string
  description?: string
  confirmText?: string
  cancelText?: string
  danger?: boolean
  onConfirm: () => void | Promise<void>
  onCancel: () => void
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmText = '确认',
  cancelText = '取消',
  danger = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const [loading, setLoading] = useState(false)

  if (!open) return null

  async function handleConfirm() {
    setLoading(true)
    try {
      await onConfirm()
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center overlay-enter"
      style={{ backgroundColor: 'rgba(0, 0, 0, 0.6)', backdropFilter: 'blur(4px)' }}
      onClick={onCancel}
    >
      <div
        className="card p-6 max-w-[400px] w-full mx-4 dialog-enter"
        style={{
          background: 'var(--color-float)',
          boxShadow: '0 8px 40px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.06)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 mb-4">
          {danger && <Warning size={22} weight="fill" className="text-red-400 shrink-0 mt-0.5" />}
          <div>
            <h3 className="text-[15px] font-semibold text-[var(--color-text-primary)]">{title}</h3>
            {description && (
              <p className="text-[13px] text-[var(--color-text-muted)] mt-1.5 leading-relaxed">
                {description}
              </p>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <button
            onClick={onCancel}
            disabled={loading}
            className="px-4 py-2 rounded-lg text-[13px] text-[var(--color-text-secondary)] border border-[var(--color-border)] hover:bg-white/[0.04] transition-colors disabled:opacity-40"
          >
            {cancelText}
          </button>
          <button
            onClick={handleConfirm}
            disabled={loading}
            className={`px-4 py-2 rounded-lg text-[13px] font-medium transition-colors disabled:opacity-40 ${
              danger
                ? 'bg-red-500 text-white hover:bg-red-400'
                : 'bg-[var(--color-accent)] text-[var(--color-deep-bg)] hover:bg-[var(--color-accent-hover)]'
            }`}
          >
            {loading ? '处理中...' : confirmText}
          </button>
        </div>
      </div>
    </div>
  )
}
