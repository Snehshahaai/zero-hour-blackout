import { describe, expect, it } from 'vitest';
import { ReportThrottle, buildReport } from './errorReporter.ts';

describe('buildReport', () => {
  it('captures message and stack from Errors, strings and junk, within server limits', () => {
    const e = new Error('boom');
    expect(buildReport('error', e).message).toBe('boom');
    expect(buildReport('error', e).stack).toContain('boom');
    expect(buildReport('unhandledrejection', 'plain string').message).toBe('plain string');
    expect(buildReport('error', undefined).message).toBe('undefined');
    expect(buildReport('error', null).message).toBe('null');
    const huge = buildReport(
      'error',
      { message: 'm'.repeat(9999), stack: 's'.repeat(99999) },
      { url: 'u'.repeat(999), userAgent: 'a'.repeat(999), build: 'b'.repeat(999) },
    );
    expect(huge.message.length).toBe(500);
    expect(huge.stack?.length).toBe(4000);
    expect(huge.url?.length).toBe(300);
    expect(huge.userAgent?.length).toBe(300);
    expect(huge.build?.length).toBe(60);
  });
});

describe('ReportThrottle', () => {
  it('drops duplicates and benign browser noise, and caps the total per session', () => {
    const t = new ReportThrottle(3);
    const r = (m: string) => buildReport('error', new Error(m));
    expect(t.allow(r('a'))).toBe(true);
    expect(t.allow(r('a'))).toBe(false); // duplicate
    expect(
      t.allow(
        buildReport('error', 'ResizeObserver loop completed with undelivered notifications.'),
      ),
    ).toBe(false);
    expect(t.allow(buildReport('error', 'Script error.'))).toBe(false);
    expect(t.allow(r('b'))).toBe(true);
    expect(t.allow(r('c'))).toBe(true);
    expect(t.allow(r('d'))).toBe(false); // cap of 3 reached
  });
});
