begin;

alter table population.data_sources
  drop constraint if exists data_sources_kind_check;

alter table population.data_sources
  add constraint data_sources_kind_check
  check (kind in ('html', 'json', 'csv', 'xlsx', 'pdf', 'doc'));

alter table population.discovered_resources
  drop constraint if exists discovered_resources_resource_kind_check;

alter table population.discovered_resources
  add constraint discovered_resources_resource_kind_check
  check (resource_kind in ('html', 'json', 'csv', 'xlsx', 'pdf', 'doc'));

commit;
