import { TranslationKey } from '../../i18n/translations';
import { DemoLobby } from '../home/lobbies';

function normalize(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/ё/g, 'е').trim();
}

export function searchLobbies(
  lobbies: readonly DemoLobby[],
  query: string,
  t: (key: TranslationKey) => string,
): DemoLobby[] {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  return lobbies.filter((lobby) => {
    const venue = lobby.placeKey ? t(lobby.placeKey) : lobby.place;
    const searchable = normalize(`${t(lobby.titleKey)} ${venue}`);
    return words.every((word) => searchable.includes(word));
  });
}
