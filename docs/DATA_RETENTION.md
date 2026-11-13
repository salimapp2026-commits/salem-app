# Data retention

_Last updated 2026-10-13 (Salem Band, step27). Source of truth for the privacy
policy's "How long we keep your data" section._

## Summary

| Data | Kept for | How it's removed |
|---|---|---|
| **Raw Salem Band readings** (heart rate, oxygen, skin temperature, steps, movement — one row every few minutes) | **90 days** | Deleted every night by the `salem_band_retention` job (00:30 UTC) |
| Band events (SOS, fall, off/on wrist, battery) | 90 days (a fall still waiting for "I'm OK" is never deleted) | Same nightly job |
| **Daily summaries** (one value per measure per day, e.g. that day's median resting heart rate) | As long as the account exists | Deleted with the account |
| Readings entered by hand (blood pressure, glucose, weight, manual heart rate …) | As long as the account exists — unchanged | Deleted with the account |
| Alerts (`health_alerts`), Trend Watch findings | As long as the account exists — unchanged | Deleted with the account |
| **Detailed band locations** (the band's own GPS fixes — Salem Band v2, planned) | **30 days** | Deleted every night by `salem_location_retention` (00:45 UTC) |
| **Location attached to an SOS / fall** (`alert_locations`) — readable only by the elder and people with the location permission, never doctors | **1 year** after the alert (the alert itself is kept) | Same nightly job; also deleted with the account |
| The phone's shared positions (`location_pings`, source fg / bg — every 5 min while the elder's app is open, and at SOS) | **30 days**; each elder's newest position is always kept, so the map can still say "last seen" (founder, 2026-11-08) | Same nightly job (`step32k`) |
| Audit log | As before; one row per band upload batch (not per reading), one row per nightly purge | — |
| Paired band record (serial, battery, last sync) | Until the account is deleted; "Forget band" marks it forgotten | Deleted with the account |

Account deletion works exactly as before (`finalize_due_deletions`): everything
above is removed with the account.

## Why 90 days

A band produces about 1,000 readings a day. Trend Watch only ever looks at the
last ~10 weeks of *daily summaries* (28-day baseline + 7 recent days + margin),
and the real-time alerts only look at the last 15 minutes. Keeping minute-level
data longer would add privacy risk without helping anyone. The daily summaries
keep the long-term picture (e.g. "resting heart rate over the past year").

## How it works

- `band_purge_raw()` (migration `step27c`) deletes `vitals` rows with
  `source = 'band'` older than `trend_config.band_raw_retention_days` (90), and
  band events older than that which are no longer pending.
- It writes **one** `audit_log` row per run (`action = 'RETENTION_PURGE'`) with
  the cutoff and the number of rows deleted.
- `refresh_vital_daily_summaries` never recomputes a day older than the
  retention window, so a summary is never rebuilt from partly-deleted data.
- Manual readings (`source = 'manual'`) are never touched by the job.
- Changing the number: update `band_raw_retention_days` in `trend_config`; the
  policy text below must be updated in the same change.

## How location retention works

- `location_purge()` (migration `step29b`) runs nightly. It deletes band
  location fixes (`location_pings` whose source starts with `band`) older than
  `trend_config.band_location_retention_days` (30), and the location attached
  to an SOS / fall (`alert_locations`) once the alert is older than
  `alert_location_retention_days` (365). Since `step32k` it also deletes the
  phone's positions (source fg / bg) older than `phone_location_retention_days`
  (30), never an elder's newest position. One `audit_log` row per run
  (`RETENTION_PURGE`, resource `location`).
- The phone-positions paragraph in the policy text below is the founder's wording
  (2026-11-08), pasted as given.
- Band fixes don't exist yet: they arrive with Salem Band v2 (own GPS + 4G).
  The job already covers them, so nothing has to change when they do.

## Text for the privacy policy

> **Salem Band data.** If you use a Salem Band, it measures heart rate, blood
> oxygen, skin temperature and movement every few minutes. We keep these
> detailed readings for **90 days** and then delete them automatically. We keep
> a short daily summary of each measure (for example, your average resting heart
> rate that day) for as long as you have an account, so you and your care circle
> can see how things change over months. Readings you enter yourself are kept
> until you delete them or your account. When you delete your account, all of
> it is deleted.
>
> **Location.** When your Salem Band records where you are, we keep those
> detailed locations for **30 days** and then delete them automatically. If you
> press SOS or the band detects a fall, the location at that moment is attached
> to the alert so your family can find you. It is visible only to people you
> allowed to see your location — never to your doctor — and is kept with that
> alert for **1 year**, then deleted. When you delete your account, all of it is
> deleted.
>
> When the elder’s app is open, Salem shares the phone’s location with their care
> circle. We keep these positions for 30 days and then delete them automatically,
> except for the most recent one, which we keep so the family can see where the
> elder was last. Doctors never see location.

Arabic (for when the Arabic policy is switched back on):

> **بيانات سوار سليم.** إذا كنت تستخدم سوار سليم، فهو يقيس نبض القلب ونسبة
> الأكسجين في الدم وحرارة الجلد والحركة كل بضع دقائق. نحتفظ بهذه القراءات
> التفصيلية لمدة **٩٠ يومًا** ثم نحذفها تلقائيًا. ونحتفظ بملخص يومي قصير لكل قياس
> (مثل متوسط نبضك أثناء الراحة في ذلك اليوم) طوال مدة وجود حسابك، حتى تتمكن أنت
> ودائرة الرعاية من متابعة التغيّر على مدى شهور. القراءات التي تُدخلها بنفسك تبقى
> حتى تحذفها أو تحذف حسابك. وعند حذف حسابك تُحذف كل هذه البيانات.
>
> **الموقع.** عندما يسجّل سوار سليم مكانك، نحتفظ بهذه المواقع التفصيلية لمدة
> **٣٠ يومًا** ثم نحذفها تلقائيًا. وإذا ضغطت زر الاستغاثة أو اكتشف السوار سقوطًا،
> يُرفق موقعك في تلك اللحظة بالتنبيه حتى تتمكن عائلتك من الوصول إليك. لا يراه إلا
> من سمحت لهم برؤية موقعك — ولا يراه طبيبك أبدًا — ويُحفظ مع ذلك التنبيه لمدة
> **سنة واحدة** ثم يُحذف. وعند حذف حسابك تُحذف كل هذه البيانات.
>
> عند فتح تطبيق سليم على هاتف المسن، يُشارَك موقع الهاتف مع دائرة الرعاية الخاصة
> به. نحتفظ بهذه المواقع لمدة 30 يومًا ثم تُحذف تلقائيًا، باستثناء آخر موقع
> مُسجَّل، إذ نحتفظ به ليتمكن ذووه من معرفة آخر مكان كان فيه. ولا يطّلع الأطباء
> على الموقع في أي حال.

Not yet pasted into `app/legal/privacy.tsx` — the lawyer reviews the whole
privacy policy first; legal wording is the founder's
call. Egypt's PDPL (151/2020) and GDPR both expect retention periods to be
stated; add this before the band ships.
