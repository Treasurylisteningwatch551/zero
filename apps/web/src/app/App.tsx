import { useEffect } from 'react'
import { RouterProvider } from '@tanstack/react-router'
import { QueryClientProvider } from '@tanstack/react-query'
import { useUIStore } from './stores/ui'
import { queryClient } from './lib/queryClient'
import { router } from './router'

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
