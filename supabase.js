import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

const DEFAULT_SUPABASE_URL = "https://sbwtvvtyjtzouokugrxb.supabase.co";
const DEFAULT_SUPABASE_KEY =
  "sb_publishable_ao5ts1bdB_9sSXpaL_HBKQ_e6jaVZ-N";

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

export async function fetchWithCache(table, key, fetchFn, options = {}) {
  const cacheKey = `${CACHE_PREFIX}${table}_${key}`;
  let cached;

  try {
    const stored = localStorage.getItem(cacheKey);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        if (
          parsed &&
          Object.prototype.hasOwnProperty.call(parsed, "data") &&
          Number.isFinite(parsed.timestamp)
        ) {
          cached = parsed;
        } else {
          console.warn(`Cache local inválido para ${table}; será ignorado.`);
        }
      } catch (error) {
        console.warn(`Não foi possível interpretar o cache local de ${table}; será ignorado.`, error);
      }
    }
  } catch (error) {
    console.warn(`Não foi possível ler o cache local de ${table}; os dados serão buscados no Supabase.`, error);
  }

  if (cached && !options.force) {
    const isFresh = Date.now() - cached.timestamp < CACHE_TIME;
    if (isFresh) {
      return cached.data;
    }
    if (options.allowStale) {
      options.onStale?.();
      return cached.data;
    }
  }

  let data;
  try {
    data = await fetchFn();
  } catch (error) {
    console.error(`Erro ao buscar ${table}:`, error);
    if (cached) {
      console.warn(`Usando dados em cache para ${table}.`);
      return cached.data;
    }
    throw error;
  }

  try {
    localStorage.setItem(cacheKey, JSON.stringify({ data, timestamp: Date.now() }));
  } catch (error) {
    console.warn(`Os dados de ${table} foram carregados, mas não foi possível atualizar o cache local.`, error);
  }
  return data;
}

export function clearCache(table) {
  try {
    const prefix = `${CACHE_PREFIX}${table}_`;
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(prefix)) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach((key) => localStorage.removeItem(key));
  } catch (error) {
    console.warn(`Não foi possível limpar o cache local de ${table}.`, error);
  }
}

export function getSupabaseConfig() {
  return {
    url: supabaseUrl,
    hasKey: Boolean(supabaseKey)
  };
}
