import { redirect } from "next/navigation";
import { getSession, hasPermission } from "@/lib/authz";
import { listRecommendations } from "@/lib/nudgebee/service";
import { ApproveButton } from "./ApproveButton";

export const dynamic = "force-dynamic";

const BADGE: Record<string, string> = {
  pending: "bg-amber-100 text-amber-900",
  approved: "bg-sky-100 text-sky-900",
  done: "bg-green-100 text-green-900",
  approved_awaiting_manual_toggle: "bg-red-100 text-red-900",
  rejected: "bg-stone-200 text-stone-700",
};

export default async function RecommendationsPage() {
  const s = await getSession();
  if (!s) redirect("/login?next=/ops/recommendations");
  if (!(await hasPermission(s, "ops.approve"))) redirect("/");
  const recs = await listRecommendations();
  return (
    <main className="p-6">
      <h1 className="mb-1 text-2xl font-bold">NudgeBee recommendations</h1>
      <p className="mb-6 text-sm text-stone-600">
        One approved scenario: after TTS failures, turn the <code>voice_calls</code> flag OFF so the TV chimes. Nothing happens without a
        human approval, and success is shown only after Flagsmith reads back OFF.
      </p>
      {recs.length === 0 && <p className="text-stone-500">No recommendations yet.</p>}
      <ul className="flex flex-col gap-3">
        {recs.map((r) => (
          <li key={r.id} className="rounded-xl border border-stone-200 bg-white p-4" data-testid="recommendation">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className={`rounded px-2 py-0.5 text-xs font-semibold ${BADGE[r.status] ?? ""}`} data-testid="rec-status">
                {r.status === "approved_awaiting_manual_toggle" ? "approved, awaiting manual toggle" : r.status}
              </span>
              <span className="text-xs text-stone-500">{new Date(r.created_at).toLocaleString("en-IN")}</span>
            </div>
            <p className="mt-2">{r.text}</p>
            <p className="mt-1 text-sm text-stone-600">
              Proposed action: <code>{r.proposed_action}</code>
            </p>
            {r.status === "done" && <p className="mt-2 font-semibold text-green-700">Done — voice_calls verified OFF.</p>}
            {r.detail && r.status !== "done" && <p className="mt-2 rounded bg-red-50 p-2 text-sm text-red-900">{r.detail}</p>}
            {(r.status === "pending" || r.status === "approved_awaiting_manual_toggle") && <ApproveButton id={r.id} retry={r.status !== "pending"} />}
          </li>
        ))}
      </ul>
    </main>
  );
}
