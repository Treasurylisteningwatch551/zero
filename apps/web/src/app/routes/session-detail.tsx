import { useParams } from '@tanstack/react-router'
import { useUIStore } from '../stores/ui'
import { SessionDetailScreen } from '../components/session/SessionDetailScreen'

export function SessionDetailPage() {
  const { selectedSessionId } = useUIStore()
  const params = useParams({ strict: false }) as { id?: string }
  const sessionId = params.id ?? selectedSessionId

  return <SessionDetailScreen sessionId={sessionId} />
}
