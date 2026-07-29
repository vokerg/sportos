-- Remove the narrowly scoped compatibility objects installed by V099 after the
-- historical V100 migration has completed. Existing databases that already ran
-- V100 may not have V099 recorded; IF EXISTS keeps this cleanup forward-safe.

DROP OPERATOR IF EXISTS public.= (uuid, text);
DROP OPERATOR IF EXISTS public.= (text, uuid);
DROP FUNCTION IF EXISTS public.sportos_uuid_equals_text(uuid, text);
DROP FUNCTION IF EXISTS public.sportos_text_equals_uuid(text, uuid);
