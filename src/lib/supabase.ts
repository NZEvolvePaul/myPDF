import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** Null until the app is connected to a Supabase project (see README). */
export const supabase: SupabaseClient | null = url && key ? createClient(url, key, { auth: { flowType: 'pkce' } }) : null;

export const BUCKET = 'documents';

/** Calls an edge function and turns its JSON error into a thrown Error. */
export async function callFunction<T>(name: string, body: Record<string, unknown>): Promise<T> {
  if (!supabase) throw new Error('Sending is not set up yet.');
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    let message = error.message;
    try {
      const ctx = (error as { context?: Response }).context;
      const parsed = ctx ? await ctx.json() : null;
      if (parsed?.error) message = parsed.error;
    } catch {
      // keep the generic message
    }
    throw new Error(message);
  }
  return data as T;
}

export interface EnvelopeSummary {
  id: string;
  title: string;
  status: 'draft' | 'sent' | 'completed' | 'declined' | 'voided';
  created_at: string;
  sent_at: string | null;
  completed_at: string | null;
  final_path: string | null;
  final_sha256: string | null;
  original_path: string;
  original_sha256: string | null;
  message: string | null;
}

export interface RecipientSummary {
  id: string;
  name: string;
  email: string;
  routing_order: number;
  status: 'pending' | 'sent' | 'viewed' | 'signed' | 'declined';
  signed_at: string | null;
  declined_reason: string | null;
}
