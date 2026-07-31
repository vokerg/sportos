CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE scoring_rules
    DROP CONSTRAINT scoring_rules_code_key;

ALTER TABLE scoring_rules
    ADD COLUMN version integer NOT NULL DEFAULT 1,
    ADD COLUMN supersedes_rule_id uuid REFERENCES scoring_rules(id) ON DELETE RESTRICT;

ALTER TABLE scoring_rules
    ADD CONSTRAINT uq_scoring_rules_code_version UNIQUE (code, version),
    ADD CONSTRAINT chk_scoring_rules_version_positive CHECK (version >= 1),
    ADD CONSTRAINT chk_scoring_rules_effective_range CHECK (valid_to IS NULL OR valid_to >= valid_from);

ALTER TABLE scoring_rules
    ADD CONSTRAINT ex_scoring_rules_enabled_ranges
    EXCLUDE USING gist (
        code WITH =,
        daterange(valid_from, COALESCE(valid_to, 'infinity'::date), '[]') WITH &&
    ) WHERE (enabled);

CREATE TABLE scoring_rule_changes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    rule_code text NOT NULL,
    previous_rule_id uuid REFERENCES scoring_rules(id) ON DELETE RESTRICT,
    proposed_rule_id uuid NOT NULL UNIQUE REFERENCES scoring_rules(id) ON DELETE RESTRICT,
    status text NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
    phase text NOT NULL DEFAULT 'queued',
    progress_percent integer NOT NULL DEFAULT 0
        CHECK (progress_percent BETWEEN 0 AND 100),
    attempt_count integer NOT NULL DEFAULT 0
        CHECK (attempt_count >= 0),
    max_attempts integer NOT NULL DEFAULT 3
        CHECK (max_attempts BETWEEN 1 AND 10),
    lease_owner text,
    lease_expires_at timestamptz,
    heartbeat_at timestamptz,
    cancellation_requested_at timestamptz,
    next_attempt_at timestamptz NOT NULL DEFAULT now(),
    initiated_by text NOT NULL,
    reason text NOT NULL,
    proposal_json jsonb NOT NULL,
    preview_json jsonb NOT NULL,
    preview_fingerprint text NOT NULL,
    affected_from date NOT NULL,
    affected_to date NOT NULL,
    error_code text,
    error_message text,
    result_json jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    started_at timestamptz,
    completed_at timestamptz,
    CHECK (affected_to >= affected_from),
    CHECK (
        (status = 'running' AND lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)
        OR status <> 'running'
    )
);

CREATE UNIQUE INDEX uq_scoring_rule_changes_active_code
    ON scoring_rule_changes (rule_code)
    WHERE status IN ('queued', 'running');

CREATE INDEX idx_scoring_rule_changes_claim
    ON scoring_rule_changes (next_attempt_at, created_at, id)
    WHERE status = 'queued';

CREATE INDEX idx_scoring_rule_changes_stale_lease
    ON scoring_rule_changes (lease_expires_at)
    WHERE status = 'running';

CREATE INDEX idx_scoring_rule_changes_created
    ON scoring_rule_changes (created_at DESC, id DESC);

CREATE INDEX idx_scoring_rules_family
    ON scoring_rules (code, version DESC);
