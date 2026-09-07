export const MAX_LOBBY_ROLES = 20;
export type LobbyRoleInput = { name: string; description?: string };
export type LobbyRole = { id: string; name: string; description: string; assignedUserId: string | null };
export type LobbyRoles = { items: LobbyRole[] };
export type LobbyRoleAction = 'select' | 'release';
export type LobbyRolesApi = {
  listLobbyRoles: (lobbyId: string) => Promise<LobbyRoles>;
  changeLobbyRole: (lobbyId: string, roleId: string, action: LobbyRoleAction) => Promise<LobbyRoles>;
};
/** Same code-point limits as PostgreSQL varchar / class-validator, after trim. */
export function normalizeLobbyRole(name: string, description = ''): Required<LobbyRoleInput> | null {
  const n = name.trim(), d = description.trim();
  return n && Array.from(n).length <= 10 && Array.from(d).length <= 50 && !n.includes('\u0000') && !d.includes('\u0000')
    ? { name: n, description: d } : null;
}
export function isLobbyRoles(value: unknown): value is LobbyRoles {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).join() !== 'items' || !('items' in value) || !Array.isArray(value.items) || value.items.length > MAX_LOBBY_ROLES) return false;
  const ids = new Set<string>(), users = new Set<string>();
  return value.items.every((r: unknown) => {
    if (!r || typeof r !== 'object' || Array.isArray(r)) return false;
    const row = r as Record<string, unknown>;
    if (Object.keys(row).sort().join() !== 'assignedUserId,description,id,name' || typeof row.id !== 'string' || !row.id
      || ids.has(row.id) || typeof row.name !== 'string' || typeof row.description !== 'string' || !normalizeLobbyRole(row.name, row.description)
      || row.name !== row.name.trim() || row.description !== row.description.trim()
      || !(row.assignedUserId === null || (typeof row.assignedUserId === 'string' && row.assignedUserId.length > 0 && !users.has(row.assignedUserId)))) return false;
    ids.add(row.id); if (row.assignedUserId) users.add(row.assignedUserId as string); return true;
  });
}
