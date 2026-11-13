// Caregiver-facing care-circle screen. The caregiver (family or primary
// caretaker) sees who's in their elder's circle, can send invites by email
// or phone, and can share a pending invite's token out-of-band (WhatsApp,
// SMS) until we wire transactional delivery via Resend / Twilio.
//
// Multiple circles: if the caregiver is in more than one elder's circle
// (e.g. caring for both parents), the screen shows a small picker at the
// top so they can switch between circles. Single-circle caregivers see no
// picker — the only circle is selected automatically.
//
// Backend pieces it touches:
//   • my_circles()                 — circles the caller is a member of
//   • create_circle_invite(...)    — generate a token-bearing invite
//   • list_circle_invites(circle)  — pending + accepted invites
//   • care_circle_members select   — current members (RLS gates by has_perm)
import { useMemo, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from '@/navigation/router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card } from '@/components/Card';
import { FieldScreen, SubHeader } from '@/components/dashboard';
import { Button } from '@/components/Button';
import { supabase } from '@/lib/supabase';
import { confirm } from '@/lib/confirm';
import { useAuthStore } from '@/stores/authStore';
import { colors, radius, space, touch, type } from '@/theme/tokens';

type CircleRow = {
  circle_id: string;
  elder_id: string;
  elder_name: string;
  member_role: 'primary_caretaker' | 'family' | 'doctor';
  is_elder: boolean;
};

type Member = {
  id: string;
  user_id: string;
  member_role: 'primary_caretaker' | 'family' | 'doctor';
  status: 'pending' | 'active' | 'removed';
  user: { id: string; display_name: string | null; role: string | null } | null;
};

type Invite = {
  id: string;
  email: string | null;
  phone_e164: string | null;
  member_role: 'primary_caretaker' | 'family' | 'doctor';
  token: string;
  expires_at: string;
  accepted_at: string | null;
  created_at: string;
};

type InviteRole = 'primary_caretaker' | 'family' | 'doctor';

export default function CaregiverCircle() {
  const router = useRouter();
  const qc = useQueryClient();
  const myId = useAuthStore((s) => s.user?.id);
  const [activeCircleId, setActiveCircleId] = useState<string | null>(null);

  const circles = useQuery<CircleRow[]>({
    queryKey: ['my-circles'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('my_circles');
      if (error) throw error;
      return (data ?? []) as CircleRow[];
    },
  });

  // From a caregiver's perspective, the relevant circles are the ones where
  // they are NOT the elder. Most caregivers manage exactly one — when they
  // manage several (e.g. caring for both parents), let them pick.
  const caregiverCircles = useMemo(
    () => circles.data?.filter((c) => !c.is_elder) ?? [],
    [circles.data],
  );

  const elderCircle = useMemo(() => {
    if (caregiverCircles.length === 0) return undefined;
    if (activeCircleId) {
      return caregiverCircles.find((c) => c.circle_id === activeCircleId) ?? caregiverCircles[0];
    }
    return caregiverCircles[0];
  }, [caregiverCircles, activeCircleId]);

  const members = useQuery<Member[]>({
    queryKey: ['circle-members', elderCircle?.circle_id],
    enabled: !!elderCircle,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('care_circle_members')
        .select(
          'id, user_id, member_role, status, user:profiles!care_circle_members_user_id_fkey(id, display_name, role)',
        )
        .eq('circle_id', elderCircle!.circle_id);
      if (error) throw error;
      return (data ?? []) as unknown as Member[];
    },
  });

  const invites = useQuery<Invite[]>({
    queryKey: ['circle-invites', elderCircle?.circle_id],
    enabled: !!elderCircle,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('list_circle_invites', {
        p_circle_id: elderCircle!.circle_id,
      });
      if (error) throw error;
      return (data ?? []) as Invite[];
    },
  });

  return (
    <FieldScreen>
      <SubHeader title="Care circle" />
      <ScrollView contentContainerStyle={styles.body}>
        {circles.isLoading ? (
          <Card>
            <Text style={styles.muted}>Loading...</Text>
          </Card>
        ) : caregiverCircles.length === 0 ? (
          <ElderOnboardingCard />
        ) : !elderCircle ? null : (
          <KeyboardAvoidingView
            style={{ gap: space.l }}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          >
            {caregiverCircles.length > 1 ? (
              <Card>
                <Text style={styles.sectionTitle}>Choose a circle</Text>
                <View style={styles.circlePickerRow}>
                  {caregiverCircles.map((c) => (
                    <Pressable
                      key={c.circle_id}
                      onPress={() => setActiveCircleId(c.circle_id)}
                      style={[
                        styles.circleChip,
                        c.circle_id === elderCircle.circle_id && styles.circleChipActive,
                      ]}
                    >
                      <Text
                        style={[
                          styles.circleChipText,
                          c.circle_id === elderCircle.circle_id && styles.circleChipTextActive,
                        ]}
                      >
                        {c.elder_name}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </Card>
            ) : null}

            <Card>
              <Text style={styles.sectionTitle}>
                {`${elderCircle.elder_name}’s circle members`}
              </Text>
              {members.isLoading ? (
                <Text style={styles.muted}>Loading...</Text>
              ) : members.data?.length ? (
                members.data.map((m) => (
                  <MemberRow
                    key={m.id}
                    member={m}
                    circleId={elderCircle.circle_id}
                    isSelf={m.user_id === myId}
                    onChanged={() =>
                      qc.invalidateQueries({
                        queryKey: ['circle-members', elderCircle.circle_id],
                      })
                    }
                  />
                ))
              ) : (
                <Text style={styles.muted}>No members yet. Start by sending an invite.</Text>
              )}
            </Card>

            <InviteForm
              circleId={elderCircle.circle_id}
              onCreated={() => {
                qc.invalidateQueries({ queryKey: ['circle-invites', elderCircle.circle_id] });
              }}
            />

            <Card>
              <Text style={styles.sectionTitle}>Invites</Text>
              {invites.isLoading ? (
                <Text style={styles.muted}>Loading...</Text>
              ) : invites.data?.length ? (
                invites.data.map((inv) => <InviteRow key={inv.id} invite={inv} />)
              ) : (
                <Text style={styles.muted}>No invites yet.</Text>
              )}
            </Card>
          </KeyboardAvoidingView>
        )}
      </ScrollView>
    </FieldScreen>
  );
}

// Shown when the caretaker isn't in any circle yet. Lets them generate a
// code an elder can claim to set up their account. Once an elder redeems,
// the caretaker is automatically added as primary_caretaker of the new
// circle and this screen will re-render with the normal member list.
function ElderOnboardingCard() {
  const [elderName, setElderName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);

  const generate = async () => {
    setError(null);
    setBusy(true);
    const { data, error: err } = await supabase.rpc('create_elder_onboarding_invite', {
      p_elder_display_name: elderName.trim() || null,
      p_email: null,
      p_phone_e164: null,
    });
    setBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    const row = data as { token?: string } | null;
    if (!row?.token) {
      setError('no_token_returned');
      return;
    }
    setToken(row.token);
    await Share.share({
      message: `Hi! Use this code to create your Salem account:\n\n${row.token}\n\nAfter signing in, open "Enter a care code" and paste it.`,
    }).catch(() => {});
  };

  return (
    <Card>
      <Text style={styles.sectionTitle}>Add a senior you care for</Text>
      <Text style={styles.muted}>
        Create a code and give it to the senior. When they sign in for the first
        time and enter it, your accounts are linked and the circle appears here.
      </Text>
      <Field
        label="Senior’s name (optional)"
        value={elderName}
        onChangeText={setElderName}
        autoCapitalize="words"
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {token ? (
        <View style={styles.tokenBox}>
          <Text style={styles.tokenLabel}>Code:</Text>
          <Text selectable style={styles.tokenText}>{token}</Text>
        </View>
      ) : null}
      <Button
        label={token ? 'Share again' : 'Create and share code'}
        onPress={token
          ? () => Share.share({
              message: `Salem care code: ${token}`,
            }).catch(() => {})
          : generate}
        loading={busy}
      />
    </Card>
  );
}

function InviteForm({
  circleId,
  onCreated,
}: {
  circleId: string;
  onCreated: () => void;
}) {
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<InviteRole>('family');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (!email.trim() && !phone.trim()) {
      setError('Enter an email or phone number.');
      return;
    }
    setBusy(true);
    const { data, error: err } = await supabase.rpc('create_circle_invite', {
      p_circle_id: circleId,
      p_member_role: role,
      p_email: email.trim() || null,
      p_phone_e164: phone.trim() || null,
    });
    setBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    setEmail('');
    setPhone('');
    const newInvite = data as Invite | null;
    if (newInvite?.token) {
      await Share.share({
        message: `You’ve been invited to a Salem care circle. Use this invite code inside the app to accept:\n\n${newInvite.token}`,
      }).catch(() => {});
    }
    onCreated();
  };

  return (
    <Card>
      <Text style={styles.sectionTitle}>Send a new invite</Text>
      <Field
        label="Email (optional)"
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
      />
      <Field
        label="Phone number (optional)"
        value={phone}
        onChangeText={setPhone}
        keyboardType="phone-pad"
      />
      <Text style={styles.fieldLabel}>Role</Text>
      <View style={styles.roleRow}>
        {(['family', 'primary_caretaker', 'doctor'] as InviteRole[]).map((r) => (
          <Pressable
            key={r}
            style={[styles.roleChip, role === r && styles.roleChipActive]}
            onPress={() => setRole(r)}
          >
            <Text style={[styles.roleChipText, role === r && styles.roleChipTextActive]}>
              {roleLabel(r)}
            </Text>
          </Pressable>
        ))}
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Button label="Send invite" onPress={submit} loading={busy} />
    </Card>
  );
}

function InviteRow({ invite }: { invite: Invite }) {
  const status = invite.accepted_at
    ? 'Accepted'
    : new Date(invite.expires_at) < new Date()
    ? 'Expired'
    : 'Pending';
  const target = invite.email ?? invite.phone_e164 ?? '—';

  const copy = async () => {
    await Share.share({
      message: `Salem invite code: ${invite.token}`,
    }).catch(() => {});
  };

  return (
    <View style={styles.inviteRow}>
      <View style={{ flex: 1 }}>
        <Text style={styles.inviteTarget}>{target}</Text>
        <Text style={styles.inviteMeta}>
          {roleLabel(invite.member_role)} · {status}
        </Text>
      </View>
      {!invite.accepted_at ? (
        <Pressable onPress={copy} hitSlop={8}>
          <Text style={styles.inviteShare}>Share</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function Field(
  props: React.ComponentProps<typeof TextInput> & { label: string },
) {
  const { label, ...inputProps } = props;
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        {...inputProps}
        style={styles.input}
        placeholderTextColor={colors.textSecondary}
        textAlign="left"
      />
    </View>
  );
}

function roleLabel(r: InviteRole | string) {
  if (r === 'primary_caretaker') return 'Primary caregiver';
  if (r === 'family') return 'Family member';
  if (r === 'doctor') return 'Doctor';
  return r;
}

const ROLE_OPTIONS: InviteRole[] = ['primary_caretaker', 'family', 'doctor'];

// A member row with expandable management actions: change role + remove.
// Both call SECURITY DEFINER RPCs that re-check the caller's manage perm, so
// the UI is convenience — the database is the real gate.
function MemberRow({
  member,
  circleId,
  isSelf,
  onChanged,
}: {
  member: Member;
  circleId: string;
  isSelf: boolean;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const changeRole = async (role: InviteRole) => {
    if (role === member.member_role) {
      setOpen(false);
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.rpc('set_circle_member_role', {
        p_circle_id: circleId,
        p_user_id: member.user_id,
        p_role: role,
      });
      if (error) throw error;
      onChanged();
      setOpen(false);
    } catch {
      /* swallow — RPC enforces; nothing changes on failure */
    } finally {
      setBusy(false);
    }
  };

  const remove = () => {
    confirm({
      title: 'Remove member?',
      message: `${member.user?.display_name ?? 'This member'} will be removed from the care circle.`,
      confirmLabel: 'Remove',
      cancelLabel: 'Cancel',
      destructive: true,
      onConfirm: async () => {
        setBusy(true);
        try {
          const { error } = await supabase.rpc('remove_circle_member', {
            p_circle_id: circleId,
            p_user_id: member.user_id,
          });
          if (error) throw error;
          onChanged();
        } catch {
          /* RPC enforces */
        } finally {
          setBusy(false);
        }
      },
    });
  };

  return (
    <View style={styles.memberBlock}>
      <Pressable
        style={styles.memberRow}
        onPress={() => !isSelf && setOpen((v) => !v)}
        disabled={isSelf}
      >
        <Text style={styles.memberName}>
          {member.user?.display_name ?? 'Unknown'}
          {isSelf ? ' (you)' : ''}
        </Text>
        <Text style={styles.memberRole}>{roleLabel(member.member_role)}</Text>
      </Pressable>

      {open && !isSelf ? (
        <View style={styles.memberActions}>
          <Text style={styles.actionsLabel}>Change role:</Text>
          <View style={styles.roleChips}>
            {ROLE_OPTIONS.map((r) => (
              <Pressable
                key={r}
                onPress={() => changeRole(r)}
                disabled={busy}
                style={[styles.roleChip, r === member.member_role && styles.roleChipActive]}
              >
                <Text
                  style={[
                    styles.roleChipText,
                    r === member.member_role && styles.roleChipTextActive,
                  ]}
                >
                  {roleLabel(r)}
                </Text>
              </Pressable>
            ))}
          </View>
          <Button label="Remove from circle" variant="danger" onPress={remove} loading={busy} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: space.m, paddingBottom: space.xxl, gap: space.l },
  sectionTitle: { ...type.subtitle, color: colors.textPrimary, marginBottom: space.m, textAlign: 'left' },
  field: { gap: space.s, marginBottom: space.m },
  fieldLabel: { ...type.caption, color: colors.textSecondary, textAlign: 'left' },
  input: {
    minHeight: touch.elderMin,
    backgroundColor: colors.cream,
    borderRadius: radius.xl,
    paddingHorizontal: space.l,
    ...type.body,
    color: colors.textPrimary,
  },
  roleRow: { flexDirection: 'row', gap: space.s, flexWrap: 'wrap', marginBottom: space.m },
  roleChip: {
    paddingHorizontal: space.l,
    paddingVertical: space.m,
    borderRadius: radius.xl,
    backgroundColor: colors.cream,
    minHeight: touch.elderMin,
    justifyContent: 'center',
  },
  roleChipActive: { backgroundColor: colors.primary },
  roleChipText: { ...type.body, color: colors.textPrimary },
  roleChipTextActive: { color: colors.textInverse },
  memberRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: space.m,
    borderBottomWidth: 1,
    borderBottomColor: colors.cream,
  },
  memberName: { ...type.body, color: colors.textPrimary },
  memberRole: { ...type.caption, color: colors.textSecondary },
  memberBlock: {},
  memberActions: { paddingVertical: space.m, gap: space.s },
  actionsLabel: { ...type.caption, color: colors.textSecondary, textAlign: 'left' },
  roleChips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s },
  inviteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: space.m,
    borderBottomWidth: 1,
    borderBottomColor: colors.cream,
    gap: space.m,
  },
  inviteTarget: { ...type.body, color: colors.textPrimary, textAlign: 'left' },
  inviteMeta: { ...type.caption, color: colors.textSecondary, textAlign: 'left' },
  inviteShare: { ...type.body, color: colors.primary },
  muted: { ...type.body, color: colors.textSecondary, textAlign: 'left' },
  circlePickerRow: { flexDirection: 'row', gap: space.s, flexWrap: 'wrap' },
  circleChip: {
    paddingHorizontal: space.l,
    paddingVertical: space.m,
    borderRadius: radius.xl,
    backgroundColor: colors.cream,
    minHeight: touch.elderMin,
    justifyContent: 'center',
  },
  circleChipActive: { backgroundColor: colors.primary },
  circleChipText: { ...type.body, color: colors.textPrimary },
  circleChipTextActive: { color: colors.textInverse },
  tokenBox: {
    backgroundColor: colors.cream,
    padding: space.m,
    borderRadius: radius.m,
    gap: space.xs,
    marginVertical: space.m,
  },
  tokenLabel: { ...type.caption, color: colors.textSecondary },
  tokenText: { ...type.body, color: colors.textPrimary, fontFamily: 'monospace' },
  error: { ...type.body, color: colors.alertCritical, textAlign: 'left' },
});
