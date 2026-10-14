-- The rejected state is named REJETEE (rule-evp-states). Databases migrated before the correction carry REFUSEE.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'base' AND t.typname = 'absence_status' AND e.enumlabel = 'REFUSEE'
  ) THEN
    ALTER TYPE base.absence_status RENAME VALUE 'REFUSEE' TO 'REJETEE';
  END IF;
END
$$;
