-- SECURITY: the credit RPCs and the published-site readers are SECURITY DEFINER and,
-- by Postgres default, executable by PUBLIC → anyone holding the public anon key could
-- mint or drain AI credits for any user and read internal site context. Only the
-- server (service_role) calls them.
REVOKE ALL ON FUNCTION public.topup_credits(uuid, bigint, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.consume_credits(uuid, bigint, text, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.topup_credits(uuid, bigint, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.consume_credits(uuid, bigint, text, uuid, jsonb) TO service_role;
ALTER FUNCTION public.topup_credits(uuid, bigint, text, jsonb) SET search_path = public;
ALTER FUNCTION public.consume_credits(uuid, bigint, text, uuid, jsonb) SET search_path = public;
ALTER FUNCTION public.on_auth_user_created_grant_credits() SET search_path = public;

REVOKE ALL ON FUNCTION public.get_published_site(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_published_page(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_site_config_lite(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_published_site(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_published_page(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_site_config_lite(text, text) TO service_role;
