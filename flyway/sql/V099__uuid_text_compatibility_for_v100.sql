-- Compatibility bridge for the historical V100 duplicate-repair statements.
--
-- `normalized_entity_id` identifies multiple canonical entity kinds. Activities
-- and performance events use UUIDs, while daily metrics use ISO dates, so the
-- durable column must be text. V100 already writes text values but the original
-- V001 definition left the column as UUID.
--
-- V100 also compares UUID references with text-typed temporary values. Keep V100
-- unchanged so databases that recorded its Flyway checksum do not require repair.
-- V101 removes only the temporary equality operators and confirms the durable text
-- column type for databases that had already advanced beyond V099.

ALTER TABLE source_records
  ALTER COLUMN normalized_entity_id TYPE text
  USING normalized_entity_id::text;

CREATE FUNCTION public.sportos_uuid_equals_text(left_value uuid, right_value text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $function$
  SELECT left_value::text = right_value
$function$;

CREATE FUNCTION public.sportos_text_equals_uuid(left_value text, right_value uuid)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $function$
  SELECT left_value = right_value::text
$function$;

CREATE OPERATOR public.= (
  LEFTARG = uuid,
  RIGHTARG = text,
  FUNCTION = public.sportos_uuid_equals_text
);

CREATE OPERATOR public.= (
  LEFTARG = text,
  RIGHTARG = uuid,
  FUNCTION = public.sportos_text_equals_uuid
);
