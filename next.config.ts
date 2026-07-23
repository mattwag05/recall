import type { NextConfig } from 'next'

const securityHeaders = [
  {
    key: 'Content-Security-Policy',
    value: "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; frame-ancestors 'none'; referrer-policy strict-origin-when-cross-origin",
  },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
]

const nextConfig: NextConfig = {
  output: 'standalone',
  allowedDevOrigins: ['127.0.0.1'],
  serverExternalPackages: ['better-sqlite3', 'pdf-parse', 'jsdom'],
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**.cdninstagram.com' },
      { protocol: 'https', hostname: '**.fbcdn.net' },
      { protocol: 'https', hostname: 'scontent.cdninstagram.com' },
      { protocol: 'https', hostname: '**.threads.net' },
      { protocol: 'https', hostname: 'static.cdninstagram.com' },
      { protocol: 'https', hostname: '**' },
    ],
  },
}

async function headers() {
  return [{ source: '/(.*)', headers: securityHeaders }]
}

export default nextConfig

export { headers }
