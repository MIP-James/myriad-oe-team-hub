import { createContext, useContext, useEffect, useState } from 'react'
import { supabase, ALLOWED_DOMAIN } from '../lib/supabase'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  const [domainError, setDomainError] = useState(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      handleSession(data.session)
      setLoading(false)
    })

    const { data: listener } = supabase.auth.onAuthStateChange((_event, s) => {
      handleSession(s)
    })
    return () => listener.subscription.unsubscribe()
  }, [])

  async function handleSession(s) {
    if (!s) {
      setSession(null)
      return
    }
    const email = s.user?.email ?? ''
    if (ALLOWED_DOMAIN && !email.toLowerCase().endsWith('@' + ALLOWED_DOMAIN.toLowerCase())) {
      setDomainError(`허용되지 않은 도메인입니다. (${ALLOWED_DOMAIN} 계정만 접근 가능)`)
      await supabase.auth.signOut()
      setSession(null)
      return
    }
    setDomainError(null)
    setSession(s)
  }

  async function signInWithGoogle() {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin,
        queryParams: ALLOWED_DOMAIN ? { hd: ALLOWED_DOMAIN } : undefined
      }
    })
    if (error) throw error
  }

  async function signOut() {
    await supabase.auth.signOut()
  }

  const value = {
    session,
    user: session?.user ?? null,
    loading,
    domainError,
    signInWithGoogle,
    signOut
  }
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
