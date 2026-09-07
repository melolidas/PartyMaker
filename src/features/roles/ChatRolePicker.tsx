import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Keyboard, Pressable, StyleSheet, Text, View } from 'react-native';
import { useI18n } from '../../i18n/LocalizationProvider';
import { colors, radius } from '../../theme';
import type { LobbyRolesStore, RolesState } from './lobbyRoles';
import { RoleTile } from './RoleTile';
import { RolePopup } from './RolePopup';

export function ChatRolePicker({ store, state, onPopupBack }: {
  store: LobbyRolesStore; state: RolesState; onPopupBack?: (back: (() => void) | null) => void;
}) {
  const { t } = useI18n();
  const [page, setPage] = useState<string | null>(null);
  const back = useCallback(() => { Keyboard.dismiss(); setPage(p => p === 'list' ? null : 'list'); }, []);
  useEffect(() => { onPopupBack?.(page && !state.blocked ? back : null); return () => onPopupBack?.(null); }, [page, state.blocked, back, onPopupBack]);
  const selected = state.items.find(r => r.id === page);
  const owned = selected?.assignedUserId === state.account;
  const busy = state.mutating || state.loading;
  const retry = state.pending ? <Pressable testID="role-action-retry" accessibilityRole="button" disabled={state.mutating} onPress={() => void store.retry()} style={styles.button}>
    <Text style={styles.primary}>{t('roles.retry')}</Text></Pressable> : null;
  const error = state.error ? <View testID="roles-error" style={styles.notice}><Text accessibilityLiveRegion="polite" style={styles.note}>{t(state.error)}</Text>
    {retry ?? (!state.blocked ? <Pressable testID="roles-load-retry" accessibilityRole="button" onPress={() => void store.reload()}><Text style={styles.text}>{t('auth.retry')}</Text></Pressable> : null)}
  </View> : null;
  return <>
    <View testID="chat-role-toolbar" style={styles.toolbar}>
      {state.items.length > 0 && !state.blocked ? <RoleTile testID="chat-choose-role" label={t('roles.choose')} onPress={() => { Keyboard.dismiss(); setPage('list'); }} /> : null}
      {!page ? error : null}
      {state.loading ? <ActivityIndicator testID="roles-loading" color={colors.text} /> : null}
    </View>
    {page && !state.blocked ? <RolePopup label={t('roles.choose')} onBack={back}>
      {page === 'list' ? <View testID="chat-role-grid" style={styles.grid}>
        {state.items.map(role => <RoleTile key={role.id} testID={`chat-role-${role.id}`} label={role.name} onPress={() => setPage(role.id)} />)}
      </View> : selected ? <>
        <View style={styles.center}><RoleTile label={selected.name} /></View>
        {selected.description ? <Text testID="chat-role-description" style={styles.text}>{selected.description}</Text> : null}
        {selected.assignedUserId && !owned ? <Text testID="role-taken" style={styles.note}>{t('roles.taken')}</Text> : <Pressable testID="role-action"
          accessibilityRole="button" disabled={busy || !!state.pending} onPress={() => void store.choose(selected.id, owned ? 'release' : 'select')}
          style={[styles.button, (busy || !!state.pending) && styles.disabled]}>
          {state.mutating ? <ActivityIndicator color={colors.black} /> : <Text style={styles.primary}>{t(owned ? 'roles.release' : 'roles.choose')}</Text>}
        </Pressable>}
      </> : <Text style={styles.note}>{t('roles.loadError')}</Text>}
      {error}
      {state.pending ? <Text testID="role-pending-target" style={styles.note}>{t(state.pending.action === 'select' ? 'roles.choose' : 'roles.release')}: {state.items.find(r => r.id === state.pending!.roleId)?.name ?? t('roles.name')}</Text> : null}
    </RolePopup> : null}
  </>;
}
const styles = StyleSheet.create({
  toolbar: { alignItems: 'flex-start', gap: 8 }, grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 }, center: { alignItems: 'center' },
  text: { color: colors.text, fontSize: 14, lineHeight: 21 }, note: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  button: { backgroundColor: '#FFFFFF', padding: 14, borderRadius: radius.small, alignItems: 'center' }, primary: { color: colors.black, fontWeight: '700' },
  disabled: { opacity: 0.5 }, notice: { gap: 8 },
});
