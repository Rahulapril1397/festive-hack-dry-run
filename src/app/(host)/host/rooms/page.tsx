import { requirePage } from "@/components/shell/guard";
import { hasPermission } from "@/lib/authz";
import { roomsView } from "@/domain/planning/service";
import { AddRooms, DeleteRoom, RoomPicker, RoomTools } from "@/components/shell/PlanActions";

export const dynamic = "force-dynamic";

export default async function RoomsPage() {
  const s = await requirePage("planning.read", "/host/rooms");
  const [v, canWrite] = await Promise.all([roomsView(s.weddingId), hasPermission(s, "planning.write")]);
  const cap = v.info.settings.roomCapacity;
  const placed = v.families.filter((f) => f.rooms.length >= f.roomsNeeded && f.roomsNeeded > 0).length;
  const waiting = v.families.filter((f) => f.roomsNeeded > 0 && f.rooms.length < f.roomsNeeded);
  const famOptions = v.families.map((f) => ({ id: f.familyId, name: `${f.name} (${f.people})` }));
  return (
    <main className="flex flex-col gap-6 p-4 md:p-6">
      <header>
        <h1 className="text-3xl font-bold">Rooms and allocation</h1>
        <p className="text-stone-600">Up to {cap} people per room, children and elders counted the same. Families stay together: a family takes as many whole rooms as it needs. Guests see their room on their family page once you allocate.</p>
        <p className="mt-1 text-sm text-stone-500" data-testid="room-summary">{v.rooms.length} rooms · {placed} of {v.families.filter((f) => f.roomsNeeded > 0).length} families placed{waiting.length ? ` · ${waiting.length} waiting` : ""}</p>
      </header>
      {canWrite && <RoomTools />}
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <section>
          <h2 className="mb-2 text-lg font-bold">Rooms</h2>
          {v.rooms.length === 0 ? <p className="rounded-xl border border-dashed bg-white p-4 text-sm text-stone-600">No rooms yet. Add the venue’s rooms on the right (for example block A, rooms 101 to 120).</p> : (
            <div className="overflow-x-auto rounded-xl border border-amber-200 bg-white">
              <table className="w-full text-sm" data-testid="rooms-table">
                <thead className="bg-amber-50 text-left"><tr><th className="p-2">Room</th><th className="p-2">Floor</th><th className="p-2">Sleeps</th><th className="p-2">Family</th>{canWrite && <th className="p-2" />}</tr></thead>
                <tbody>
                  {v.rooms.map((r) => (
                    <tr key={r.id} className="border-t" data-testid={`room-${r.block}${r.label}`}>
                      <td className="p-2 font-medium">{r.block ? `${r.block}-${r.label}` : r.label}</td>
                      <td className="p-2">{r.floor ?? "—"}</td>
                      <td className="p-2">{r.capacity} ({r.beds} beds)</td>
                      <td className="p-2">{canWrite ? <RoomPicker roomId={r.id} familyId={r.familyId} families={famOptions} /> : (r.family ?? "—")}</td>
                      {canWrite && <td className="p-2">{!r.familyId && <DeleteRoom id={r.id} />}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
        <aside className="flex flex-col gap-4">
          {canWrite && <AddRooms />}
          <div>
            <h2 className="mb-1 text-lg font-bold">Families</h2>
            <ul className="max-h-96 overflow-y-auto rounded-xl border border-amber-200 bg-white text-sm" data-testid="family-rooms">
              {v.families.map((f) => (
                <li key={f.familyId} className="flex justify-between gap-2 border-b border-stone-100 px-3 py-1.5">
                  <span>{f.name} <span className="text-stone-500">({f.people})</span></span>
                  <span className={f.rooms.length >= f.roomsNeeded ? "text-green-700" : "text-amber-700"}>{f.rooms.length ? f.rooms.join(", ") : `needs ${f.roomsNeeded}`}</span>
                </li>
              ))}
              {v.families.length === 0 && <li className="p-3 text-stone-500">No attending families yet.</li>}
            </ul>
          </div>
        </aside>
      </div>
    </main>
  );
}
