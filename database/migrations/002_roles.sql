begin;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'population_api_readonly') then
    create role population_api_readonly nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'population_pipeline_writer') then
    create role population_pipeline_writer nologin;
  end if;
end
$$;

revoke all on schema population from public;
revoke all on all tables in schema population from public;

grant usage on schema population to population_api_readonly;
grant select on population.regions,
  population.data_sources,
  population.source_checks,
  population.indicator_definitions,
  population.data_versions,
  population.indicator_records,
  population.publication_events,
  population.current_indicator_records
to population_api_readonly;

grant usage on schema population to population_pipeline_writer;
grant select, insert, update on all tables in schema population to population_pipeline_writer;
revoke delete on all tables in schema population from population_pipeline_writer;

alter default privileges in schema population revoke all on tables from public;

commit;
