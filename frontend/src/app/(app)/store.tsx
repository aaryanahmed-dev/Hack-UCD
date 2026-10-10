import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { PageHeader } from '@/components/controls';
import { Screen } from '@/components/screen';
import { Sheet } from '@/components/sheet';
import { AppText, Avatar, Banner, Button, Pill } from '@/components/ui';
import { api, toApiError } from '@/lib/api';
import type { ShopItem } from '@/lib/types';
import { useAuth, useMe } from '@/providers/auth';
import { colors, fonts, radius, shadow } from '@/theme';

export default function StoreScreen() {
  const me = useMe();
  const [items, setItems] = useState<ShopItem[] | null>(null);
  const [tokens, setTokens] = useState<number | null>(null);
  const [selected, setSelected] = useState<ShopItem | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [s, w] = await Promise.all([api.shopItems(), api.wallet()]);
      setItems(s.items);
      setTokens(w.tokens);
    } catch (e) {
      setError(toApiError(e).message);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const avatars = items?.filter((i) => i.kind === 'avatar') ?? [];
  const frames = items?.filter((i) => i.kind === 'frame') ?? [];
  const powerUps = items?.filter((i) => i.kind === 'streak_freeze') ?? [];

  return (
    <Screen>
      <PageHeader title="Token store" right={tokens !== null ? <Pill tone="accent" icon="leaf" label={`${tokens.toLocaleString()} tokens`} /> : undefined} />
      {error ? <Banner message={error} /> : null}

      <View style={styles.preview}>
        <Avatar name={me.displayName} seed={me.id} equipped={me.equipped} size={96} />
        <View style={styles.flex}>
          <AppText variant="title">{me.displayName}</AppText>
          <AppText variant="caption">Earn tokens by passing quizzes and finishing sessions. Spend them on your look and on keeping your streak.</AppText>
        </View>
      </View>

      {!items ? (
        <ActivityIndicator color={colors.primary} style={styles.loader} />
      ) : (
        <>
          <Section title="Power-ups">
            {powerUps.map((item) => (
              <Pressable key={item.id} accessibilityRole="button" onPress={() => setSelected(item)} style={({ pressed }) => [styles.powerUp, pressed && { opacity: 0.85 }]}>
                <View style={styles.freezeIcon}>
                  <Ionicons name="snow" size={26} color="#3B82C4" />
                </View>
                <View style={styles.flex}>
                  <AppText variant="heading">{item.name}</AppText>
                  <AppText variant="caption">{item.description}</AppText>
                  <Text style={styles.ownedText}>You have {item.owned}</Text>
                </View>
                <Price item={item} />
              </Pressable>
            ))}
          </Section>

          <Section title="Avatars">
            <View style={styles.grid}>
              {avatars.map((item) => (
                <ItemCard key={item.id} item={item} onPress={() => setSelected(item)}>
                  <Avatar name={me.displayName} seed={me.id} equipped={{ avatar: item.id, frame: me.equipped.frame }} size={60} />
                </ItemCard>
              ))}
            </View>
          </Section>

          <Section title="Frames">
            <View style={styles.grid}>
              {frames.map((item) => (
                <ItemCard key={item.id} item={item} onPress={() => setSelected(item)}>
                  <Avatar name={me.displayName} seed={me.id} equipped={{ avatar: me.equipped.avatar, frame: item.id }} size={60} />
                </ItemCard>
              ))}
            </View>
          </Section>
        </>
      )}

      {selected ? (
        <ItemSheet
          item={selected}
          tokens={tokens ?? 0}
          onClose={() => setSelected(null)}
          onChanged={() => {
            setSelected(null);
            load();
          }}
        />
      ) : null}
    </Screen>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function Price({ item }: { item: ShopItem }) {
  if (item.equipped) return <Pill tone="primary" icon="checkmark" label="Equipped" />;
  if (item.owned && item.kind !== 'streak_freeze') return <Pill tone="neutral" label="Owned" />;
  return (
    <View style={styles.price}>
      <Ionicons name="leaf" size={12} color={colors.accentInk} />
      <Text style={styles.priceText}>{item.priceTokens}</Text>
    </View>
  );
}

function ItemCard({ item, onPress, children }: { item: ShopItem; onPress: () => void; children: React.ReactNode }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${item.name}, ${item.equipped ? 'equipped' : item.owned ? 'owned' : `${item.priceTokens} tokens`}`}
      onPress={onPress}
      style={({ pressed }) => [styles.card, item.equipped && styles.cardEquipped, pressed && { opacity: 0.85 }]}
    >
      {children}
      <Text style={styles.cardName} numberOfLines={1}>
        {item.name}
      </Text>
      <Price item={item} />
    </Pressable>
  );
}

function ItemSheet({ item, tokens, onClose, onChanged }: { item: ShopItem; tokens: number; onClose: () => void; onChanged: () => void }) {
  const me = useMe();
  const { setMe } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const slot = item.kind === 'avatar' ? 'avatar' : item.kind === 'frame' ? 'frame' : null;
  const canBuy = item.kind === 'streak_freeze' || !item.owned;
  const short = tokens < item.priceTokens;

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onChanged();
    } catch (e) {
      setError(toApiError(e).message);
      setBusy(false);
    }
  }

  const preview =
    slot === 'avatar'
      ? { avatar: item.id, frame: me.equipped.frame }
      : slot === 'frame'
        ? { avatar: me.equipped.avatar, frame: item.id }
        : null;

  return (
    <Sheet visible onClose={onClose} title={item.name}>
      <View style={styles.sheetPreview}>
        {preview ? (
          <Avatar name={me.displayName} seed={me.id} equipped={preview} size={110} />
        ) : (
          <View style={[styles.freezeIcon, styles.freezeBig]}>
            <Ionicons name="snow" size={48} color="#3B82C4" />
          </View>
        )}
      </View>
      <AppText style={styles.centerText}>{item.description}</AppText>
      {item.kind === 'streak_freeze' ? (
        <AppText variant="caption" style={styles.centerText}>
          You have {item.owned} (max 5). If you miss a day, one is used automatically so your streak survives.
        </AppText>
      ) : null}
      {error ? <Banner message={error} /> : null}
      {canBuy ? (
        <Button
          title={short ? `You need ${item.priceTokens - tokens} more tokens` : `Buy for ${item.priceTokens} tokens`}
          icon="leaf"
          disabled={short}
          loading={busy}
          onPress={() =>
            run(async () => {
              await api.buyItem(item.id);
              if (slot) setMe(await api.equip({ [slot]: item.id })); // wear it straight away
            })
          }
        />
      ) : slot && item.equipped ? (
        <Button title="Take off" variant="secondary" loading={busy} onPress={() => run(async () => setMe(await api.equip({ [slot]: null })))} />
      ) : slot ? (
        <Button title="Equip" icon="checkmark" loading={busy} onPress={() => run(async () => setMe(await api.equip({ [slot]: item.id })))} />
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  loader: { marginTop: 30 },
  centerText: { textAlign: 'center' },
  preview: { flexDirection: 'row', alignItems: 'center', gap: 18, padding: 18, borderRadius: radius.xl, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, ...shadow.card },
  section: { marginTop: 22 },
  sectionTitle: { fontFamily: fonts.semibold, fontSize: 13, letterSpacing: 0.6, textTransform: 'uppercase', color: colors.inkSoft, marginBottom: 10 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  card: { width: '30%', flexGrow: 1, alignItems: 'center', gap: 6, paddingVertical: 14, paddingHorizontal: 8, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.line },
  cardEquipped: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  cardName: { fontFamily: fonts.semibold, fontSize: 13, color: colors.ink },
  price: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingVertical: 3, paddingHorizontal: 8, borderRadius: radius.pill, backgroundColor: colors.accentSoft },
  priceText: { fontFamily: fonts.bold, fontSize: 12, color: colors.accentInk },
  powerUp: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.line },
  freezeIcon: { width: 52, height: 52, borderRadius: 26, backgroundColor: '#E3EEF9', alignItems: 'center', justifyContent: 'center' },
  freezeBig: { width: 100, height: 100, borderRadius: 50 },
  ownedText: { fontFamily: fonts.semibold, fontSize: 12, color: '#3B82C4', marginTop: 4 },
  sheetPreview: { alignItems: 'center', paddingVertical: 8 },
});
