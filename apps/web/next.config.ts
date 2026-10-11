import type { NextConfig } from 'next';

/**
 * O navegador fala só com este domínio: `/api/*` é repassado à API. Assim o
 * cookie de sessão é do mesmo site (SameSite=Lax) e não há CORS. Em produção
 * o Traefik faz o mesmo roteamento antes de chegar aqui.
 */
const API_INTERNAL_URL = process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:4000';

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=()' },
];

const config: NextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${API_INTERNAL_URL}/api/:path*` }];
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
  images: {
    // Capas vêm do bucket público (CDN em produção).
    remotePatterns: [{ protocol: 'http', hostname: '127.0.0.1' }, { protocol: 'https', hostname: '**' }],
  },
};

export default config;
