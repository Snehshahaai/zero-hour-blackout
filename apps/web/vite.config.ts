import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { securityHeaders } from './security-headers.ts';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, strictPort: true },
  // Local preview applies the same CSP the static host serves, so violations show up before release.
  preview: {
    port: 4173,
    headers: securityHeaders("'self' http://localhost:* ws://localhost:*"),
  },
  build: { target: 'es2022', sourcemap: true },
});
