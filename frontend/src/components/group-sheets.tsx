import Ionicons from '@expo/vector-icons/Ionicons';
import * as Clipboard from 'expo-clipboard';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Share, StyleSheet, Text, View } from 'react-native';

import { Sheet } from '@/components/sheet';
import { AppText, Banner, Button, TextField } from '@/components/ui';
import { api, toApiError } from '@/lib/api';
import type { GroupDetail } from '@/lib/types';
import { colors, fonts, radius } from '@/theme';

// ───────── Create ─────────

type CreateProps = { visible: boolean; onClose: () => void; onCreated: () => void };

// Each sheet mounts its content only while open, so every open starts with fresh state.
export function CreateGroupSheet(props: CreateProps) {
  return props.visible ? <CreateGroupDialog {...props} /> : null;
}

function CreateGroupDialog({ onClose, onCreated }: CreateProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState<GroupDetail | null>(null);

  async function submit() {
    setError(null);
    if (!name.trim()) {
      setNameError('Give your group a name.');
      return;
    }
    setSaving(true);
    try {
      const group = await api.createGroup({ name: name.trim(), description: description.trim() || null });
      setCreated(group);
      onCreated();
    } catch (e) {
      const err = toApiError(e);
      if (err.fieldError('name')) setNameError(err.fieldError('name')!);
      else setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet visible onClose={onClose} title={created ? 'Group created' : 'New study group'}>
      {created ? (
        <>
          <AppText>
            <Text style={styles.strong}>{created.name}</Text> is ready. Share this code so friends can join.
          </AppText>
          <InviteCode group={created} />
          <Button title="Done" onPress={onClose} />
        </>
      ) : (
        <>
          {error ? <Banner message={error} /> : null}
          <TextField
            label="Group name"
            value={name}
            onChangeText={(t) => {
              setName(t);
              if (nameError) setNameError(null);
            }}
            error={nameError}
            placeholder="Organic Chemistry Squad"
            maxLength={60}
            autoFocus
            returnKeyType="next"
          />
          <TextField
            label="Description (optional)"
            value={description}
            onChangeText={setDescription}
            placeholder="Weekly grind before the May exams"
            maxLength={500}
            returnKeyType="done"
            onSubmitEditing={submit}
          />
          <Button title="Create group" icon="add" onPress={submit} loading={saving} />
        </>
      )}
    </Sheet>
  );
}

// ───────── Join ─────────

type JoinProps = { visible: boolean; onClose: () => void; onJoined: () => void };

export function JoinGroupSheet(props: JoinProps) {
  return props.visible ? <JoinGroupDialog {...props} /> : null;
}

function JoinGroupDialog({ onClose, onJoined }: JoinProps) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const [joined, setJoined] = useState<GroupDetail | null>(null);

  async function submit() {
    setError(null);
    if (code.length !== 6) {
      setError('Invite codes are 6 characters.');
      return;
    }
    setJoining(true);
    try {
      const group = await api.joinGroup(code);
      setJoined(group);
      onJoined();
    } catch (e) {
      const err = toApiError(e);
      setError(
        err.code === 'not_found'
          ? 'No group has that code. Check it and try again.'
          : err.code === 'already_member'
            ? 'You’re already in this group.'
            : err.message,
      );
    } finally {
      setJoining(false);
    }
  }

  return (
    <Sheet visible onClose={onClose} title={joined ? 'You’re in!' : 'Join a group'}>
      {joined ? (
        <>
          <View style={styles.joinedRow}>
            <Ionicons name="checkmark-circle" size={28} color={colors.primary} />
            <AppText style={styles.flex}>
              You joined <Text style={styles.strong}>{joined.name}</Text> with {joined.memberCount - 1}{' '}
              {joined.memberCount - 1 === 1 ? 'other member' : 'other members'}.
            </AppText>
          </View>
          <Button title="Done" onPress={onClose} />
        </>
      ) : (
        <>
          <AppText>Ask a friend in the group for its 6-character invite code.</AppText>
          {error ? <Banner message={error} /> : null}
          <TextField
            label="Invite code"
            value={code}
            onChangeText={(t) => {
              setCode(t.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6));
              if (error) setError(null);
            }}
            placeholder="ABC123"
            autoCapitalize="characters"
            autoCorrect={false}
            autoFocus
            maxLength={6}
            returnKeyType="go"
            onSubmitEditing={submit}
          />
          <Button title="Join group" icon="enter-outline" onPress={submit} loading={joining} />
        </>
      )}
    </Sheet>
  );
}

// ───────── Invite ─────────

export function InviteSheet({ groupId, onClose }: { groupId: string | null; onClose: () => void }) {
  return groupId ? <InviteDialog key={groupId} groupId={groupId} onClose={onClose} /> : null;
}

function InviteDialog({ groupId, onClose }: { groupId: string; onClose: () => void }) {
  const [group, setGroup] = useState<GroupDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    api
      .getGroup(groupId)
      .then((g) => active && setGroup(g))
      .catch((e) => active && setError(toApiError(e).message));
    return () => {
      active = false;
    };
  }, [groupId]);

  return (
    <Sheet visible onClose={onClose} title="Invite friends">
      {error ? <Banner message={error} /> : null}
      {!group && !error ? <ActivityIndicator color={colors.primary} style={styles.loader} /> : null}
      {group ? (
        <>
          <AppText>
            Friends can join <Text style={styles.strong}>{group.name}</Text> with this code.
          </AppText>
          <InviteCode group={group} />
        </>
      ) : null}
    </Sheet>
  );
}

function InviteCode({ group }: { group: GroupDetail }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await Clipboard.setStringAsync(group.inviteCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function share() {
    const message = `Join my study group "${group.name}" on Study Stakes with code ${group.inviteCode}`;
    try {
      if (Platform.OS === 'web' && !(navigator as Navigator & { share?: unknown }).share) {
        await copy();
        return;
      }
      await Share.share({ message });
    } catch {
      await copy();
    }
  }

  return (
    <View style={styles.codeBox}>
      <Text style={styles.code} selectable accessibilityLabel={`Invite code ${group.inviteCode.split('').join(' ')}`}>
        {group.inviteCode}
      </Text>
      <View style={styles.codeActions}>
        <Button
          title={copied ? 'Copied!' : 'Copy code'}
          icon={copied ? 'checkmark' : 'copy-outline'}
          variant="secondary"
          size="sm"
          onPress={copy}
          style={styles.flex}
        />
        <Button title="Share" icon="share-outline" size="sm" onPress={share} style={styles.flex} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  strong: { fontFamily: fonts.semibold, color: colors.ink },
  loader: { marginVertical: 24 },
  joinedRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  codeBox: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderStyle: 'dashed',
    padding: 18,
    gap: 14,
    alignItems: 'stretch',
  },
  code: {
    textAlign: 'center',
    fontFamily: fonts.bold,
    fontSize: 34,
    letterSpacing: 8,
    color: colors.primary,
  },
  codeActions: { flexDirection: 'row', gap: 10 },
});
