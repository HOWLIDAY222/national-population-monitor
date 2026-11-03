begin;

create table if not exists population.discovered_resources (
  id uuid primary key,
  source_id text not null references population.data_sources(id),
  region_code text references population.regions(code),
  title text not null,
  resource_url text not null,
  resource_kind text not null check (resource_kind in ('html','json','csv','xlsx','pdf')),
  status text not null default 'candidate' check (status in ('candidate','stale','ignored','promoted')),
  first_seen_at timestamptz not null,
  last_seen_at timestamptz not null,
  last_changed_at timestamptz not null,
  discovered_from_snapshot_id uuid references population.raw_snapshots(id),
  metadata jsonb not null default '{}'::jsonb,
  unique(source_id, resource_url)
);

create index if not exists discovered_resources_region_seen_idx
  on population.discovered_resources(region_code, last_seen_at desc);

create index if not exists discovered_resources_candidate_idx
  on population.discovered_resources(last_seen_at desc)
  where status = 'candidate';

grant select on population.discovered_resources to population_api_readonly;
grant select, insert, update on population.discovered_resources to population_pipeline_writer;

commit;
