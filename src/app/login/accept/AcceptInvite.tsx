"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";

/** Reads the invite tokens from the URL fragment, starts the session, then sets a password. */
export function AcceptInvite({ supabase }: { supabase: { url: string; anonKey: string } }) {
  const router = useRouter();
  const client = useMemo(() => createBrowserClient(supabase.url, supabase.anonKey), [supabase.url, supabase.anonKey]);
  const [state, setState] = useState<"loading" | "ready" | "invalid" | "saving">("loading");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const access_token = hash.get("access_token");
    const refresh_token = hash.get("refresh_token");
    (async () => {
      if (access_token && refresh_token) {
        const { error } = await client.auth.setSession({ access_token, refresh_token });
        window.history.replaceState(null, "", window.location.pathname); // drop tokens from the URL
        setState(error ? "invalid" : "ready");
      } else {
        const { data } = await client.auth.getUser();
        setState(data.user ? "ready" : "invalid");
      }
    })();
  }, [client]);

  if (state === "loading") return <p className="text-stone-500">Checking your invite…</p>;
  if (state === "invalid") return <p className="text-red-700">This invite link is invalid or has expired. Ask your administrator for a new one.</p>;
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (pw.length < 12) return setErr("Use at least 12 characters");
        setState("saving");
        const { error } = await client.auth.updateUser({ password: pw });
        if (error) {
          setErr(error.message);
          return setState("ready");
        }
        router.replace("/");
        router.refresh();
      }}
    >
      <input className="input" type="password" autoComplete="new-password" placeholder="New password (12+ characters)" value={pw} onChange={(e) => setPw(e.target.value)} />
      {err && <p className="text-sm text-red-700">{err}</p>}
      <button className="btn-primary" disabled={state === "saving"}>
        {state === "saving" ? "Saving…" : "Save and continue"}
      </button>
    </form>
  );
}
