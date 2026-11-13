// Reading a signed-in user's role (native/src/stores/authStore.ts): an expired session
// that is still refreshing must never look like "no role yet" (→ role-select).
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getSession = vi.fn();
const maybeSingle = vi.fn();

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getSession: () => getSession() },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => maybeSingle() }) }) }),
  },
}));
vi.mock('@/lib/oneSignal', () => ({
  forgetThisDevice: vi.fn(),
  logoutOneSignal: vi.fn(),
  requestPushPermission: vi.fn(),
}));
vi.mock('@/lib/shareLocation', () => ({ resetShareLocation: vi.fn() }));

import { useAuthStore } from '../native/src/stores/authStore';

const USER = { id: 'u1' } as never;
const noSession = { data: { session: null } };
const hasSession = { data: { session: { user: USER } } };
const familyRow = { data: { role: 'family', role_chosen_at: '2026-11-04T18:54:50Z' }, error: null };

async function readRole() {
  const done = useAuthStore.getState().refreshRole();
  await vi.runAllTimersAsync();
  await done;
  return useAuthStore.getState();
}

beforeEach(() => {
  vi.useFakeTimers();
  getSession.mockReset();
  maybeSingle.mockReset();
  useAuthStore.setState({ user: USER, role: null, roleChosen: false, roleReadFailed: false });
});

describe('refreshRole', () => {
  it('waits for the refreshed session, then reads the role', async () => {
    getSession.mockResolvedValueOnce(noSession).mockResolvedValueOnce(noSession).mockResolvedValue(hasSession);
    maybeSingle.mockResolvedValue(familyRow);
    const s = await readRole();
    expect(maybeSingle).toHaveBeenCalledTimes(1); // never read without a session
    expect(s.role).toBe('family');
    expect(s.roleChosen).toBe(true);
    expect(s.roleReadFailed).toBe(false);
  });

  it('a row that never comes back is a failed read, not "no role"', async () => {
    getSession.mockResolvedValue(hasSession);
    maybeSingle.mockResolvedValue({ data: null, error: null });
    const s = await readRole();
    expect(s.roleReadFailed).toBe(true);
    expect(s.roleChosen).toBe(false);
    expect(s.role).toBeNull();
  });

  it('keeps a role it already had when a later read fails', async () => {
    useAuthStore.setState({ role: 'family', roleChosen: true });
    getSession.mockResolvedValue(noSession);
    const s = await readRole();
    expect(s.role).toBe('family');
    expect(s.roleChosen).toBe(true);
    expect(s.roleReadFailed).toBe(false);
  });

  it('stops when the user signs out meanwhile', async () => {
    getSession.mockImplementation(async () => {
      useAuthStore.setState({ user: null });
      return noSession;
    });
    const s = await readRole();
    expect(getSession).toHaveBeenCalledTimes(1);
    expect(s.roleReadFailed).toBe(false);
  });
});
