import { defineServer, matchMaker } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { loadConfig } from './config.ts';
import { createRoutes } from './routes.ts';

const config = loadConfig();

// Colyseus defaults to `Access-Control-Allow-Origin: <any origin>`. Restrict it to our web origins.
matchMaker.controller.getCorsHeaders = (headers) => {
  const origin = headers.get('origin');
  const allowed = origin !== null && config.CLIENT_ORIGINS.includes(origin);
  return {
    'Access-Control-Allow-Origin': allowed ? origin : (config.CLIENT_ORIGINS[0] ?? 'null'),
    Vary: 'Origin',
  };
};

const server = defineServer({
  transport: new WebSocketTransport(),
  // Lobby / match rooms are registered here starting in Phase 5.
  rooms: {},
  routes: createRoutes(Date.now()),
  greet: false,
});

await server.listen(config.PORT);
console.log(`[server] ZERO HOUR: BLACKOUT game server listening on :${config.PORT}`);
