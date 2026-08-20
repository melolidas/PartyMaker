import cors from "cors";
import express from "express";
import { db, type GuestRow, type PartyRow, type Rsvp } from "./db.js";

const RSVP_VALUES: Rsvp[] = ["pending", "yes", "no", "maybe"];

interface GuestSummary {
  total: number;
  yes: number;
  no: number;
  maybe: number;
  pending: number;
}

function summarize(guests: GuestRow[]): GuestSummary {
  return {
    total: guests.length,
    yes: guests.filter((g) => g.rsvp === "yes").length,
    no: guests.filter((g) => g.rsvp === "no").length,
    maybe: guests.filter((g) => g.rsvp === "maybe").length,
    pending: guests.filter((g) => g.rsvp === "pending").length,
  };
}

function getGuests(partyId: number): GuestRow[] {
  return db
    .prepare(
      "SELECT * FROM guests WHERE party_id = ? ORDER BY created_at ASC, id ASC",
    )
    .all(partyId) as GuestRow[];
}

export function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", service: "partymaker", time: new Date().toISOString() });
  });

  app.get("/api/parties", (_req, res) => {
    const parties = db
      .prepare("SELECT * FROM parties ORDER BY starts_at ASC, id ASC")
      .all() as PartyRow[];
    res.json(
      parties.map((party) => ({
        ...party,
        guests: summarize(getGuests(party.id)),
      })),
    );
  });

  app.post("/api/parties", (req, res) => {
    const { name, host, location, startsAt, description } = req.body ?? {};
    if (typeof name !== "string" || name.trim() === "") {
      return res.status(400).json({ error: "name is required" });
    }
    if (typeof host !== "string" || host.trim() === "") {
      return res.status(400).json({ error: "host is required" });
    }
    if (typeof startsAt !== "string" || startsAt.trim() === "") {
      return res.status(400).json({ error: "startsAt is required" });
    }
    const info = db
      .prepare(
        `INSERT INTO parties (name, host, location, starts_at, description)
         VALUES (@name, @host, @location, @startsAt, @description)`,
      )
      .run({
        name: name.trim(),
        host: host.trim(),
        location: typeof location === "string" ? location.trim() : "",
        startsAt: startsAt.trim(),
        description: typeof description === "string" ? description.trim() : "",
      });
    const party = db
      .prepare("SELECT * FROM parties WHERE id = ?")
      .get(info.lastInsertRowid) as PartyRow;
    res.status(201).json({ ...party, guests: summarize([]) });
  });

  app.get("/api/parties/:id", (req, res) => {
    const party = db
      .prepare("SELECT * FROM parties WHERE id = ?")
      .get(req.params.id) as PartyRow | undefined;
    if (!party) return res.status(404).json({ error: "party not found" });
    const guests = getGuests(party.id);
    res.json({ ...party, guestList: guests, guests: summarize(guests) });
  });

  app.delete("/api/parties/:id", (req, res) => {
    const info = db.prepare("DELETE FROM parties WHERE id = ?").run(req.params.id);
    if (info.changes === 0) return res.status(404).json({ error: "party not found" });
    res.status(204).end();
  });

  app.post("/api/parties/:id/guests", (req, res) => {
    const party = db
      .prepare("SELECT id FROM parties WHERE id = ?")
      .get(req.params.id) as { id: number } | undefined;
    if (!party) return res.status(404).json({ error: "party not found" });

    const { name, rsvp } = req.body ?? {};
    if (typeof name !== "string" || name.trim() === "") {
      return res.status(400).json({ error: "name is required" });
    }
    const rsvpValue: Rsvp =
      typeof rsvp === "string" && RSVP_VALUES.includes(rsvp as Rsvp)
        ? (rsvp as Rsvp)
        : "pending";

    const info = db
      .prepare("INSERT INTO guests (party_id, name, rsvp) VALUES (?, ?, ?)")
      .run(party.id, name.trim(), rsvpValue);
    const guest = db
      .prepare("SELECT * FROM guests WHERE id = ?")
      .get(info.lastInsertRowid) as GuestRow;
    res.status(201).json(guest);
  });

  app.patch("/api/guests/:id", (req, res) => {
    const { rsvp } = req.body ?? {};
    if (typeof rsvp !== "string" || !RSVP_VALUES.includes(rsvp as Rsvp)) {
      return res
        .status(400)
        .json({ error: `rsvp must be one of ${RSVP_VALUES.join(", ")}` });
    }
    const info = db
      .prepare("UPDATE guests SET rsvp = ? WHERE id = ?")
      .run(rsvp, req.params.id);
    if (info.changes === 0) return res.status(404).json({ error: "guest not found" });
    const guest = db
      .prepare("SELECT * FROM guests WHERE id = ?")
      .get(req.params.id) as GuestRow;
    res.json(guest);
  });

  app.delete("/api/guests/:id", (req, res) => {
    const info = db.prepare("DELETE FROM guests WHERE id = ?").run(req.params.id);
    if (info.changes === 0) return res.status(404).json({ error: "guest not found" });
    res.status(204).end();
  });

  return app;
}
