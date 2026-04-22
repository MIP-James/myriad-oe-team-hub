import { createContext, useContext, useEffect, useState } from 'react'
import { supabase, ALLOWED_DOMAIN } from '../lib/supabase'

const AuthContext = createContext(null)

// Google OAuth access_token (provider_token) 저장소.
// Supabase 가 자동 refresh 해주지 않으므로 sessionStorage 에 직접 보관하고
// 만료(보수적으로 55분) 시 null 반환하여 재로그인 유도.
const GOOGLE_TOKEN_KEY = 'myriad_google_token'
const GOOGLE_TOKEN_TTL_MS = 55 * 60 * 1000

function saveGoogleToken(token) {
  try {
    if (!token) {
      sessionStorage.removeItem(GOOGLE_TOKEN_KEY)
      return
    }
    sessionStorage.setItem(
      GOOGLE_TOKEN_KEY,
      JSON.stringify({ token, savedAt: Date.now() })
    )
  } catch {}
}

function loadGoogleToken() {
  try {
    const raw = sessionStorage.getItem(GOOGLE_TOKEN_KEY)
    if (!raw) return null
    const { token, savedAt } = JSON.parse(raw)
    if (Date.now() - savedAt > GOOGLE_TOKEN_TTL_MS) {
      sessionStorage.removeItem(GOOGLE_TOKEN_KEY)
      return null
    }
    return token
  } catch {
    return null
  }
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [domainError, setDomainError] = useState(null)
  const [googleAccessToken, setGoogleAccessToken] = useState(loadGoogleToken())

  useEffect(() => {
    let mounted = true

    const init = async () => {
      try {
        const { data } = await supabase.auth.getSession()
        // provider_token 은 OAuth 직후에만 붙어있음 (refresh 시 소실)
        if (data.session?.provider_token) {
          saveGoogleToken(data.session.provider_token)
          setGoogleAccessToken(data.session.provider_token)
        }
        await handleSession(data.session)
      } catch (e) {
        console.error('[Auth] init failed:', e)
      } finally {
        if (mounted) setLoading(false)
      }
    }
    init()

    const { data: listener } = supabase.auth.onAuthStateChange(async (event, s) => {
      try {
        // SIGNED_IN 이벤트에 provider_token 이 함께 옴
        if (event === 'SIGNED_IN' && s?.provider_token) {
          saveGoogleToken(s.provider_token)
          setGoogleAccessToken(s.provider_token)
        }
        if (event === 'SIGNED_OUT') {
          saveGoogleToken(null)
          setGoogleAccessToken(null)
        }
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
        scopes: 'https://www.googleapis.com/auth/drive.file',
        queryParams: {
          ...(ALLOWED_DOMAIN ? { hd: ALLOWED_DOMAIN } : {}),
          access_type: 'offline',
          prompt: 'consent'
        }
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
    googleAccessToken,
    hasGoogleToken: !!googleAccessToken,
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
