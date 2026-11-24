import type { Permission } from "@/lib/authz/catalogue";

/**
 * Demo tiles with FIXED data (Stage 3 demo plan, "static tiles"): Vendors, Event readiness, Tasks and
 * Gift ledger. Nothing here is read from or written to the database; the Add button only says
 * "Demo only". The real vendor, task and shagun ledger screens stay in the repository, unlinked.
 * All data below is invented sample data.
 */
export type TileKey = "vendors" | "readiness" | "tasks" | "ledger";
export type Audience = "team" | "vendor" | "helper";
export type CheckStatus = "done" | "in_progress" | "not_started";

export type TableTile = { kind: "table"; title: string; blurb: string; add: string; permissions: Permission[]; columns: string[]; rows: { cells: string[]; audience?: Audience }[] };
export type ChecklistTile = { kind: "checklists"; title: string; blurb: string; add: string; permissions: Permission[]; groups: { name: string; items: { label: string; status: CheckStatus }[] }[] };

export const TILES: Record<TileKey, TableTile | ChecklistTile> = {
  vendors: {
    kind: "table",
    title: "Vendors",
    blurb: "Everyone booked for the wedding, with the functions they are booked for.",
    add: "Add vendor",
    permissions: ["vendors.contacts.read", "vendors.manage", "vendors.commercial.read"],
    columns: ["Vendor", "Category", "Contact", "Status", "Booked for"],
    rows: [
      { cells: ["Sharma Caterers", "Caterer", "Raju Sharma", "Contract signed", "Reception"] },
      { cells: ["Phoolwala Decor", "Decorator", "Anita Verma", "Quote sent", "Sangeet, Reception"] },
      { cells: ["Lens & Light Studio", "Photographer", "Karan Mehta", "Contract signed", "Haldi, Sangeet, Reception"] },
      { cells: ["Henna by Sana", "Mehendi artist", "Sana Khan", "Booked", "Haldi"] },
      { cells: ["Punjab Dhol Group", "Dhol group", "Gurpreet Singh", "Booked", "Reception"] },
      { cells: ["Bright Tent & Lights", "Tent and lights", "Mohan Lal", "Quote sent", "Sangeet"] },
    ],
  },
  readiness: {
    kind: "checklists",
    title: "Event readiness",
    blurb: "How ready each function is, item by item.",
    add: "Add event",
    permissions: ["tasks.read", "host.read"],
    groups: [
      {
        name: "Haldi",
        items: [
          { label: "Venue and seating confirmed", status: "done" },
          { label: "Haldi supplies and flowers", status: "done" },
          { label: "Photographer briefed", status: "done" },
          { label: "Music playlist", status: "in_progress" },
          { label: "Guest refreshments", status: "not_started" },
        ],
      },
      {
        name: "Sangeet",
        items: [
          { label: "Stage and lights", status: "in_progress" },
          { label: "Sound check", status: "in_progress" },
          { label: "Performance order", status: "done" },
          { label: "Dinner menu", status: "done" },
          { label: "Photo backdrop", status: "not_started" },
        ],
      },
      {
        name: "Reception",
        items: [
          { label: "Stage and queue console tested", status: "done" },
          { label: "Venue TV and speakers", status: "in_progress" },
          { label: "Caterer headcount", status: "in_progress" },
          { label: "Photographer clock calibration", status: "not_started" },
          { label: "Guest list printed", status: "done" },
        ],
      },
    ],
  },
  tasks: {
    kind: "table",
    title: "Tasks",
    blurb: "Open tasks. Each role sees only its own.",
    add: "Add task",
    permissions: ["tasks.read"],
    columns: ["Task", "Due", "Status"],
    rows: [
      { audience: "team", cells: ["Print token slips", "12 Dec, 10:00", "Not started"] },
      { audience: "team", cells: ["Test the venue TV and speakers", "12 Dec, 16:00", "In progress"] },
      { audience: "team", cells: ["Brief the photographer on stage times", "13 Dec, 09:00", "Not started"] },
      { audience: "vendor", cells: ["Confirm the final headcount with the caterer", "10 Dec, 18:00", "In progress"] },
      { audience: "vendor", cells: ["Send the decoration mock-up for approval", "11 Dec, 12:00", "Not started"] },
      { audience: "helper", cells: ["Set up the welcome desk", "13 Dec, 15:00", "Not started"] },
      { audience: "helper", cells: ["Arrange the guest seating cards", "13 Dec, 12:00", "In progress"] },
      { audience: "helper", cells: ["Carry the gift boxes to the gift table", "13 Dec, 19:00", "Not started"] },
    ],
  },
  ledger: {
    kind: "table",
    title: "Gift ledger",
    blurb: "Gifts and shagun received, by family.",
    add: "Add entry",
    permissions: ["ledger.read", "ledger.write"],
    columns: ["Family", "Type", "Detail", "Date"],
    rows: [
      { cells: ["Sharma family", "Cash", "₹5,100", "13 Dec"] },
      { cells: ["Verma family", "UPI", "₹11,000", "13 Dec"] },
      { cells: ["Khan family", "Boxed gift", "Dinner set", "13 Dec"] },
      { cells: ["Mehta family", "Cash", "₹2,100", "13 Dec"] },
      { cells: ["Singh family", "UPI", "₹21,000", "12 Dec"] },
      { cells: ["Gupta family", "Boxed gift", "Silver tray", "12 Dec"] },
      { cells: ["Iyer family", "Cash", "₹3,100", "13 Dec"] },
      { cells: ["Das family", "UPI", "₹5,100", "13 Dec"] },
    ],
  },
};

export const isTileKey = (s: string): s is TileKey => Object.prototype.hasOwnProperty.call(TILES, s);

/** Which task audiences a role sees: admins and hosts see all; vendor and helper only their own; other roles the team's. */
export function audiencesFor(roles: readonly string[], isSuperAdmin: boolean): Audience[] {
  if (isSuperAdmin || roles.some((r) => ["admin", "host", "coordinator"].includes(r))) return ["team", "vendor", "helper"];
  if (roles.includes("vendor")) return ["vendor"];
  if (roles.includes("helper")) return ["helper"];
  return ["team"];
}

export const readinessPercent = (items: { status: CheckStatus }[]) => Math.round((items.filter((i) => i.status === "done").length / Math.max(1, items.length)) * 100);
