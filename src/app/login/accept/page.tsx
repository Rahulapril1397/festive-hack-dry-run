import { publicSupabaseConfig } from "@/lib/db/auth";
import { AcceptInvite } from "./AcceptInvite";

export const dynamic = "force-dynamic";

/** Landing page for Supabase invite links (redirectTo = APP_URL/login/accept). */
export default function AcceptPage() {
  return (
    <main className="mx-auto max-w-sm p-8">
      <h1 className="mb-6 text-2xl font-bold text-rose-800">Set your password</h1>
      <AcceptInvite supabase={publicSupabaseConfig()} />
    </main>
  );
}
