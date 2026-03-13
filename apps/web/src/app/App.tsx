import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { useEffect } from 'react'
import { queryClient } from './lib/queryClient'
import { router } from './router'
import { useUIStore } from './stores/ui'

function AppShell() {
  const { setViewport } = useUIStore()

  // Viewport listener
  useEffect(() => {
    function handleResize() {
      setViewport(window.innerWidth)
    }
    window.addEventListener('resize', handleResize)
    // Set initial value
    handleResize()
    return () => window.removeEventListener('resize', handleResize)
  }, [setViewport])

  return (
    <div className="min-h-[100dvh]">
      <RouterProvider router={router} />
    </div>
  )
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppShell />
    </QueryClientProvider>
  )
}
