create table scoring_rules (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  activity_type text not null check (activity_type in ('steps', 'run', 'bike', 'swim', 'workout', 'rowing', 'sup', 'hiit', 'power_bonus')),
  rule_kind text not null check (rule_kind in ('coefficient', 'achievement', 'manual_points')),
  metric text not null,
  coefficient numeric(12,4),
  threshold_operator text check (threshold_operator in ('lt', 'lte', 'gt', 'gte', 'eq', 'exists')),
  threshold_value numeric(14,4),
  threshold_unit text,
  points integer,
  valid_from date not null default date '1900-01-01',
  valid_to date,
  priority integer not null default 100,
  enabled boolean not null default true,
  description text,
  created_at timestamptz not null default now()
);

create table score_ledger (
  id uuid primary key default gen_random_uuid(),
  metric_date date not null,
  activity_id uuid references activities(id) on delete cascade,
  rule_id uuid references scoring_rules(id) on delete set null,
  points integer not null,
  reason text not null,
  calculation_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index idx_score_ledger_date on score_ledger(metric_date);
create index idx_score_ledger_activity on score_ledger(activity_id);
create index idx_score_ledger_rule on score_ledger(rule_id);
