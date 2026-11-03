import { useEffect, useState } from 'react';
import { checkServer, type ServerStatus } from '../services/serverStatus.ts';

export function useServerStatus(intervalMs = 5000): ServerStatus {
  const [status, setStatus] = useState<ServerStatus>('checking');
  useEffect(() => {
    const ctrl = new AbortController();
    const poll = () =>
      void checkServer(ctrl.signal).then((s) => !ctrl.signal.aborted && setStatus(s));
    poll();
    const id = setInterval(poll, intervalMs);
    return () => {
      ctrl.abort();
      clearInterval(id);
    };
  }, [intervalMs]);
  return status;
}
