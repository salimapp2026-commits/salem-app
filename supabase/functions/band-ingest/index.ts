// band-ingest (verify_jwt: true) — the phone app uploads what it received from
// the Salem Band. Called with the ELDER's own session (normal public key + user
// JWT). The service-role key exists only here, inside the function.
//
// Body (JSON):
//   {
//     band_serial: "SB-…",
//     firmware_version?: "1.0.0",
//     battery_pct?: 0–100,                       // read from the Battery service
//     packets?: { records?: string[], events?: string[] }   // base64 BLE payloads
//     records?: WireRecord[], events?: WireEvent[]          // or already decoded
//   }
//
// _shared/bandUpload.ts decodes and validates everything with
// _shared/bandProtocol.ts — the same code the app, the simulator and the unit
// tests use. Impossible values are dropped and counted per reason; the rest go
// to band_ingest() (step27c/d), which stores, de-duplicates, runs the
// real-time rules, handles SOS / falls, and writes one audit row per batch.
//
// Reply: band_ingest's summary plus `commands` the phone should write back to
// the band (ACK_EVENT for every stored event, MEASURE_NOW when a critical
// reading needs confirming, VIBRATE when an SOS / fall alert went out).
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { prepareUpload, replyCommands, type IngestResult } from '../_shared/bandUpload.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SUPABASE_SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const MAX_BODY_BYTES = 512 * 1024;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  // Who is calling: the signed-in elder. Their own id is the only elder this
  // upload can write to; band_ingest also checks the band is paired to them.
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'unauthorized' }, 401);
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData } = await userClient.auth.getUser();
  const user = userData?.user;
  if (!user) return json({ error: 'unauthorized' }, 401);

  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return json({ error: 'too_large' }, 413);
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  const prep = prepareUpload(body, Math.floor(Date.now() / 1000));
  if (!prep.ok) return json({ error: prep.error }, prep.status);

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);
  const { data, error } = await admin.rpc('band_ingest', {
    p_elder: user.id,
    p_serial: prep.serial,
    p_upload: prep.payload,
  });
  if (error) {
    if (error.message?.includes('band_not_registered')) {
      return json({ error: 'band_not_registered', detail: 'Pair this band to your account first.' }, 409);
    }
    console.error('band_ingest failed', error.message);
    return json({ error: 'ingest_failed' }, 500);
  }

  return json({ ...(data as object), commands: replyCommands(data as IngestResult) });
});
