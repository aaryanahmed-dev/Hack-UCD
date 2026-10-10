// iOS/Android: a localStorage implementation backed by SQLite, so the session survives app restarts.
import 'expo-sqlite/localStorage/install';

export const authStorage = globalThis.localStorage;
