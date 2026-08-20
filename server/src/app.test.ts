import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

process.env.PARTYMAKER_DB = join(
  mkdtempSync(join(tmpdir(), "partymaker-test-")),
  "test.db",
);

const { createApp } = await import("./app.js");

let server: Server;
let base: string;

async function json(res: Response): Promise<any> {
  return res.json();
}

before(async () => {
  const app = createApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      base = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

after(() => {
  server.close();
});

test("health check responds ok", async () => {
  const res = await fetch(`${base}/api/health`);
  assert.equal(res.status, 200);
  const body = await json(res);
  assert.equal(body.status, "ok");
});

test("full party + guest RSVP flow", async () => {
  const createRes = await fetch(`${base}/api/parties`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "Summer BBQ",
      host: "Alex",
      location: "Backyard",
      startsAt: "2026-07-04T18:00",
      description: "Bring your appetite",
    }),
  });
  assert.equal(createRes.status, 201);
  const party = await json(createRes);
  assert.equal(party.name, "Summer BBQ");
  assert.equal(party.guests.total, 0);

  const guestRes = await fetch(`${base}/api/parties/${party.id}/guests`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Jordan", rsvp: "yes" }),
  });
  assert.equal(guestRes.status, 201);
  const guest = await json(guestRes);
  assert.equal(guest.rsvp, "yes");

  const patchRes = await fetch(`${base}/api/guests/${guest.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rsvp: "maybe" }),
  });
  assert.equal(patchRes.status, 200);
  assert.equal((await json(patchRes)).rsvp, "maybe");

  const detailRes = await fetch(`${base}/api/parties/${party.id}`);
  const detail = await json(detailRes);
  assert.equal(detail.guests.total, 1);
  assert.equal(detail.guests.maybe, 1);
  assert.equal(detail.guestList.length, 1);
});

test("rejects invalid party payloads", async () => {
  const res = await fetch(`${base}/api/parties`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ host: "No Name" }),
  });
  assert.equal(res.status, 400);
});
