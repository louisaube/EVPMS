-- rule-evp-rights-db-enforced: the EVP rights are also enforced by PostgreSQL. Every EVP request runs under the
-- non-bypassing role `evp_app` (SET LOCAL ROLE) with two transaction settings, `evp.user_id` and `evp.scope_all`;
-- when a setting is absent the policies see nothing (fail closed). Internal tasks keep the connection role.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'evp_app') THEN
    CREATE ROLE evp_app NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
  EXECUTE format('GRANT evp_app TO %I', current_user);
END
$$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA base TO evp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA base TO evp_app;
--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA base TO evp_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA base GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO evp_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA base GRANT USAGE, SELECT ON SEQUENCES TO evp_app;
--> statement-breakpoint
-- append-only or final data: no UPDATE nor DELETE for the application role
REVOKE UPDATE, DELETE ON base.absence_events, base.closures, base.payfit_proofs, base.audit_logs FROM evp_app;
--> statement-breakpoint
CREATE FUNCTION base.evp_in_perimeter(creche text) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('evp.scope_all', true), '') = 'true'
    OR EXISTS (
      SELECT 1 FROM base.creche_assignments ca
      WHERE ca.user_id::text = nullif(current_setting('evp.user_id', true), '') AND ca.creche_code = creche
    )
$$;
--> statement-breakpoint
-- rule-evp-declare-roles: the ADMINISTRATRICE reads everything and writes nothing
CREATE FUNCTION base.evp_can_write(creche text) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT base.evp_in_perimeter(creche)
    AND NOT EXISTS (
      SELECT 1 FROM base.evp_accounts e
      WHERE e.user_id::text = nullif(current_setting('evp.user_id', true), '') AND e.role = 'ADMINISTRATRICE'
    )
$$;
--> statement-breakpoint
ALTER TABLE base.absences ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE base.absences FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE base.absence_pieces ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE base.absence_pieces FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE base.absence_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE base.absence_events FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE base.notifications ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE base.notifications FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE base.notification_reads ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE base.notification_reads FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE base.closures ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE base.closures FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE base.payfit_alerts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE base.payfit_alerts FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE base.payfit_proofs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE base.payfit_proofs FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- tables attached to a crèche through `scope_code` (equal to the crèche code)
CREATE POLICY absences_select ON base.absences FOR SELECT TO evp_app USING (base.evp_in_perimeter(scope_code));
--> statement-breakpoint
CREATE POLICY absences_insert ON base.absences FOR INSERT TO evp_app WITH CHECK (base.evp_can_write(scope_code));
--> statement-breakpoint
CREATE POLICY absences_update ON base.absences FOR UPDATE TO evp_app
  USING (base.evp_can_write(scope_code)) WITH CHECK (base.evp_can_write(scope_code));
--> statement-breakpoint
CREATE POLICY absences_delete ON base.absences FOR DELETE TO evp_app USING (base.evp_can_write(scope_code));
--> statement-breakpoint
CREATE POLICY absence_pieces_select ON base.absence_pieces FOR SELECT TO evp_app USING (base.evp_in_perimeter(scope_code));
--> statement-breakpoint
CREATE POLICY absence_pieces_insert ON base.absence_pieces FOR INSERT TO evp_app WITH CHECK (base.evp_can_write(scope_code));
--> statement-breakpoint
CREATE POLICY absence_pieces_update ON base.absence_pieces FOR UPDATE TO evp_app
  USING (base.evp_can_write(scope_code)) WITH CHECK (base.evp_can_write(scope_code));
--> statement-breakpoint
CREATE POLICY absence_pieces_delete ON base.absence_pieces FOR DELETE TO evp_app USING (base.evp_can_write(scope_code));
--> statement-breakpoint
CREATE POLICY notifications_select ON base.notifications FOR SELECT TO evp_app USING (base.evp_in_perimeter(scope_code));
--> statement-breakpoint
CREATE POLICY notifications_insert ON base.notifications FOR INSERT TO evp_app WITH CHECK (base.evp_can_write(scope_code));
--> statement-breakpoint
CREATE POLICY notifications_update ON base.notifications FOR UPDATE TO evp_app
  USING (base.evp_can_write(scope_code)) WITH CHECK (base.evp_can_write(scope_code));
--> statement-breakpoint
CREATE POLICY notifications_delete ON base.notifications FOR DELETE TO evp_app USING (base.evp_can_write(scope_code));
--> statement-breakpoint
CREATE POLICY closures_select ON base.closures FOR SELECT TO evp_app USING (base.evp_in_perimeter(scope_code));
--> statement-breakpoint
CREATE POLICY closures_insert ON base.closures FOR INSERT TO evp_app WITH CHECK (base.evp_can_write(scope_code));
--> statement-breakpoint
-- tables that follow the dossier they belong to
CREATE POLICY absence_events_select ON base.absence_events FOR SELECT TO evp_app
  USING (EXISTS (SELECT 1 FROM base.absences a WHERE a.id = absence_id));
--> statement-breakpoint
CREATE POLICY absence_events_insert ON base.absence_events FOR INSERT TO evp_app
  WITH CHECK (EXISTS (SELECT 1 FROM base.absences a WHERE a.id = absence_id AND base.evp_can_write(a.scope_code)));
--> statement-breakpoint
CREATE POLICY payfit_proofs_select ON base.payfit_proofs FOR SELECT TO evp_app
  USING (EXISTS (SELECT 1 FROM base.absences a WHERE a.id = absence_id));
--> statement-breakpoint
CREATE POLICY payfit_alerts_select ON base.payfit_alerts FOR SELECT TO evp_app
  USING (EXISTS (SELECT 1 FROM base.absences a WHERE a.id = absence_id));
--> statement-breakpoint
-- rule-evp-notif-per-user-read: a user only sees and writes their own read marks
CREATE POLICY notification_reads_own ON base.notification_reads FOR ALL TO evp_app
  USING (user_id::text = nullif(current_setting('evp.user_id', true), ''))
  WITH CHECK (user_id::text = nullif(current_setting('evp.user_id', true), ''));
--> statement-breakpoint
-- rule-evp-audit-atomic: the timeline of a dossier is append-only, even for the connection role
CREATE FUNCTION base.absence_events_refuse_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'base.absence_events is append-only' USING ERRCODE = '42501';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER absence_events_no_update_delete BEFORE UPDATE OR DELETE ON base.absence_events
  FOR EACH ROW EXECUTE FUNCTION base.absence_events_refuse_change();
--> statement-breakpoint
CREATE FUNCTION base.absence_events_refuse_truncate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_database() LIKE '%\_test' THEN
    RETURN NULL;
  END IF;
  RAISE EXCEPTION 'base.absence_events is append-only' USING ERRCODE = '42501';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER absence_events_no_truncate BEFORE TRUNCATE ON base.absence_events
  FOR EACH STATEMENT EXECUTE FUNCTION base.absence_events_refuse_truncate();
--> statement-breakpoint
-- default absence types; the PayFit codes stay null until the HR administrator configures them
INSERT INTO base.absence_types (code, label, expected_piece, private_piece, hr_review) VALUES
  ('CONGES_PAYES', 'Congés payés', NULL, false, false),
  ('ARRET_MALADIE', 'Arrêt maladie', 'Avis d''arrêt', true, false),
  ('SANS_SOLDE', 'Sans solde', 'Accord écrit', false, true),
  ('ENFANT_MALADE', 'Enfant malade', 'Certificat', false, false),
  ('ACCIDENT_TRAVAIL', 'Accident du travail', 'Certificat et déclaration', false, true),
  ('RECUPERATION', 'Récupération', 'Heures validées', false, true),
  ('SANS_JUSTIFICATIF', 'Sans justificatif', NULL, false, true),
  ('EVENEMENT_FAMILIAL', 'Événement familial', 'Acte', false, false),
  ('AUTRE', 'Autre', NULL, false, true);
