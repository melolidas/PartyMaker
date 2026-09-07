import { Feather } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { getRequestErrorTranslationKey } from '../../api/errorMessages';
import type { UserProfile } from '../../api/types';
import { useAuthenticatedAuth } from '../../auth/AuthProvider';
import { useI18n } from '../../i18n/LocalizationProvider';
import type { TranslationKey } from '../../i18n/translations';
import { colors, radius, shadows } from '../../theme';

type Props = {
  visible: boolean;
  profile: UserProfile;
  onClose: () => void;
};

export function ProfileEditModal({ visible, profile, onClose }: Props) {
  const { t } = useI18n();
  const { updateProfile } = useAuthenticatedAuth();
  const [displayName, setDisplayName] = useState(profile.displayName);
  const [bio, setBio] = useState(profile.bio ?? '');
  const [city, setCity] = useState(profile.city ?? '');
  const [countryCode, setCountryCode] = useState(profile.countryCode ?? '');
  const [saving, setSaving] = useState(false);
  const [errorKey, setErrorKey] = useState<TranslationKey | null>(null);

  useEffect(() => {
    if (!visible) return;
    setDisplayName(profile.displayName);
    setBio(profile.bio ?? '');
    setCity(profile.city ?? '');
    setCountryCode(profile.countryCode ?? '');
    setErrorKey(null);
  // Do not reset an unsaved text draft when an independent avatar/level response arrives.
  }, [profile.id, visible]);

  const close = () => {
    if (!saving) onClose();
  };

  const save = async () => {
    if (saving) return;
    const normalizedDisplayName = displayName.trim();
    const normalizedBio = bio.trim();
    const normalizedCity = city.trim();
    const normalizedCountryCode = countryCode.trim().toUpperCase();
    const validationError = validateProfileForm({
      displayName: normalizedDisplayName,
      bio: normalizedBio,
      city: normalizedCity,
      countryCode: normalizedCountryCode,
    });
    if (validationError) {
      setErrorKey(validationError);
      return;
    }

    setSaving(true);
    setErrorKey(null);
    try {
      await updateProfile({
        displayName: normalizedDisplayName,
        bio: normalizedBio || null,
        city: normalizedCity || null,
        countryCode: normalizedCountryCode || null,
      });
      onClose();
    } catch (error: unknown) {
      setErrorKey(getRequestErrorTranslationKey(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      animationType="fade"
      onRequestClose={close}
      statusBarTranslucent
      transparent
      visible={visible}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.overlay}
      >
        <Pressable
          accessibilityLabel={t('common.cancel')}
          accessibilityRole="button"
          onPress={close}
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.sheet}>
          <View style={styles.header}>
            <View>
              <Text style={styles.title}>{t('profile.editTitle')}</Text>
              <Text style={styles.subtitle}>@{profile.handle}</Text>
            </View>
            <Pressable
              accessibilityLabel={t('common.close')}
              accessibilityRole="button"
              disabled={saving}
              onPress={close}
              style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}
            >
              <Feather name="x" size={20} color={colors.text} />
            </Pressable>
          </View>

          <ScrollView
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <ProfileField
              label={t('auth.displayName')}
              value={displayName}
              onChangeText={(value) => {
                setDisplayName(value);
                setErrorKey(null);
              }}
              autoCapitalize="words"
              maxLength={80}
            />
            <ProfileField
              label={t('profile.bio')}
              value={bio}
              onChangeText={(value) => {
                setBio(value);
                setErrorKey(null);
              }}
              maxLength={300}
              multiline
              style={[styles.input, styles.bioInput]}
              textAlignVertical="top"
            />
            <View style={styles.row}>
              <View style={styles.cityField}>
                <ProfileField
                  label={t('profile.city')}
                  value={city}
                  onChangeText={(value) => {
                    setCity(value);
                    setErrorKey(null);
                  }}
                  maxLength={100}
                />
              </View>
              <View style={styles.countryField}>
                <ProfileField
                  label={t('profile.countryCode')}
                  value={countryCode}
                  onChangeText={(value) => {
                    setCountryCode(value.toUpperCase());
                    setErrorKey(null);
                  }}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  maxLength={2}
                />
              </View>
            </View>

            {errorKey ? (
              <Text accessibilityLiveRegion="polite" style={styles.errorText}>
                {t(errorKey)}
              </Text>
            ) : null}

            <View style={styles.actions}>
              <Pressable
                accessibilityRole="button"
                disabled={saving}
                onPress={close}
                style={({ pressed }) => [
                  styles.cancelButton,
                  pressed && styles.pressed,
                  saving && styles.disabled,
                ]}
              >
                <Text style={styles.cancelText}>{t('common.cancel')}</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={saving}
                onPress={() => void save()}
                style={({ pressed }) => [
                  styles.saveButton,
                  pressed && styles.pressed,
                  saving && styles.disabled,
                ]}
              >
                {saving ? (
                  <ActivityIndicator color={colors.black} />
                ) : (
                  <Text style={styles.saveText}>{t('common.save')}</Text>
                )}
              </Pressable>
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

type ProfileFieldProps = React.ComponentProps<typeof TextInput> & {
  label: string;
};

function ProfileField({ label, style, ...inputProps }: ProfileFieldProps) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        {...inputProps}
        placeholder={label}
        placeholderTextColor={colors.subtle}
        selectionColor={colors.text}
        style={[styles.input, style]}
      />
    </View>
  );
}

function validateProfileForm(input: {
  displayName: string;
  bio: string;
  city: string;
  countryCode: string;
}): TranslationKey | null {
  if (!input.displayName || input.displayName.length > 80) {
    return 'profile.error.displayName';
  }
  if (input.bio.length > 300) return 'profile.error.bio';
  if (input.city.length > 100) return 'profile.error.city';
  if (input.countryCode && !/^[A-Z]{2}$/.test(input.countryCode)) {
    return 'profile.error.countryCode';
  }
  return null;
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0, 0, 0, 0.68)',
  },
  sheet: {
    maxHeight: '88%',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: 20,
    paddingTop: 19,
    paddingBottom: Platform.OS === 'ios' ? 30 : 20,
    ...shadows.soft,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  title: { color: colors.text, fontSize: 21, fontWeight: '800' },
  subtitle: { color: colors.muted, fontSize: 12, marginTop: 4 },
  closeButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceRaised,
  },
  field: { gap: 7, marginBottom: 15 },
  label: { color: colors.muted, fontSize: 12, fontWeight: '600' },
  input: {
    minHeight: 48,
    borderRadius: radius.medium,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    color: colors.text,
    fontSize: 14,
    paddingHorizontal: 13,
  },
  bioInput: { minHeight: 92, paddingTop: 13, paddingBottom: 13 },
  row: { flexDirection: 'row', gap: 10 },
  cityField: { flex: 1 },
  countryField: { width: 94 },
  errorText: {
    color: '#FFB2AD',
    fontSize: 12,
    lineHeight: 17,
    marginBottom: 13,
  },
  actions: { flexDirection: 'row', gap: 10, marginTop: 3 },
  cancelButton: {
    flex: 1,
    height: 48,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelText: { color: colors.text, fontSize: 14, fontWeight: '700' },
  saveButton: {
    flex: 1.25,
    height: 48,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.text,
  },
  saveText: { color: colors.black, fontSize: 14, fontWeight: '800' },
  pressed: { opacity: 0.72 },
  disabled: { opacity: 0.58 },
});
