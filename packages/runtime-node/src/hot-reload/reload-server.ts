/**
 * Live Reload WebSocket Server
 *
 * Sends reload notifications to connected clients
 */

import { WebSocketServer, type WebSocket } from 'ws'
import type { Server as HTTPServer } from 'node:http'
import type { Logger } from '@zebric/observability'

export interface ReloadServerOptions {
  server: HTTPServer
  path?: string
  logger?: Logger
}

export interface ReloadEvent {
  type: 'reload' | 'error' | 'connected'
  timestamp: number
  message?: string
  changes?: string[]
}

export class ReloadServer {
  private wss: WebSocketServer
  private clients = new Set<WebSocket>()
  private logger?: Logger

  constructor(options: ReloadServerOptions) {
    this.logger = options.logger
    this.wss = new WebSocketServer({
      server: options.server,
      path: options.path || '/__reload',
    })

    this.wss.on('connection', (ws) => {
      this.clients.add(ws)
      this.logger?.info('Live reload client connected', {
        clientCount: this.clients.size,
      })

      // Send connected event
      this.sendToClient(ws, {
        type: 'connected',
        timestamp: Date.now(),
        message: 'Connected to Zebric live reload server',
      })

      ws.on('close', () => {
        this.clients.delete(ws)
        this.logger?.info('Live reload client disconnected', {
          clientCount: this.clients.size,
        })
      })

      ws.on('error', (error) => {
        this.logger?.error('Live reload WebSocket error', { error })
        this.clients.delete(ws)
      })
    })
  }

  /**
   * Send reload event to all connected clients
   */
  notifyReload(changes?: string[]): void {
    const event: ReloadEvent = {
      type: 'reload',
      timestamp: Date.now(),
      changes,
    }

    this.broadcast(event)
  }

  /**
   * Send error event to all connected clients
   */
  notifyError(message: string): void {
    const event: ReloadEvent = {
      type: 'error',
      timestamp: Date.now(),
      message,
    }

    this.broadcast(event)
  }

  /**
   * Broadcast event to all connected clients
   */
  private broadcast(event: ReloadEvent): void {
    const message = JSON.stringify(event)

    for (const client of this.clients) {
      if (client.readyState === client.OPEN) {
        client.send(message)
      }
    }
  }

  /**
   * Send event to specific client
   */
  private sendToClient(client: WebSocket, event: ReloadEvent): void {
    if (client.readyState === client.OPEN) {
      client.send(JSON.stringify(event))
    }
  }

  /**
   * Close WebSocket server
   */
  async close(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.wss.close((error) => {
        if (error) {
          reject(error)
        } else {
          this.logger?.info('Live reload server closed')
          resolve()
        }
      })
    })
  }

  /**
   * Get number of connected clients
   */
  get clientCount(): number {
    return this.clients.size
  }
}
