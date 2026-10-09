-- Migration 020: Fix handle_new_user() trigger to match profiles schema
-- Root cause: Supabase default trigger inserts (id, email) into public.profiles,
-- but profiles table (migration 010) has no email column -> "Database error creating new user".
-- Fix: update function to insert only columns that exist (id, name from metadata).
-- Trigger itself is preserved (not disabled). RLS/security unchanged.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
begin
  insert into public.profiles (id, name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end
$function$;
