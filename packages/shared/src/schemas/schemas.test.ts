import { describe, expect, it } from 'vitest';
import { createRoomOptionsSchema, roomCodeSchema } from './index.ts';

describe('roomCodeSchema', () => {
  it('normalises case and accepts valid codes', () => {
    expect(roomCodeSchema.parse(' abc234 ')).toBe('ABC234');
  });
  it('rejects ambiguous characters and wrong length', () => {
    expect(roomCodeSchema.safeParse('ABCOO1').success).toBe(false);
    expect(roomCodeSchema.safeParse('ABC').success).toBe(false);
  });
});

describe('createRoomOptionsSchema', () => {
  it('applies defaults', () => {
    const v = createRoomOptionsSchema.parse({ playerName: 'Ghost' });
    expect(v.mode).toBe('competitive');
    expect(v.format).toBe('1v1');
  });
  it('rejects 5v5 until enabled and unsafe names', () => {
    expect(createRoomOptionsSchema.safeParse({ playerName: 'Ghost', format: '5v5' }).success).toBe(
      false,
    );
    expect(createRoomOptionsSchema.safeParse({ playerName: '<script>' }).success).toBe(false);
  });
});
