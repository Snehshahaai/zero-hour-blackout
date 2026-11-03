import { describe, expect, it, vi } from 'vitest';
import { GameLoop } from './GameLoop.ts';

describe('GameLoop', () => {
  it('runs fixed steps and reports interpolation alpha', () => {
    const update = vi.fn();
    const render = vi.fn();
    const loop = new GameLoop({ update, render }, { tickRate: 10 });
    loop.advance(0.25); // 2 ticks of 0.1s, 0.05 left
    expect(update).toHaveBeenCalledTimes(2);
    expect(render).toHaveBeenCalledTimes(1);
    expect(render.mock.calls[0]![0]).toBeCloseTo(0.5);
  });
  it('caps catch-up steps after a stall', () => {
    const update = vi.fn();
    const loop = new GameLoop({ update, render: vi.fn() }, { tickRate: 60, maxStepsPerFrame: 5 });
    loop.advance(10);
    expect(update).toHaveBeenCalledTimes(5);
  });
});
