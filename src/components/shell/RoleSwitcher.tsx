"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";

/** Non-prod only: switch between the seeded demo users. */
export function RoleSwitcher(props: { supabase: { url: string; anonKey: string }; users: { email: string; label: string }[]; currentEmail: string | null; password: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <select
      className="rounded border border-amber-400 bg-amber-50 px-1 py-0.5 text-xs"
      value={props.currentEmail ?? ""}
      disabled={busy}
      title="Dev user switcher (non-prod)"
      data-testid="role-switcher"
      onChange={async (e) => {
        setBusy(true);
        const client = createBrowserClient(props.supabase.url, props.supabase.anonKey);
        await client.auth.signOut();
        await client.auth.signInWithPassword({ email: e.target.value, password: props.password });
        setBusy(false);
        router.replace("/");
        router.refresh();
      }}
    >
      {!props.users.some((u) => u.email === props.currentEmail) && <option value="">switch user…</option>}
      {props.users.map((u) => (
        <option key={u.email} value={u.email}>
          as {u.label}
        </option>
      ))}
    </select>
  );
}
