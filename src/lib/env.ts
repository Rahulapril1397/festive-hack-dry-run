import "server-only";
import { z } from "zod";

const schema = z.object({
  APP_ENV: z.enum(["local", "staging", "production"]).default("local"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  GIT_SHA: z.string().default("dev"),
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  CLOCK_HMAC_SECRET: z.string().min(16),
});

export type ServerEnv = z.infer<typeof schema>;

let cached: ServerEnv | undefined;

/** Read lazily so `next build` works without secrets; fails loudly on first real use. */
export function env(): ServerEnv {
  cached ??= schema.parse(process.env);
  return cached;
}

export const isProduction = () => (process.env.APP_ENV ?? "local") === "production";
