export type Rsvp = "pending" | "yes" | "no" | "maybe";

export interface GuestSummary {
  total: number;
  yes: number;
  no: number;
  maybe: number;
  pending: number;
}

export interface Party {
  id: number;
  name: string;
  host: string;
  location: string;
  starts_at: string;
  description: string;
  created_at: string;
  guests: GuestSummary;
}

export interface Guest {
  id: number;
  party_id: number;
  name: string;
  rsvp: Rsvp;
  created_at: string;
}

export interface PartyDetail extends Party {
  guestList: Guest[];
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { "content-type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  listParties: () => request<Party[]>("/api/parties"),
  getParty: (id: number) => request<PartyDetail>(`/api/parties/${id}`),
  createParty: (input: {
    name: string;
    host: string;
    location: string;
    startsAt: string;
    description: string;
  }) =>
    request<Party>("/api/parties", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  deleteParty: (id: number) =>
    request<void>(`/api/parties/${id}`, { method: "DELETE" }),
  addGuest: (partyId: number, name: string, rsvp: Rsvp) =>
    request<Guest>(`/api/parties/${partyId}/guests`, {
      method: "POST",
      body: JSON.stringify({ name, rsvp }),
    }),
  setRsvp: (guestId: number, rsvp: Rsvp) =>
    request<Guest>(`/api/guests/${guestId}`, {
      method: "PATCH",
      body: JSON.stringify({ rsvp }),
    }),
  removeGuest: (guestId: number) =>
    request<void>(`/api/guests/${guestId}`, { method: "DELETE" }),
};
