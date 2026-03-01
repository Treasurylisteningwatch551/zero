interface FlipNumberProps {
  value: string
  className?: string
}

export function FlipNumber({ value, className = '' }: FlipNumberProps) {
  return (
    <span className={`font-mono font-bold tracking-tighter ${className}`}>
      {value.split('').map((char, i) => (
        <span
          key={`${i}-${char}`}
          className="inline-block"
          style={{
            animation: 'fadeUp 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards',
            animationDelay: `${i * 20}ms`,
          }}
        >
          {char}
        </span>
      ))}
    </span>
  )
}
