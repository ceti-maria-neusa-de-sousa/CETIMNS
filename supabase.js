import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

const DEFAULT_SUPABASE_URL = "https://sbwtvvtyjtzouokugrxb.supabase.co";
const DEFAULT_SUPABASE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNid3R2dnR5anR6b3Vva3VncnhiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI1NDQ3NDgsImV4cCI6MjA5ODEyMDc0OH0.GbUEMQIylmGhlYcjWynCGmGkQWMhSgsqWBXl8rBzOxU";

const runtimeConfig = globalThis.CETI_SUPABASE_CONFIG || {};
const supabaseUrl = runtimeConfig.url || globalThis.CETI_SUPABASE_URL || DEFAULT_SUPABASE_URL;
const supabaseKey = runtimeConfig.key || globalThis.CETI_SUPABASE_ANON_KEY || DEFAULT_SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error(
    "Configuração do Supabase ausente. Defina `window.CETI_SUPABASE_URL` e `window.CETI_SUPABASE_ANON_KEY` antes de carregar o app."
  );
}

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false
  }
});

// Funções auxiliares para cache local com fallback
const CACHE_PREFIX = "ceti_cache_";
const CACHE_TIME = 5 * 60 * 1000; // 5 minutos

export async function fetchWithCache(table, key, fetchFn) {
  const cacheKey = `${CACHE_PREFIX}${table}_${key}`;
  const cached = localStorage.getItem(cacheKey);
  
  if (cached) {
    const { data, timestamp } = JSON.parse(cached);
    if (Date.now() - timestamp < CACHE_TIME) {
      return data;
    }
  }

  try {
    const data = await fetchFn();
    localStorage.setItem(cacheKey, JSON.stringify({ data, timestamp: Date.now() }));
    return data;
  } catch (error) {
    console.error(`Erro ao buscar ${table}:`, error);
    if (cached) {
      const { data } = JSON.parse(cached);
      console.log("Usando dados em cache");
      return data;
    }
    throw error;
  }
}

export function clearCache(table) {
  const prefix = `${CACHE_PREFIX}${table}_`;
  const keysToRemove = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(prefix)) {
      keysToRemove.push(key);
    }
  }
  keysToRemove.forEach((key) => localStorage.removeItem(key));
}

export function getSupabaseConfig() {
  return {
    url: supabaseUrl,
    hasKey: Boolean(supabaseKey)
  };
}
