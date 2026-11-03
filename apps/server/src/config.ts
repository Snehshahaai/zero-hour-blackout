import { DEFAULT_SERVER_PORT } from '@zhb/shared';
import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(DEFAULT_SERVER_PORT),
  CLIENT_ORIGINS: z
    .string()
    .default('http://localhost:5173')
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  MAX_ROOMS: z.coerce.number().int().min(1).default(200),
  UPGRADE_BURST: z.coerce.number().int().min(1).default(60),
  UPGRADE_REFILL_PER_SEC: z.coerce.number().min(0.1).default(2),
  MAX_PAYLOAD_BYTES: z.coerce.number().int().min(512).default(8192),
  TRUST_PROXY: z
    .enum(['true', 'false', '1', '0'])
    .default('false')
    .transform((v) => v === 'true' || v === '1'),
  /** If set, GET /metrics requires `Authorization: Bearer <token>`. */
  METRICS_TOKEN: z.string().min(8).optional(),
});

export type ServerConfig = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  return envSchema.parse(env);
}
