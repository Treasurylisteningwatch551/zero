type ConsoleMethod = 'log' | 'info' | 'warn' | 'error'

type ConsoleMethodFn = (...args: unknown[]) => void

const METHODS: ConsoleMethod[] = ['log', 'info', 'warn', 'error']
const TIMESTAMPING_INSTALLED = Symbol.for('zero-os.console.timestamping.installed')

export interface TimestampConsoleTarget {
  log: ConsoleMethodFn
  info: ConsoleMethodFn
  warn: ConsoleMethodFn
  error: ConsoleMethodFn
  [TIMESTAMPING_INSTALLED]?: boolean
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function formatLocalTimestamp(date: Date = new Date()): string {
  return `${[date.getFullYear(), pad(date.getMonth() + 1), pad(date.getDate())].join('-')} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

function prefixMessage(text: string, timestamp: string): string {
  const prefix = `[${timestamp}] `
  const leadingNewlines = text.match(/^\n+/)?.[0] ?? ''
  return `${leadingNewlines}${prefix}${text.slice(leadingNewlines.length)}`
}

function patchMethod(targetConsole: TimestampConsoleTarget, method: ConsoleMethod): void {
  const original = targetConsole[method]

  targetConsole[method] = (...args: unknown[]) => {
    const timestamp = formatLocalTimestamp()

    if (typeof args[0] === 'string') {
      Reflect.apply(original, targetConsole, [prefixMessage(args[0], timestamp), ...args.slice(1)])
      return
    }

    Reflect.apply(original, targetConsole, [`[${timestamp}]`, ...args])
  }
}

export function installConsoleTimestampingOn(targetConsole: TimestampConsoleTarget): void {
  if (targetConsole[TIMESTAMPING_INSTALLED]) return

  for (const method of METHODS) {
    patchMethod(targetConsole, method)
  }

  targetConsole[TIMESTAMPING_INSTALLED] = true
}

export function installConsoleTimestamping(): void {
  installConsoleTimestampingOn(console as TimestampConsoleTarget)
}
