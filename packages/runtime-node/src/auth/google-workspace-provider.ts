/**
 * Google Workspace Auth Provider
 *
 * Implements domain-restricted Google OAuth for internal Zebric apps.
 */

import Database from 'better-sqlite3'
import { randomBytes, randomUUID } from 'node:crypto'
import type {
  AuthPresentationConfig,
  AuthProvider,
  GoogleWorkspaceClaimMapping,
  GoogleWorkspaceClaimMatch,
  PluginAuthToken,
  UserSession,
} from '@zebric/runtime-core'
import type { AuthProviderConfig } from './config.js'

interface GoogleUserInfo {
  sub: string
  email: string
  email_verified?: boolean
  name?: string
  hd?: string
  picture?: string
  [key: string]: any
}

interface StoredState {
  state: string
  callbackUrl: string
  expiresAt: number
}

interface StoredUserProfile {
  userId: string
  email: string
  name: string | null
  role: string
  roles: string[]
  groups: string[]
}

interface StoredSession extends StoredUserProfile {
  sessionId: string
  token: string
  createdAt: number
  expiresAt: number
}

export class GoogleWorkspaceAuthProvider implements AuthProvider {
  private db: Database.Database
  private baseURL: string
  private trustedOrigins: Set<string>
  private clientId: string
  private clientSecret: string
  private hostedDomain?: string
  private scopes: string[]
  private defaultRole: string
  private defaultGroups: string[]
  private adminEmails: Set<string>
  private roleMappings: GoogleWorkspaceClaimMapping[]
  private groupMappings: GoogleWorkspaceClaimMapping[]
  private sessionDurationSeconds: number
  private presentation: AuthPresentationConfig = {
    signInMode: 'redirect',
    signUpMode: 'disabled',
  }

  private readonly sessionCookieName = 'zebric.session_token'
  private readonly stateCookieName = 'zebric.oauth_state'
  private readonly callbackPath = '/api/auth/callback/google'

  constructor(config: AuthProviderConfig) {
    this.db = new Database(config.databaseUrl)
    this.baseURL = config.baseURL
    this.trustedOrigins = new Set(config.trustedOrigins)

    const googleConfig = config.blueprint.auth?.google || {}
    const clientIdEnv = googleConfig.clientIdEnv || 'GOOGLE_CLIENT_ID'
    const clientSecretEnv = googleConfig.clientSecretEnv || 'GOOGLE_CLIENT_SECRET'

    this.clientId = process.env[clientIdEnv] || ''
    this.clientSecret = process.env[clientSecretEnv] || ''
    this.hostedDomain = googleConfig.hostedDomain
    this.scopes = googleConfig.scopes?.length ? googleConfig.scopes : ['openid', 'email', 'profile']
    this.defaultRole = googleConfig.defaultRole || 'user'
    this.defaultGroups = googleConfig.defaultGroups || []
    this.adminEmails = new Set((googleConfig.adminEmails || []).map((email: string) => email.toLowerCase()))
    this.roleMappings = googleConfig.roleMappings || []
    this.groupMappings = googleConfig.groupMappings || []
    this.sessionDurationSeconds = config.blueprint.auth?.session?.duration || 60 * 60 * 24 * 7

    this.initializeSchema()
  }

  getProviderId(): string {
    return 'google-workspace'
  }

  getAuthInstance(): null {
    return null
  }

  getPresentationConfig(): AuthPresentationConfig {
    return this.presentation
  }

  getSignInUrl(callbackURL: string): string {
    return `/api/auth/sign-in/google?callbackURL=${encodeURIComponent(callbackURL || '/')}`
  }

  getSignUpUrl(_callbackURL: string): string | null {
    return null
  }

  async handleAuthRequest(request: Request): Promise<Response> {
    const url = new URL(request.url)

    switch (url.pathname) {
      case '/api/auth/sign-in/google':
        return this.beginSignIn(request)
      case this.callbackPath:
        return this.finishSignIn(request)
      case '/api/auth/sign-out':
        return this.signOut(request)
      case '/api/auth/session':
        return this.sessionInfo(request)
      default:
        return Response.json({ error: 'Auth route not found' }, { status: 404 })
    }
  }

  async getSession(request: Request): Promise<UserSession | null> {
    const token = this.extractToken(request)
    if (!token) {
      return null
    }

    const session = this.findSessionByToken(token)
    if (!session) {
      return null
    }

    if (session.expiresAt <= Date.now()) {
      await this.invalidateSession(token)
      return null
    }

    return {
      id: session.sessionId,
      userId: session.userId,
      user: {
        id: session.userId,
        email: session.email,
        name: session.name || undefined,
        role: session.role,
        roles: session.roles,
        groups: session.groups,
      },
      createdAt: new Date(session.createdAt),
      expiresAt: new Date(session.expiresAt),
    }
  }

  hasRole(session: UserSession | null, role: string): boolean {
    if (!session) return false
    const roles = Array.isArray((session.user as any).roles)
      ? (session.user as any).roles
      : [session.user.role].filter(Boolean)
    return roles.includes(role)
  }

  ownsResource(session: UserSession | null, resourceUserId: string): boolean {
    if (!session) return false
    return session.userId === resourceUserId
  }

  async createSession(userId: string, options?: { replaceToken?: string }): Promise<PluginAuthToken> {
    if (options?.replaceToken) {
      await this.invalidateSession(options.replaceToken)
    }

    const profile = this.findUserProfile(userId) || this.defaultProfileForUserId(userId)
    const session = this.insertSession(profile)
    return {
      id: session.sessionId,
      userId: session.userId,
      token: session.token,
      createdAt: new Date(session.createdAt),
      expiresAt: new Date(session.expiresAt),
    }
  }

  async invalidateSession(token: string): Promise<void> {
    this.db.prepare('DELETE FROM zebric_google_session WHERE token = ?').run(token)
  }

  async resolveUserFromToken(token: string): Promise<Record<string, any> | null> {
    const session = this.findSessionByToken(token)
    if (!session || session.expiresAt <= Date.now()) {
      return null
    }

    return {
      id: session.userId,
      email: session.email,
      name: session.name || undefined,
      role: session.role,
      roles: session.roles,
      groups: session.groups,
    }
  }

  async cleanup(): Promise<void> {
    this.db.close()
  }

  private initializeSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS zebric_google_user (
        user_id TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        name TEXT,
        role TEXT NOT NULL,
        roles_json TEXT,
        groups_json TEXT,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS zebric_google_session (
        session_id TEXT PRIMARY KEY,
        token TEXT NOT NULL UNIQUE,
        user_id TEXT NOT NULL,
        email TEXT NOT NULL,
        name TEXT,
        role TEXT NOT NULL,
        roles_json TEXT,
        groups_json TEXT,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS zebric_google_oauth_state (
        state TEXT PRIMARY KEY,
        callback_url TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      );
    `)

    this.ensureColumn('zebric_google_user', 'roles_json', 'TEXT')
    this.ensureColumn('zebric_google_user', 'groups_json', 'TEXT')
    this.ensureColumn('zebric_google_session', 'roles_json', 'TEXT')
    this.ensureColumn('zebric_google_session', 'groups_json', 'TEXT')
  }

  private async beginSignIn(request: Request): Promise<Response> {
    if (!this.clientId || !this.clientSecret) {
      return Response.json(
        { error: 'Google Workspace auth is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.' },
        { status: 500 }
      )
    }

    const requestUrl = new URL(request.url)
    const callbackURL = this.normalizeCallbackUrl(requestUrl.searchParams.get('callbackURL'))
    const state = randomBytes(24).toString('hex')
    const expiresAt = Date.now() + (10 * 60 * 1000)

    this.db.prepare(
      `INSERT INTO zebric_google_oauth_state (state, callback_url, expires_at)
       VALUES (?, ?, ?)`
    ).run(state, callbackURL, expiresAt)

    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: `${this.baseURL}${this.callbackPath}`,
      response_type: 'code',
      scope: this.scopes.join(' '),
      state,
      access_type: 'offline',
      include_granted_scopes: 'true',
      prompt: 'select_account',
    })
    if (this.hostedDomain) {
      params.set('hd', this.hostedDomain)
    }

    return new Response(null, {
      status: 302,
      headers: {
        Location: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
        'Set-Cookie': this.serializeCookie(this.stateCookieName, state, {
          httpOnly: true,
          maxAge: 10 * 60,
          path: '/',
          sameSite: 'Lax',
          secure: this.shouldUseSecureCookies(),
        }),
      },
    })
  }

  private async finishSignIn(request: Request): Promise<Response> {
    const requestUrl = new URL(request.url)
    const state = requestUrl.searchParams.get('state')
    const code = requestUrl.searchParams.get('code')
    const stateCookie = this.parseCookies(request.headers.get('cookie'))[this.stateCookieName]

    if (!state || !stateCookie || state !== stateCookie) {
      return this.redirectToSignIn('Invalid Google sign-in state.')
    }

    const storedState = this.db.prepare(
      'SELECT state, callback_url as callbackUrl, expires_at as expiresAt FROM zebric_google_oauth_state WHERE state = ?'
    ).get(state) as StoredState | undefined

    this.db.prepare('DELETE FROM zebric_google_oauth_state WHERE state = ?').run(state)

    if (!storedState || storedState.expiresAt <= Date.now()) {
      return this.redirectToSignIn('Google sign-in session expired. Please try again.')
    }

    if (!code) {
      return this.redirectToSignIn('Google did not return an authorization code.')
    }

    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: this.clientId,
        client_secret: this.clientSecret,
        redirect_uri: `${this.baseURL}${this.callbackPath}`,
        grant_type: 'authorization_code',
      }),
    })

    if (!tokenResponse.ok) {
      return this.redirectToSignIn('Google token exchange failed.')
    }

    const tokenPayload = await tokenResponse.json() as { access_token?: string }
    if (!tokenPayload.access_token) {
      return this.redirectToSignIn('Google did not return an access token.')
    }

    const userInfoResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: {
        Authorization: `Bearer ${tokenPayload.access_token}`,
      },
    })

    if (!userInfoResponse.ok) {
      return this.redirectToSignIn('Failed to load your Google profile.')
    }

    const userInfo = await userInfoResponse.json() as GoogleUserInfo
    const validationError = this.validateGoogleUser(userInfo)
    if (validationError) {
      return this.redirectToSignIn(validationError)
    }

    const profile = this.buildProfileFromGoogleUser(userInfo)
    this.upsertUserProfile(profile)

    const session = this.insertSession(profile)
    const headers = new Headers({ Location: storedState.callbackUrl })
    headers.append('Set-Cookie', this.serializeCookie(this.sessionCookieName, session.token, {
      httpOnly: true,
      maxAge: this.sessionDurationSeconds,
      path: '/',
      sameSite: 'Lax',
      secure: this.shouldUseSecureCookies(),
    }))
    headers.append('Set-Cookie', this.serializeCookie(this.stateCookieName, '', {
      httpOnly: true,
      maxAge: 0,
      path: '/',
      sameSite: 'Lax',
      secure: this.shouldUseSecureCookies(),
    }))

    return new Response(null, {
      status: 302,
      headers,
    })
  }

  private async signOut(request: Request): Promise<Response> {
    const token = this.extractToken(request)
    if (token) {
      await this.invalidateSession(token)
    }

    const callbackURL = this.normalizeCallbackUrl(new URL(request.url).searchParams.get('callbackURL'))
    return new Response(null, {
      status: 302,
      headers: {
        Location: callbackURL,
        'Set-Cookie': this.serializeCookie(this.sessionCookieName, '', {
          httpOnly: true,
          maxAge: 0,
          path: '/',
          sameSite: 'Lax',
          secure: this.shouldUseSecureCookies(),
        }),
      },
    })
  }

  private async sessionInfo(request: Request): Promise<Response> {
    const session = await this.getSession(request)
    if (!session) {
      return Response.json({ session: null }, { status: 401 })
    }
    return Response.json({ session })
  }

  private findUserProfile(userId: string): StoredUserProfile | null {
    const row = this.db.prepare(
      `SELECT user_id as userId, email, name, role, roles_json as rolesJson, groups_json as groupsJson
       FROM zebric_google_user
       WHERE user_id = ?`
    ).get(userId) as ({
      userId: string
      email: string
      name: string | null
      role: string
      rolesJson?: string | null
      groupsJson?: string | null
    }) | undefined

    return row ? this.inflateStoredProfile(row) : null
  }

  private defaultProfileForUserId(userId: string): StoredUserProfile {
    const normalized = userId.toLowerCase()
    const role = this.defaultRole
    return {
      userId: normalized,
      email: normalized.includes('@') ? normalized : `${normalized}@local.invalid`,
      name: null,
      role,
      roles: [role],
      groups: [...this.defaultGroups],
    }
  }

  private upsertUserProfile(profile: StoredUserProfile): void {
    this.db.prepare(
      `INSERT INTO zebric_google_user (user_id, email, name, role, roles_json, groups_json, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         email = excluded.email,
         name = excluded.name,
         role = excluded.role,
         roles_json = excluded.roles_json,
         groups_json = excluded.groups_json,
         updated_at = excluded.updated_at`
    ).run(
      profile.userId,
      profile.email,
      profile.name,
      profile.role,
      JSON.stringify(profile.roles),
      JSON.stringify(profile.groups),
      Date.now()
    )
  }

  private insertSession(profile: StoredUserProfile): StoredSession {
    const createdAt = Date.now()
    const expiresAt = createdAt + (this.sessionDurationSeconds * 1000)
    const sessionId = randomUUID()
    const token = randomBytes(32).toString('hex')

    this.db.prepare(
      `INSERT INTO zebric_google_session (
        session_id, token, user_id, email, name, role, roles_json, groups_json, created_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      sessionId,
      token,
      profile.userId,
      profile.email,
      profile.name,
      profile.role,
      JSON.stringify(profile.roles),
      JSON.stringify(profile.groups),
      createdAt,
      expiresAt
    )

    return {
      sessionId,
      token,
      userId: profile.userId,
      email: profile.email,
      name: profile.name,
      role: profile.role,
      roles: [...profile.roles],
      groups: [...profile.groups],
      createdAt,
      expiresAt,
    }
  }

  private findSessionByToken(token: string): StoredSession | null {
    const result = this.db.prepare(
      `SELECT
        session_id as sessionId,
        token,
        user_id as userId,
        email,
        name,
        role,
        roles_json as rolesJson,
        groups_json as groupsJson,
        created_at as createdAt,
        expires_at as expiresAt
      FROM zebric_google_session
      WHERE token = ?`
    ).get(token) as ({
      sessionId: string
      token: string
      userId: string
      email: string
      name: string | null
      role: string
      rolesJson?: string | null
      groupsJson?: string | null
      createdAt: number
      expiresAt: number
    }) | undefined

    if (!result) {
      return null
    }

    return {
      ...result,
      roles: this.parseStringArray(result.rolesJson, [result.role]),
      groups: this.parseStringArray(result.groupsJson, this.defaultGroups),
    }
  }

  private roleForEmail(email: string): string {
    return this.adminEmails.has(email.toLowerCase()) ? 'admin' : this.defaultRole
  }

  private buildProfileFromGoogleUser(user: GoogleUserInfo): StoredUserProfile {
    const normalizedEmail = user.email.toLowerCase()
    const mappedRoles = this.applyClaimMappings(this.roleMappings, user)
    const mappedGroups = this.applyClaimMappings(this.groupMappings, user)
    const baseRole = this.roleForEmail(normalizedEmail)
    const roles = mappedRoles.length > 0
      ? this.uniqueStrings([...(baseRole === 'admin' ? [baseRole] : []), ...mappedRoles])
      : [baseRole]
    const groups = this.uniqueStrings([...this.defaultGroups, ...mappedGroups])

    return {
      userId: normalizedEmail,
      email: normalizedEmail,
      name: user.name || null,
      role: roles[0] || this.defaultRole,
      roles,
      groups,
    }
  }

  private applyClaimMappings(mappings: GoogleWorkspaceClaimMapping[], user: GoogleUserInfo): string[] {
    const results: string[] = []
    for (const mapping of mappings) {
      const mode = mapping.mode || 'all'
      const matched = mode === 'any'
        ? mapping.when.some((match: GoogleWorkspaceClaimMatch) => this.matchesClaim(match, user))
        : mapping.when.every((match: GoogleWorkspaceClaimMatch) => this.matchesClaim(match, user))
      if (matched) {
        results.push(mapping.value)
      }
    }
    return this.uniqueStrings(results)
  }

  private matchesClaim(match: GoogleWorkspaceClaimMatch, user: GoogleUserInfo): boolean {
    const value = this.resolveClaim(user, match.claim)
    if (value === undefined || value === null) {
      return false
    }

    if (Array.isArray(value)) {
      return this.matchesArrayClaim(value, match)
    }

    const actual = String(value)
    if (match.equals !== undefined) {
      return actual === match.equals
    }
    if (match.oneOf?.length) {
      return match.oneOf.includes(actual)
    }
    if (match.endsWith !== undefined) {
      return actual.endsWith(match.endsWith)
    }
    if (match.contains !== undefined) {
      return actual.includes(match.contains)
    }
    if (match.regex !== undefined) {
      return new RegExp(match.regex).test(actual)
    }
    return false
  }

  private matchesArrayClaim(values: unknown[], match: GoogleWorkspaceClaimMatch): boolean {
    const normalized = values.map(value => String(value))
    if (match.equals !== undefined) {
      return normalized.includes(match.equals)
    }
    if (match.oneOf?.length) {
      return normalized.some(value => match.oneOf!.includes(value))
    }
    if (match.endsWith !== undefined) {
      return normalized.some(value => value.endsWith(match.endsWith!))
    }
    if (match.contains !== undefined) {
      return normalized.some(value => value.includes(match.contains!))
    }
    if (match.regex !== undefined) {
      const regex = new RegExp(match.regex)
      return normalized.some(value => regex.test(value))
    }
    return false
  }

  private resolveClaim(user: GoogleUserInfo, path: string): unknown {
    const segments = path.split('.').filter(Boolean)
    let current: unknown = user
    for (const segment of segments) {
      if (!current || typeof current !== 'object') {
        return undefined
      }
      current = (current as Record<string, unknown>)[segment]
    }
    return current
  }

  private inflateStoredProfile(row: {
    userId: string
    email: string
    name: string | null
    role: string
    rolesJson?: string | null
    groupsJson?: string | null
  }): StoredUserProfile {
    return {
      userId: row.userId,
      email: row.email,
      name: row.name,
      role: row.role,
      roles: this.parseStringArray(row.rolesJson, [row.role]),
      groups: this.parseStringArray(row.groupsJson, this.defaultGroups),
    }
  }

  private parseStringArray(serialized: string | null | undefined, fallback: string[] = []): string[] {
    if (!serialized) {
      return this.uniqueStrings(fallback)
    }

    try {
      const parsed = JSON.parse(serialized)
      if (Array.isArray(parsed)) {
        return this.uniqueStrings(parsed.map(value => String(value)))
      }
    } catch {
      return this.uniqueStrings(fallback)
    }

    return this.uniqueStrings(fallback)
  }

  private uniqueStrings(values: string[]): string[] {
    return Array.from(new Set(values.filter((value): value is string => Boolean(value && value.trim()))))
  }

  private ensureColumn(table: string, column: string, definition: string): void {
    try {
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (!message.includes('duplicate column name')) {
        throw error
      }
    }
  }

  private validateGoogleUser(user: GoogleUserInfo): string | null {
    if (!user.email) {
      return 'Google did not return an email address.'
    }

    if (user.email_verified === false) {
      return 'Google account email must be verified.'
    }

    const normalizedEmail = user.email.toLowerCase()
    if (this.hostedDomain) {
      const expected = this.hostedDomain.toLowerCase()
      const emailDomain = normalizedEmail.split('@')[1]
      const claimDomain = user.hd?.toLowerCase()
      if (emailDomain !== expected && claimDomain !== expected) {
        return `Only ${this.hostedDomain} accounts can sign in.`
      }
    }

    return null
  }

  private extractToken(request: Request): string | null {
    const authorization = request.headers.get('authorization')
    if (authorization?.toLowerCase().startsWith('bearer ')) {
      return authorization.slice(7)
    }

    const candidateHeaders = [
      'zbl-token',
      'x-api-token',
      'x-zbl-token',
      'x-plugin-token',
    ]

    for (const header of candidateHeaders) {
      const value = request.headers.get(header)
      if (value?.trim()) {
        return value.trim()
      }
    }

    const cookies = this.parseCookies(request.headers.get('cookie'))
    return cookies[this.sessionCookieName] || null
  }

  private parseCookies(cookieHeader: string | null): Record<string, string> {
    const cookies: Record<string, string> = {}
    if (!cookieHeader) {
      return cookies
    }

    for (const entry of cookieHeader.split(';')) {
      const [key, value] = entry.trim().split('=')
      if (key && value) {
        cookies[key] = decodeURIComponent(value)
      }
    }

    return cookies
  }

  private normalizeCallbackUrl(candidate: string | null): string {
    if (!candidate) {
      return '/'
    }

    if (candidate.startsWith('/') && !candidate.startsWith('//')) {
      return candidate
    }

    try {
      const parsed = new URL(candidate)
      if (this.trustedOrigins.has(parsed.origin)) {
        return parsed.toString()
      }
    } catch {
      return '/'
    }

    return '/'
  }

  private redirectToSignIn(message: string): Response {
    const location = `/auth/sign-in?message=${encodeURIComponent(message)}`
    return new Response(null, {
      status: 302,
      headers: {
        Location: location,
        'Set-Cookie': this.serializeCookie(this.stateCookieName, '', {
          httpOnly: true,
          maxAge: 0,
          path: '/',
          sameSite: 'Lax',
          secure: this.shouldUseSecureCookies(),
        }),
      },
    })
  }

  private shouldUseSecureCookies(): boolean {
    return this.baseURL.startsWith('https://') || process.env.NODE_ENV === 'production'
  }

  private serializeCookie(
    name: string,
    value: string,
    options: {
      httpOnly?: boolean
      maxAge?: number
      path?: string
      sameSite?: 'Lax' | 'Strict' | 'None'
      secure?: boolean
    }
  ): string {
    const parts = [`${name}=${encodeURIComponent(value)}`]
    parts.push(`Path=${options.path || '/'}`)
    if (typeof options.maxAge === 'number') {
      parts.push(`Max-Age=${Math.max(0, Math.floor(options.maxAge))}`)
    }
    if (options.httpOnly) {
      parts.push('HttpOnly')
    }
    if (options.sameSite) {
      parts.push(`SameSite=${options.sameSite}`)
    }
    if (options.secure) {
      parts.push('Secure')
    }
    return parts.join('; ')
  }
}
