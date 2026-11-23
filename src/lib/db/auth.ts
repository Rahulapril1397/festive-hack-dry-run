import "server-only";
import { cookies } from "next/headers";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { env } from "@/lib/env";

/** Per-request Supabase client bound to the auth cookies (anon key + user JWT). */
export async function authClient() {
  const store = await cookies();
  return createServerClient(env().SUPABASE_URL, env().SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list: { name: string; value: string; options: CookieOptions }[]) => {
        try {
          list.forEach(({ name, value, options }) => store.set(name, value, options));
        } catch {
          // Called from a Server Component: cookies are read-only there. Route handlers refresh them.
        }
      },
    },
  });
}

/** Values the browser needs to sign in. Sent at runtime so one image serves every environment. */
export function publicSupabaseConfig() {
  return { url: env().SUPABASE_URL, anonKey: env().SUPABASE_ANON_KEY };
}
