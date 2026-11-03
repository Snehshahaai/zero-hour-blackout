/**
 * Security headers for the static web app. One definition feeds `vite preview` (so CSP is
 * exercised locally) and is mirrored in render.yaml (a test keeps the two identical).
 *
 * - `wasm-unsafe-eval`: the physics engine is WebAssembly. No `unsafe-eval` for JS.
 * - `style-src 'unsafe-inline'`: React sets inline `style` attributes (progress bars etc.).
 * - `connect-src`: the game server (HTTPS + WSS). Tighten to the exact server origin in production.
 */
export function contentSecurityPolicy(connectSrc: string): string {
  return [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src ${connectSrc}`,
    "media-src 'self' blob:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

export const PRODUCTION_CONNECT_SRC = "'self' https: wss:";

export function securityHeaders(connectSrc: string): Record<string, string> {
  return {
    'Content-Security-Policy': contentSecurityPolicy(connectSrc),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'DENY',
    // Pointer lock and audio are needed; everything else sensitive is off.
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
  };
}
