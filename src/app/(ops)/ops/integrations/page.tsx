import { requirePage } from "@/components/shell/guard";
import { db } from "@/lib/db/service";
import { flagClient, isEnabled } from "@/lib/flags";
import { listRecommendations } from "@/lib/nudgebee/service";
import { sarvam } from "@/lib/sarvam/client";

export const dynamic = "force-dynamic";

/** E2 T7 (admin and host): live state of the Stage 1 integrations, counts only. */
export default async function IntegrationsPage() {
  await requirePage("integrations.read", "/ops/integrations");
  const [{ data: tts }, voice, recs, { data: evals }] = await Promise.all([
    db().from("tts_event").select("id, result, source, language, latency_ms, created_at").order("id", { ascending: false }).limit(20),
    isEnabled("voice_calls"),
    listRecommendations(),
    db().from("feature_flag_eval_log").select("id, role, flag, permission, result, fallback, created_at").order("id", { ascending: false }).limit(10),
  ]);
  const rows = tts ?? [];
  const counts = rows.reduce<Record<string, number>>((a, r) => ((a[r.result] = (a[r.result] ?? 0) + 1), a), {});
  const s = sarvam();
  const flags = flagClient();
  return (
    <main className="flex flex-col gap-6 p-4 md:p-6">
      <h1 className="text-2xl font-bold">Integrations</h1>
      <section className="grid gap-3 md:grid-cols-3">
        <Card title="Spoken announcements (voice_calls)" value={voice ? "ON" : "OFF"} note={flags.configured ? "from Flagsmith" : "Flagsmith not configured — safe default"} testid="voice-calls" />
        <Card title="Sarvam" value={s.off ? "not configured" : s.mock ? "mock (local)" : "live"} note="TTS falls back to the chime" />
        <Card title="Last 20 TTS results" value={["success", "failure", "timeout", "disabled"].map((k) => `${k} ${counts[k] ?? 0}`).join(" · ")} note={rows[0] ? `latest ${new Date(rows[0].created_at).toLocaleString("en-IN")}` : "none yet"} testid="tts-counts" />
      </section>

      <section>
        <h2 className="mb-2 font-semibold">Recent TTS results</h2>
        {rows.length === 0 ? (
          <p className="text-sm text-stone-500">No announcements yet. They appear after the first CALL NEXT.</p>
        ) : (
          <table className="w-full max-w-2xl rounded-lg border bg-white text-sm">
            <thead className="bg-stone-50 text-left">
              <tr>{["When", "Result", "Source", "Lang", "ms"].map((h) => <th key={h} className="p-2">{h}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="p-2">{new Date(r.created_at).toLocaleTimeString("en-IN")}</td>
                  <td className="p-2">{r.result}</td>
                  <td className="p-2">{r.source ?? "—"}</td>
                  <td className="p-2">{r.language ?? "—"}</td>
                  <td className="p-2 tabular-nums">{r.latency_ms ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h2 className="mb-2 font-semibold">NudgeBee recommendations</h2>
        {recs.length === 0 ? <p className="text-sm text-stone-500">None.</p> : (
          <ul className="flex flex-col gap-2 text-sm">
            {recs.slice(0, 5).map((r) => (
              <li key={r.id} className="rounded border bg-white p-2"><b>{r.status}</b> · {r.text.slice(0, 140)}</li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-2 font-semibold">Flagsmith override evaluations</h2>
        {(evals ?? []).length === 0 ? <p className="text-sm text-stone-500">None yet.</p> : (
          <ul className="text-sm">
            {(evals ?? []).map((e) => (
              <li key={e.id}>{new Date(e.created_at).toLocaleTimeString("en-IN")} · {e.role} · {e.flag} → {e.permission}: {e.result ? "granted" : "not granted"}{e.fallback ? " (fallback)" : ""}</li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function Card({ title, value, note, testid }: { title: string; value: string; note?: string; testid?: string }) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-3">
      <p className="text-xs text-stone-500">{title}</p>
      <p className="text-lg font-bold" data-testid={testid}>{value}</p>
      {note && <p className="text-xs text-stone-500">{note}</p>}
    </div>
  );
}
