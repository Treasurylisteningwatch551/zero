import { User } from '@phosphor-icons/react'

interface Props {
  text: string
  images?: Array<{ mediaType: string; data: string }>
  createdAt: string
}

export function UserMessageBlock({ text, images }: Props) {
  const hasImages = Boolean(images && images.length > 0)
  const displayText = hasImages ? stripImagePlaceholders(text) : text
  const showText = displayText.trim().length > 0

  return (
    <div
      className="px-4 py-3 rounded-lg"
      style={{
        background: 'rgba(34, 211, 238, 0.06)',
        borderLeft: '2px solid rgb(34, 211, 238)',
      }}
    >
      <div className="flex items-start gap-2">
        <User size={16} weight="bold" className="text-cyan-400 mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1 space-y-2">
          {showText && (
            <p className="text-[13px] text-[var(--color-text-primary)] whitespace-pre-wrap">{displayText}</p>
          )}
          {images?.map((image, index) => (
            <img
              key={`${image.mediaType}-${index}`}
              src={`data:${image.mediaType};base64,${image.data}`}
              alt={`User upload ${index + 1}`}
              className="max-h-72 rounded-md border border-white/10 object-contain bg-black/20"
            />
          ))}
        </div>
      </div>
    </div>
  )
}

function stripImagePlaceholders(text: string): string {
  return text
    .replace(/^\s*\[(?:图片|Image(?:\s*#?\d+)?)\]\s*$/gim, '')
    .replace(/(?:\r?\n){3,}/g, '\n\n')
    .trim()
}
