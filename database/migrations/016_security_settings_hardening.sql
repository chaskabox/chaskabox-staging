-- ChaskaBox v4 hardening: remove unsafe legacy hard-delete RPC, validate public settings,
-- and centralize common owner-editable storefront contact/copy values.

-- The production API performs hard-delete only after server-side JWT role verification
-- with service_role. The old SECURITY DEFINER RPC trusted caller-supplied role text and
-- is intentionally removed.
DROP FUNCTION IF EXISTS public.admin_hard_delete_product(BIGINT, UUID, TEXT);

-- Harden the SECURITY DEFINER RLS helper functions with an empty search_path and
-- fully-qualified objects, then restrict direct execute privileges to authenticated users.
CREATE OR REPLACE FUNCTION public.staff_role()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT ar.role
  FROM public.admin_roles ar
  WHERE ar.user_id = auth.uid() AND ar.active = TRUE
  LIMIT 1;
$$;
CREATE OR REPLACE FUNCTION public.is_staff()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$ SELECT public.staff_role() IS NOT NULL; $$;
CREATE OR REPLACE FUNCTION public.is_owner()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$ SELECT public.staff_role() = 'owner'; $$;
REVOKE ALL ON FUNCTION public.staff_role() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_staff() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_owner() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_role() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_staff() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_owner() TO authenticated;

INSERT INTO public.site_settings(key,value) VALUES
  ('support_whatsapp', to_jsonb('0332-0005381'::text)),
  ('support_email', to_jsonb('Chaskabox.mzg@gmail.com'::text)),
  ('store_address', to_jsonb('Near Ahmad Drink Corner, Railway Road, Bhatti Hussainabad, Muzaffargarh, Pakistan'::text)),
  ('jazzcash_till_id', to_jsonb('981716438'::text)),
  ('jazzcash_qr_url', to_jsonb('/images/jazzcash-qr.webp'::text)),
  ('promo_text', to_jsonb('Original sealed packs · Pakistan-wide delivery · COD + prepaid'::text))
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.validate_site_setting()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  n numeric;
  s text;
BEGIN
  IF NEW.key IN ('cod_enabled','jazzcash_enabled','bank_transfer_enabled','ai_customer_assistant_enabled','ai_semantic_search_enabled') THEN
    IF jsonb_typeof(NEW.value) <> 'boolean' THEN RAISE EXCEPTION '% must be boolean', NEW.key; END IF;
  ELSIF NEW.key IN ('cod_delivery_fee_pkr','prepaid_delivery_fee_pkr','prepaid_free_delivery_threshold_pkr') THEN
    IF jsonb_typeof(NEW.value) <> 'number' THEN RAISE EXCEPTION '% must be a number', NEW.key; END IF;
    n := (NEW.value #>> '{}')::numeric;
    IF NEW.key = 'prepaid_free_delivery_threshold_pkr' THEN
      IF n < 0 OR n > 1000000 OR n <> trunc(n) THEN RAISE EXCEPTION '% out of range', NEW.key; END IF;
    ELSE
      IF n < 0 OR n > 100000 OR n <> trunc(n) THEN RAISE EXCEPTION '% out of range', NEW.key; END IF;
    END IF;
  ELSIF NEW.key = 'delivery_estimate' THEN
    IF jsonb_typeof(NEW.value) <> 'string' THEN RAISE EXCEPTION 'delivery_estimate must be text'; END IF;
    s := NEW.value #>> '{}'; IF length(btrim(s)) < 2 OR length(s) > 80 THEN RAISE EXCEPTION 'delivery_estimate invalid'; END IF;
  ELSIF NEW.key = 'support_email' THEN
    IF jsonb_typeof(NEW.value) <> 'string' THEN RAISE EXCEPTION 'support_email must be text'; END IF;
    s := NEW.value #>> '{}'; IF length(s) > 254 OR s !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN RAISE EXCEPTION 'support_email invalid'; END IF;
  ELSIF NEW.key = 'support_whatsapp' THEN
    IF jsonb_typeof(NEW.value) <> 'string' THEN RAISE EXCEPTION 'support_whatsapp must be text'; END IF;
    s := NEW.value #>> '{}'; IF length(s) > 25 OR s !~ '^[+0-9 ()-]{7,25}$' THEN RAISE EXCEPTION 'support_whatsapp invalid'; END IF;
  ELSIF NEW.key = 'store_address' THEN
    IF jsonb_typeof(NEW.value) <> 'string' THEN RAISE EXCEPTION 'store_address must be text'; END IF;
    s := NEW.value #>> '{}'; IF length(btrim(s)) < 3 OR length(s) > 300 THEN RAISE EXCEPTION 'store_address invalid'; END IF;
  ELSIF NEW.key = 'jazzcash_till_id' THEN
    IF jsonb_typeof(NEW.value) <> 'string' THEN RAISE EXCEPTION 'jazzcash_till_id must be text'; END IF;
    s := NEW.value #>> '{}'; IF length(s) > 40 OR s !~ '^[A-Za-z0-9 -]{3,40}$' THEN RAISE EXCEPTION 'jazzcash_till_id invalid'; END IF;
  ELSIF NEW.key = 'jazzcash_qr_url' THEN
    IF jsonb_typeof(NEW.value) <> 'string' THEN RAISE EXCEPTION 'jazzcash_qr_url must be text'; END IF;
    s := NEW.value #>> '{}'; IF length(s) > 500 OR s !~ '^(https://|/)[^[:space:]]+$' THEN RAISE EXCEPTION 'jazzcash_qr_url invalid'; END IF;
  ELSIF NEW.key = 'promo_text' THEN
    IF jsonb_typeof(NEW.value) <> 'string' THEN RAISE EXCEPTION 'promo_text must be text'; END IF;
    s := NEW.value #>> '{}'; IF length(btrim(s)) < 1 OR length(s) > 180 THEN RAISE EXCEPTION 'promo_text invalid'; END IF;
  ELSIF NEW.key = 'bank_transfer_details' THEN
    IF jsonb_typeof(NEW.value) <> 'object' OR pg_column_size(NEW.value) > 4096 THEN RAISE EXCEPTION 'bank_transfer_details invalid'; END IF;
    IF length(btrim(COALESCE(NEW.value->>'bank',''))) < 2 OR length(COALESCE(NEW.value->>'bank','')) > 100 THEN RAISE EXCEPTION 'bank name invalid'; END IF;
    IF length(btrim(COALESCE(NEW.value->>'account_title',''))) < 2 OR length(COALESCE(NEW.value->>'account_title','')) > 120 THEN RAISE EXCEPTION 'account title invalid'; END IF;
    IF length(btrim(COALESCE(NEW.value->>'account_number',''))) < 4 OR length(COALESCE(NEW.value->>'account_number','')) > 80 THEN RAISE EXCEPTION 'account number invalid'; END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_site_setting ON public.site_settings;
CREATE TRIGGER trg_validate_site_setting
BEFORE INSERT OR UPDATE OF key, value ON public.site_settings
FOR EACH ROW EXECUTE FUNCTION public.validate_site_setting();

REVOKE ALL ON FUNCTION public.validate_site_setting() FROM PUBLIC, anon, authenticated;
