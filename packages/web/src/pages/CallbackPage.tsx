import { useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'

export function CallbackPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { refresh } = useAuth()

  useEffect(() => {
    const error = searchParams.get('error')
    if (error) {
      console.error('Auth error:', error)
      navigate('/login', { replace: true })
      return
    }

    // Refresh auth state and redirect to dashboard
    refresh().then(() => {
      navigate('/', { replace: true })
    })
  }, [searchParams, navigate, refresh])

  return (
    <div className="flex h-screen items-center justify-center">
      <div className="text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
        <p className="mt-4 text-muted-foreground">ログイン中...</p>
      </div>
    </div>
  )
}
