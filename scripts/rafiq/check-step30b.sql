-- step30b live check — run AFTER applying 20261022090100_step30b_rafiq_enums.sql.
-- Paste into the Supabase SQL editor. READ-ONLY (catalog only). Every row: ok = true.
select 1 as n, 'rafiq_level has exactly normal, watch, alert, urgent (in that order)' as check_name,
       (select string_agg(e.enumlabel, ',' order by e.enumsortorder)
          from pg_enum e join pg_type t on t.oid = e.enumtypid
         where t.typname = 'rafiq_level' and t.typnamespace = 'public'::regnamespace) = 'normal,watch,alert,urgent' as ok
union all
select 2, 'alert_kind has the new value rafiq',
       exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
                where t.typname = 'alert_kind' and e.enumlabel = 'rafiq')
union all
select 3, 'the existing alert kinds are all still there',
       (select count(*) from pg_enum e join pg_type t on t.oid = e.enumtypid
         where t.typname = 'alert_kind' and e.enumlabel in
           ('sos','fall_detected','hr_high','hr_low','spo2_low','zone_exit','low_battery',
            'no_movement','med_missed','trend','band_off_wrist','band_no_data')) = 12
order by 1;
