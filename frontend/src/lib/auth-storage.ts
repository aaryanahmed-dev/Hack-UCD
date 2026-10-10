// Web: Supabase keeps the session in the browser's localStorage.
// Native uses auth-storage.native.ts instead.
export const authStorage = typeof window !== 'undefined' ? window.localStorage : undefined;
