import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'SOS Comida',
    short_name: 'SOS Comida',
    description: 'Doações com prestação de contas verificável',
    start_url: '/',
    display: 'standalone',
    background_color: '#fffbf4',
    theme_color: '#26b4e0',
    lang: 'pt-BR',
    icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }],
  };
}
