import { useCallback, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { MAX_LOBBY_ROLES, normalizeLobbyRole, type LobbyRoleInput } from '../../api/lobbyRoleTypes';
import { useI18n } from '../../i18n/LocalizationProvider';
import { colors, radius } from '../../theme';
import { RoleTile } from './RoleTile';
import { RolePopup } from './RolePopup';

export function DraftLobbyRoles({ roles, editable, onAdd, onRemove }: {
  roles: Required<LobbyRoleInput>[]; editable: boolean;
  onAdd: (name: string, description: string) => boolean; onRemove: (index: number) => void;
}) {
  const { t } = useI18n();
  const [popup, setPopup] = useState<'add' | number | null>(null);
  const [name, setName] = useState(''), [description, setDescription] = useState('');
  const handled = useRef(false);
  const close = useCallback(() => { handled.current = true; setPopup(null); }, []);
  const selected = typeof popup === 'number' ? roles[popup] : null;
  const valid = !!normalizeLobbyRole(name, description);
  return <>
    <View testID="draft-role-grid" style={styles.grid}>
      <RoleTile testID="draft-role-add" label={t('roles.addRole')} add disabled={!editable || roles.length >= MAX_LOBBY_ROLES}
        onPress={() => { handled.current = false; setName(''); setDescription(''); setPopup('add'); }} />
      {roles.map((role, i) => <RoleTile key={i} testID={`draft-role-${i}`} label={role.name} disabled={!editable} onPress={() => { handled.current = false; setPopup(i); }} />)}
    </View>
    {roles.length >= MAX_LOBBY_ROLES ? <Text style={styles.note}>{t('roles.limit')}</Text> : null}
    {popup !== null && editable ? <RolePopup standalone label={selected?.name ?? t('roles.addRole')} onBack={close}>
      <View style={styles.center}><RoleTile label="" /></View>
      <Text style={styles.note}>{t('roles.name')}</Text>
      <TextInput testID="role-name" accessibilityLabel={t('roles.name')} editable={popup === 'add'} value={selected?.name ?? name}
        onChangeText={setName} style={styles.input} />
      <Text testID="role-name-count" style={styles.counter}>{Array.from((selected?.name ?? name).trim()).length}/10</Text>
      <Text style={styles.note}>{t('roles.description')}</Text>
      <TextInput testID="role-description" accessibilityLabel={t('roles.description')} editable={popup === 'add'} multiline value={selected?.description ?? description}
        onChangeText={setDescription} style={styles.input} />
      <Text testID="role-description-count" style={styles.counter}>{Array.from((selected?.description ?? description).trim()).length}/50</Text>
      {popup === 'add' && !valid && (name || description) ? <Text testID="role-invalid" style={styles.note}>{t('roles.invalid')}</Text> : null}
      <Pressable testID="draft-role-confirm" accessibilityRole="button" disabled={popup === 'add' && !valid}
        onPress={() => { if (handled.current) return; if (popup === 'add') { if (onAdd(name, description)) close(); } else { onRemove(popup); close(); } }}
        style={[styles.button, popup === 'add' && !valid && styles.disabled]}>
        <Text style={styles.buttonText}>{t(popup === 'add' ? 'roles.add' : 'roles.remove')}</Text>
      </Pressable>
    </RolePopup> : null}
  </>;
}
const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 12 }, center: { alignItems: 'center' },
  note: { color: colors.muted, fontSize: 12, lineHeight: 18 }, counter: { color: colors.muted, fontSize: 11, textAlign: 'right', marginTop: -12 },
  input: { color: colors.text, borderColor: colors.border, borderWidth: 1, borderRadius: radius.small, padding: 10, minHeight: 42, fontSize: 15 },
  button: { backgroundColor: '#FFFFFF', padding: 14, borderRadius: radius.small, alignItems: 'center' },
  buttonText: { color: colors.black, fontWeight: '700', fontSize: 14 }, disabled: { opacity: 0.5 },
});
