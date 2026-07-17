import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  output: 'standalone',
  allowedDevOrigins: ['127.0.0.1'],
  serverExternalPackages: ['better-sqlite3', 'pdf-parse'],
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

export default nextConfig
