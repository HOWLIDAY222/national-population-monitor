begin;

create extension if not exists pgcrypto;
create schema if not exists population;

create table population.regions (
  code text primary key,
  name text not null,
  level text not null check (level in ('country', 'province', 'city')),
  parent_code text references population.regions(code),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index regions_parent_code_idx on population.regions(parent_code);

create table population.data_sources (
  id text primary key,
  name text not null,
  institution text not null,
  url text not null,
  kind text not null check (kind in ('html', 'json', 'csv', 'xlsx', 'pdf')),
  parser_type text not null,
  parser_version text not null,
  check_interval_seconds integer not null check (check_interval_seconds >= 60),
  enabled boolean not null default true,
  auto_publish boolean not null default false,
  status text not null default 'pending' check (status in ('pending', 'healthy', 'delayed', 'failed', 'disabled')),
  etag text,
  last_modified text,
  last_content_hash text,
  last_checked_at timestamptz,
  last_success_at timestamptz,
  next_check_at timestamptz not null default now(),
  consecutive_failures integer not null default 0,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index data_sources_due_idx on population.data_sources(next_check_at)
where enabled = true;
create index data_sources_config_gin_idx on population.data_sources using gin(config jsonb_path_ops);

create table population.source_checks (
  id uuid primary key default gen_random_uuid(),
  source_id text not null references population.data_sources(id),
  started_at timestamptz not null,
  finished_at timestamptz not null,
  outcome text not null check (outcome in ('unchanged', 'changed', 'failed')),
  http_status integer,
  content_hash text,
  duration_ms integer not null,
  error_code text,
  error_message text,
  metadata jsonb not null default '{}'::jsonb
);

create index source_checks_source_finished_idx on population.source_checks(source_id, finished_at desc);

create table population.raw_snapshots (
  id uuid primary key default gen_random_uuid(),
  source_id text not null references population.data_sources(id),
  check_id uuid references population.source_checks(id),
  content_hash text not null,
  content_type text,
  byte_size bigint not null check (byte_size >= 0),
  storage_key text not null,
  response_headers jsonb not null default '{}'::jsonb,
  source_published_at timestamptz,
  collected_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (source_id, content_hash)
);

create index raw_snapshots_source_collected_idx on population.raw_snapshots(source_id, collected_at desc);

create table population.parser_runs (
  id uuid primary key default gen_random_uuid(),
  raw_snapshot_id uuid not null references population.raw_snapshots(id),
  parser_type text not null,
  parser_version text not null,
  status text not null check (status in ('running', 'succeeded', 'failed')),
  record_count integer not null default 0,
  started_at timestamptz not null,
  finished_at timestamptz,
  error_message text,
  metadata jsonb not null default '{}'::jsonb
);

create index parser_runs_snapshot_idx on population.parser_runs(raw_snapshot_id);

create table population.indicator_definitions (
  code text primary key,
  name text not null,
  description text not null,
  default_unit text not null,
  frequency text not null check (frequency in ('realtime', 'hourly', 'daily', 'monthly', 'quarterly', 'annual', 'census', 'survey')),
  value_type text not null default 'number' check (value_type in ('number', 'index', 'ratio')),
  minimum_value numeric,
  maximum_value numeric,
  review_change_ratio numeric not null default 0.05,
  auto_publish boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (minimum_value is null or maximum_value is null or minimum_value <= maximum_value)
);

create table population.staging_records (
  id uuid primary key default gen_random_uuid(),
  parser_run_id uuid not null references population.parser_runs(id),
  indicator_code text not null references population.indicator_definitions(code),
  region_code text not null references population.regions(code),
  period text not null,
  value numeric(24, 6) not null,
  unit text not null,
  frequency text not null,
  source_id text not null references population.data_sources(id),
  source_url text not null,
  source_published_at timestamptz,
  collected_at timestamptz not null,
  effective_at timestamptz,
  parser_version text not null,
  quality_status text not null default 'pending' check (quality_status in ('pending', 'verified', 'review_required', 'rejected')),
  dimensions jsonb not null default '{}'::jsonb,
  raw_value text,
  created_at timestamptz not null default now(),
  unique (parser_run_id, indicator_code, region_code, period)
);

create index staging_records_run_idx on population.staging_records(parser_run_id);
create index staging_records_pending_idx on population.staging_records(created_at)
where quality_status in ('pending', 'review_required');
create index staging_records_dimensions_gin_idx on population.staging_records using gin(dimensions jsonb_path_ops);

create table population.validation_issues (
  id uuid primary key default gen_random_uuid(),
  staging_record_id uuid references population.staging_records(id),
  parser_run_id uuid not null references population.parser_runs(id),
  severity text not null check (severity in ('info', 'warning', 'error', 'blocking')),
  rule_code text not null,
  message text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index validation_issues_run_idx on population.validation_issues(parser_run_id);
create index validation_issues_record_idx on population.validation_issues(staging_record_id);

create table population.data_versions (
  id uuid primary key default gen_random_uuid(),
  version_code text not null unique,
  dataset_key text not null,
  period text not null,
  status text not null check (status in ('draft', 'published', 'rolled_back', 'rejected')),
  quality_status text not null check (quality_status in ('verified', 'reviewed')),
  parser_run_id uuid references population.parser_runs(id),
  replaces_version_id uuid references population.data_versions(id),
  rollback_of_version_id uuid references population.data_versions(id),
  record_count integer not null default 0,
  change_summary jsonb not null default '{}'::jsonb,
  created_by text not null default 'system',
  created_at timestamptz not null default now(),
  published_at timestamptz,
  rolled_back_at timestamptz
);

create unique index data_versions_one_published_idx
on population.data_versions(dataset_key, period)
where status = 'published';
create index data_versions_parser_run_idx on population.data_versions(parser_run_id);
create index data_versions_replaces_idx on population.data_versions(replaces_version_id);

create table population.indicator_records (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references population.data_versions(id),
  indicator_code text not null references population.indicator_definitions(code),
  region_code text not null references population.regions(code),
  period text not null,
  value numeric(24, 6) not null,
  unit text not null,
  frequency text not null,
  source_id text not null references population.data_sources(id),
  source_url text not null,
  source_published_at timestamptz,
  collected_at timestamptz not null,
  effective_at timestamptz,
  platform_published_at timestamptz not null,
  data_status text not null check (data_status in ('official', 'provisional', 'survey', 'index')),
  parser_version text not null,
  quality_status text not null check (quality_status in ('verified', 'reviewed')),
  dimensions jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (version_id, indicator_code, region_code, period)
);

create index indicator_records_version_idx on population.indicator_records(version_id);
create index indicator_records_lookup_idx on population.indicator_records(indicator_code, region_code, effective_at desc);
create index indicator_records_source_idx on population.indicator_records(source_id);
create index indicator_records_dimensions_gin_idx on population.indicator_records using gin(dimensions jsonb_path_ops);

create table population.publication_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  occurred_at timestamptz not null,
  region_code text,
  indicator_code text,
  previous_value numeric(24, 6),
  current_value numeric(24, 6),
  unit text,
  source_id text references population.data_sources(id),
  source_name text,
  source_url text,
  trigger_rule text not null,
  version_id uuid references population.data_versions(id),
  version_code text,
  severity text not null check (severity in ('info', 'success', 'warning', 'error')),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index publication_events_occurred_idx on population.publication_events(occurred_at desc);
create index publication_events_region_idx on population.publication_events(region_code, occurred_at desc);
create index publication_events_version_idx on population.publication_events(version_id);

create table population.collection_jobs (
  id uuid primary key default gen_random_uuid(),
  source_id text not null references population.data_sources(id),
  status text not null default 'pending' check (status in ('pending', 'processing', 'retry', 'completed', 'failed')),
  priority integer not null default 100,
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  available_at timestamptz not null default now(),
  worker_id text,
  started_at timestamptz,
  finished_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index collection_jobs_claim_idx
on population.collection_jobs(priority, available_at, created_at)
where status in ('pending', 'retry');
create index collection_jobs_source_idx on population.collection_jobs(source_id, created_at desc);

create view population.current_indicator_records as
select ir.*
from population.indicator_records ir
join population.data_versions dv on dv.id = ir.version_id
where dv.status = 'published';

commit;
