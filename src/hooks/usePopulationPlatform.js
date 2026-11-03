import { useCallback, useEffect, useRef, useState } from 'react'
import { loadPopulationPlatform, populationStreamUrl } from '../api/populationApi'

const realtimeEvents = [
  'indicator.updated',
  'indicator.history_added',
  'version.published',
  'version.rolled_back',
  'validation.pending',
  'validation.rejected',
  'parser.failed',
  'source.failed',
  'source.checked',
  'source.changed',
  'source.discovery',
]

const staticPublish = import.meta.env.VITE_STATIC_PUBLISH === 'true'

export function usePopulationPlatform() {
  const [state, setState] = useState({
    mode: staticPublish ? 'static-demo' : 'loading',
    connection: staticPublish ? 'offline' : 'connecting',
    snapshot: null,
    sources: [],
    events: [],
    discoveries: [],
    regionalHistory: [],
    annualRegionalHistory: [],
    error: null,
  })
  const refreshTimer = useRef(null)

  const refresh = useCallback(async (signal) => {
    if (staticPublish) return false
    try {
      const payload = await loadPopulationPlatform(signal)
      setState((current) => ({
        ...current,
        ...payload,
        mode: 'official',
        error: null,
      }))
      return true
    } catch (error) {
      if (error.name === 'AbortError') return false
      setState((current) => ({
        ...current,
        mode: current.snapshot ? 'official' : 'demo-fallback',
        connection: current.snapshot ? 'reconnecting' : 'offline',
        error: error.message,
      }))
      return false
    }
  }, [])

  useEffect(() => {
    if (staticPublish) return undefined
    const controller = new AbortController()
    let stream
    let disposed = false
    let reconnectTimer
    let reconnectDelay = 1000

    const scheduleRefresh = () => {
      clearTimeout(refreshTimer.current)
      refreshTimer.current = window.setTimeout(() => refresh(controller.signal), 180)
    }

    const scheduleReconnect = () => {
      if (disposed || reconnectTimer) return
      reconnectTimer = window.setTimeout(async () => {
        reconnectTimer = null
        const loaded = await refresh(controller.signal)
        if (disposed) return
        if (loaded) connectStream()
        else {
          reconnectDelay = Math.min(reconnectDelay * 2, 15000)
          scheduleReconnect()
        }
      }, reconnectDelay)
    }

    const connectStream = () => {
      if (disposed || typeof EventSource === 'undefined') return
      stream?.close()
      const candidate = new EventSource(populationStreamUrl)
      stream = candidate
      const markLive = () => {
        if (stream !== candidate) return
        reconnectDelay = 1000
        setState((current) => ({ ...current, connection: 'live' }))
      }
      candidate.addEventListener('connected', markLive)
      candidate.addEventListener('heartbeat', markLive)
      realtimeEvents.forEach((eventName) => candidate.addEventListener(eventName, scheduleRefresh))
      candidate.onerror = () => {
        if (stream !== candidate || disposed) return
        candidate.close()
        setState((current) => ({ ...current, connection: current.snapshot ? 'reconnecting' : 'offline' }))
        scheduleReconnect()
      }
    }

    refresh(controller.signal).then((loaded) => {
      if (disposed) return
      if (loaded) connectStream()
      else scheduleReconnect()
    })

    return () => {
      disposed = true
      controller.abort()
      clearTimeout(refreshTimer.current)
      clearTimeout(reconnectTimer)
      stream?.close()
    }
  }, [refresh])

  return { ...state, refresh: () => refresh() }
}
