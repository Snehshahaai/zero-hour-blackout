import { defineRoom, defineServer, matchMaker } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { MATCH_ROOM_NAME } from '@zhb/shared';
import type { CoopRules, PowerRules, RoundRules, Weather } from '@zhb/shared';
import type { ServerConfig } from './config.ts';
import { MatchRoom } from './rooms/MatchRoom.ts';
import { createRoutes } from './routes.ts';

export function createGameServer(
  config: Pick<ServerConfig, 'CLIENT_ORIGINS'>,
  options: {
    roundRules?: Partial<RoundRules>;
    powerRules?: Partial<PowerRules>;
    coopRules?: Partial<CoopRules>;
    weather?: Weather;
  } = {},
) {
  MatchRoom.roundRules = options.roundRules ?? {};
  MatchRoom.powerRules = options.powerRules ?? {};
  MatchRoom.coopRules = options.coopRules ?? {};
  MatchRoom.weatherOverride = options.weather ?? null;
  // Colyseus defaults to `Access-Control-Allow-Origin: <any origin>`. Restrict it to our web origins.
  matchMaker.controller.getCorsHeaders = (headers) => {
    const origin = headers.get('origin');
    const allowed = origin !== null && config.CLIENT_ORIGINS.includes(origin);
    return {
      'Access-Control-Allow-Origin': allowed ? origin : (config.CLIENT_ORIGINS[0] ?? 'null'),
      Vary: 'Origin',
    };
  };

  return defineServer({
    transport: new WebSocketTransport(),
    rooms: {
      // Public quick-play only pairs players who asked for the same visibility/format/mode.
      [MATCH_ROOM_NAME]: defineRoom(MatchRoom).filterBy(['visibility', 'format', 'mode']),
    },
    routes: createRoutes(Date.now()),
    greet: false,
  });
}
