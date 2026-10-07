-- ChaskaBox v4: defense-in-depth for the public configuration surface.
-- Only explicitly approved storefront settings may ever be read through the public view.

CREATE OR REPLACE VIEW public.public_site_settings
WITH (security_invoker = true) AS
SELECT key, value
FROM public.site_settings
WHERE key IN (
  'cod_enabled',
  'cod_delivery_fee_pkr',
  'jazzcash_enabled',
  'bank_transfer_enabled',
  'bank_transfer_details',
  'prepaid_free_delivery_threshold_pkr',
  'prepaid_delivery_fee_pkr',
  'delivery_estimate',
  'support_whatsapp',
  'support_email',
  'store_address',
  'jazzcash_till_id',
  'jazzcash_qr_url',
  'promo_text',
  'ai_customer_assistant_enabled',
  'ai_semantic_search_enabled'
);

GRANT SELECT ON public.public_site_settings TO anon, authenticated;

-- Trigger functions are invoked by their triggers, never by browser clients.
REVOKE ALL ON FUNCTION public.guard_order_update() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_review_verified() FROM PUBLIC, anon, authenticated;
