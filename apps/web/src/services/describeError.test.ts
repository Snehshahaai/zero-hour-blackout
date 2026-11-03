import { describe as suite, expect, it } from 'vitest';
import { describe } from './network.ts';

suite('describe (player-facing network errors)', () => {
  it('translates matchmaker errors and never leaks raw technical text', () => {
    expect(describe({ code: 522, message: 'room "ABC123" not found' })).toMatch(
      /No room with that code/,
    );
    expect(describe({ code: 522, message: 'room "ABC123" is locked' })).toMatch(
      /full or its match has already started/,
    );
    expect(describe({ code: 4002, message: 'Invalid player name' })).toMatch(/callsign/);
    expect(describe({ code: 503, message: 'Server is busy, try again shortly' })).toMatch(/busy/);
    expect(describe({ code: 500, message: 'Internal Server Error' })).toMatch(
      /server had a problem/,
    );
    expect(describe(new Error('Failed to fetch'))).toMatch(/Could not reach the game server/);
    expect(describe(undefined)).toMatch(/Could not reach/);
    for (const e of [
      { code: 522, message: 'room "X" is locked' },
      { code: 500, message: 'Internal Server Error' },
    ]) {
      expect(describe(e)).not.toMatch(/locked|Internal Server Error|"X"/);
    }
  });
});
