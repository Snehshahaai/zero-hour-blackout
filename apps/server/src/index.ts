import { loadConfig } from './config.ts';
import { createGameServer } from './server.ts';

const config = loadConfig();
const server = createGameServer(config);

await server.listen(config.PORT);
console.log(`[server] ZERO HOUR: BLACKOUT game server listening on :${config.PORT}`);
