-- ============================================================================
-- ChaskaBox — Migration 015: Admin-created product ID sequence
-- Existing catalogue IDs are preserved. New Admin-created products / boxes get
-- the next BIGINT automatically so normal store operations need no code edit.
-- ============================================================================

CREATE SEQUENCE IF NOT EXISTS public.products_id_seq;
ALTER SEQUENCE public.products_id_seq OWNED BY public.products.id;

DO $$
DECLARE
  v_max BIGINT;
BEGIN
  SELECT COALESCE(MAX(id), 0) INTO v_max FROM public.products;
  IF v_max > 0 THEN
    PERFORM setval('public.products_id_seq'::regclass, v_max, true);
  ELSE
    PERFORM setval('public.products_id_seq'::regclass, 1, false);
  END IF;
END;
$$;

ALTER TABLE public.products
  ALTER COLUMN id SET DEFAULT nextval('public.products_id_seq'::regclass);

-- Staff may also write products through authenticated RLS paths; the trusted
-- server uses service_role. Neither grant bypasses table/RLS authorization.
GRANT USAGE, SELECT ON SEQUENCE public.products_id_seq TO authenticated, service_role;
REVOKE ALL ON SEQUENCE public.products_id_seq FROM anon;
