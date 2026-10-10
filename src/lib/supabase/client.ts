import { createBrowserClient } from "@supabase/ssr";

/** Browser client: anon key, subject to RLS (published data + the user's own rows). */
export function createClient() {
  return createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
}
