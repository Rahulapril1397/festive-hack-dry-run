"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";

/** Non-prod only: switch between the seeded demo users (E1 seed). */
export function RoleSwitcher(props: { supabase: { url: string; anonKey: string }; roles: string[]; current: string; password: string; domain: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <select
      className="rounded border border-amber-400 bg-amber-50 px-1 py-0.5 text-xs"
      value={props.current}
      disabled={busy}
      title="Dev role switcher (non-prod)"
      data-testid="role-switcher"
      onChange={async (e) => {
        setBusy(true);
        const client = createBrowserClient(props.supabase.url, props.supabase.anonKey);
        await client.auth.signOut();
        await client.auth.signInWithPassword({ email: `${e.target.value}@${props.domain}`, password: props.password });
        setBusy(false);
        router.replace("/");
        router.refresh();
      }}
    >
      {props.roles.map((r) => (
        <option key={r} value={r}>
          as {r}
        </option>
      ))}
    </select>
  );
}
