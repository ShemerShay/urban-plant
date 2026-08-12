'use client'

import posthog from 'posthog-js'
import { PostHogProvider as PHProvider } from 'posthog-js/react'

const posthogKey = process.env.NEXT_PUBLIC_POSTHOG_KEY
const posthogHost = process.env.NEXT_PUBLIC_POSTHOG_HOST

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
  clientInitialized = true
}

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  ensurePostHogClient()

  if (!posthogKey) return <>{children}</>

  return <PHProvider client={posthog}>{children}</PHProvider>
}
