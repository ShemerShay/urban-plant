'use client'

import posthog from 'posthog-js'
import { PostHogProvider as PHProvider } from 'posthog-js/react'

const posthogKey = process.env.NEXT_PUBLIC_POSTHOG_KEY
const posthogHost = process.env.NEXT_PUBLIC_POSTHOG_HOST

/** Private one-time activation: `?up_internal=1` — not for public QR links. */
const INTERNAL_QUERY_PARAM = 'up_internal'
const INTERNAL_QUERY_VALUE = '1'
const INTERNAL_STORAGE_KEY = 'up_ph_internal'

/**
 * Persist staff-browser status and stamp every later event with `is_internal`.
 * Must run after init and before child useEffects capture (e.g. TrackPosScan).
 */
function applyInternalDeviceCapture(): void {
  try {
    const params = new URLSearchParams(window.location.search)
    if (params.get(INTERNAL_QUERY_PARAM) === INTERNAL_QUERY_VALUE) {
      localStorage.setItem(INTERNAL_STORAGE_KEY, '1')
      params.delete(INTERNAL_QUERY_PARAM)
      const qs = params.toString()
      const next =
        window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash
      window.history.replaceState(null, '', next)
    }
    if (localStorage.getItem(INTERNAL_STORAGE_KEY) === '1') {
      posthog.register({ is_internal: true })
    }
  } catch {
    // localStorage / history unavailable (private mode restrictions, etc.)
  }
}

/**
 * Init must run before child useEffects (e.g. TrackPosScan).
 * useEffect-based init races: children capture while __loaded=false,
 * posthog.capture no-ops, and sessionStorage dedupe burns the slot.
 */
let clientInitialized = false
function ensurePostHogClient(): void {
  if (clientInitialized || !posthogKey || typeof window === 'undefined') return
  posthog.init(posthogKey, {
    api_host: posthogHost,
    ui_host: process.env.NEXT_PUBLIC_POSTHOG_UI_HOST || posthogHost,
    capture_pageview: false, // handled by PostHogPageView
    capture_pageleave: true,
  })
  applyInternalDeviceCapture()
  clientInitialized = true
}

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  ensurePostHogClient()

  if (!posthogKey) return <>{children}</>

  return <PHProvider client={posthog}>{children}</PHProvider>
}
