"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";

type Props = {
  supabase: { url: string; anonKey: string };
  next: string;
  quick: { users: { email: string; label: string }[]; password: string } | null;
};

export function LoginForm({ supabase, next, quick }: Props) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function signIn(e: string, p: string) {
    setBusy(true);
    setError(null);
    const client = createBrowserClient(supabase.url, supabase.anonKey);
    const { error } = await client.auth.signInWithPassword({ email: e, password: p });
    setBusy(false);
    if (error) return setError("Email or password is incorrect");
    router.replace(next);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-6">
      <form
        className="flex flex-col gap-3"
        onSubmit={(ev) => {
          ev.preventDefault();
          void signIn(email, password);
        }}
      >
        <input className="input" type="email" placeholder="Email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <input className="input" type="password" placeholder="Password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        {error && <p className="text-sm text-red-700">{error}</p>}
        <button className="btn-primary" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>

      {quick && (
        <section className="rounded-lg border border-dashed border-amber-500 bg-amber-50 p-3">
          <p className="mb-2 text-xs font-semibold uppercase text-amber-800">Non-prod quick login</p>
          <div className="grid grid-cols-3 gap-2">
            {/* labels are the email local part: host, stage, kitchen, photographer, admin, finance, coordinator, superadmin */}
            {quick.users.map((u) => (
              <button key={u.email} className="btn-secondary text-sm" disabled={busy} data-testid={`quick-${u.label}`} onClick={() => signIn(u.email, quick.password)}>
                {u.label}
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
