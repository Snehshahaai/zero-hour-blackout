/** Dev-only: game server on :2567 with very short rounds, for browser soak tests. */
import { createGameServer } from '../src/server.ts';
const s = createGameServer(
  { CLIENT_ORIGINS: ['http://localhost:5173'] },
  {
    roundRules: {
      freezeSeconds: 1,
      roundSeconds: 8,
      roundEndSeconds: 1,
      roundsToWin: 99,
      deathmatchSeconds: 900,
    },
  },
);
await s.listen(2567);
console.log('short-round server up');
