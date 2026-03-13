import { useCallback, useEffect, useRef } from 'react'

interface UseWebSocketOptions {
  url: string
  topics: string[]
  onEvent?: (topic: string, data: unknown) => void
  onStream?: (sessionId: string, delta: string) => void
}

export function useWebSocket({ url, topics, onEvent, onStream }: UseWebSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const connect = useCallback(() => {
    const ws = new WebSocket(url)
    wsRef.current = ws

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'subscribe', topics }))
    }

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data)
        if (msg.type === 'event' && onEvent) {
          onEvent(msg.topic, msg.data)
        } else if (msg.type === 'stream' && onStream) {
          onStream(msg.sessionId, msg.delta)
        }
      } catch {}
    }

    ws.onclose = () => {
      reconnectTimer.current = setTimeout(connect, 3000)
    }

    ws.onerror = () => {
      ws.close()
    }
  }, [url, topics, onEvent, onStream])

  useEffect(() => {
    connect()
    return () => {
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current)
      }
      wsRef.current?.close()
    }
  }, [connect])

  const send = useCallback((data: unknown) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data))
    }
  }, [])

  return { send }
}
