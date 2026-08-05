import { createClient } from "@supabase/supabase-js";

const DEFAULT_SUPABASE_URL = "https://sbwtvvtyjtzouokugrxb.supabase.co";
const DEFAULT_SUPABASE_KEY =
  "sb_publishable_ao5ts1bdB_9sSXpaL_HBKQ_e6jaVZ-N";

function getSupabaseConfig() {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    DEFAULT_SUPABASE_URL;
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    DEFAULT_SUPABASE_KEY;

  return { url, key };
}

export async function GET() {
  const { url, key } = getSupabaseConfig();

  if (!url || !key) {
    return Response.json(
      {
        ok: false,
        connected: false,
        error:
          "Variáveis do Supabase ausentes. Defina NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY no .env.local."
      },
      { status: 500 }
    );
  }

  const supabase = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });

  const [schoolConfigResult, adminsResult] = await Promise.all([
    supabase.from("school_config").select("id", { count: "exact", head: true }),
    supabase.from("admins").select("id", { count: "exact", head: true })
  ]);

  const firstError = schoolConfigResult.error || adminsResult.error;

  if (firstError) {
    return Response.json(
      {
        ok: false,
        connected: false,
        error: firstError.message,
        details: {
          school_config: schoolConfigResult.error?.message ?? null,
          admins: adminsResult.error?.message ?? null
        }
      },
      { status: 500 }
    );
  }

  return Response.json({
    ok: true,
    connected: true,
    url,
    tables: {
      school_config: schoolConfigResult.count ?? 0,
      admins: adminsResult.count ?? 0
    }
  });
}
