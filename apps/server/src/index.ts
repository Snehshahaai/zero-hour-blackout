import { loadConfig } from './config.ts';
import { createGameServer } from './server.ts';

const config = loadConfig();
const server = createGameServer(config, {
  metricsToken: config.METRICS_TOKEN,
  limits: {
    maxRooms: config.MAX_ROOMS,
    upgradeBurst: config.UPGRADE_BURST,
    upgradeRefillPerSecond: config.UPGRADE_REFILL_PER_SEC,
    maxPayloadBytes: config.MAX_PAYLOAD_BYTES,
    trustProxy: config.TRUST_PROXY,
  },
});

// One bad room must never take every match down with it: log loudly, keep serving.
process.on('unhandledRejection', (reason) => {
  console.error(JSON.stringify({ type: 'unhandled_rejection', reason: String(reason) }));
});
process.on('uncaughtException', (err) => {
  console.error(
    JSON.stringify({ type: 'uncaught_exception', message: err.message, stack: err.stack }),
  );
});

await server.listen(config.PORT);
console.log(`[server] ZERO HOUR: BLACKOUT game server listening on :${config.PORT}`);

// Colyseus handles SIGTERM/SIGINT (graceful room shutdown); make that visible in the logs.
for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.once(sig, () => console.log(`[server] ${sig} received, shutting down gracefully`));
}
