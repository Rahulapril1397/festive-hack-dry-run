/**
 * Planning demo data (additive; never deletes families or RSVPs).
 *
 *   npx tsx scripts/planning-demo.ts seed [--wedding=<uuid>]
 *       Venue, station and airport names, 50 rooms (6 per room), a transport vendor "Pink City Cabs"
 *       linked to the demo vendor login, travel + food answers for the first 24 attending families, and a driver for two of them.
 *       Rooms are NOT allocated: press "Allocate rooms automatically" on the Rooms page to show it.
 *   npx tsx scripts/planning-demo.ts reset [--wedding=<uuid>]
 *       Removes the demo rooms, pickups, travel/food answers this script added and unlinks the vendor.
 *
 * Needs DATABASE_URL.
 */
import postgres from "postgres";
import { DEMO_WEDDING_ID } from "./demoData";

const arg = (k: string, d: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=")[1] ?? d;
const MODES = ["train", "train", "flight", "train", "car", "flight", "bus", "train"] as const;
const FOODS = ["veg", "veg", "non_veg", "jain", "veg", "non_veg", "vegan", "veg"] as const;
const TRAINS = ["12957", "12413", "12985", "12991", "12915"];
const FLIGHTS = ["AI 611", "6E 2043", "UK 721", "SG 8197"];

async function main() {
  const cmd = process.argv[2];
  const url = process.env.DATABASE_URL;
  if (!url || !/^seed|reset$/.test(cmd ?? "")) {
    console.error("usage: DATABASE_URL=… npx tsx scripts/planning-demo.ts seed|reset [--wedding=<uuid>]");
    process.exit(1);
  }
  const sql = postgres(url.replace(/\s+#.*$/, ""), { max: 2, onnotice: () => {} });
  const w = arg("wedding", DEMO_WEDDING_ID);
  try {
    if (cmd === "reset") {
      await sql`delete from pickup_assignment where family_id in (select id from family where wedding_id = ${w})`;
      await sql`delete from guest_profile where family_id in (select id from family where wedding_id = ${w})`;
      await sql`delete from room where wedding_id = ${w}`;
      await sql`update vendor set login_user_id = null where wedding_id = ${w} and name = 'Pink City Cabs'`;
      console.log("planning demo data removed");
      return;
    }
    await sql`update wedding set venue_name = 'The Royal Orchid Banquet Hall', venue_city = 'Jaipur', station_name = 'Jaipur Junction (JP)', airport_name = 'Jaipur International Airport (JAI)' where id = ${w}`;
    for (const [block, floor, from, to] of [["A", "1", 101, 130], ["B", "2", 201, 220]] as const) {
      for (let n = from; n <= to; n++) await sql`insert into room(wedding_id, block, floor, label, capacity, beds) values (${w}, ${block}, ${floor}, ${String(n)}, 6, 2) on conflict do nothing`;
    }
    // Transport vendor, booked for every function, linked to the demo vendor login when it exists.
    const [cat] = await sql<{ id: string }[]>`select id from vendor_category where wedding_id = ${w} and key = 'transport'`;
    if (cat) {
      let [v] = await sql<{ id: string }[]>`select id from vendor where wedding_id = ${w} and name = 'Pink City Cabs'`;
      if (!v) [v] = await sql<{ id: string }[]>`insert into vendor(wedding_id, category_id, name, city, services) values (${w}, ${cat.id}, 'Pink City Cabs', 'Jaipur', 'Station, airport and venue pickups: sedans, SUVs and tempo travellers') returning id`;
      await sql`insert into vendor_event_assignment(vendor_id, event_id, scope) select ${v!.id}, e.id, 'Guest pickups and drops' from event e where e.wedding_id = ${w} on conflict do nothing`;
      const [u] = await sql<{ id: string }[]>`select id from app_user where lower(email) = 'vendor@demo.pehleaap.test'`;
      if (u) await sql`update vendor set login_user_id = ${u.id} where id = ${v!.id} and not exists (select 1 from vendor x where x.login_user_id = ${u.id})`;
    }
    // Arrivals: 11 Dec 2026, spread over the day; departures on 14 Dec.
    const fams = await sql<{ id: string; name: string; people: number }[]>`select family_id as id, name, people from v_family_people where wedding_id = ${w} order by name limit 24`;
    let i = 0;
    for (const f of fams) {
      const mode = MODES[i % MODES.length]!;
      const hour = 6 + ((i * 5) % 15);
      const day = i % 5 === 0 ? 10 : 11;
      const at = `2026-12-${day}T${String(hour).padStart(2, "0")}:${i % 2 ? "30" : "05"}:00+05:30`;
      const number = mode === "train" ? TRAINS[i % TRAINS.length]! : mode === "flight" ? FLIGHTS[i % FLIGHTS.length]! : null;
      await sql`insert into guest_profile(family_id, travel_mode, travel_number, arrival_at, departure_at, arriving_count, food_pref)
                values (${f.id}, ${mode}, ${number}, ${at}, '2026-12-14T11:00:00+05:30', ${Math.max(1, f.people)}, ${FOODS[i % FOODS.length]!})
                on conflict (family_id) do nothing`;
      i++;
    }
    const [drv] = await sql<{ id: string }[]>`select id from vendor where wedding_id = ${w} and name = 'Pink City Cabs'`;
    for (const [idx, name, phone, veh] of [[0, "Ramesh Kumar", "9876501234", "RJ14 TA 4521"], [1, "Sunil Meena", "9876505678", "RJ14 CB 7788"]] as const) {
      const f = fams[idx];
      if (f) await sql`insert into pickup_assignment(family_id, vendor_id, driver_name, driver_phone, vehicle) values (${f.id}, ${drv?.id ?? null}, ${name}, ${phone}, ${veh}) on conflict (family_id) do nothing`;
    }
    console.log(`planning demo ready: 50 rooms, ${fams.length} families with travel and food, 2 drivers. First pickups: ${fams.slice(0, 2).map((f) => f.name).join(", ")}`);
  } finally {
    await sql.end();
  }
}
main().catch((e) => (console.error(e), process.exit(1)));
