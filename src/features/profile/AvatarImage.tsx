import { useRef, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import type { Avatar } from '../../api/types';
import { useAuthenticatedAuth } from '../../auth/AuthProvider';
import { useI18n } from '../../i18n/LocalizationProvider';
import { colors } from '../../theme';

export function AvatarImage({ avatar, size = 94, reloadKey }: { avatar: Avatar | null; size?: number; reloadKey?: string }) {
  const { user, getAvatarUrl, avatarReloadKey } = useAuthenticatedAuth();
  const { t } = useI18n();
  const [failed, setFailed] = useState<string | null>(null);
  let url: string | null = null;
  try {
    if (avatar) {
      url = getAvatarUrl(avatar.id);
      const retry = reloadKey ?? avatarReloadKey;
      if (retry) url += `?retry=${encodeURIComponent(retry)}`;
    }
  } catch { /* Neutral fallback for unavailable API configuration. */ }
  const requestKey = `${user.id}:${url}`;
  const currentRequest = useRef(requestKey);
  currentRequest.current = requestKey;
  const shape = { width: size, height: size, borderRadius: size / 2 };
  return url && failed !== requestKey ? <Image key={requestKey} testID="profile-avatar-image" source={{ uri: url }} accessibilityLabel={t('avatar.label')}
    style={[styles.avatar, shape]} onError={() => { if (currentRequest.current === requestKey) setFailed(requestKey); }} />
    : <View testID="profile-avatar-placeholder" accessibilityLabel={t('avatar.placeholder')} style={[styles.avatar, shape]}><Feather name="user" size={size * 0.45} color={colors.muted} /></View>;
}
const styles = StyleSheet.create({ avatar: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' } });
