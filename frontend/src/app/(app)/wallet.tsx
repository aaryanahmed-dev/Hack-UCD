import Ionicons from '@expo/vector-icons/Ionicons';
import * as Linking from 'expo-linking';
import { router, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { PageHeader } from '@/components/controls';
import { Screen } from '@/components/screen';
import { AppText, Banner, Button, Card, Pill } from '@/components/ui';
import { api, toApiError } from '@/lib/api';
import { timeAgo } from '@/lib/dates';
import type { CoinPack, LedgerEntry, Verification, Wallet } from '@/lib/types';
import { useAuth, useMe } from '@/providers/auth';
import { colors, fonts, radius, shadow } from '@/theme';

const euro = (coins: number) => `€${(coins / 100).toFixed(2)}`;

/** Where Stripe / Persona should send the browser back to. */
function returnUrl(): string {
  return Platform.OS === 'web' ? `${window.location.origin}/wallet` : Linking.createURL('wallet');
}

async function openExternal(url: string, returnTo: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    window.location.href = url;
    return null;
  }
  const result = await WebBrowser.openAuthSessionAsync(url, returnTo);
  return result.type === 'success' ? result.url : null;
}

export default function WalletScreen() {
  const me = useMe();
  const { reloadProfile } = useAuth();
  const params = useLocalSearchParams<{ checkout?: string; session_id?: string; verification?: string }>();
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [verification, setVerification] = useState<Verification | null>(null);
  const [history, setHistory] = useState<LedgerEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [w, v, t] = await Promise.all([api.wallet(), api.verification(), api.transactions()]);
      setWallet(w);
      setVerification(v);
      setHistory(t.items);
    } catch (e) {
      setError(toApiError(e).message);
    }
  }, []);

  const confirmPayment = useCallback(
    async (sessionId: string) => {
      setBusy('confirm');
      try {
        const p = await api.confirmCheckout(sessionId);
        setNotice(p.status === 'paid' ? `Payment received — ${p.coins.toLocaleString()} coins added to your wallet.` : 'Payment is processing — your coins will appear shortly.');
      } catch (e) {
        setError(toApiError(e).message);
      } finally {
        setBusy(null);
        load();
      }
    },
    [load],
  );

  const checkVerification = useCallback(async () => {
    setBusy('verify-check');
    try {
      const v = await api.refreshVerification();
      setVerification(v);
      if (v.verified) {
        setNotice('ID verified — real-money features are unlocked.');
        reloadProfile();
      } else if (v.status === 'pending') setNotice('Your verification is being reviewed. Check back in a minute.');
      else if (v.status === 'declined') setError('Verification didn’t pass. You can try again.');
    } catch (e) {
      setError(toApiError(e).message);
    } finally {
      setBusy(null);
    }
  }, [reloadProfile]);

  // Returning from Stripe Checkout or Persona
  useEffect(() => {
    let active = true;
    (async () => {
      await load();
      if (!active) return;
      if (params.checkout === 'success' && params.session_id) confirmPayment(params.session_id);
      else if (params.checkout === 'cancelled') setNotice('Checkout cancelled — no charge was made.');
      if (params.verification === 'done') checkVerification();
    })();
    return () => {
      active = false;
    };
  }, [params.checkout, params.session_id, params.verification, load, confirmPayment, checkVerification]);

  async function buy(pack: CoinPack) {
    setBusy(`buy-${pack.coins}`);
    setError(null);
    try {
      const { checkoutUrl } = await api.checkout(pack.coins, returnUrl());
      const back = await openExternal(checkoutUrl, returnUrl());
      if (back) {
        const sessionId = Linking.parse(back).queryParams?.session_id;
        if (typeof sessionId === 'string') await confirmPayment(sessionId);
        else setNotice('Checkout cancelled — no charge was made.');
      }
    } catch (e) {
      setError(toApiError(e).message);
    } finally {
      setBusy(null);
    }
  }

  async function verify() {
    setBusy('verify');
    setError(null);
    try {
      const back = `${returnUrl()}${returnUrl().includes('?') ? '&' : '?'}verification=done`;
      const { url } = await api.startVerification(back);
      const returned = await openExternal(url, back);
      if (returned) await checkVerification();
    } catch (e) {
      setError(toApiError(e).message);
    } finally {
      setBusy(null);
    }
  }

  const needsVerification = !!verification?.required && !verification.verified;
  const canBuy = me.isAdult && !needsVerification && !!wallet?.paymentsConfigured;

  return (
    <Screen>
      <PageHeader title="Wallet" subtitle="Coins & tokens" />
      {notice ? <Banner tone="info" message={notice} action={{ label: 'OK', onPress: () => setNotice(null) }} /> : null}
      {error ? <Banner message={error} action={{ label: 'Dismiss', onPress: () => setError(null) }} /> : null}
      {busy === 'confirm' ? (
        <View style={styles.confirming}>
          <ActivityIndicator color={colors.primary} />
          <AppText>Confirming your payment with Stripe…</AppText>
        </View>
      ) : null}

      {!wallet ? (
        <ActivityIndicator color={colors.primary} style={styles.loader} />
      ) : (
        <>
          <View style={styles.balance}>
            <View style={styles.flex}>
              <Text style={styles.balanceLabel}>Coins</Text>
              <Text style={styles.balanceValue}>{me.isAdult ? euro(wallet.coins) : '—'}</Text>
              <Text style={styles.balanceSub}>
                {me.isAdult ? `${wallet.coins.toLocaleString()} coins${wallet.lockedCoins ? ` · ${euro(wallet.lockedCoins)} staked` : ''}` : 'Real money unlocks at 18'}
              </Text>
            </View>
            <View style={styles.tokens}>
              <Ionicons name="leaf" size={20} color={colors.accent} />
              <Text style={styles.tokenValue}>{wallet.tokens.toLocaleString()}</Text>
              <Text style={styles.balanceSub}>tokens</Text>
            </View>
          </View>

          <Pressable accessibilityRole="button" onPress={() => router.push('/store')} style={({ pressed }) => [styles.storeLink, pressed && { opacity: 0.8 }]}>
            <Ionicons name="storefront-outline" size={20} color={colors.primary} />
            <View style={styles.flex}>
              <AppText variant="label">Token store</AppText>
              <AppText variant="caption">Spend tokens on avatars, frames and streak freezes</AppText>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.lineStrong} />
          </Pressable>

          {me.isAdult ? (
            <>
              {/* ID verification */}
              {verification?.required ? (
                <Card style={styles.verify}>
                  <View style={styles.verifyTop}>
                    <View style={[styles.verifyIcon, verification.verified && { backgroundColor: colors.primarySoft }]}>
                      <Ionicons name={verification.verified ? 'shield-checkmark' : 'id-card-outline'} size={20} color={verification.verified ? colors.primary : colors.accentInk} />
                    </View>
                    <View style={styles.flex}>
                      <AppText variant="heading">{verification.verified ? 'ID verified' : 'Verify your ID'}</AppText>
                      <AppText variant="caption">
                        {verification.verified
                          ? 'You can buy coins and join money sessions.'
                          : 'Real-money stakes need a quick ID check with Persona (government ID + selfie). It takes about a minute.'}
                      </AppText>
                    </View>
                  </View>
                  {!verification.verified ? (
                    <View style={styles.row}>
                      <Button title="Verify with Persona" icon="shield-checkmark-outline" loading={busy === 'verify'} onPress={verify} style={styles.flex} />
                      {verification.status === 'pending' ? (
                        <Button title="Check status" size="sm" variant="secondary" loading={busy === 'verify-check'} onPress={checkVerification} />
                      ) : null}
                    </View>
                  ) : null}
                </Card>
              ) : null}

              {/* Buy coins */}
              <View style={styles.sectionHead}>
                <AppText variant="title">Buy coins</AppText>
                <Pill tone="neutral" icon="lock-closed" label="Stripe" />
              </View>
              <AppText variant="caption" style={styles.pricing}>
                1 coin = €0.01. Coins are what you stake in real-money sessions — win them from others who don’t pass, or lose yours
                if you don’t.
              </AppText>
              <View style={styles.packs}>
                {wallet.packs.map((p, i) => (
                  <Pressable
                    key={p.coins}
                    accessibilityRole="button"
                    accessibilityLabel={`Buy ${p.coins} coins for ${p.label}`}
                    disabled={!canBuy || busy !== null}
                    onPress={() => buy(p)}
                    style={({ pressed }) => [styles.pack, i === 1 && styles.packPopular, pressed && { opacity: 0.85 }, !canBuy && { opacity: 0.5 }]}
                  >
                    {i === 1 ? <Text style={styles.popular}>POPULAR</Text> : null}
                    <Text style={styles.packCoins}>{p.coins.toLocaleString()}</Text>
                    <Text style={styles.packUnit}>coins</Text>
                    {busy === `buy-${p.coins}` ? <ActivityIndicator color={colors.primary} /> : <Text style={styles.packPrice}>{p.label}</Text>}
                  </Pressable>
                ))}
              </View>
              {!wallet.paymentsConfigured ? (
                <Banner tone="info" message="Payments aren't set up on this server yet (Stripe keys missing)." />
              ) : needsVerification ? (
                <AppText variant="caption" style={styles.center}>
                  Verify your ID above to buy coins.
                </AppText>
              ) : (
                <AppText variant="caption" style={styles.center}>
                  Secure checkout by Stripe (sandbox). Test card: 4242 4242 4242 4242, any future date and CVC.
                </AppText>
              )}
            </>
          ) : (
            <Card style={styles.minor}>
              <Ionicons name="leaf-outline" size={22} color={colors.primary} />
              <AppText style={styles.flex}>You’re in token mode. Earn tokens by passing quizzes and spend them in the store.</AppText>
            </Card>
          )}

          {/* History */}
          <AppText variant="title" style={styles.historyTitle}>
            History
          </AppText>
          {history.length === 0 ? (
            <AppText variant="caption">No transactions yet.</AppText>
          ) : (
            <Card style={styles.list}>
              {history.map((t, i) => (
                <View key={t.id} style={[styles.txRow, i > 0 && styles.divider]}>
                  <View style={[styles.txIcon, { backgroundColor: t.amount >= 0 ? colors.primarySoft : colors.surfaceAlt }]}>
                    <Ionicons
                      name={t.type === 'purchase' ? 'card' : t.type === 'shop_purchase' ? 'storefront' : t.amount >= 0 ? 'arrow-down' : 'arrow-up'}
                      size={14}
                      color={t.amount >= 0 ? colors.primary : colors.muted}
                    />
                  </View>
                  <View style={styles.flex}>
                    <AppText variant="label" numberOfLines={1}>
                      {t.description}
                    </AppText>
                    <AppText variant="caption">{timeAgo(t.createdAt)}</AppText>
                  </View>
                  <Text style={[styles.txAmount, { color: t.amount >= 0 ? colors.primary : colors.inkSoft }]}>
                    {t.amount >= 0 ? '+' : '−'}
                    {t.currency === 'coins' ? euro(Math.abs(t.amount)) : `${Math.abs(t.amount)} tokens`}
                  </Text>
                </View>
              ))}
            </Card>
          )}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { textAlign: 'center', marginTop: 8 },
  row: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  loader: { marginTop: 40 },
  confirming: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  balance: { flexDirection: 'row', backgroundColor: colors.primary, borderRadius: radius.xl, padding: 22, gap: 16, ...shadow.raised },
  balanceLabel: { fontFamily: fonts.medium, fontSize: 13, color: colors.onPrimaryMuted },
  balanceValue: { fontFamily: fonts.displayBold, fontSize: 42, lineHeight: 50, color: colors.onPrimary },
  balanceSub: { fontFamily: fonts.body, fontSize: 13, color: colors.onPrimaryMuted },
  tokens: { alignItems: 'center', justifyContent: 'center', paddingLeft: 16, borderLeftWidth: 1, borderLeftColor: 'rgba(246, 242, 233, 0.15)' },
  tokenValue: { fontFamily: fonts.displayBold, fontSize: 24, color: colors.onPrimary },
  storeLink: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 12, padding: 16, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  verify: { gap: 12, marginTop: 14 },
  verifyTop: { flexDirection: 'row', gap: 12 },
  verifyIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 24 },
  pricing: { marginTop: 6, marginBottom: 12 },
  packs: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  pack: { width: '47%', flexGrow: 1, alignItems: 'center', paddingVertical: 18, borderRadius: radius.lg, borderWidth: 1.5, borderColor: colors.line, backgroundColor: colors.surface, gap: 2 },
  packPopular: { borderColor: colors.primary, borderWidth: 2 },
  popular: { position: 'absolute', top: -9, backgroundColor: colors.primary, color: colors.onPrimary, fontFamily: fonts.bold, fontSize: 10, letterSpacing: 0.8, paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill, overflow: 'hidden' },
  packCoins: { fontFamily: fonts.displayBold, fontSize: 28, color: colors.ink },
  packUnit: { fontFamily: fonts.medium, fontSize: 12, color: colors.muted },
  packPrice: { fontFamily: fonts.bold, fontSize: 16, color: colors.primary, marginTop: 6 },
  minor: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 14 },
  historyTitle: { marginTop: 28, marginBottom: 10 },
  list: { padding: 0, overflow: 'hidden' },
  divider: { borderTopWidth: 1, borderTopColor: colors.line },
  txRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  txIcon: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  txAmount: { fontFamily: fonts.semibold, fontSize: 14 },
});
