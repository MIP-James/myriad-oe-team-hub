import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { ALLOWED_DOMAIN } from '../lib/supabase'

export default function Login() {
  const { session, signInWithGoogle, domainError, loading } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    if (session) navigate('/', { replace: true })
  }, [session, navigate])

  return (
    <div className="h-full flex items-center justify-center bg-gradient-to-br from-slate-50 to-amber-50">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-xl border border-slate-200 p-8">
        <div className="text-center mb-6">
          <div className="inline-block bg-myriad-primary/20 px-3 py-1 rounded-full text-xs font-semibold text-myriad-ink mb-3">
            MYRIAD Team Hub
          </div>
          <h1 className="text-xl font-bold text-slate-900">Online Enforcement 팀</h1>
          <p className="text-sm text-slate-500 mt-2">
            @{ALLOWED_DOMAIN || 'myriadip.com'} 계정으로 로그인하세요
          </p>
        </div>

        <button
          onClick={signInWithGoogle}
          disabled={loading}
          className="w-full flex items-center justify-center gap-3 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 font-medium py-2.5 rounded-lg transition disabled:opacity-50"
        >
          <svg className="w-5 h-5" viewBox="0 0 48 48" aria-hidden>
            <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.4 29.2 35.5 24 35.5c-6.4 0-11.5-5.1-11.5-11.5S17.6 12.5 24 12.5c2.9 0 5.6 1.1 7.7 2.9l5.7-5.7C33.9 6.3 29.2 4.5 24 4.5 13.2 4.5 4.5 13.2 4.5 24S13.2 43.5 24 43.5c10.8 0 19.5-8.7 19.5-19.5 0-1.2-.1-2.3-.4-3.5z"/>
            <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16 19 12.5 24 12.5c2.9 0 5.6 1.1 7.7 2.9l5.7-5.7C33.9 6.3 29.2 4.5 24 4.5c-7.3 0-13.6 4-17.7 10.2z"/>
            <path fill="#4CAF50" d="M24 43.5c5.1 0 9.7-1.7 13.2-4.7l-6.1-5c-2 1.3-4.4 2.1-7.1 2.1-5.2 0-9.6-3.1-11.4-7.6l-6.5 5C9.9 39.6 16.4 43.5 24 43.5z"/>
            <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.2-4.2 5.6l6.1 5c-.4.4 6.6-4.8 6.6-14.6 0-1.2-.1-2.3-.2-3.5z"/>
          </svg>
          Google 계정으로 로그인
        </button>

        {domainError && (
          <div className="mt-4 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-lg p-3">
            {domainError}
          </div>
        )}

        <p className="text-center text-[11px] text-slate-400 mt-6">
          © MYRIAD IP · Online Enforcement Team
        </p>
      </div>
    </div>
  )
}
