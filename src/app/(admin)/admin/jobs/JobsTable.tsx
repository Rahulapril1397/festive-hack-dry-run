"use client";

import { useState } from "react";
import { api } from "@/components/shell/api";

type Job = { id: string; name: string; payload: Record<string, unknown>; run_at: string; status: string; attempts: number; last_error: string | null; updated_at: string; finished_at: string | null };
const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "medium" }) : "—");
const STYLE: Record<string, string> = { pending: "bg-sky-100 text-sky-900", running: "bg-amber-100 text-amber-900", done: "bg-green-100 text-green-900", failed: "bg-orange-100 text-orange-900", dead: "bg-red-100 text-red-900" };

export function JobsTable({ initialJobs, initialCounts, tokenConfigured }: { initialJobs: Job[]; initialCounts: Record<string, number>; tokenConfigured: boolean }) {
  const [jobs, setJobs] = useState(initialJobs);
  const [counts, setCounts] = useState(initialCounts);
  const [status, setStatus] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const reload = async (s = status) => {
    const r = await api<{ jobs: Job[]; counts: Record<string, number> }>(`/api/jobs${s ? `?status=${s}` : ""}`);
    setJobs(r.jobs);
    setCounts(r.counts);
  };
  return (
    <main className="flex flex-col gap-4 p-4 md:p-6">
      <h1 className="text-2xl font-bold">Background jobs</h1>
      {!tokenConfigured && <p className="rounded bg-amber-50 p-2 text-sm text-amber-900">JOBS_TOKEN is not set on this server, so the scheduler cannot run jobs (reminders and escalations are paused).</p>}
      <div className="flex flex-wrap gap-2 text-sm">
        {["", "pending", "running", "failed", "dead", "done"].map((s) => (
          <button
            key={s || "all"}
            className={`rounded-full border px-3 py-1 ${status === s ? "border-rose-700 bg-rose-50 font-semibold" : "border-stone-300 bg-white"}`}
            onClick={() => {
              setStatus(s);
              void reload(s).catch((e) => setErr((e as Error).message));
            }}
          >
            {s || "all"} {s && <span className="text-stone-500">({counts[s] ?? 0})</span>}
          </button>
        ))}
      </div>
      {err && <p className="rounded bg-red-50 p-2 text-sm text-red-900">{err}</p>}
      <div className="overflow-x-auto rounded-xl border bg-white">
        <table className="w-full text-sm" data-testid="jobs-table">
          <thead className="bg-stone-50 text-left text-stone-600">
            <tr>
              <th className="p-2">Job</th>
              <th className="p-2">Status</th>
              <th className="p-2">Attempts</th>
              <th className="p-2">Run at</th>
              <th className="p-2">Last error</th>
              <th className="p-2" />
            </tr>
          </thead>
          <tbody>
            {jobs.length === 0 && (
              <tr>
                <td colSpan={6} className="p-4 text-center text-stone-500">
                  No jobs.
                </td>
              </tr>
            )}
            {jobs.map((j) => (
              <tr key={j.id} className="border-t">
                <td className="p-2 font-mono text-xs">{j.name}</td>
                <td className="p-2">
                  <span className={`rounded px-2 py-0.5 text-xs ${STYLE[j.status] ?? ""}`}>{j.status}</span>
                </td>
                <td className="p-2">{j.attempts}</td>
                <td className="p-2 whitespace-nowrap">{fmt(j.run_at)}</td>
                <td className="max-w-xs truncate p-2 text-xs text-red-800" title={j.last_error ?? undefined}>
                  {j.last_error}
                </td>
                <td className="p-2">
                  {(j.status === "failed" || j.status === "dead") && (
                    <button
                      className="btn-secondary !px-2 !py-1 text-xs"
                      onClick={async () => {
                        setErr(null);
                        try {
                          await api(`/api/jobs/${j.id}/retry`, { method: "POST" });
                          await reload();
                        } catch (e) {
                          setErr((e as Error).message);
                        }
                      }}
                    >
                      Retry
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
