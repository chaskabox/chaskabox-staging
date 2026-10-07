-- Distributed token bucket, keyed by a SHA-256-derived opaque key from the Worker.
CREATE TABLE IF NOT EXISTS api_rate_limits (
  bucket_key text PRIMARY KEY,
  tokens double precision NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE api_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON api_rate_limits FROM anon, authenticated;
CREATE OR REPLACE FUNCTION public.take_rate_limit_token(p_key text,p_capacity integer,p_per_minute integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_now timestamptz:=clock_timestamp(); v_tokens double precision; v_updated timestamptz; v_refill double precision; v_retry integer;
BEGIN
 IF p_key IS NULL OR length(p_key)<16 OR p_capacity<1 OR p_per_minute<1 THEN RAISE EXCEPTION 'invalid limiter input'; END IF;
 v_refill:=p_per_minute/60.0;
 INSERT INTO api_rate_limits(bucket_key,tokens,updated_at) VALUES(p_key,p_capacity-1,v_now)
 ON CONFLICT DO NOTHING;
 IF FOUND THEN RETURN jsonb_build_object('allowed',true,'retry_after_sec',0); END IF;
 SELECT tokens,updated_at INTO v_tokens,v_updated FROM api_rate_limits WHERE bucket_key=p_key FOR UPDATE;
 v_tokens:=LEAST(p_capacity, v_tokens + EXTRACT(EPOCH FROM (v_now-v_updated))*v_refill);
 IF v_tokens>=1 THEN
   UPDATE api_rate_limits SET tokens=v_tokens-1,updated_at=v_now WHERE bucket_key=p_key;
   RETURN jsonb_build_object('allowed',true,'retry_after_sec',0);
 END IF;
 v_retry:=GREATEST(1,CEIL((1-v_tokens)/v_refill)::integer);
 UPDATE api_rate_limits SET tokens=v_tokens,updated_at=v_now WHERE bucket_key=p_key;
 RETURN jsonb_build_object('allowed',false,'retry_after_sec',v_retry);
END $$;
REVOKE ALL ON FUNCTION public.take_rate_limit_token(text,integer,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.take_rate_limit_token(text,integer,integer) TO service_role;
