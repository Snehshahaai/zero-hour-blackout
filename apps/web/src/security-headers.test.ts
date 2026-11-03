import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  PRODUCTION_CONNECT_SRC,
  contentSecurityPolicy,
  securityHeaders,
} from '../security-headers.ts';

describe('security headers', () => {
  it('render.yaml serves exactly the CSP (and the same headers) that the code defines', () => {
    const yaml = readFileSync(new URL('../../../render.yaml', import.meta.url), 'utf8');
    expect(yaml).toContain(`value: "${contentSecurityPolicy(PRODUCTION_CONNECT_SRC)}"`);
    for (const [name, value] of Object.entries(securityHeaders(PRODUCTION_CONNECT_SRC))) {
      if (name === 'Content-Security-Policy') continue;
      expect(yaml).toContain(`name: ${name}`);
      expect(yaml).toContain(`value: ${value}`);
    }
  });

  it('never allows unsafe-eval, remote scripts, framing or plugins', () => {
    const csp = contentSecurityPolicy(PRODUCTION_CONNECT_SRC);
    expect(csp).not.toMatch(/'unsafe-eval'/);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toMatch(/script-src 'self' 'wasm-unsafe-eval'(;|$)/);
  });
});
