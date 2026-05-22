// ── Cliente Supabase (opcional / lazy) ────────────────────────────
// O app roda 100% sem Supabase (cai para localStorage). Quando as
// variáveis de ambiente estiverem configuradas em .env, o client é
// criado e os serviços passam a persistir no banco real.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabase: SupabaseClient | null =
  url && anonKey ? createClient(url, anonKey) : null;

export const supabaseAtivo = (): boolean => supabase !== null;
