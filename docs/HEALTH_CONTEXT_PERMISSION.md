# Health context behind the read-health permission (decision 7)

_Inventory written 2026-10-13, before the change was applied
(migration `step26e_health_context_requires_read_health` + `ai-chat` v8)._

"Health context" = `recent_health_context(elder)`: the elder's name, birth date,
gender and language, the last 7 days of readings, the last 7 days of alerts,
and their active medicines.

## Every place whose behaviour changes

| # | Place | Before | After |
|---|---|---|---|
| 1 | **Rafiq chat (`ai-chat`)**, caregiver **with** read-health | Rafiq sees the elder's health context | **Unchanged** |
| 2 | **Rafiq chat**, caregiver **without** read-health (but with the old chat permission) | Rafiq sees the elder's readings, alerts and medicines, and can repeat them | Rafiq gets **no** health context for that elder. It still chats, and still does "call / text" actions |
| 3 | **Rafiq chat**, the elder about themselves | Sees own context | **Unchanged** — the elder always passes (`has_perm` is true for yourself) |
| 4 | **Rafiq chat**, doctor | Sees context (doctors have read-health by default) | **Unchanged** while the doctor has read-health |
| 5 | **`recent_health_context` called directly** (database RPC) | Callable by **anyone with the app's public key, without signing in**, for any elder ID. No permission check | Callable **only by the server** (service role). A signed-in caller is also checked against read-health as a second guard |

## Places checked that do NOT change

| Place | Why unaffected |
|---|---|
| `analyze-vitals` | Calls `recent_health_context` with the service role; its user path already required read-health |
| The app (any screen) | No screen calls `recent_health_context` directly (all 27 RPCs the app uses were listed; it isn't one of them) |
| Vitals, alerts, assessments, notifications screens | Use their own tables/RPCs, already protected by row-level security |
| Location | Separate permission; doctors remain blocked |

## Not changed, but you should know

- **`health_alerts` is readable by every circle member**, including members
  without read-health (`is_in_circle`, not `has_perm`). Trend alerts therefore
  store only the metric name; all numbers and text live in the
  read-health-protected `trend_findings` table.
- **`record_ai_assessment` can be called by anyone with the public key** and
  writes an AI assessment for any elder, which then shows in caregivers'
  alert feeds. Not part of decision 7, so not changed. Recommended fix: revoke
  it from `anon` and `authenticated` (only server functions use it).

## Proof

`scripts/trend-watch/permissions.sql` checks, as each real role, that:

| Who | Health context | Trend tables | Mark as expected |
|---|---|---|---|
| The elder | ✅ own data | ✅ | ❌ |
| Caregiver with read-health | ❌ direct RPC (server-only now) — gets it through Rafiq | ✅ | ❌ |
| Caregiver without read-health | ❌ | ❌ (0 rows) | ❌ |
| Doctor (with read-health) | ❌ direct RPC — gets it through Rafiq | ✅ | ✅ |
| Not signed in | ❌ | ❌ | ❌ |

The Rafiq-level rule (who gets context inside chat) is the pure function
`planChatContext`, covered by `tests/chatTrendContext.test.ts`.
