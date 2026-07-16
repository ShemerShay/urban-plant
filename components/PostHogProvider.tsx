'use client'

import posthog from 'posthog-js'
import { PostHogProvider as PHProvider } from 'posthog-js/react'
import { useEffect } from 'react'

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  const posthogKey = process.env.NEXT_PUBLIC_POSTHOG_KEY

  useEffect(() => {
    if (!posthogKey) return
    posthog.init(posthogKey, {
      api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST,
      ui_host: process.env.NEXT_PUBLIC_POSTHOG_UI_HOST || process.env.NEXT_PUBLIC_POSTHOG_HOST,
      capture_pageview: false, // handled by PostHogPageView
      capture_pageleave: true,
    })
  }, [posthogKey])

  if (!posthogKey) return <>{children}</>

  return <PHProvider client={posthog}>{children}</PHProvider>
}
