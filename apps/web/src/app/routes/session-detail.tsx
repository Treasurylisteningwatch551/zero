import { useParams } from '@tanstack/react-router'
import { SessionDetailScreen } from '../components/session/SessionDetailScreen'
import { useUIStore } from '../stores/ui'

export function SessionDetailPage() {
  const { selectedSessionId } = useUIStore()
  const params = useParams({ strict: false }) as { id?: string }
  const sessionId = params.id ?? selectedSessionId

  return <SessionDetailScreen sessionId={sessionId} />
}
