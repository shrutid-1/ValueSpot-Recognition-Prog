import React from 'react'
import ReactDOM from 'react-dom/client'
import { AppProviders } from './app/providers'
import './styles/globals.css'
/*
  The Employee experience's own system. Loaded after globals so its scoped
  rules win where they overlap, and entirely inert until something sets
  data-vs-theme="dark" — which only the Employee shell does.
*/
import './styles/employee-theme.css'
/*
  Re-points the light Blueprint tokens at the dark system, but only inside the
  Employee shell — so screens not yet rewritten (the wizard, Support, Profile,
  the notification centre) still come out coherent.
*/
import './styles/employee-bridge.css'
/*
  The administrative system (Manager, HR Admin, Super Admin). Loaded LAST so
  its scoped rules win where they restate a shared primitive — the feed
  components are one set of classes wearing two systems, and this is the one
  that has to come second. Inert until AppShell sets data-vs-portal="admin".
*/
import './styles/admin-theme.css'
/*
  The profile header card and its dialogs. Reads whichever of the systems
  above is in force through its own .vp-scope tokens, so it is last.
*/
import './styles/profile.css'
/* The AI interpretation panel on Reports. Token-driven, like the above. */
import './styles/report-insights.css'
/* The Core Value journey's season panel and trails. Token-driven, like the above. */
import './styles/journey.css'
/* My Recognitions' tabs, summary and cards. Token-driven, like the above. */
import './styles/my-recognitions.css'
/* Sign in, create account, the emailed code and reset password. Scoped to .au-scope. */
import './styles/auth.css'
/*
  The second mode of each portal — Employee light, administrative dark —
  switched by the `dark` class on <html>. Last, because it re-values tokens
  and restates literals from every stylesheet above.
*/
import './styles/theme-modes.css'

const root = document.getElementById('root')
if (!root) throw new Error('Root element not found')

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <AppProviders />
  </React.StrictMode>
)
