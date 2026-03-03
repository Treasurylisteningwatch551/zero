import { hc } from 'hono/client'
import type { AppType } from '../../api/routes'
import { useUIStore } from '../stores/ui'

export const client = hc<AppType>('/')

const API_BASE = ''

function showErrorToast(message: string) {
  useUIStore.getState().addToast('error', message)
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, init)
  if (!res.ok) {
    const message = `请求失败: ${res.status} ${res.statusText}`
    showErrorToast(message)
    throw new Error(message)
  }
  return res.json() as Promise<T>
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  return apiFetch<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export async function apiPut<T>(path: string, body: unknown): Promise<T> {
  return apiFetch<T>(path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export async function apiDelete<T>(path: string): Promise<T> {
  return apiFetch<T>(path, { method: 'DELETE' })
}

export { useUIStore } from '../stores/ui'
