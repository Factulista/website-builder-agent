-- Retire every builder tab opened before the 2026-10-07 recovery (builds marked
-- 'builder-3' could hold stale pages): only 'builder-4' (+ server) may write pages.
CREATE OR REPLACE FUNCTION public._require_client(p_client text)
RETURNS void LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF p_client IS NULL OR p_client NOT IN ('builder-4', 'server') THEN
    RAISE EXCEPTION 'client_outdated: questa scheda del builder usa una versione vecchia — ricarica la pagina (Cmd+Shift+R)';
  END IF;
END;
$$;
