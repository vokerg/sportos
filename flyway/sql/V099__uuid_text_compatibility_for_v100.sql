-- Compatibility shim for the historical V100 duplicate-repair statements.
--
-- V100 compares UUID foreign keys with text-typed temporary values on a clean
-- Postgres 16 schema. Keep V100 unchanged so databases that already recorded its
-- Flyway checksum are not forced through a checksum repair. V101 removes every
-- object created here immediately after V100 succeeds.

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
