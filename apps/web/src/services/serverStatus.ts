import { DEFAULT_SERVER_PORT } from '@zhb/shared';

export const SERVER_HTTP_URL: string =
  import.meta.env.VITE_SERVER_URL ?? `http://localhost:${DEFAULT_SERVER_PORT}`;

export type ServerStatus = 'checking' | 'online' | 'offline';

export async function checkServer(signal: AbortSignal): Promise<ServerStatus> {
  try {
    const res = await fetch(`${SERVER_HTTP_URL}/health`, { signal, cache: 'no-store' });
    return res.ok ? 'online' : 'offline';
  } catch {
    return 'offline';
  }
}
