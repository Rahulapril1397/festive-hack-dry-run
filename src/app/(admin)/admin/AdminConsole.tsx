"use client";

import { useMemo, useState } from "react";
import type { AdminRole, AdminUser, AuditPage, InviteResult } from "@/contracts/admin";
import { permissionsByModule } from "@/lib/authz/catalogue";
import { api } from "./api";

type Props = {
  me: string;
  wedding: { id: string; name: string };
  can: { audit: boolean; roles: boolean; weddings: boolean; superAdmin: boolean };
  initialUsers: AdminUser[];
  initialRoles: AdminRole[];
  initialAudit: AuditPage | null;
};

const TABS = ["Users", "Roles", "Audit log", "Weddings"] as const;
type Tab = (typeof TABS)[number];
const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—");

export function AdminConsole(p: Props) {
  const tabs = TABS.filter((t) => (t === "Audit log" ? p.can.audit : t === "Weddings" ? p.can.weddings : true));
  const [tab, setTab] = useState<Tab>("Users");
  const [users, setUsers] = useState(p.initialUsers);
  const [roles, setRoles] = useState(p.initialRoles);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const run = async (fn: () => Promise<void>, ok: string) => {
    setMsg(null);
    try {
      await fn();
      setMsg({ kind: "ok", text: ok });
    } catch (e) {
      setMsg({ kind: "err", text: (e as Error).message });
    }
  };
  const reloadUsers = async () => setUsers((await api<{ users: AdminUser[] }>("/api/admin/users")).users);

  return (
    <main className="flex flex-col gap-4 p-4 md:p-6">
      <h1 className="text-2xl font-bold">Users and Roles</h1>
      <nav className="flex gap-2 border-b" role="tablist">
        {tabs.map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab === t ? "border-rose-700 font-semibold" : "border-transparent text-stone-600"}`} data-testid={`tab-${t}`}>
            {t}
          </button>
        ))}
      </nav>
      {msg && (
        <p role="status" className={`rounded p-2 text-sm ${msg.kind === "ok" ? "bg-green-50 text-green-900" : "bg-red-50 text-red-900"}`} data-testid="admin-msg">
          {msg.text}
        </p>
      )}
      {tab === "Users" && <UsersTab {...p} users={users} roles={roles} run={run} reload={reloadUsers} />}
      {tab === "Roles" && <RolesTab roles={roles} setRoles={setRoles} canEdit={p.can.roles} run={run} />}
      {tab === "Audit log" && p.initialAudit && <AuditTab initial={p.initialAudit} superAdmin={p.can.superAdmin} />}
      {tab === "Weddings" && <WeddingsTab run={run} />}
    </main>
  );
}

type Run = (fn: () => Promise<void>, ok: string) => Promise<void>;

function UsersTab({ me, wedding, users, roles, run, reload, can }: Props & { users: AdminUser[]; roles: AdminRole[]; run: Run; reload: () => Promise<void> }) {
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const assignable = roles.filter((r) => r.key !== "super_admin" || can.superAdmin);
  return (
    <section className="flex flex-col gap-4">
      <form
        className="grid gap-2 rounded-xl border bg-white p-4 md:grid-cols-5"
        data-testid="invite-form"
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const form = e.currentTarget;
          await run(async () => {
            const expires = String(f.get("expiresAt") || "");
            const r = await api<InviteResult>("/api/admin/users", {
              method: "POST",
              body: { email: f.get("email"), name: f.get("name") || undefined, roleId: f.get("roleId") || undefined, expiresAt: expires ? new Date(expires).toISOString() : undefined },
            });
            setInviteLink(r.inviteLink ?? null);
            form.reset();
            await reload();
          }, "Invited");
        }}
      >
        <h2 className="font-semibold md:col-span-5">Invite a user to {wedding.name}</h2>
        <input name="email" type="email" required placeholder="email@example.com" className="rounded border px-2 py-1" aria-label="Email" />
        <input name="name" placeholder="Name" className="rounded border px-2 py-1" aria-label="Name" />
        <select name="roleId" className="rounded border px-2 py-1" aria-label="Role">
          <option value="">No role yet</option>
          {assignable.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
        <input name="expiresAt" type="datetime-local" className="rounded border px-2 py-1" aria-label="Role expires" title="Role expires (optional)" />
        <button className="btn-primary">Invite</button>
        {inviteLink && (
          <p className="text-sm md:col-span-5">
            Email could not be sent; share this link with them: <code className="break-all">{inviteLink}</code>
          </p>
        )}
      </form>

      {users.length === 0 ? (
        <p className="text-stone-500">No users in this wedding yet. Invite someone above.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-white">
          <table className="w-full text-sm" data-testid="users-table">
            <thead className="bg-stone-50 text-left">
              <tr>{["Name", "Email", "Status", "Roles (wedding · window)", "Last active", ""].map((h) => <th key={h} className="p-2">{h}</th>)}</tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-t align-top" data-testid={`user-${u.email}`}>
                  <td className="p-2">{u.name ?? "—"}</td>
                  <td className="p-2">{u.email}</td>
                  <td className="p-2">{u.status === "active" ? "active" : <span className="text-red-700">suspended</span>}</td>
                  <td className="p-2">
                    <ul className="flex flex-col gap-1">
                      {u.assignments.map((a) => (
                        <li key={a.id} className={a.active ? "" : "text-stone-400"}>
                          {a.roleName} · {a.weddingName ?? "all weddings"} · {a.expiresAt ? `until ${fmt(a.expiresAt)}` : "no expiry"}
                          {!a.active && " (inactive)"}
                          {u.id !== me && (
                            <button className="ml-2 text-xs text-red-700 underline" onClick={() => run(async () => { await api(`/api/admin/assignments/${a.id}`, { method: "DELETE" }); await reload(); }, "Role removed")}>
                              remove
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                    {u.id !== me && <AssignForm userId={u.id} weddingId={wedding.id} roles={assignable} run={run} reload={reload} />}
                  </td>
                  <td className="p-2">{fmt(u.lastActiveAt)}</td>
                  <td className="p-2">
                    {u.id !== me &&
                      (u.status === "active" ? (
                        <button className="btn-secondary px-2 py-1 text-xs" onClick={() => run(async () => { await api(`/api/admin/users/${u.id}/suspend`, { method: "POST" }); await reload(); }, `${u.email} suspended`)} data-testid="suspend">
                          Suspend
                        </button>
                      ) : (
                        <button className="btn-secondary px-2 py-1 text-xs" onClick={() => run(async () => { await api(`/api/admin/users/${u.id}/reactivate`, { method: "POST" }); await reload(); }, `${u.email} reactivated`)}>
                          Reactivate
                        </button>
                      ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function AssignForm({ userId, weddingId, roles, run, reload }: { userId: string; weddingId: string; roles: AdminRole[]; run: Run; reload: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  if (!open) return <button className="mt-1 text-xs underline" onClick={() => setOpen(true)}>+ assign role</button>;
  return (
    <form
      className="mt-2 flex flex-wrap gap-1"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const starts = String(f.get("startsAt") || "");
        const expires = String(f.get("expiresAt") || "");
        const roleId = String(f.get("roleId"));
        const isSuper = roles.find((r) => r.id === roleId)?.key === "super_admin";
        await run(async () => {
          await api("/api/admin/assignments", { method: "POST", body: { userId, roleId, weddingId: isSuper ? null : weddingId, startsAt: starts ? new Date(starts).toISOString() : undefined, expiresAt: expires ? new Date(expires).toISOString() : null } });
          setOpen(false);
          await reload();
        }, "Role assigned");
      }}
    >
      <select name="roleId" className="rounded border px-1 text-xs" aria-label="Role">
        {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
      </select>
      <input name="startsAt" type="datetime-local" className="rounded border px-1 text-xs" aria-label="Starts" title="Starts (default now)" />
      <input name="expiresAt" type="datetime-local" className="rounded border px-1 text-xs" aria-label="Expires" title="Expires (optional)" data-testid="assign-expires" />
      <button className="btn-primary px-2 py-0.5 text-xs">Assign</button>
    </form>
  );
}

function RolesTab({ roles, setRoles, canEdit, run }: { roles: AdminRole[]; setRoles: (r: AdminRole[]) => void; canEdit: boolean; run: Run }) {
  const [selected, setSelected] = useState(roles[0]?.id ?? "");
  const role = roles.find((r) => r.id === selected);
  const [draft, setDraft] = useState<Set<string>>(new Set(role?.permissions));
  const modules = useMemo(() => permissionsByModule(), []);
  const pick = (id: string) => {
    setSelected(id);
    setDraft(new Set(roles.find((r) => r.id === id)?.permissions));
  };
  const reload = async () => setRoles((await api<{ roles: AdminRole[] }>("/api/admin/roles")).roles);
  return (
    <section className="grid gap-4 md:grid-cols-[14rem_1fr]">
      <ul className="flex flex-col gap-1">
        {roles.map((r) => (
          <li key={r.id}>
            <button onClick={() => pick(r.id)} className={`w-full rounded px-2 py-1 text-left text-sm ${r.id === selected ? "bg-rose-100 font-semibold" : "hover:bg-stone-100"}`}>
              {r.name} {r.isSystem && <span className="text-xs text-stone-500">system</span>}
            </button>
          </li>
        ))}
        {canEdit && <NewRole run={run} reload={reload} />}
      </ul>
      {role && (
        <div className="rounded-xl border bg-white p-4">
          <h2 className="font-semibold">{role.name} <code className="text-xs text-stone-500">{role.key}</code></h2>
          {role.description && <p className="text-sm text-stone-600">{role.description}</p>}
          {!canEdit && <p className="mt-1 text-xs text-stone-500">Read-only: role permissions apply to every wedding and are edited by a super admin.</p>}
          <div className="mt-3 grid gap-3 md:grid-cols-2" data-testid="permission-editor">
            {Object.entries(modules).map(([mod, keys]) => (
              <fieldset key={mod} className="rounded border p-2">
                <legend className="px-1 text-xs font-semibold uppercase text-stone-500">{mod}</legend>
                {keys.map((k) => (
                  <label key={k} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" disabled={!canEdit || role.key === "super_admin"} checked={draft.has(k)} onChange={(e) => { const n = new Set(draft); if (e.target.checked) n.add(k); else n.delete(k); setDraft(n); }} />
                    <code>{k}</code>
                  </label>
                ))}
              </fieldset>
            ))}
          </div>
          {canEdit && (
            <button className="btn-primary mt-3" data-testid="save-role" onClick={() => run(async () => { await api(`/api/admin/roles/${role.id}/permissions`, { method: "PUT", body: { permissionKeys: [...draft] } }); await reload(); }, "Role saved")}>
              Save
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function NewRole({ run, reload }: { run: Run; reload: () => Promise<void> }) {
  return (
    <form
      className="mt-2 flex flex-col gap-1 rounded border p-2"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const form = e.currentTarget;
        await run(async () => {
          await api("/api/admin/roles", { method: "POST", body: { key: f.get("key"), name: f.get("name"), permissionKeys: ["assistant.use"] } });
          form.reset();
          await reload();
        }, "Role created — now tick its permissions");
      }}
    >
      <input name="key" required placeholder="key, e.g. decorator" className="rounded border px-1 text-sm" aria-label="Role key" />
      <input name="name" required placeholder="Name" className="rounded border px-1 text-sm" aria-label="Role name" />
      <button className="btn-secondary px-2 py-0.5 text-xs">Create role</button>
    </form>
  );
}

function AuditTab({ initial, superAdmin }: { initial: AuditPage; superAdmin: boolean }) {
  const [pages, setPages] = useState<AuditPage[]>([initial]);
  const [filters, setFilters] = useState({ action: "", from: "", to: "", scope: "wedding" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const load = async (cursor?: number) => {
    setBusy(true);
    setErr(null);
    const qs = new URLSearchParams();
    if (filters.action) qs.set("action", filters.action);
    if (filters.from) qs.set("from", new Date(filters.from).toISOString());
    if (filters.to) qs.set("to", new Date(filters.to).toISOString());
    qs.set("scope", filters.scope);
    if (cursor) qs.set("cursor", String(cursor));
    try {
      const page = await api<AuditPage>(`/api/admin/audit?${qs}`);
      setPages((p) => (cursor ? [...p, page] : [page]));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const entries = pages.flatMap((p) => p.entries);
  const next = pages.at(-1)?.nextCursor;
  return (
    <section className="flex flex-col gap-3">
      <form className="flex flex-wrap gap-2 text-sm" onSubmit={(e) => { e.preventDefault(); void load(); }}>
        <input placeholder="Action starts with… (e.g. ledger)" className="rounded border px-2 py-1" value={filters.action} onChange={(e) => setFilters({ ...filters, action: e.target.value })} aria-label="Action" />
        <input type="datetime-local" className="rounded border px-2 py-1" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} aria-label="From" />
        <input type="datetime-local" className="rounded border px-2 py-1" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} aria-label="To" />
        {superAdmin && (
          <select className="rounded border px-2 py-1" value={filters.scope} onChange={(e) => setFilters({ ...filters, scope: e.target.value })} aria-label="Scope">
            <option value="wedding">This wedding</option>
            <option value="all">All weddings</option>
          </select>
        )}
        <button className="btn-secondary" disabled={busy}>Filter</button>
      </form>
      {err && <p className="text-sm text-red-700">{err}</p>}
      {entries.length === 0 ? <p className="text-stone-500">No entries match.</p> : (
        <ul className="divide-y rounded-lg border bg-white text-sm" data-testid="audit-log">
          {entries.map((a) => (
            <li key={a.id} className="grid gap-2 p-2 md:grid-cols-[11rem_13rem_1fr_1fr]">
              <span className="text-stone-500">{fmt(a.at)}</span>
              <span className="font-mono text-xs">{a.action}</span>
              <span className="truncate text-stone-600">{a.actorEmail ?? (a.actor ? a.actor.slice(0, 8) : "system")}</span>
              <span className="truncate font-mono text-xs text-stone-500" title={JSON.stringify(a.details)}>{a.entity}</span>
            </li>
          ))}
        </ul>
      )}
      {next && <button className="btn-secondary self-start" disabled={busy} onClick={() => load(next)}>Load older</button>}
    </section>
  );
}

function WeddingsTab({ run }: { run: Run }) {
  const [events, setEvents] = useState([{ name: "Haldi", startsAt: "" }]);
  return (
    <form
      className="grid max-w-xl gap-2 rounded-xl border bg-white p-4"
      data-testid="create-wedding"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        await run(async () => {
          await api("/api/admin/weddings", {
            method: "POST",
            body: {
              wedding: { name: f.get("name"), coupleNames: f.get("coupleNames") || undefined, weddingDate: f.get("weddingDate") || undefined, contactPhone: f.get("contactPhone") || undefined },
              events: events.filter((x) => x.name.trim()).map((x) => ({ name: x.name, startsAt: x.startsAt ? new Date(x.startsAt).toISOString() : undefined })),
              hostEmail: f.get("hostEmail") || undefined,
            },
          });
        }, "Wedding created — choose it in the wedding selector");
      }}
    >
      <h2 className="font-semibold">Create a wedding</h2>
      <input name="name" required placeholder="Wedding name (e.g. Sharma–Iyer wedding)" className="rounded border px-2 py-1" />
      <input name="coupleNames" placeholder="Couple names" className="rounded border px-2 py-1" />
      <input name="weddingDate" type="date" className="rounded border px-2 py-1" aria-label="Wedding date" />
      <input name="contactPhone" placeholder="Organiser phone (shown to guests)" className="rounded border px-2 py-1" />
      <input name="hostEmail" type="email" placeholder="Host email (invited as host)" className="rounded border px-2 py-1" />
      <p className="text-sm font-medium">Functions</p>
      {events.map((ev, i) => (
        <div key={i} className="flex gap-2">
          <input value={ev.name} onChange={(e) => setEvents(events.map((x, k) => (k === i ? { ...x, name: e.target.value } : x)))} className="flex-1 rounded border px-2 py-1" aria-label="Function name" />
          <input type="datetime-local" value={ev.startsAt} onChange={(e) => setEvents(events.map((x, k) => (k === i ? { ...x, startsAt: e.target.value } : x)))} className="rounded border px-2 py-1" aria-label="Starts" />
        </div>
      ))}
      <button type="button" className="text-left text-sm underline" onClick={() => setEvents([...events, { name: "", startsAt: "" }])}>+ add function</button>
      <button className="btn-primary">Create wedding</button>
    </form>
  );
}
