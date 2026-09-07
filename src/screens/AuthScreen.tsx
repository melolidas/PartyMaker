import { Feather } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import {
  getRequestErrorTranslationKey,
  isRetryableRequestError,
} from '../api/errorMessages';
import { useAuth } from '../auth/AuthProvider';
import { useI18n } from '../i18n/LocalizationProvider';
import type { TranslationKey } from '../i18n/translations';
import { colors, radius, shadows } from '../theme';

type AuthMode = 'login' | 'register';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HANDLE_PATTERN = /^[a-z0-9_]{3,30}$/;

export function AuthScreen() {
  const { t } = useI18n();
  const {
    login, register, storageRecoveryRequired, recoveringSessionStorage, recoverSessionStorage,
  } = useAuth();
  const [mode, setMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [handle, setHandle] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [errorKey, setErrorKey] = useState<TranslationKey | null>(null);
  const [retryingNetworkRequest, setRetryingNetworkRequest] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [storageRecovered, setStorageRecovered] = useState(false);
  const busy = submitting || recoveringSessionStorage;
  const displayedError = storageRecoveryRequired ? 'auth.storageNotReady' : errorKey;

  const retryStorageRecovery = async () => {
    if (busy) return;
    setStorageRecovered(false);
    try {
      await recoverSessionStorage();
      clearError();
      setStorageRecovered(true);
    } catch (error: unknown) {
      setErrorKey(getRequestErrorTranslationKey(error));
    }
  };

  const clearError = () => {
    setErrorKey(null);
    setRetryingNetworkRequest(false);
  };

  const switchMode = (nextMode: AuthMode) => {
    if (busy || nextMode === mode) return;
    setMode(nextMode);
    clearError();
  };

  const submit = async () => {
    if (busy || storageRecoveryRequired) return;
    setStorageRecovered(false);
    const normalizedEmail = email.trim().toLowerCase();
    const normalizedHandle = handle.trim().toLowerCase();
    const normalizedDisplayName = displayName.trim();
    const validationError = validateAuthForm({
      mode,
      email: normalizedEmail,
      password,
      handle: normalizedHandle,
      displayName: normalizedDisplayName,
    });
    if (validationError) {
      setErrorKey(validationError);
      setRetryingNetworkRequest(false);
      return;
    }

    setSubmitting(true);
    clearError();
    try {
      if (mode === 'login') {
        await login({ email: normalizedEmail, password });
      } else {
        await register({
          email: normalizedEmail,
          password,
          handle: normalizedHandle,
          displayName: normalizedDisplayName,
        });
      }
    } catch (error: unknown) {
      setErrorKey(getRequestErrorTranslationKey(error));
      setRetryingNetworkRequest(isRetryableRequestError(error));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.brandMark}>
            <Feather name="users" size={29} color={colors.black} />
          </View>
          <Text style={styles.brand}>{t('app.name')}</Text>
          <Text style={styles.subtitle}>{t('auth.subtitle')}</Text>

          <View style={styles.card}>
            <View style={styles.modeSwitch}>
              {(['login', 'register'] as const).map((item) => {
                const active = mode === item;
                return (
                  <Pressable
                    key={item}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: active, disabled: busy }}
                    disabled={busy}
                    onPress={() => switchMode(item)}
                    style={[styles.modeButton, active && styles.modeButtonActive]}
                  >
                    <Text style={[styles.modeText, active && styles.modeTextActive]}>
                      {t(item === 'login' ? 'auth.login' : 'auth.register')}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={styles.title}>
              {t(mode === 'login' ? 'auth.loginTitle' : 'auth.registerTitle')}
            </Text>

            {mode === 'register' ? (
              <>
                <AuthField
                  label={t('auth.displayName')}
                  value={displayName}
                  onChangeText={(value) => {
                    setDisplayName(value);
                    clearError();
                  }}
                  autoCapitalize="words"
                  autoComplete="name"
                  textContentType="name"
                />
                <AuthField
                  label={t('auth.handle')}
                  value={handle}
                  onChangeText={(value) => {
                    setHandle(value);
                    clearError();
                  }}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="username"
                  textContentType="username"
                />
              </>
            ) : null}

            <AuthField
              label={t('auth.email')}
              value={email}
              onChangeText={(value) => {
                setEmail(value);
                clearError();
              }}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              keyboardType="email-address"
              textContentType="emailAddress"
            />
            <AuthField
              label={t('auth.password')}
              value={password}
              onChangeText={(value) => {
                setPassword(value);
                clearError();
              }}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              secureTextEntry
              textContentType={mode === 'login' ? 'password' : 'newPassword'}
              onSubmitEditing={() => void submit()}
            />

            {displayedError ? (
              <View accessibilityLiveRegion="polite" style={styles.errorBox}>
                <Feather name="alert-circle" size={16} color="#FF8B84" />
                <Text style={styles.errorText}>{t(displayedError)}</Text>
              </View>
            ) : null}

            {storageRecoveryRequired ? (
              <Pressable
                testID="auth-storage-recovery"
                accessibilityRole="button"
                accessibilityLabel={t('auth.recoverStorage')}
                accessibilityState={{ disabled: busy, busy: recoveringSessionStorage }}
                disabled={busy}
                onPress={retryStorageRecovery}
                style={[styles.submitButton, busy && styles.disabled]}
              >
                <Text style={styles.submitText}>
                  {t(recoveringSessionStorage ? 'auth.recoveringStorage' : 'auth.recoverStorage')}
                </Text>
              </Pressable>
            ) : null}
            {storageRecovered && !storageRecoveryRequired ? (
              <Text accessibilityLiveRegion="polite" style={styles.loadingText}>
                {t('auth.storageRecovered')}
              </Text>
            ) : null}

            <Pressable
              testID="auth-submit"
              accessibilityRole="button"
              accessibilityState={{ disabled: busy || storageRecoveryRequired }}
              disabled={busy || storageRecoveryRequired}
              onPress={() => void submit()}
              style={({ pressed }) => [
                styles.submitButton,
                pressed && !busy && !storageRecoveryRequired && styles.pressed,
                (busy || storageRecoveryRequired) && styles.disabled,
              ]}
            >
              {submitting ? (
                <ActivityIndicator color={colors.black} />
              ) : (
                <Text style={styles.submitText}>
                  {t(
                    retryingNetworkRequest
                      ? 'auth.retry'
                      : mode === 'login'
                        ? 'auth.loginAction'
                        : 'auth.registerAction',
                  )}
                </Text>
              )}
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export function AuthLoadingScreen() {
  const { t } = useI18n();
  return (
    <SafeAreaView style={styles.loadingScreen}>
      <StatusBar style="light" />
      <View style={styles.loadingMark}>
        <Feather name="users" size={25} color={colors.black} />
      </View>
      <ActivityIndicator color={colors.text} />
      <Text style={styles.loadingText}>{t('auth.restoring')}</Text>
    </SafeAreaView>
  );
}

type AuthFieldProps = React.ComponentProps<typeof TextInput> & {
  label: string;
};

function AuthField({ label, ...inputProps }: AuthFieldProps) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        {...inputProps}
        editable={inputProps.editable ?? true}
        placeholder={label}
        placeholderTextColor={colors.subtle}
        selectionColor={colors.text}
        style={styles.input}
      />
    </View>
  );
}

function validateAuthForm(input: {
  mode: AuthMode;
  email: string;
  password: string;
  handle: string;
  displayName: string;
}): TranslationKey | null {
  if (!EMAIL_PATTERN.test(input.email)) return 'auth.error.invalidEmail';
  if (input.password.length < 8) return 'auth.error.passwordLength';
  if (input.mode === 'register' && !HANDLE_PATTERN.test(input.handle)) {
    return 'auth.error.invalidHandle';
  }
  if (
    input.mode === 'register'
    && (!input.displayName || input.displayName.length > 80)
  ) {
    return 'auth.error.invalidDisplayName';
  }
  return null;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safeArea: { flex: 1, backgroundColor: colors.background },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    alignSelf: 'center',
    width: '100%',
    maxWidth: 480,
    paddingHorizontal: 22,
    paddingVertical: 36,
  },
  brandMark: {
    alignSelf: 'center',
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.text,
    marginBottom: 13,
  },
  brand: {
    color: colors.text,
    textAlign: 'center',
    fontSize: 30,
    fontWeight: '800',
    letterSpacing: -0.7,
  },
  subtitle: {
    color: colors.muted,
    textAlign: 'center',
    fontSize: 14,
    lineHeight: 20,
    marginTop: 7,
    marginBottom: 26,
  },
  card: {
    padding: 18,
    borderRadius: radius.large,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    ...shadows.soft,
  },
  modeSwitch: {
    flexDirection: 'row',
    padding: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.background,
    marginBottom: 22,
  },
  modeButton: {
    flex: 1,
    minHeight: 39,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modeButtonActive: { backgroundColor: colors.surfaceRaised },
  modeText: { color: colors.muted, fontSize: 13, fontWeight: '600' },
  modeTextActive: { color: colors.text },
  title: {
    color: colors.text,
    fontSize: 21,
    lineHeight: 27,
    fontWeight: '700',
    marginBottom: 17,
  },
  field: { gap: 7, marginBottom: 14 },
  label: { color: colors.muted, fontSize: 12, fontWeight: '600' },
  input: {
    minHeight: 49,
    borderRadius: radius.medium,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    color: colors.text,
    fontSize: 15,
    paddingHorizontal: 14,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    borderRadius: radius.medium,
    borderWidth: 1,
    borderColor: '#5D302E',
    backgroundColor: '#241514',
    padding: 11,
    marginBottom: 14,
  },
  errorText: { flex: 1, color: '#FFB2AD', fontSize: 12, lineHeight: 17 },
  submitButton: {
    minHeight: 50,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.text,
    marginTop: 2,
  },
  submitText: { color: colors.black, fontSize: 15, fontWeight: '800' },
  pressed: { opacity: 0.78, transform: [{ scale: 0.99 }] },
  disabled: { opacity: 0.65 },
  loadingScreen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    backgroundColor: colors.background,
  },
  loadingMark: {
    width: 50,
    height: 50,
    borderRadius: 25,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.text,
    marginBottom: 5,
  },
  loadingText: { color: colors.muted, fontSize: 13 },
});
