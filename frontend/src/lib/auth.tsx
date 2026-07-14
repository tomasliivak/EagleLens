import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'

type AuthContextValue = {
  session: Session | null
  loading: boolean
  signIn: () => void
  signOut: () => void
}

const AuthContext = createContext<AuthContextValue>({
  session: null,
  loading: true,
  signIn: () => {},
  signOut: () => {},
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // When the signup trigger rejects a non-BC account, Supabase redirects
    // back with #error_description=... — clean it off the URL.
    if (window.location.hash.includes('error_description')) {
      console.warn('Sign-in is limited to @bc.edu accounts.')
      history.replaceState(null, '', window.location.pathname + window.location.search)
    }

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      // The database trigger blocks non-BC signups; this is a client safety net.
      if (s && !s.user.email?.toLowerCase().endsWith('@bc.edu')) {
        supabase.auth.signOut()
        return
      }
      setSession(s)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  const signIn = () => {
    supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.href,
        // hd narrows Google's account picker to bc.edu — a hint only; real
        // enforcement is the auth.users trigger + RLS checks in the database.
        queryParams: { hd: 'bc.edu', prompt: 'select_account' },
      },
    })
  }

  const signOut = () => {
    supabase.auth.signOut()
  }

  return (
    <AuthContext.Provider value={{ session, loading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
