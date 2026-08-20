import { useEffect, useMemo, useState } from "react";
import {
  api,
  type Guest,
  type Party,
  type PartyDetail,
  type Rsvp,
} from "./api";

const RSVP_OPTIONS: { value: Rsvp; label: string }[] = [
  { value: "yes", label: "Going" },
  { value: "maybe", label: "Maybe" },
  { value: "no", label: "Can't" },
  { value: "pending", label: "No reply" },
];

function formatDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function App() {
  const [parties, setParties] = useState<Party[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<PartyDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    try {
      const list = await api.listParties();
      setParties(list);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    if (selectedId == null) {
      setDetail(null);
      return;
    }
    api.getParty(selectedId).then(setDetail).catch((e) => setError(e.message));
  }, [selectedId]);

  async function reloadDetail() {
    if (selectedId == null) return;
    const [d] = await Promise.all([api.getParty(selectedId), refresh()]);
    setDetail(d);
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">🎉</span>
          <div>
            <h1>PartyMaker</h1>
            <p>Plan parties, manage guest lists, and track RSVPs.</p>
          </div>
        </div>
      </header>

      {error && <div className="banner error">{error}</div>}

      <main className="layout">
        <section className="panel">
          <h2>Create a party</h2>
          <CreatePartyForm
            onCreated={async (party) => {
              await refresh();
              setSelectedId(party.id);
            }}
            onError={setError}
          />
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>Upcoming parties</h2>
            <span className="pill">{parties.length}</span>
          </div>
          {loading ? (
            <p className="muted">Loading…</p>
          ) : parties.length === 0 ? (
            <p className="muted">No parties yet. Create your first one!</p>
          ) : (
            <ul className="party-list">
              {parties.map((party) => (
                <li
                  key={party.id}
                  className={party.id === selectedId ? "active" : ""}
                  onClick={() => setSelectedId(party.id)}
                >
                  <div className="party-list-main">
                    <strong>{party.name}</strong>
                    <span className="muted">{formatDate(party.starts_at)}</span>
                  </div>
                  <div className="party-list-meta">
                    <span className="chip chip-yes">{party.guests.yes} going</span>
                    <span className="chip">{party.guests.total} invited</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="panel detail">
          {detail ? (
            <PartyDetailView
              detail={detail}
              onChanged={reloadDetail}
              onDeleted={async () => {
                setSelectedId(null);
                await refresh();
              }}
              onError={setError}
            />
          ) : (
            <div className="empty-detail">
              <p className="muted">Select a party to manage its guest list.</p>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

function CreatePartyForm({
  onCreated,
  onError,
}: {
  onCreated: (party: Party) => void;
  onError: (message: string) => void;
}) {
  const [name, setName] = useState("");
  const [host, setHost] = useState("");
  const [location, setLocation] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const party = await api.createParty({
        name,
        host,
        location,
        startsAt,
        description,
      });
      setName("");
      setHost("");
      setLocation("");
      setStartsAt("");
      setDescription("");
      onCreated(party);
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="form" onSubmit={submit}>
      <label>
        Party name
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Rooftop birthday bash"
          required
        />
      </label>
      <label>
        Host
        <input
          value={host}
          onChange={(e) => setHost(e.target.value)}
          placeholder="Your name"
          required
        />
      </label>
      <label>
        When
        <input
          type="datetime-local"
          value={startsAt}
          onChange={(e) => setStartsAt(e.target.value)}
          required
        />
      </label>
      <label>
        Where
        <input
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="123 Main St"
        />
      </label>
      <label>
        Details
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Theme, what to bring, etc."
          rows={2}
        />
      </label>
      <button className="btn primary" type="submit" disabled={submitting}>
        {submitting ? "Creating…" : "Create party"}
      </button>
    </form>
  );
}

function PartyDetailView({
  detail,
  onChanged,
  onDeleted,
  onError,
}: {
  detail: PartyDetail;
  onChanged: () => Promise<void> | void;
  onDeleted: () => Promise<void> | void;
  onError: (message: string) => void;
}) {
  const [guestName, setGuestName] = useState("");
  const [guestRsvp, setGuestRsvp] = useState<Rsvp>("pending");

  const sorted = useMemo(
    () => [...detail.guestList].sort((a, b) => a.name.localeCompare(b.name)),
    [detail.guestList],
  );

  async function addGuest(e: React.FormEvent) {
    e.preventDefault();
    if (!guestName.trim()) return;
    try {
      await api.addGuest(detail.id, guestName.trim(), guestRsvp);
      setGuestName("");
      setGuestRsvp("pending");
      await onChanged();
    } catch (err) {
      onError((err as Error).message);
    }
  }

  async function updateGuest(guest: Guest, rsvp: Rsvp) {
    try {
      await api.setRsvp(guest.id, rsvp);
      await onChanged();
    } catch (err) {
      onError((err as Error).message);
    }
  }

  async function removeGuest(guest: Guest) {
    try {
      await api.removeGuest(guest.id);
      await onChanged();
    } catch (err) {
      onError((err as Error).message);
    }
  }

  return (
    <div className="detail-inner">
      <div className="panel-head">
        <div>
          <h2>{detail.name}</h2>
          <p className="muted">
            Hosted by {detail.host} · {formatDate(detail.starts_at)}
            {detail.location ? ` · ${detail.location}` : ""}
          </p>
        </div>
        <button
          className="btn danger"
          onClick={async () => {
            await api.deleteParty(detail.id);
            await onDeleted();
          }}
        >
          Delete
        </button>
      </div>

      {detail.description && <p className="description">{detail.description}</p>}

      <div className="summary">
        <SummaryStat label="Invited" value={detail.guests.total} />
        <SummaryStat label="Going" value={detail.guests.yes} tone="yes" />
        <SummaryStat label="Maybe" value={detail.guests.maybe} tone="maybe" />
        <SummaryStat label="Can't" value={detail.guests.no} tone="no" />
      </div>

      <form className="guest-form" onSubmit={addGuest}>
        <input
          value={guestName}
          onChange={(e) => setGuestName(e.target.value)}
          placeholder="Add a guest…"
          aria-label="Guest name"
        />
        <select
          value={guestRsvp}
          onChange={(e) => setGuestRsvp(e.target.value as Rsvp)}
          aria-label="RSVP status"
        >
          {RSVP_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <button className="btn primary" type="submit">
          Add
        </button>
      </form>

      {sorted.length === 0 ? (
        <p className="muted">No guests invited yet.</p>
      ) : (
        <ul className="guest-list">
          {sorted.map((guest) => (
            <li key={guest.id}>
              <span className={`dot dot-${guest.rsvp}`} />
              <span className="guest-name">{guest.name}</span>
              <select
                value={guest.rsvp}
                onChange={(e) => updateGuest(guest, e.target.value as Rsvp)}
                aria-label={`RSVP for ${guest.name}`}
              >
                {RSVP_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <button
                className="btn ghost"
                onClick={() => removeGuest(guest)}
                aria-label={`Remove ${guest.name}`}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SummaryStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "yes" | "maybe" | "no";
}) {
  return (
    <div className={`stat ${tone ? `stat-${tone}` : ""}`}>
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}
