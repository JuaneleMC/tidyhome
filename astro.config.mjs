// @ts-check
import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import vercel from '@astrojs/vercel';
import tailwindcss from '@tailwindcss/vite';

// Detectar automáticamente si estamos en Vercel (despliegue 24/7 en la nube)
// o en entorno local/Node convencional
const isVercel = Boolean(process.env.VERCEL || process.env.VERCEL_ENV);

// https://astro.build/config
export default defineConfig({
  output: 'server',
  security: {
    checkOrigin: false,
  },
  adapter: isVercel ? vercel() : node({ mode: 'standalone' }),
  vite: {
    plugins: [tailwindcss()],
  },
});
