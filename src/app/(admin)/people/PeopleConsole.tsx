"use client";

import { useMemo, useState } from "react";
import type { HistoryEntry, Person, PersonAssignment, WeddingRole } from "@/contracts/people";
import { PERMISSIONS, permissionsByModule } from "@/lib/authz/catalogue";
import { copyText } from "@/components/shell/copyText";
import { api } from "@/components/shell/api";

type Props = { me: string; myPermissions: string[]; superAdmin: boolean; initialPeople: Person[]; initialRoles: WeddingRole[] };
type Msg = { kind: "ok" | "err"; text: string } | null;

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—");
const STATUS_STYLE: Record<PersonAssignment["status"], string> = {
  active: "bg-green-100 text-green-900",
  pending: "bg-amber-100 text-amber-900",
  suspended: "bg-red-100 text-red-900",
  expired: "bg-stone-200 text-stone-600",
};
const PLATFORM_ONLY = new Set(["roles.manage", "weddings.manage"]);

export function PeopleConsole(p: Props) {
  const [tab, setTab] = useState<"people" | "roles">("people");
  const [people, setPeople] = useState(p.initialPeople);
  const [roles, setRoles] = useState(p.initialRoles);
  const [msg, setMsg] = useState<Msg>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const run = async (fn: () => Promise<void>, ok: string) => {
    setMsg(null);
    try {
      await fn();
      setMsg({ kind: "ok", text: ok });
    } catch (e) {
      setMsg({ kind: "err", text: (e as Error).message });
    }
  };
  const replace = (x: Person) => setPeople((ps) => (ps.some((q) => q.id === x.id) ? ps.map((q) => (q.id === x.id ? x : q)) : [...ps, x].sort((a, b) => a.displayName.localeCompare(b.displayName))));
  const person = people.find((x) => x.id === selected) ?? null;

  return (
    <main className="flex flex-col gap-4 p-4 md:p-6">
      <h1 className="text-2xl font-bold">People</h1>
      <p className="-mt-2 text-sm text-stone-600">Everyone helping with this wedding. People without a login can still be given roles — the roles start working once they accept an invite.</p>
      <nav className="flex gap-2 border-b" role="tablist">
        {(["people", "roles"] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab === t ? "border-rose-700 font-semibold" : "border-transparent text-stone-600"}`}>
            {t === "people" ? `People (${people.length})` : "Roles for this wedding"}
          </button>
        ))}
      </nav>
      {msg && (
        <p role="status" className={`rounded p-2 text-sm ${msg.kind === "ok" ? "bg-green-50 text-green-900" : "bg-red-50 text-red-900"}`} data-testid="people-msg">
          {msg.text}
        </p>
      )}
      {tab === "people" ? (
        <div className="grid gap-4 lg:grid-cols-[1fr_28rem]">
          <section className="flex flex-col gap-3">
            <AddPerson run={run} onAdded={(x) => (replace(x), setSelected(x.id))} />
            <ul className="flex flex-col gap-2" data-testid="people-list">
              {people.map((x) => (
                <li key={x.id}>
                  <button onClick={() => setSelected(x.id)} className={`flex w-full flex-wrap items-center gap-2 rounded-xl border bg-white p-3 text-left ${selected === x.id ? "border-rose-400 ring-2 ring-rose-100" : "border-stone-200 hover:border-rose-300"}`}>
                    <span className="font-medium">{x.displayName}</span>
                    {x.title && <span className="text-sm text-stone-500">{x.title}</span>}
                    <span className="flex-1" />
                    {x.assignments.map((a) => (
                      <span key={a.id} className={`rounded px-2 py-0.5 text-xs ${STATUS_STYLE[a.status]}`}>
                        {a.roleName}
                        {a.status !== "active" ? ` · ${a.status}` : ""}
                      </span>
                    ))}
                    {!x.user && <span className="rounded border border-dashed border-stone-300 px-2 py-0.5 text-xs text-stone-500">no login</span>}
                    {x.status === "inactive" && <span className="text-xs text-stone-400">inactive</span>}
                  </button>
                </li>
              ))}
            </ul>
          </section>
          {person ? <PersonPanel key={person.id} person={person} roles={roles} me={p.me} run={run} onChange={replace} /> : <p className="hidden rounded-xl border border-dashed p-6 text-sm text-stone-500 lg:block">Pick a person to see their roles, invite them, or change their access.</p>}
        </div>
      ) : (
        <RolesTab roles={roles} setRoles={setRoles} myPermissions={new Set(p.myPermissions)} superAdmin={p.superAdmin} run={run} />
      )}
    </main>
  );
}

type Run = (fn: () => Promise<void>, ok: string) => Promise<void>;

function AddPerson({ run, onAdded }: { run: Run; onAdded: (p: Person) => void }) {
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <button className="btn-primary self-start" onClick={() => setOpen(true)} data-testid="add-person">
        Add person
      </button>
    );
  return (
    <form
      className="grid gap-2 rounded-xl border bg-white p-4 sm:grid-cols-2"
      data-testid="add-person-form"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        await run(async () => {
          const x = await api<Person>("/api/people", { method: "POST", body: { displayName: f.get("displayName"), phone: f.get("phone") || undefined, email: f.get("email") || undefined, title: f.get("title") || undefined } });
          onAdded(x);
          setOpen(false);
        }, "Person added");
      }}
    >
      <input name="displayName" required minLength={2} className="input !text-base" placeholder="Name" aria-label="Name" />
      <input name="title" className="input !text-base" placeholder="What they help with (e.g. Stage helper)" aria-label="Title" />
      <input name="email" type="email" className="input !text-base" placeholder="Email (needed for a login)" aria-label="Email" />
      <input name="phone" inputMode="tel" className="input !text-base" placeholder="Phone (optional)" aria-label="Phone" />
      <div className="flex gap-2 sm:col-span-2">
        <button className="btn-primary">Save</button>
        <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function PersonPanel({ person, roles, me, run, onChange }: { person: Person; roles: WeddingRole[]; me: string; run: Run; onChange: (p: Person) => void }) {
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry[] | null>(null);
  const [overridesFor, setOverridesFor] = useState<string | null>(null);
  const self = person.user?.id === me;
  const roleById = useMemo(() => new Map(roles.map((r) => [r.id, r])), [roles]);

  return (
    <section className="flex flex-col gap-4 rounded-xl border bg-white p-4" data-testid="person-panel">
      <div>
        <h2 className="text-lg font-semibold">{person.displayName}</h2>
        <p className="text-sm text-stone-600">{[person.title, person.email, person.phone].filter(Boolean).join(" · ") || "No contact details"}</p>
        <p className="mt-1 text-sm">
          {person.user ? (
            <>
              Login: <b>{person.user.email}</b> ({person.user.status}) · last seen {fmt(person.user.lastSeenAt)}
            </>
          ) : (
            <span className="text-stone-500">No login yet.</span>
          )}
        </p>
        {!person.user && (
          <button
            className="btn-secondary mt-2 !py-1.5"
            disabled={!person.email}
            title={person.email ? undefined : "Add an email first"}
            data-testid="invite-person"
            onClick={() =>
              run(async () => {
                const r = await api<{ person: Person; delivery: string; inviteLink?: string }>(`/api/people/${person.id}/invite`, { method: "POST" });
                onChange(r.person);
                setInviteLink(r.inviteLink ?? null);
              }, "Invite sent — their pending roles start working once they sign in")
            }
          >
            Invite to sign in
          </button>
        )}
        {inviteLink && (
          <div className="mt-2 flex gap-2">
            <input readOnly value={inviteLink} className="input !text-sm" onFocus={(e) => e.currentTarget.select()} aria-label="Invite link" />
            <button className="btn-secondary !py-1" onClick={() => copyText(inviteLink)}>
              Copy
            </button>
          </div>
        )}
      </div>

      <div>
        <h3 className="mb-2 font-semibold">Roles</h3>
        {person.assignments.length === 0 && <p className="text-sm text-stone-500">No roles yet.</p>}
        <ul className="flex flex-col gap-2">
          {person.assignments.map((a) => {
            const role = roleById.get(a.roleId);
            const effective = (role?.permissions ?? []).filter((k) => !a.denied.includes(k));
            return (
              <li key={a.id} className="rounded-lg border border-stone-200 p-3 text-sm" data-testid="assignment">
                <div className="flex flex-wrap items-center gap-2">
                  <b>{a.roleName}</b>
                  <span className={`rounded px-2 py-0.5 text-xs ${STATUS_STYLE[a.status]}`}>{a.status}</span>
                  {a.status === "active" && !a.effective && <span className="text-xs text-stone-500">(not in its time window)</span>}
                  <span className="flex-1" />
                  {!self && a.status === "active" && (
                    <button className="text-xs text-red-800 underline" onClick={() => run(async () => onChange(await api<Person>(`/api/people/assignments/${a.id}/status`, { method: "POST", body: { status: "suspended" } })), "Role suspended")}>
                      Suspend
                    </button>
                  )}
                  {!self && a.status === "suspended" && (
                    <button className="text-xs text-green-800 underline" onClick={() => run(async () => onChange(await api<Person>(`/api/people/assignments/${a.id}/status`, { method: "POST", body: { status: "active" } })), "Role reactivated")}>
                      Reactivate
                    </button>
                  )}
                  {!self && (
                    <button className="text-xs underline" onClick={() => setOverridesFor(overridesFor === a.id ? null : a.id)}>
                      {overridesFor === a.id ? "Close" : "Restrict…"}
                    </button>
                  )}
                </div>
                <p className="text-xs text-stone-500">
                  {fmt(a.startsAt)} → {a.expiresAt ? fmt(a.expiresAt) : "no end"}
                  {a.denied.length > 0 && <span className="text-red-800"> · denied: {a.denied.join(", ")}</span>}
                </p>
                {overridesFor === a.id && (
                  <div className="mt-2 rounded bg-stone-50 p-2">
                    <p className="mb-1 text-xs text-stone-600">Untick to deny one permission for this person only. A deny always wins, even over feature flags.</p>
                    <div className="grid grid-cols-1 gap-x-3 sm:grid-cols-2">
                      {(role?.permissions ?? []).map((k) => (
                        <label key={k} className="flex items-center gap-1 text-xs">
                          <input
                            type="checkbox"
                            checked={!a.denied.includes(k)}
                            onChange={(e) => run(async () => onChange(await api<Person>(`/api/people/assignments/${a.id}/overrides`, { method: "PUT", body: { permissionKey: k, deny: !e.target.checked } })), e.target.checked ? `${k} allowed again` : `${k} denied`)}
                          />
                          {k}
                        </label>
                      ))}
                    </div>
                    <p className="mt-1 text-xs text-stone-500">Effective: {effective.length} of {role?.permissions.length ?? 0} permissions</p>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        <form
          className="mt-3 grid gap-2 rounded-lg bg-stone-50 p-3 sm:grid-cols-2"
          data-testid="assign-form"
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const starts = String(f.get("startsAt") || "");
            const expires = String(f.get("expiresAt") || "");
            await run(
              async () =>
                onChange(
                  await api<Person>(`/api/people/${person.id}/assignments`, {
                    method: "POST",
                    body: { roleId: f.get("roleId"), startsAt: starts ? new Date(starts).toISOString() : null, expiresAt: expires ? new Date(expires).toISOString() : null },
                  }),
                ),
              person.user ? "Role assigned" : "Role assigned — pending until they accept an invite",
            );
          }}
        >
          <select name="roleId" required className="input !text-base sm:col-span-2" aria-label="Role">
            <option value="">Give a role…</option>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
                {r.custom ? " (this wedding)" : ""}
              </option>
            ))}
          </select>
          <label className="text-xs">
            From (optional)
            <input name="startsAt" type="datetime-local" className="input mt-1 !text-sm" />
          </label>
          <label className="text-xs">
            Until (optional)
            <input name="expiresAt" type="datetime-local" className="input mt-1 !text-sm" />
          </label>
          <button className="btn-primary !py-1.5 sm:col-span-2">Assign</button>
        </form>
      </div>

      <div>
        <button className="text-sm underline" onClick={async () => setHistory((await api<{ entries: HistoryEntry[] }>(`/api/people/${person.id}/history`)).entries)}>
          {history ? "Refresh history" : "Show access history"}
        </button>
        {history && (
          <ol className="mt-2 flex flex-col gap-1 border-l-2 border-stone-200 pl-3 text-xs" data-testid="person-history">
            {history.length === 0 && <li className="text-stone-500">No changes recorded.</li>}
            {history.map((h) => (
              <li key={h.id}>
                <b>{h.action}</b> by {h.actorEmail ?? "system"} · {fmt(h.createdAt)}
                {typeof h.data.role === "string" && <> · {h.data.role}</>}
                {typeof h.data.permission === "string" && <> · {h.data.permission}</>}
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}

function RolesTab({ roles, setRoles, myPermissions, superAdmin, run }: { roles: WeddingRole[]; setRoles: (r: WeddingRole[]) => void; myPermissions: Set<string>; superAdmin: boolean; run: Run }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Set<string>>(new Set());
  const modules = permissionsByModule(PERMISSIONS.filter((k) => !PLATFORM_ONLY.has(k)));
  const templates = roles.filter((r) => !r.custom);
  const custom = roles.filter((r) => r.custom);
  return (
    <section className="flex flex-col gap-4">
      <form
        className="flex flex-wrap items-end gap-2 rounded-xl border bg-white p-4"
        data-testid="clone-role-form"
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          await run(async () => {
            const r = await api<WeddingRole>("/api/people/roles", { method: "POST", body: { sourceRoleId: f.get("sourceRoleId"), name: f.get("name") } });
            setRoles([...roles, r]);
            setEditing(r.id);
            setDraft(new Set(r.permissions));
          }, "Role created — adjust its permissions below");
        }}
      >
        <label className="text-sm">
          Start from
          <select name="sourceRoleId" required className="input mt-1 !text-base">
            {templates.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        <label className="min-w-48 flex-1 text-sm">
          New role name
          <input name="name" required minLength={2} maxLength={60} className="input mt-1 !text-base" placeholder="e.g. Mehendi helper" />
        </label>
        <button className="btn-primary">Create role</button>
      </form>

      {custom.length === 0 && <p className="text-sm text-stone-500">No custom roles yet. The standard roles are listed below as templates.</p>}
      <ul className="flex flex-col gap-2">
        {[...custom, ...templates].map((r) => (
          <li key={r.id} className="rounded-xl border bg-white p-3" data-testid="role-row">
            <div className="flex flex-wrap items-center gap-2">
              <b>{r.name}</b>
              <span className="text-xs text-stone-500">{r.custom ? "this wedding" : "template"}</span>
              <span className="text-xs text-stone-500">· {r.permissions.length} permissions</span>
              <span className="flex-1" />
              {r.custom && editing !== r.id && (
                <button
                  className="text-sm underline"
                  onClick={() => {
                    setEditing(r.id);
                    setDraft(new Set(r.permissions));
                  }}
                >
                  Edit permissions
                </button>
              )}
            </div>
            {editing === r.id ? (
              <div className="mt-2">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {Object.entries(modules).map(([mod, keys]) => (
                    <fieldset key={mod} className="rounded border border-stone-200 p-2">
                      <legend className="px-1 text-xs font-semibold uppercase text-stone-500">{mod}</legend>
                      {keys.map((k) => {
                        const grantable = superAdmin || myPermissions.has(k);
                        return (
                          <label key={k} className={`flex items-center gap-1 text-xs ${grantable ? "" : "text-stone-400"}`} title={grantable ? undefined : "You can't grant a permission you don't have"}>
                            <input
                              type="checkbox"
                              disabled={!grantable}
                              checked={draft.has(k)}
                              onChange={(e) => {
                                const d = new Set(draft);
                                if (e.target.checked) d.add(k);
                                else d.delete(k);
                                setDraft(d);
                              }}
                            />
                            {k}
                          </label>
                        );
                      })}
                    </fieldset>
                  ))}
                </div>
                <p className="mt-2 text-xs text-stone-600" data-testid="role-preview">
                  Preview — people with this role will be able to use: {[...draft].sort().join(", ") || "nothing"}
                </p>
                <div className="mt-2 flex gap-2">
                  <button
                    className="btn-primary !py-1.5"
                    onClick={() =>
                      run(async () => {
                        const u = await api<WeddingRole>(`/api/people/roles/${r.id}`, { method: "PUT", body: { permissionKeys: [...draft].sort() } });
                        setRoles(roles.map((x) => (x.id === u.id ? u : x)));
                        setEditing(null);
                      }, "Role saved")
                    }
                  >
                    Save
                  </button>
                  <button className="btn-secondary !py-1.5" onClick={() => setEditing(null)}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <p className="mt-1 text-xs text-stone-500">{r.permissions.join(", ") || "No permissions"}</p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
