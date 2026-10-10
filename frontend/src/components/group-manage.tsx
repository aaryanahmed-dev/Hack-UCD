import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { Sheet } from '@/components/sheet';
import { AppText, Avatar, Banner, Button, Card, TextField } from '@/components/ui';
import { api, toApiError } from '@/lib/api';
import type { Friend, GroupDetail } from '@/lib/types';
import { colors } from '@/theme';

/** Rename a group / edit its description (owner and admins). */
export function EditGroupSheet({ group, onClose, onSaved }: { group: GroupDetail; onClose: () => void; onSaved: (g: GroupDetail) => void }) {
  const [name, setName] = useState(group.name);
  const [description, setDescription] = useState(group.description ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!name.trim()) {
      setError('The group needs a name.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      onSaved(await api.updateGroup(group.id, { name: name.trim(), description: description.trim() || null }));
    } catch (e) {
      setError(toApiError(e).message);
      setSaving(false);
    }
  }

  return (
    <Sheet visible onClose={onClose} title="Edit group">
      {error ? <Banner message={error} /> : null}
      <TextField label="Group name" value={name} onChangeText={setName} maxLength={60} autoFocus returnKeyType="next" />
      <TextField
        label="Description (optional)"
        value={description}
        onChangeText={setDescription}
        placeholder="What are you studying together?"
        maxLength={500}
        returnKeyType="done"
        onSubmitEditing={save}
      />
      <Button title="Save changes" icon="checkmark" onPress={save} loading={saving} />
    </Sheet>
  );
}

/** Pick friends who aren't in the group yet and send them an invite notification. */
export function InviteFriendsSheet({ group, onClose }: { group: GroupDetail; onClose: () => void }) {
  const [friends, setFriends] = useState<Friend[] | null>(null);
  const [sent, setSent] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const memberIds = new Set(group.members.map((m) => m.user.id));

  useEffect(() => {
    api.listFriends().then((r) => setFriends(r.items), () => setFriends([]));
  }, []);

  const candidates = (friends ?? []).filter((f) => !memberIds.has(f.user.id));

  async function invite(f: Friend) {
    setBusy(f.user.id);
    setError(null);
    try {
      await api.inviteToGroup(group.id, f.user.id);
      setSent((s) => [...s, f.user.id]);
    } catch (e) {
      setError(toApiError(e).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Sheet visible onClose={onClose} title={`Invite to ${group.name}`}>
      <AppText>Friends get a notification with a one-tap join button.</AppText>
      {error ? <Banner message={error} /> : null}
      {!friends ? (
        <ActivityIndicator color={colors.primary} />
      ) : candidates.length === 0 ? (
        <AppText variant="caption">
          {friends.length === 0 ? 'Add friends on the Friends tab first — or share the invite code.' : 'All your friends are already in this group.'}
        </AppText>
      ) : (
        <Card style={styles.list}>
          {candidates.map((f, i) => {
            const done = sent.includes(f.user.id);
            return (
              <View key={f.user.id} style={[styles.row, i > 0 && styles.divider]}>
                <Avatar name={f.user.displayName} seed={f.user.id} equipped={f.user.equipped} size={36} />
                <View style={styles.flex}>
                  <AppText variant="label">{f.user.displayName}</AppText>
                  <AppText variant="caption">@{f.user.username}</AppText>
                </View>
                {done ? (
                  <View style={styles.sent}>
                    <Ionicons name="checkmark-circle" size={18} color={colors.primary} />
                    <AppText variant="caption" style={{ color: colors.primary }}>
                      Invited
                    </AppText>
                  </View>
                ) : (
                  <Button title="Invite" size="sm" icon="paper-plane-outline" loading={busy === f.user.id} onPress={() => invite(f)} />
                )}
              </View>
            );
          })}
        </Card>
      )}
      <Button title="Done" variant="secondary" onPress={onClose} />
    </Sheet>
  );
}

export function EditGroupButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="Edit group" onPress={onPress} hitSlop={8} style={styles.editBtn}>
      <Ionicons name="create-outline" size={20} color={colors.ink} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  list: { padding: 0, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  divider: { borderTopWidth: 1, borderTopColor: colors.line },
  sent: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  editBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceAlt },
});
