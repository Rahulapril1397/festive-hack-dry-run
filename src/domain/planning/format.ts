/** Display helpers (India time). */
export const fmtDay = (day: string) => new Date(`${day}T00:00:00+05:30`).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short" });
export const fmtHour = (h: number) => `${String(h).padStart(2, "0")}:00–${String((h + 1) % 24).padStart(2, "0")}:00`;
export const fmtWhen = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }) : "Time not set");
export const modeLabel = (m: string) => ({ train: "Train", flight: "Flight", car: "Car", bus: "Bus", other: "Other", "not given": "Mode not given" })[m] ?? m;
export const foodLabel = (k: string) => ({ veg: "Veg", non_veg: "Non-veg", jain: "Jain", vegan: "Vegan", "not stated": "Not stated" })[k] ?? k;
