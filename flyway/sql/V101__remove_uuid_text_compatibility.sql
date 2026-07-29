-- Finalize the normalized-entity identifier schema after V100 and remove the
-- narrowly scoped comparison operators installed by V099.
--
-- Existing databases that already ran V100 may not have V099 recorded. Confirming
-- the text type here makes those databases compatible with daily-metric identifiers,
-- while IF EXISTS keeps operator cleanup safe in both migration histories.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'source_records'
      AND column_name = 'normalized_entity_id'
      AND data_type <> 'text'
  ) THEN
    ALTER TABLE source_records
      ALTER COLUMN normalized_entity_id TYPE text
      USING normalized_entity_id::text;
  END IF;
END $$;

DROP OPERATOR IF EXISTS public.= (uuid, text);
DROP OPERATOR IF EXISTS public.= (text, uuid);
DROP FUNCTION IF EXISTS public.sportos_uuid_equals_text(uuid, text);
DROP FUNCTION IF EXISTS public.sportos_text_equals_uuid(text, uuid);
