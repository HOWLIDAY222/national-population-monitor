import { EventEmitter } from 'node:events'

export class RealtimeEventBus extends EventEmitter {
  publish(event) {
    this.emit('event', event)
  }
}
