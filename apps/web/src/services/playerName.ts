import { playerNameSchema } from '@zhb/shared';

const KEY = 'zhb.playerName';

export function loadPlayerName(): string {
  try {
    const parsed = playerNameSchema.safeParse(localStorage.getItem(KEY));
    if (parsed.success) return parsed.data;
  } catch {
    /* ignore */
  }
  return `Operator${Math.floor(1000 + Math.random() * 9000)}`;
}

export function savePlayerName(name: string): void {
  try {
    localStorage.setItem(KEY, name);
  } catch {
    /* ignore */
  }
}
