/** Synthetic application backend. Its calculations are independent of the hook assertions. */
import type { IncomingMessage, ServerResponse } from "node:http";
import { staticServer } from "@testwalker/web";

export const PRICES: Record<string, number> = {
  "Ridge walk": 80,
  "River paddle": 120,
};
export const CAPACITY = 1000;
type Data = Record<string, string>;
export interface Booking {
  id: string;
  token: string;
  data: Data;
  total_cents: number;
  status: string;
  pickup: string;
}
interface Refund {
  booking_id: string;
  amount_cents: number;
  reason: string;
}
const length = (value: string) => [...value].length;
export function money(value: string | number): number {
  const text = String(value).replace(/^\+/, "");
  if (!/^\d*(?:\.\d*)?$/.test(text)) throw new Error("Invalid monetary amount");
  const [whole = "", fraction = ""] = text.split(".");
  const cents =
    BigInt(whole || "0") * 100n + BigInt((fraction + "00").slice(0, 2));
  return Number(cents + (Number(fraction[2] ?? "0") >= 5 ? 1n : 0n));
}
export function clean(data: unknown): Data {
  if (
    !data ||
    typeof data !== "object" ||
    Array.isArray(data) ||
    !Object.values(data).every(
      (value) =>
        typeof value === "string" ||
        (typeof value === "number" && Number.isFinite(value)),
    )
  ) {
    throw new Error("Supply a business-data object");
  }
  return Object.fromEntries(
    Object.entries(data).map(([key, value]) => [key, String(value).trim()]),
  );
}
export function bookingData(data: unknown): { values: Data; total: number } {
  const values = clean(data),
    name = values["Traveller name"] ?? "",
    email = values["Contact email"] ?? "";
  const places = values["Party size"] ?? "",
    trip = values.Adventure ?? "",
    gift = values["Conservation contribution"] ?? "";
  if (length(name) < 2 || length(name) > 60)
    throw new Error("Traveller name must contain 2–60 characters");
  if (!/^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(email))
    throw new Error("A valid contact email is required");
  if (!/^[+-]?\d+$/.test(places) || Number(places) < 1 || Number(places) > 6)
    throw new Error("Party size must be a whole number from 1 through 6");
  if (!Object.hasOwn(PRICES, trip))
    throw new Error("Choose Ridge walk or River paddle");
  if (
    !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(gift) ||
    Number(gift) < 0 ||
    Number(gift) > 50
  ) {
    throw new Error("Contribution must be a decimal number from 0 through 50");
  }
  return {
    values,
    total:
      Number(places) * PRICES[trip] * 100 +
      money(Number(gift) === 0 ? "0" : gift),
  };
}
export class TrailheadStore {
  defect = "";
  bookings: Booking[] = [];
  refunds: Refund[] = [];
  remaining: Record<string, number> = {};
  profile: Data = {};
  constructor() {
    this.reset();
  }
  reset(defect = "") {
    if (!["", "inventory", "refund"].includes(defect))
      throw new Error("Unknown demo defect");
    this.defect = defect;
    this.bookings = [];
    this.refunds = [];
    this.remaining = Object.fromEntries(
      Object.keys(PRICES).map((trip) => [trip, CAPACITY]),
    );
    this.profile = {
      "Display name": "Alex Morgan",
      "Member email": "alex@example.test",
      "Updates preference": "Email",
      "Access notes": "",
    };
    return this.snapshot();
  }
  snapshot() {
    return structuredClone({
      bookings: this.bookings,
      refunds: this.refunds,
      remaining: this.remaining,
      capacity: CAPACITY,
      prices: PRICES,
      profile: this.profile,
    });
  }
  confirm(
    data: unknown,
    token: string,
    pickup = "City visitor centre",
  ): Booking {
    const { values, total } = bookingData(data);
    if (typeof token !== "string" || token.length < 1 || token.length > 100)
      throw new Error("A confirmation token is required");
    if (!["City visitor centre", "Marina pier"].includes(pickup))
      throw new Error("Choose City visitor centre or Marina pier");
    const existing = this.bookings.find((booking) => booking.token === token);
    if (existing) return structuredClone(existing);
    const trip = values.Adventure,
      places = Number(values["Party size"]);
    if (this.remaining[trip] < places)
      throw new Error("Not enough remaining places");
    const booking = {
      id: `TH-${String(this.bookings.length + 1).padStart(4, "0")}`,
      token,
      data: values,
      total_cents: total,
      status: "confirmed",
      pickup,
    };
    this.bookings.push(booking);
    if (this.defect !== "inventory") this.remaining[trip] -= places;
    return structuredClone(booking);
  }
  cancel(identifier: string, data: unknown): Refund {
    const reason = clean(data)["Cancellation reason"] ?? "";
    if (length(reason) < 5 || length(reason) > 120)
      throw new Error("Cancellation reason must contain 5–120 characters");
    const booking = this.bookings.find((item) => item.id === identifier);
    if (!booking) throw new Error("Booking does not exist");
    const existing = this.refunds.find(
      (item) => item.booking_id === identifier,
    );
    if (existing) return structuredClone(existing);
    booking.status = "cancelled";
    this.remaining[booking.data.Adventure] += Number(
      booking.data["Party size"],
    );
    const refund = {
      booking_id: identifier,
      amount_cents: booking.total_cents,
      reason,
    };
    this.refunds.push(refund);
    if (this.defect === "refund") this.refunds.push(structuredClone(refund));
    return structuredClone(refund);
  }
  saveProfile(data: unknown): Data {
    const values = clean(data),
      name = values["Display name"] ?? "";
    if (length(name) < 2 || length(name) > 40)
      throw new Error("Display name must contain 2–40 characters");
    if (!/^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(values["Member email"] ?? ""))
      throw new Error("A valid member email is required");
    if (!["Email", "SMS", "None"].includes(values["Updates preference"]))
      throw new Error("Choose Email, SMS or None");
    if (length(values["Access notes"] ?? "") > 80)
      throw new Error("Access notes must contain at most 80 characters");
    this.profile = values;
    return structuredClone(values);
  }
}
function json(response: ServerResponse, value: unknown, status = 200): void {
  response.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(value));
}
async function body(request: IncomingMessage): Promise<Record<string, any>> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > 16384) throw new Error("Supply at most 16 KiB of JSON");
    chunks.push(chunk);
  }
  const data = JSON.parse(Buffer.concat(chunks).toString());
  if (!data || typeof data !== "object" || Array.isArray(data))
    throw new Error("Supply a JSON object");
  return data;
}
export function create_server(directory: string) {
  const store = new TrailheadStore();
  return staticServer(directory, async (request, response) => {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    if (!path.startsWith("/api/trailhead/")) return false;
    if (request.method === "GET" && path === "/api/trailhead/state") {
      json(response, store.snapshot());
      return true;
    }
    if (request.method !== "POST") {
      json(response, { error: "Unknown demo endpoint" }, 404);
      return true;
    }
    try {
      const data = await body(request);
      let value;
      switch (path) {
        case "/api/trailhead/reset":
          value = store.reset(data.defect ?? "");
          break;
        case "/api/trailhead/bookings":
          value = store.confirm(data.data, data.token, data.pickup);
          break;
        case "/api/trailhead/cancellations":
          value = store.cancel(data.booking_id, data.data);
          break;
        case "/api/trailhead/profile":
          value = store.saveProfile(data.data);
          break;
        default:
          json(response, { error: "Unknown demo endpoint" }, 404);
          return true;
      }
      json(response, value);
    } catch (error) {
      json(
        response,
        { error: error instanceof Error ? error.message : String(error) },
        400,
      );
    }
    return true;
  });
}
