"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Task, TaskDetail } from "@/contracts/tasks";
import { STATUS_LABEL, TASK_PRIORITIES, TASK_STATUSES, TRANSITIONS, whatsappText, type TaskStatus } from "@/domain/tasks/status";
import { copyText } from "@/components/shell/copyText";
import { api } from "@/components/shell/api";

type Opt = { id: string; name: string };
type Props = { initialTasks: Task[]; owners: Opt[]; events: Opt[]; me: string | null; can: { manage: boolean; updateOwn: boolean }; openTaskId: string | null };

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }) : "—");
/** ISO → value for <input type="datetime-local"> in the browser's zone. */
const toLocalInput = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};
const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : "");

const STATUS_STYLE: Record<TaskStatus, string> = {
  open: "bg-sky-100 text-sky-900",
  in_progress: "bg-amber-100 text-amber-900",
  blocked: "bg-red-100 text-red-900",
  done: "bg-green-100 text-green-900",
  cancelled: "bg-stone-200 text-stone-600",
};
const PRIORITY_STYLE = { urgent: "text-red-700 font-semibold", high: "text-orange-700", normal: "text-stone-600", low: "text-stone-400" } as const;

export function TasksBoard(p: Props) {
  const router = useRouter();
  const [tasks, setTasks] = useState(p.initialTasks);
  const [filter, setFilter] = useState<{ status: "" | TaskStatus | "active"; mine: boolean; overdue: boolean; eventId: string; q: string }>({ status: "active", mine: !p.can.manage && !!p.me, overdue: false, eventId: "", q: "" });
  const [openId, setOpenId] = useState<string | null>(p.openTaskId);
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const reload = useCallback(async () => setTasks((await api<{ tasks: Task[] }>("/api/tasks")).tasks), []);

  const shown = useMemo(
    () =>
      tasks.filter(
        (t) =>
          (filter.status === "" || (filter.status === "active" ? !["done", "cancelled"].includes(t.status) : t.status === filter.status)) &&
          (!filter.mine || t.owner?.id === p.me) &&
          (!filter.overdue || t.overdue) &&
          (!filter.eventId || t.event?.id === filter.eventId) &&
          (!filter.q || t.title.toLowerCase().includes(filter.q.toLowerCase())),
      ),
    [tasks, filter, p.me],
  );
  const overdueCount = tasks.filter((t) => t.overdue).length;

  const openTask = (id: string | null) => {
    setOpenId(id);
    router.replace(id ? `/tasks?task=${id}` : "/tasks", { scroll: false });
  };

  return (
    <main className="flex flex-col gap-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">
          Tasks
          {overdueCount > 0 && (
            <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 align-middle text-sm font-semibold text-red-800" data-testid="overdue-badge">
              {overdueCount} overdue
            </span>
          )}
        </h1>
        {p.can.manage && (
          <button className="btn-primary" onClick={() => setCreating(true)} data-testid="new-task">
            New task
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm" role="group" aria-label="Filters">
        <select className="rounded-lg border border-stone-300 bg-white px-2 py-1.5" value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value as typeof filter.status })} aria-label="Status">
          <option value="active">Not finished</option>
          <option value="">All statuses</option>
          {TASK_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        <select className="rounded-lg border border-stone-300 bg-white px-2 py-1.5" value={filter.eventId} onChange={(e) => setFilter({ ...filter, eventId: e.target.value })} aria-label="Function">
          <option value="">All functions</option>
          {p.events.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
        {p.me && (
          <label className="flex items-center gap-1 rounded-lg border border-stone-300 bg-white px-2 py-1.5">
            <input type="checkbox" checked={filter.mine} onChange={(e) => setFilter({ ...filter, mine: e.target.checked })} data-testid="filter-mine" /> My tasks
          </label>
        )}
        <label className="flex items-center gap-1 rounded-lg border border-stone-300 bg-white px-2 py-1.5">
          <input type="checkbox" checked={filter.overdue} onChange={(e) => setFilter({ ...filter, overdue: e.target.checked })} /> Overdue only
        </label>
        <input className="min-w-40 flex-1 rounded-lg border border-stone-300 bg-white px-2 py-1.5" placeholder="Search tasks" value={filter.q} onChange={(e) => setFilter({ ...filter, q: e.target.value })} aria-label="Search" />
      </div>

      {err && <p className="rounded bg-red-50 p-2 text-sm text-red-900">{err}</p>}

      {shown.length === 0 ? (
        <p className="rounded-xl border border-dashed border-stone-300 bg-white p-8 text-center text-stone-500">{tasks.length ? "No tasks match these filters." : p.can.manage ? "No tasks yet — create the first one." : "No tasks assigned yet."}</p>
      ) : (
        <ul className="flex flex-col gap-2" data-testid="task-list">
          {shown.map((t) => (
            <li key={t.id}>
              <button onClick={() => openTask(t.id)} className={`flex w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border bg-white p-3 text-left hover:border-rose-300 ${t.overdue ? "border-red-300" : "border-stone-200"}`} data-testid="task-row">
                <span className={`rounded px-2 py-0.5 text-xs ${STATUS_STYLE[t.status]}`}>{STATUS_LABEL[t.status]}</span>
                <span className="min-w-0 flex-1 font-medium">{t.title}</span>
                <span className={`text-xs ${PRIORITY_STYLE[t.priority]}`}>{t.priority !== "normal" ? t.priority : ""}</span>
                <span className="text-sm text-stone-600">{t.owner?.name ?? "Unassigned"}</span>
                <span className={`text-sm ${t.overdue ? "font-semibold text-red-700" : "text-stone-500"}`}>
                  {t.overdue && "Overdue · "}
                  {t.dueAt ? fmt(t.dueAt) : "No due date"}
                </span>
                {t.event && <span className="rounded bg-stone-100 px-2 py-0.5 text-xs">{t.event.name}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}

      {creating && (
        <Drawer title="New task" onClose={() => setCreating(false)}>
          <TaskForm
            owners={p.owners}
            events={p.events}
            submit="Create task"
            onSubmit={async (body) => {
              const t = await api<Task>("/api/tasks", { method: "POST", body });
              await reload();
              setCreating(false);
              openTask(t.id);
            }}
          />
        </Drawer>
      )}
      {openId && <TaskDrawer id={openId} p={p} onClose={() => openTask(null)} onChanged={() => reload().catch((e) => setErr((e as Error).message))} />}
    </main>
  );
}

function Drawer({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-30 flex justify-end bg-black/30" onClick={onClose}>
      <aside className="flex h-full w-full max-w-lg flex-col overflow-y-auto bg-white shadow-xl" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={title} data-testid="task-drawer">
        <div className="sticky top-0 flex items-center justify-between border-b bg-white px-4 py-3">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} className="rounded p-1 text-stone-500 hover:bg-stone-100" aria-label="Close">
            ✕
          </button>
        </div>
        <div className="p-4">{children}</div>
      </aside>
    </div>
  );
}

type FormBody = { title: string; description: string; ownerParticipantId: string; eventId: string; dueAt: string; priority: string };

function TaskForm({ owners, events, initial, submit, onSubmit }: { owners: Opt[]; events: Opt[]; initial?: Partial<FormBody>; submit: string; onSubmit: (b: FormBody) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <form
      className="flex flex-col gap-3"
      data-testid="task-form"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        setBusy(true);
        setErr(null);
        try {
          await onSubmit({
            title: String(f.get("title") ?? ""),
            description: String(f.get("description") ?? ""),
            ownerParticipantId: String(f.get("ownerParticipantId") ?? ""),
            eventId: String(f.get("eventId") ?? ""),
            dueAt: fromLocalInput(String(f.get("dueAt") ?? "")),
            priority: String(f.get("priority") ?? "normal"),
          });
        } catch (x) {
          setErr((x as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className="text-sm">
        Title
        <input name="title" required minLength={2} maxLength={160} defaultValue={initial?.title} className="input mt-1 !text-base" />
      </label>
      <label className="text-sm">
        Details
        <textarea name="description" rows={3} maxLength={4000} defaultValue={initial?.description} className="input mt-1 !text-base" />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="text-sm">
          Owner
          <select name="ownerParticipantId" defaultValue={initial?.ownerParticipantId ?? ""} className="input mt-1 !text-base">
            <option value="">Unassigned</option>
            {owners.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Function
          <select name="eventId" defaultValue={initial?.eventId ?? ""} className="input mt-1 !text-base">
            <option value="">—</option>
            {events.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Due
          <input name="dueAt" type="datetime-local" defaultValue={initial?.dueAt ? toLocalInput(initial.dueAt) : ""} className="input mt-1 !text-base" />
        </label>
        <label className="text-sm">
          Priority
          <select name="priority" defaultValue={initial?.priority ?? "normal"} className="input mt-1 !text-base">
            {TASK_PRIORITIES.map((x) => (
              <option key={x} value={x}>
                {x}
              </option>
            ))}
          </select>
        </label>
      </div>
      {err && <p className="rounded bg-red-50 p-2 text-sm text-red-900">{err}</p>}
      <button className="btn-primary self-start" disabled={busy}>
        {busy ? "Saving…" : submit}
      </button>
    </form>
  );
}

const EVENT_LABEL: Record<string, (d: Record<string, unknown>) => string> = {
  created: () => "created the task",
  updated: (d) => `updated ${Object.keys(d).join(", ") || "the task"}`,
  assigned: () => "changed the owner",
  status_changed: (d) => `moved ${STATUS_LABEL[d.from as TaskStatus] ?? d.from} → ${STATUS_LABEL[d.to as TaskStatus] ?? d.to}${d.note ? ` (“${d.note}”)` : ""}`,
  reminder_sent: (d) => `Reminder sent (${d.kind} before due)${d.delivered ? "" : " — owner has no login"}`,
  escalated: (d) => `Escalated to level ${d.level}${Array.isArray(d.roles) ? ` (${(d.roles as string[]).join(", ")} notified)` : ""}`,
  comment: (d) => String(d.body ?? ""),
};

function TaskDrawer({ id, p, onClose, onChanged }: { id: string; p: Props; onClose: () => void; onChanged: () => void }) {
  const [t, setT] = useState<TaskDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const load = useCallback(() => api<TaskDetail>(`/api/tasks/${id}`).then(setT, (e) => setErr((e as Error).message)), [id]);
  useEffect(() => {
    setT(null);
    void load();
  }, [load]);

  const act = async (fn: () => Promise<unknown>) => {
    setErr(null);
    try {
      await fn();
      await load();
      onChanged();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  return (
    <Drawer title={t?.title ?? "Task"} onClose={onClose}>
      {!t ? (
        <p className="text-stone-500">{err ?? "Loading…"}</p>
      ) : editing ? (
        <TaskForm
          owners={p.owners}
          events={p.events}
          submit="Save"
          initial={{ title: t.title, description: t.description ?? "", ownerParticipantId: t.owner?.id ?? "", eventId: t.event?.id ?? "", dueAt: t.dueAt ?? "", priority: t.priority }}
          onSubmit={async (body) => {
            await api(`/api/tasks/${id}`, { method: "PATCH", body });
            setEditing(false);
            await load();
            onChanged();
          }}
        />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded px-2 py-0.5 text-sm ${STATUS_STYLE[t.status]}`} data-testid="task-status">
              {STATUS_LABEL[t.status]}
            </span>
            <span className={`text-sm ${PRIORITY_STYLE[t.priority]}`}>{t.priority} priority</span>
            {t.overdue && <span className="rounded bg-red-100 px-2 py-0.5 text-sm font-semibold text-red-800">Overdue</span>}
            {t.escalationLevel > 0 && <span className="rounded bg-orange-100 px-2 py-0.5 text-sm text-orange-900">Escalated (level {t.escalationLevel})</span>}
          </div>
          <dl className="grid grid-cols-[6rem_1fr] gap-y-1 text-sm">
            <dt className="text-stone-500">Owner</dt>
            <dd>{t.owner?.name ?? "Unassigned"}</dd>
            <dt className="text-stone-500">Due</dt>
            <dd>{fmt(t.dueAt)}</dd>
            {t.event && (
              <>
                <dt className="text-stone-500">Function</dt>
                <dd>{t.event.name}</dd>
              </>
            )}
            {t.vendor && (
              <>
                <dt className="text-stone-500">Vendor</dt>
                <dd>
                  <a className="underline" href={`/vendors/${t.vendor.id}`}>
                    {t.vendor.name}
                  </a>
                </dd>
              </>
            )}
          </dl>
          {t.description && <p className="whitespace-pre-wrap rounded-lg bg-stone-50 p-3 text-sm">{t.description}</p>}

          {t.canUpdate && TRANSITIONS[t.status].length > 0 && (
            <div className="flex flex-wrap gap-2" data-testid="task-actions">
              {TRANSITIONS[t.status].map((to) => (
                <button key={to} className={to === "done" ? "btn-primary !py-1.5" : "btn-secondary !py-1.5"} onClick={() => act(() => api(`/api/tasks/${id}/status`, { method: "POST", body: { status: to } }))} data-testid={`to-${to}`}>
                  {to === "open" ? "Reopen" : to === "in_progress" ? (t.status === "blocked" ? "Unblock" : "Start") : to === "blocked" ? "Blocked" : to === "done" ? "Mark done" : "Cancel task"}
                </button>
              ))}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {p.can.manage && !["done", "cancelled"].includes(t.status) && (
              <button className="btn-secondary !py-1.5" onClick={() => setEditing(true)}>
                Edit
              </button>
            )}
            <button
              className="btn-secondary !py-1.5"
              data-testid="copy-whatsapp"
              onClick={async () => {
                const text = whatsappText({ title: t.title, description: t.description, dueAt: t.dueAt, ownerName: t.owner?.name ?? null, eventName: t.event?.name, status: t.status }, `${location.origin}/tasks?task=${t.id}`);
                const ok = await copyText(text);
                setCopied(ok ? "Copied — paste it in WhatsApp" : text);
              }}
            >
              Copy for WhatsApp
            </button>
          </div>
          {copied && (copied.startsWith("Copied") ? <p className="text-sm text-green-800">{copied}</p> : <textarea readOnly className="input !text-sm" rows={6} value={copied} onFocus={(e) => e.currentTarget.select()} />)}
          {err && <p className="rounded bg-red-50 p-2 text-sm text-red-900">{err}</p>}

          <section>
            <h3 className="mb-2 font-semibold">History</h3>
            <ol className="flex flex-col gap-2 border-l-2 border-stone-200 pl-3" data-testid="task-timeline">
              {t.events.map((e) => (
                <li key={e.id} className="text-sm">
                  <span className={e.type === "comment" ? "whitespace-pre-wrap" : "text-stone-700"}>
                    {e.type === "comment" ? <b>{e.actorEmail ?? "Someone"}: </b> : e.actorEmail ? <b>{e.actorEmail} </b> : null}
                    {(EVENT_LABEL[e.type] ?? (() => e.type))(e.data)}
                  </span>
                  <span className="block text-xs text-stone-400">{fmt(e.createdAt)}</span>
                </li>
              ))}
            </ol>
          </section>
          {t.canUpdate && (
            <form
              className="flex gap-2"
              onSubmit={async (e) => {
                e.preventDefault();
                const form = e.currentTarget;
                const body = String(new FormData(form).get("body") ?? "").trim();
                if (!body) return;
                await act(() => api(`/api/tasks/${id}/comments`, { method: "POST", body: { body } }));
                form.reset();
              }}
            >
              <input name="body" className="input !text-base" placeholder="Add a comment" maxLength={2000} aria-label="Comment" />
              <button className="btn-secondary">Post</button>
            </form>
          )}
        </div>
      )}
    </Drawer>
  );
}
