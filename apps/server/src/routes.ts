import { createEndpoint, createRouter } from '@colyseus/core';
import { GAME_NAME } from '@zhb/shared';

export function createRoutes(startedAt: number) {
  const health = createEndpoint('/health', { method: 'GET' }, async () => ({
    status: 'ok' as const,
    game: GAME_NAME,
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
  }));
  return createRouter({ health });
}
