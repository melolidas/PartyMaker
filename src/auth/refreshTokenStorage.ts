import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { createFailClosedRefreshTokenStorage } from './refreshTokenPersistence';

const REFRESH_TOKEN_KEY = 'partymaker.refresh-token';
const SESSION_INVALIDATED_KEY = 'partymaker.session-invalidated';
const STORAGE_KEYS = {
  token: REFRESH_TOKEN_KEY,
  invalidated: SESSION_INVALIDATED_KEY,
};
const webValues = new Map<string, string>();

const nativeStorage = createFailClosedRefreshTokenStorage({
  getItem(key) {
    return SecureStore.getItemAsync(key);
  },
  setItem(key, value) {
    return SecureStore.setItemAsync(key, value);
  },
  deleteItem(key) {
    return SecureStore.deleteItemAsync(key);
  },
}, STORAGE_KEYS);

const webStorage = createFailClosedRefreshTokenStorage({
  async getItem(key) {
    return webValues.get(key) ?? null;
  },
  async setItem(key, value) {
    webValues.set(key, value);
  },
  async deleteItem(key) {
    webValues.delete(key);
  },
}, STORAGE_KEYS);

export const refreshTokenStorage = Platform.OS === 'web'
  ? webStorage
  : nativeStorage;
