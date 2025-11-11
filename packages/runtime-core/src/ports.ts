/**
 * Platform Ports
 *
 * Defines the interfaces that platform adapters must implement.
 * All interfaces use Web API types (Request, Response, ReadableStream, etc.)
 * to ensure platform compatibility.
 */

// =============================================================================
// Database / Storage Port
// =============================================================================

export interface StoragePort {
  /**
   * Execute a SQL query and return rows
   */
  query<T = unknown>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;

  /**
   * Execute a transaction
   */
  transaction<T>(fn: (tx: StoragePort) => Promise<T>): Promise<T>;

  /**
   * Run database migrations
   */
  migrate(statements: string[]): Promise<void>;

  /**
   * Check if database connection is healthy
   */
  healthCheck(): Promise<boolean>;

  /**
   * Close database connection
   */
  close(): Promise<void>;
}

// =============================================================================
// Key-Value Store Port
// =============================================================================

export interface KVPort {
  /**
   * Get a value by key
   */
  get(key: string): Promise<string | null>;

  /**
   * Set a value with optional expiration
   */
  put(
    key: string,
    value: string,
    opts?: { expiration?: number; metadata?: Record<string, unknown> }
  ): Promise<void>;

  /**
   * Delete a key
   */
  delete(key: string): Promise<void>;

  /**
   * Check if a key exists
   */
  exists?(key: string): Promise<boolean>;

  /**
   * Increment a counter (for rate limiting, etc.)
   */
  incr?(key: string): Promise<number>;

  /**
   * Clear all keys (dev/test only)
   */
  clear?(): Promise<void>;
}

// =============================================================================
// Blob Storage Port (Files, Images, etc.)
// =============================================================================

export interface BlobPort {
  /**
   * Get a blob as a ReadableStream
   */
  get(key: string): Promise<ReadableStream | null>;

  /**
   * Store a blob
   */
  put(
    key: string,
    body: ReadableStream | ArrayBuffer | Uint8Array | string,
    opts?: { contentType?: string; metadata?: Record<string, unknown> }
  ): Promise<void>;

  /**
   * Delete a blob
   */
  delete(key: string): Promise<void>;

  /**
   * List blobs by prefix
   */
  list?(prefix?: string): Promise<BlobMetadata[]>;

  /**
   * Get blob metadata without downloading content
   */
  head?(key: string): Promise<BlobMetadata | null>;
}

export interface BlobMetadata {
  key: string;
  size: number;
  contentType?: string;
  uploaded: Date;
  metadata?: Record<string, unknown>;
}

// =============================================================================
// Queue Port (Background Jobs)
// =============================================================================

export interface QueuePort<T = unknown> {
  /**
   * Send a message to the queue
   */
  send(message: T, opts?: { delaySeconds?: number }): Promise<void>;

  /**
   * Receive messages from the queue (pull-based)
   */
  receive?(opts?: { maxMessages?: number; waitTimeSeconds?: number }): Promise<QueueMessage<T>[]>;

  /**
   * Acknowledge message processing (delete from queue)
   */
  ack?(messageId: string): Promise<void>;

  /**
   * Return message to queue (requeue for retry)
   */
  nack?(messageId: string): Promise<void>;
}

export interface QueueMessage<T = unknown> {
  id: string;
  body: T;
  receiptHandle?: string;
  retryCount?: number;
}

// =============================================================================
// WebSocket Port
// =============================================================================

export interface WebSocketPort {
  /**
   * Upgrade an HTTP request to WebSocket
   * Returns null if upgrade fails
   */
  upgrade(req: Request): { socket: WebSocket; response: Response } | null;

  /**
   * Send data through a WebSocket
   */
  send(socket: WebSocket, data: string | ArrayBuffer | Uint8Array): void;

  /**
   * Close a WebSocket connection
   */
  close(socket: WebSocket, code?: number, reason?: string): void;

  /**
   * Add event listener to WebSocket
   */
  on?(socket: WebSocket, event: 'message' | 'close' | 'error', handler: (data: any) => void): void;
}

// =============================================================================
// Authentication Port
// =============================================================================

export interface AuthPort {
  /**
   * Sign a JWT token with payload
   */
  sign(payload: Record<string, unknown>, expiresIn?: number): Promise<string>;

  /**
   * Verify a JWT token and return payload
   */
  verify(token: string): Promise<Record<string, unknown> | null>;

  /**
   * Get a cookie value from request
   */
  getCookie(req: Request, name: string): string | undefined;

  /**
   * Set a cookie in response headers
   */
  setCookie(
    headers: Headers,
    name: string,
    value: string,
    opts?: CookieOptions
  ): void;

  /**
   * Hash a password (for user registration)
   */
  hashPassword?(password: string): Promise<string>;

  /**
   * Verify a password against a hash
   */
  verifyPassword?(password: string, hash: string): Promise<boolean>;
}

export interface CookieOptions {
  maxAge?: number;
  expires?: Date;
  path?: string;
  domain?: string;
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: 'strict' | 'lax' | 'none';
}

// =============================================================================
// Audit Logging Port
// =============================================================================

export interface AuditPort {
  /**
   * Log an audit event
   */
  log(event: AuditEvent): Promise<void>;

  /**
   * Query audit logs (optional, depends on implementation)
   */
  query?(filters: AuditFilters): Promise<AuditEvent[]>;
}

export interface AuditEvent {
  id: string;
  timestamp: number;
  userId?: string;
  sessionId?: string;
  action: string;
  entity?: string;
  entityId?: string;
  changes?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}

export interface AuditFilters {
  userId?: string;
  action?: string;
  entity?: string;
  startDate?: number;
  endDate?: number;
  limit?: number;
}

// =============================================================================
// File System Port (Node.js only - for blueprint loading)
// =============================================================================

export interface FileSystemPort {
  /**
   * Read a file as text
   */
  readFile(path: string): Promise<string>;

  /**
   * Write text to a file
   */
  writeFile(path: string, content: string): Promise<void>;

  /**
   * Check if a file exists
   */
  exists(path: string): Promise<boolean>;

  /**
   * Watch a file for changes (optional, for hot reload)
   */
  watch?(path: string, callback: () => void): () => void;
}

// =============================================================================
// Platform Aggregation
// =============================================================================

export interface Platform {
  /**
   * Database/SQL storage
   */
  storage?: StoragePort;

  /**
   * Key-value store (cache, sessions, etc.)
   */
  kv?: KVPort;

  /**
   * Blob storage (files, images, etc.)
   */
  blob?: BlobPort;

  /**
   * Background job queue
   */
  queue?: QueuePort;

  /**
   * WebSocket support
   */
  ws?: WebSocketPort;

  /**
   * Authentication (JWT, sessions, etc.)
   */
  auth?: AuthPort;

  /**
   * Audit logging
   */
  audit?: AuditPort;

  /**
   * File system access (Node.js only)
   */
  fs?: FileSystemPort;
}

// =============================================================================
// HTTP Adapter Interface
// =============================================================================

export interface HttpAdapter {
  /**
   * Handle an HTTP request and return a response
   * Uses Web API Request/Response for platform compatibility
   */
  handleFetch(req: Request, env?: unknown, ctx?: unknown): Promise<Response>;
}

// =============================================================================
// Runtime Configuration
// =============================================================================

export interface RuntimeConfig {
  /**
   * Platform implementation
   */
  platform: Platform;

  /**
   * Environment (development, production, etc.)
   */
  env?: 'development' | 'production' | 'test';

  /**
   * Enable debug logging
   */
  debug?: boolean;

  /**
   * Graceful shutdown timeout (ms)
   */
  shutdownTimeout?: number;
}
