"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "./api";

/** Small client helpers for the planning screens: every action calls a planning API and refreshes the page. */
function useAct() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const run = async (fn: () => Promise<string | void>) => {
    setBusy(true);
    setMsg(null);
    try {
      const t = await fn();
      setMsg({ ok: true, text: t || "Saved" });
      router.refresh();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  return { busy, msg, run };
}
const Msg = ({ m }: { m: { ok: boolean; text: string } | null }) => (m ? <p role="status" className={`text-sm ${m.ok ? "text-green-700" : "text-red-700"}`}>{m.text}</p> : null);

export function RoomTools() {
  const { busy, msg, run } = useAct();
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="room-tools">
      <button
        className="btn-primary"
        disabled={busy}
        data-testid="allocate"
        onClick={() =>
          run(async () => {
            const r = await api<{ families: number; rooms: number; unplaced: { family: string; people: number }[] }>("/api/planning/rooms/allocate", { method: "POST", body: {} });
            return `${r.families} families placed in ${r.rooms} rooms.${r.unplaced.length ? ` Not enough free rooms for: ${r.unplaced.map((u) => `${u.family} (${u.people})`).join(", ")}.` : ""}`;
          })
        }
      >
        Allocate rooms automatically
      </button>
      <button
        className="btn-secondary"
        disabled={busy}
        onClick={() => confirm("Free every room? Families will lose their allocation.") && run(async () => `${(await api<{ freed: number }>("/api/planning/rooms/clear", { method: "POST", body: {} })).freed} rooms freed.`)}
      >
        Free all rooms
      </button>
      <Msg m={msg} />
    </div>
  );
}

export function AddRooms() {
  const { busy, msg, run } = useAct();
  return (
    <form
      className="grid grid-cols-2 gap-2 rounded-xl border border-amber-200 bg-white p-4 text-sm"
      data-testid="add-rooms"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const n = (k: string) => Number(f.get(k));
        void run(async () => {
          const r = await api<{ created: number; skipped: number }>("/api/planning/rooms", { method: "POST", body: { block: String(f.get("block") ?? ""), floor: String(f.get("floor") ?? "") || undefined, prefix: String(f.get("prefix") ?? ""), from: n("from"), to: n("to"), capacity: n("capacity"), beds: n("beds") } });
          return `${r.created} rooms added${r.skipped ? `, ${r.skipped} already existed` : ""}.`;
        });
      }}
    >
      <p className="col-span-2 font-semibold">Add rooms</p>
      <input name="block" placeholder="Block (e.g. A)" className="rounded border px-2 py-1" />
      <input name="floor" placeholder="Floor (optional)" className="rounded border px-2 py-1" />
      <input name="prefix" placeholder="Prefix (optional)" className="rounded border px-2 py-1" />
      <span />
      <input name="from" type="number" min={0} placeholder="From (e.g. 101)" required className="rounded border px-2 py-1" />
      <input name="to" type="number" min={0} placeholder="To (e.g. 120)" required className="rounded border px-2 py-1" />
      <input name="capacity" type="number" min={1} max={20} defaultValue={6} aria-label="People per room" className="rounded border px-2 py-1" />
      <input name="beds" type="number" min={0} max={20} defaultValue={2} aria-label="Beds per room" className="rounded border px-2 py-1" />
      <button className="btn-primary col-span-2" disabled={busy}>Add rooms</button>
      <div className="col-span-2"><Msg m={msg} /></div>
    </form>
  );
}

export function RoomPicker({ roomId, familyId, families }: { roomId: string; familyId: string | null; families: { id: string; name: string }[] }) {
  const { busy, msg, run } = useAct();
  return (
    <span className="inline-flex flex-col">
      <select
        className="max-w-48 rounded border px-1 py-0.5 text-sm"
        value={familyId ?? ""}
        disabled={busy}
        aria-label="Family in this room"
        onChange={(e) => run(async () => { await api("/api/planning/rooms/assign", { method: "PUT", body: { roomId, familyId: e.target.value || null } }); })}
      >
        <option value="">— free —</option>
        {families.map((f) => (
          <option key={f.id} value={f.id}>{f.name}</option>
        ))}
      </select>
      <Msg m={msg?.ok ? null : msg} />
    </span>
  );
}

export function DeleteRoom({ id }: { id: string }) {
  const { busy, run } = useAct();
  return <button className="text-xs text-red-700 underline" disabled={busy} onClick={() => run(async () => { await api(`/api/planning/rooms/${id}`, { method: "DELETE" }); })}>remove</button>;
}

type PlanSettings = { venueName: string; venueCity: string; stationName: string; airportName: string; roomCapacity: number; bedsPerRoom: number; roomsPerCleaner: number; guestsPerTeaStaff: number; vehicleBuffer: number; vehicles: { name: string; capacity: number }[] };

export function SettingsForm({ initial }: { initial: PlanSettings }) {
  const { busy, msg, run } = useAct();
  const v = initial.vehicles.map((x) => `${x.name}:${x.capacity}`).join(", ");
  return (
    <form
      className="grid gap-2 rounded-xl border border-amber-200 bg-white p-4 text-sm md:grid-cols-2"
      data-testid="plan-settings"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const num = (k: string) => Number(f.get(k));
        const s = (k: string) => String(f.get(k) ?? "").trim() || null;
        const vehicles = String(f.get("vehicles") ?? "").split(",").map((p) => p.trim()).filter(Boolean).map((p) => { const [name, cap] = p.split(":"); return { name: (name ?? "").trim(), capacity: Number(cap) }; });
        void run(async () => { await api("/api/planning/settings", { method: "PUT", body: { venueName: s("venueName"), venueCity: s("venueCity"), stationName: s("stationName"), airportName: s("airportName"), roomCapacity: num("roomCapacity"), bedsPerRoom: num("bedsPerRoom"), roomsPerCleaner: num("roomsPerCleaner"), guestsPerTeaStaff: num("guestsPerTeaStaff"), vehicleBuffer: num("vehicleBuffer") / 100, vehicles } }); });
      }}
    >
      <p className="font-semibold md:col-span-2">Venue and planning settings</p>
      <label>Venue name<input name="venueName" defaultValue={initial.venueName} className="mt-1 w-full rounded border px-2 py-1" /></label>
      <label>City<input name="venueCity" defaultValue={initial.venueCity} className="mt-1 w-full rounded border px-2 py-1" /></label>
      <label>Railway station (pickup for train)<input name="stationName" defaultValue={initial.stationName} className="mt-1 w-full rounded border px-2 py-1" /></label>
      <label>Airport (pickup for flight)<input name="airportName" defaultValue={initial.airportName} className="mt-1 w-full rounded border px-2 py-1" /></label>
      <label>People per room<input name="roomCapacity" type="number" min={1} max={20} defaultValue={initial.roomCapacity} className="mt-1 w-full rounded border px-2 py-1" /></label>
      <label>Beds per room<input name="bedsPerRoom" type="number" min={0} max={20} defaultValue={initial.bedsPerRoom} className="mt-1 w-full rounded border px-2 py-1" /></label>
      <label>Occupied rooms per cleaner<input name="roomsPerCleaner" type="number" min={1} defaultValue={initial.roomsPerCleaner} className="mt-1 w-full rounded border px-2 py-1" /></label>
      <label>Guests per tea and water person<input name="guestsPerTeaStaff" type="number" min={1} defaultValue={initial.guestsPerTeaStaff} className="mt-1 w-full rounded border px-2 py-1" /></label>
      <label>Vehicle buffer (%)<input name="vehicleBuffer" type="number" min={0} max={100} defaultValue={Math.round(initial.vehicleBuffer * 100)} className="mt-1 w-full rounded border px-2 py-1" /></label>
      <label>Vehicles (name:seats, comma separated)<input name="vehicles" defaultValue={v} className="mt-1 w-full rounded border px-2 py-1" /></label>
      <button className="btn-primary md:col-span-2" disabled={busy}>Save settings</button>
      <div className="md:col-span-2"><Msg m={msg} /></div>
    </form>
  );
}

export function DriverForm({ familyId, current, vendors }: { familyId: string; current: { driverName: string; driverPhone: string; vehicle: string | null; vendorId: string | null } | null; vendors: { id: string; name: string }[] }) {
  const { busy, msg, run } = useAct();
  return (
    <form
      className="flex flex-wrap items-center gap-1 text-xs"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        void run(async () => { await api("/api/planning/pickup", { method: "PUT", body: { familyId, driver: { name: String(f.get("name")), phone: String(f.get("phone")), vehicle: String(f.get("vehicle") ?? "") || undefined, vendorId: String(f.get("vendor") ?? "") || null } } }); });
      }}
    >
      <input name="name" defaultValue={current?.driverName} placeholder="Driver name" required className="w-28 rounded border px-1 py-0.5" />
      <input name="phone" defaultValue={current?.driverPhone} placeholder="Driver phone" required inputMode="numeric" className="w-28 rounded border px-1 py-0.5" />
      <input name="vehicle" defaultValue={current?.vehicle ?? ""} placeholder="Vehicle no." className="w-24 rounded border px-1 py-0.5" />
      {vendors.length > 0 && (
        <select name="vendor" defaultValue={current?.vendorId ?? ""} className="rounded border px-1 py-0.5" aria-label="Transport vendor">
          <option value="">no vendor</option>
          {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
      )}
      <button className="rounded bg-rose-700 px-2 py-0.5 text-white" disabled={busy}>{current ? "Update" : "Assign"}</button>
      {current && <button type="button" className="text-red-700 underline" disabled={busy} onClick={() => run(async () => { await api("/api/planning/pickup", { method: "PUT", body: { familyId, driver: null } }); })}>clear</button>}
      <Msg m={msg?.ok ? null : msg} />
    </form>
  );
}

export function VendorLink({ vendors }: { vendors: { id: string; name: string; linked: boolean }[] }) {
  const { busy, msg, run } = useAct();
  if (!vendors.length) return <p className="text-sm text-stone-600">No transport vendor yet. Add one under Vendors with the category Transport.</p>;
  return (
    <form
      className="flex flex-wrap items-end gap-2 text-sm"
      data-testid="vendor-link"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        void run(async () => { await api("/api/planning/vendor-login", { method: "PUT", body: { vendorId: String(f.get("vendor")), email: String(f.get("email") ?? "").trim() || null } }); return "Login linked."; });
      }}
    >
      <label>Vendor<select name="vendor" className="ml-1 rounded border px-2 py-1">{vendors.map((v) => <option key={v.id} value={v.id}>{v.name}{v.linked ? " (linked)" : ""}</option>)}</select></label>
      <label>Login email<input name="email" type="email" placeholder="leave empty to unlink" className="ml-1 rounded border px-2 py-1" /></label>
      <button className="btn-primary" disabled={busy}>Link login</button>
      <Msg m={msg} />
    </form>
  );
}
