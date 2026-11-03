const getJson = async (path, signal) => {
  const response = await fetch(path, {
    method: 'GET',
    headers: { accept: 'application/json' },
    cache: 'no-store',
    signal,
  })
  if (!response.ok) throw new Error(`人口数据接口返回 HTTP ${response.status}`)
  return response.json()
}

export const loadPopulationPlatform = async (signal) => {
  const [snapshot, sources, events, discoveries, regionalHistory, annualRegionalHistory] = await Promise.all([
    getJson('/api/v1/snapshot', signal),
    getJson('/api/v1/sources', signal),
    getJson('/api/v1/events?limit=50', signal),
    getJson('/api/v1/discoveries?limit=100&status=candidate', signal),
    getJson('/api/v1/indicators/census_population_total/history?regionCode=all', signal),
    getJson('/api/v1/indicators/province_population_total/history?regionCode=all', signal),
  ])
  return {
    snapshot,
    sources: sources.items ?? [],
    events: events.items ?? [],
    discoveries: discoveries.items ?? [],
    regionalHistory: regionalHistory.items ?? [],
    annualRegionalHistory: annualRegionalHistory.items ?? [],
  }
}

export const populationStreamUrl = '/api/v1/stream'
