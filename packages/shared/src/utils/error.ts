function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  if (maxLength <= 3) return value.slice(0, Math.max(0, maxLength))
  return `${value.slice(0, Math.max(0, maxLength - 3))}...`
}

function getHeaderValue(headers: unknown, headerName: string): string | undefined {
  if (!headers || typeof headers !== 'object') return undefined

  const lowerName = headerName.toLowerCase()
  const withGetter = headers as { get?: (name: string) => unknown }
  if (typeof withGetter.get === 'function') {
    const value = withGetter.get(headerName) ?? withGetter.get(lowerName)
    return typeof value === 'string' ? value : undefined
  }

  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== lowerName) continue
    if (typeof value === 'string') return value
    if (Array.isArray(value) && typeof value[0] === 'string') return value[0]
  }

  return undefined
}

function extractRequestId(headers: unknown): string | undefined {
  return getHeaderValue(headers, 'x-request-id') ?? getHeaderValue(headers, 'request-id')
}

function extractResponseDetail(data: unknown): string | undefined {
  if (!data) return undefined
  if (typeof data === 'string') return truncate(data, 160)
  if (typeof data !== 'object') return undefined

  const record = data as Record<string, unknown>
  const code =
    typeof record.code === 'number' || typeof record.code === 'string'
      ? String(record.code)
      : undefined
  const message =
    typeof record.msg === 'string'
      ? record.msg
      : typeof record.message === 'string'
        ? record.message
        : undefined

  if (!code && !message) return undefined
  return [code ? `code=${code}` : '', message ?? ''].filter(Boolean).join(' ')
}

export function describeError(error: unknown): string {
  if (typeof error === 'string') return error
  if (typeof error === 'number' || typeof error === 'boolean' || error == null) {
    return String(error)
  }

  const record = error as Record<string, unknown>
  const response =
    typeof record.response === 'object' && record.response !== null
      ? (record.response as Record<string, unknown>)
      : undefined
  const config =
    typeof record.config === 'object' && record.config !== null
      ? (record.config as Record<string, unknown>)
      : undefined

  const message =
    typeof record.message === 'string'
      ? record.message
      : error instanceof Error
        ? error.message
        : undefined
  const code =
    typeof record.code === 'number' || typeof record.code === 'string'
      ? String(record.code)
      : undefined
  const status =
    typeof response?.status === 'number'
      ? response.status
      : typeof record.status === 'number'
        ? record.status
        : typeof record.statusCode === 'number'
          ? record.statusCode
          : undefined
  const method = typeof config?.method === 'string' ? config.method.toUpperCase() : undefined
  const url =
    typeof config?.url === 'string'
      ? config.url
      : typeof record.url === 'string'
        ? record.url
        : undefined
  const requestId = extractRequestId(response?.headers)
  const detail = extractResponseDetail(response?.data)

  const parts = [
    status ? `status=${status}` : '',
    code ? `code=${code}` : '',
    requestId ? `request_id=${requestId}` : '',
    method || url ? `${method ?? 'REQUEST'} ${url ?? ''}`.trim() : '',
    message ?? '',
    detail ? `detail=${detail}` : '',
  ].filter(Boolean)

  return parts.join(' | ') || '[unknown error]'
}

export function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
