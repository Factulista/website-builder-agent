import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Website Builder Agent',
  description: 'AI-powered SEO website builder',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
