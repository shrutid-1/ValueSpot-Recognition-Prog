/*
  "Remember me", on the sign-in form.

  Remembered (the default, and how every session behaved before the box
  existed): the session lives in localStorage and survives closing the
  browser. Not remembered: it lives in sessionStorage instead, so it ends when
  the browser — or that tab — closes, and a new tab asks for sign-in again.

  The choice is read at the moment Supabase WRITES the session, which is the
  sign-in itself and every token refresh after it, so it holds for the whole
  session. Reads look in both places, so nothing is lost when the choice
  changes between one sign-in and the next. Storage that throws (a private
  window, blocked site data) degrades to an in-memory session rather than a
  failed sign-in.

  Kept apart from lib/supabase.ts, which cannot be imported without the
  project's environment variables, so this can be exercised on its own.
*/
const REMEMBER_KEY = 'valuespot.remember'

export function getRememberMe(): boolean {
  try {
    return localStorage.getItem(REMEMBER_KEY) !== '0'
  } catch {
    return true
  }
}

export function setRememberMe(remember: boolean): void {
  try {
    localStorage.setItem(REMEMBER_KEY, remember ? '1' : '0')
  } catch {
    // Not being able to store the preference is not worth failing sign-in over.
  }
}

/** The storage adapter handed to supabase-js (auth.storage). */
export const authStorage = {
  getItem(key: string): string | null {
    try {
      return sessionStorage.getItem(key) ?? localStorage.getItem(key)
    } catch {
      return null
    }
  },
  setItem(key: string, value: string): void {
    try {
      const [keep, drop] = getRememberMe()
        ? [localStorage, sessionStorage]
        : [sessionStorage, localStorage]
      keep.setItem(key, value)
      drop.removeItem(key)
    } catch {
      // See above: the session simply is not persisted.
    }
  },
  removeItem(key: string): void {
    try {
      localStorage.removeItem(key)
      sessionStorage.removeItem(key)
    } catch {
      // Nothing was stored, so there is nothing to remove.
    }
  },
}
