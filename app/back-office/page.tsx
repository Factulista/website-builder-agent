'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function BackOfficeIndex() {
  const router = useRouter()
  useEffect(() => { router.replace('/back-office/agents') }, [router])
  return null
}
