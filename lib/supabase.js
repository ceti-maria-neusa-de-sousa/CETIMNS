import { createClient } from "@supabase/supabase-js";

const DEFAULT_SUPABASE_URL = "https://sbwtvvtyjtzouokugrxb.supabase.co";
const DEFAULT_SUPABASE_KEY =
  "sb_publishable_ao5ts1bdB_9sSXpaL_HBKQ_e6jaVZ-N";

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL || DEFAULT_SUPABASE_URL;
const supabaseKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || DEFAULT_SUPABASE_KEY;

export const supabase = createClient(supabaseUrl, supabaseKey);
