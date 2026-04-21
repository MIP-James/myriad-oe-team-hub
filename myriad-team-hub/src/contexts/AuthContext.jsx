import { createContext, useContext, useEffect, useState } from 'react'
import { supabase, ALLOWED_DOMAIN } from '../lib/supabase'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [domainError, setDomainError] = useState(null)

  useEffect(() => {
    let mounted = true

    const init = async () => {
      try {
        const { data } = await supabase.auth.getSession()
        await handleSession(data.session)
      } catch (e) {
        console.error('[Auth] init failed:', e)
      } finally {
        if (mounted) setLoading(false)
      }
    }
    init()

    const { data: listener } = supabase.auth.onAuthStateChange(async (_event, s) => {
      try {
        await handleSession(s)
      } catch (e) {
        console.error('[Auth] session change failed:', e)
      }
    })
    return () => {
      mounted = false
      listener.subscription.unsubscribe()
    }
  }, [])

  async function handleSession(s) {
    if (!s) {
      setSession(null)
      setProfile(null)
      return
    }
    const email = s.user?.email ?? ''
    if (
      ALLOWED_DOMAIN &&
      !email.toLowerCase().endsWith('@' + ALLOWED_DOMAIN.toLowerCase())
    ) {
      setDomainError(
        `허용되지 않은 도메인입니다. (${ALLOWED_DOMAIN} 계정만 접근 가능)`
      )
      await supabase.auth.signOut()
      setSession(null)
      setProfile(null)
      return
    }
    setDomainError(null)
    setSession(s)
    // 프로필 로드는 실패해도 로그인 자체는 진행
    loadProfile(s.user.id).catch((e) =>
      console.warn('[Auth] loadProfile error:', e)
    )
  }

  async function loadProfile(userId) {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .maybeSingle()
      if (error) {
        console.warn('[Auth] profile load failed:', error.message)
        setProfile(null)
        return
      }
      setProfile(data)
    } catch (e) {
      console.warn('[Auth] profile load exception:', e)
      setProfile(null)
    }
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
    profile,
    isAdmin: profile?.role === 'admin',
    loading,
    domainError,
    signInWithGoogle,
    signOut,
    reloadProfile: () => session?.user?.id && loadProfile(session.user.id)
  }
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
