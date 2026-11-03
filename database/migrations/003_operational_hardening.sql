begin;

alter table population.data_sources
  add column if not exists last_error text;

create index if not exists collection_jobs_processing_started_idx
  on population.collection_jobs(started_at)
  where status = 'processing';

commit;
