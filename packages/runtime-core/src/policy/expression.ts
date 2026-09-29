import { ExpressionEvaluationError } from '../errors/domain-errors.js'

export type ExpressionNode =
  | { type: 'literal'; value: unknown }
  | { type: 'path'; path: string }
  | { type: 'array'; elements: ExpressionNode[] }
  | { type: 'unary'; operator: '!' | '-'; operand: ExpressionNode }
  | { type: 'binary'; operator: BinaryOperator; left: ExpressionNode; right: ExpressionNode }

type BinaryOperator =
  | '||' | '&&'
  | '==' | '!=' | '>' | '>=' | '<' | '<='
  | 'contains' | 'in'
  | '+' | '-' | '*' | '/' | '%'

export interface ExpressionContext {
  actor?: Record<string, unknown>
  record?: Record<string, unknown>
  input?: Record<string, unknown>
  workflow?: Record<string, unknown>
  now?: Date
}

interface Token {
  type: 'number' | 'string' | 'identifier' | 'operator' | 'punctuation' | 'eof'
  value: string
  offset: number
}

const BINARY_PRECEDENCE: Record<BinaryOperator, number> = {
  '||': 1,
  '&&': 2,
  '==': 3,
  '!=': 3,
  contains: 3,
  in: 3,
  '>': 4,
  '>=': 4,
  '<': 4,
  '<=': 4,
  '+': 5,
  '-': 5,
  '*': 6,
  '/': 6,
  '%': 6,
}

export function parseExpression(source: string): ExpressionNode {
  const parser = new ExpressionParser(tokenize(source), source)
  return parser.parse()
}

export function validateExpression(source: string): void {
  const ast = parseExpression(source)
  const allowedRoots = new Set(['actor', 'record', 'input', 'workflow', 'now'])
  for (const path of expressionPaths(ast)) {
    const root = path.split('.')[0]
    if (!root || !allowedRoots.has(root)) {
      throw new ExpressionEvaluationError(`Unknown expression root "${root ?? path}"`, {
        expression: source,
        path,
      })
    }
  }
}

export function evaluateExpression(
  expression: string | ExpressionNode,
  context: ExpressionContext,
): unknown {
  const ast = typeof expression === 'string' ? parseExpression(expression) : expression
  try {
    return evaluateNode(ast, { ...context, now: context.now ?? new Date() })
  } catch (error) {
    if (error instanceof ExpressionEvaluationError) throw error
    throw new ExpressionEvaluationError('Expression evaluation failed', undefined, { cause: error })
  }
}

export function expressionPaths(expression: string | ExpressionNode): string[] {
  const ast = typeof expression === 'string' ? parseExpression(expression) : expression
  const paths = new Set<string>()
  visit(ast, node => {
    if (node.type === 'path') paths.add(node.path)
  })
  return [...paths]
}

function visit(node: ExpressionNode, callback: (node: ExpressionNode) => void): void {
  callback(node)
  if (node.type === 'binary') {
    visit(node.left, callback)
    visit(node.right, callback)
  } else if (node.type === 'unary') {
    visit(node.operand, callback)
  } else if (node.type === 'array') {
    node.elements.forEach(element => visit(element, callback))
  }
}

function evaluateNode(node: ExpressionNode, context: ExpressionContext): unknown {
  if (node.type === 'literal') return node.value
  if (node.type === 'path') {
    if (node.path === 'now') return context.now
    return getPath(context as Record<string, unknown>, node.path)
  }
  if (node.type === 'array') return node.elements.map(element => evaluateNode(element, context))
  if (node.type === 'unary') {
    const value = evaluateNode(node.operand, context)
    return node.operator === '!' ? !toBoolean(value) : -toFiniteNumber(value)
  }

  if (node.operator === '&&') {
    const left = evaluateNode(node.left, context)
    return toBoolean(left) && toBoolean(evaluateNode(node.right, context))
  }
  if (node.operator === '||') {
    const left = evaluateNode(node.left, context)
    return toBoolean(left) || toBoolean(evaluateNode(node.right, context))
  }

  const left = evaluateNode(node.left, context)
  const right = evaluateNode(node.right, context)
  switch (node.operator) {
    case '==': return left === right
    case '!=': return left !== right
    case '>': return comparable(left) > comparable(right)
    case '>=': return comparable(left) >= comparable(right)
    case '<': return comparable(left) < comparable(right)
    case '<=': return comparable(left) <= comparable(right)
    case 'contains': return contains(left, right)
    case 'in': return contains(right, left)
    case '+':
      if (typeof left === 'string' || typeof right === 'string') return `${left ?? ''}${right ?? ''}`
      return toFiniteNumber(left) + toFiniteNumber(right)
    case '-': return toFiniteNumber(left) - toFiniteNumber(right)
    case '*': return toFiniteNumber(left) * toFiniteNumber(right)
    case '/': {
      const divisor = toFiniteNumber(right)
      if (divisor === 0) throw new ExpressionEvaluationError('Division by zero')
      return toFiniteNumber(left) / divisor
    }
    case '%': {
      const divisor = toFiniteNumber(right)
      if (divisor === 0) throw new ExpressionEvaluationError('Division by zero')
      return toFiniteNumber(left) % divisor
    }
  }
}

function getPath(root: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((current, part) => {
    if (Array.isArray(current)) {
      return current.flatMap(item => {
        if (item == null || typeof item !== 'object') return []
        const value = safeProperty(item as Record<string, unknown>, part)
        return Array.isArray(value) ? value : [value]
      }).filter(value => value !== undefined)
    }
    if (current == null || typeof current !== 'object') return undefined
    return safeProperty(current as Record<string, unknown>, part)
  }, root)
}

function safeProperty(value: Record<string, unknown>, key: string): unknown {
  if (key === '__proto__' || key === 'prototype' || key === 'constructor') return undefined
  return Object.prototype.hasOwnProperty.call(value, key) ? value[key] : undefined
}

function contains(collection: unknown, sought: unknown): boolean {
  if (Array.isArray(collection)) return collection.includes(sought)
  if (typeof collection === 'string' && typeof sought === 'string') return collection.includes(sought)
  return false
}

function comparable(value: unknown): string | number {
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
    const timestamp = Date.parse(value)
    if (Number.isFinite(timestamp)) return timestamp
  }
  if (typeof value === 'number' || typeof value === 'string') return value
  throw new ExpressionEvaluationError('Comparison operands must be numbers, strings, or timestamps')
}

function toFiniteNumber(value: unknown): number {
  const number = value instanceof Date ? value.getTime() : value
  if (typeof number !== 'number' || !Number.isFinite(number)) {
    throw new ExpressionEvaluationError('Arithmetic operands must be finite numbers or timestamps')
  }
  return number
}

function toBoolean(value: unknown): boolean {
  return value === true
}

class ExpressionParser {
  private index = 0

  constructor(private readonly tokens: Token[], private readonly source: string) {}

  parse(): ExpressionNode {
    if (this.peek().type === 'eof') this.fail('Expression cannot be empty')
    const expression = this.parseBinary(1)
    if (this.peek().type !== 'eof') this.fail(`Unexpected token "${this.peek().value}"`)
    return expression
  }

  private parseBinary(minPrecedence: number): ExpressionNode {
    let left = this.parseUnary()
    while (true) {
      const token = this.peek()
      const operator = token.value as BinaryOperator
      const precedence = token.type === 'operator' ? BINARY_PRECEDENCE[operator] : undefined
      if (precedence === undefined || precedence < minPrecedence) break
      this.index++
      const right = this.parseBinary(precedence + 1)
      left = { type: 'binary', operator, left, right }
    }
    return left
  }

  private parseUnary(): ExpressionNode {
    const token = this.peek()
    if (token.type === 'operator' && (token.value === '!' || token.value === '-')) {
      this.index++
      return { type: 'unary', operator: token.value, operand: this.parseUnary() }
    }
    return this.parsePrimary()
  }

  private parsePrimary(): ExpressionNode {
    const token = this.consume()
    if (token.type === 'number') return { type: 'literal', value: Number(token.value) }
    if (token.type === 'string') return { type: 'literal', value: token.value }
    if (token.type === 'identifier') {
      if (token.value === 'true') return { type: 'literal', value: true }
      if (token.value === 'false') return { type: 'literal', value: false }
      if (token.value === 'null') return { type: 'literal', value: null }
      return { type: 'path', path: token.value }
    }
    if (token.value === '(') {
      const expression = this.parseBinary(1)
      this.expect(')')
      return expression
    }
    if (token.value === '[') {
      const elements: ExpressionNode[] = []
      if (this.peek().value !== ']') {
        while (this.peek().value !== ']') {
          elements.push(this.parseBinary(1))
          if (this.peek().value !== ',') break
          this.index++
        }
      }
      this.expect(']')
      return { type: 'array', elements }
    }
    this.fail(`Expected a value, found "${token.value}"`, token)
  }

  private expect(value: string): void {
    if (this.peek().value !== value) this.fail(`Expected "${value}"`)
    this.index++
  }

  private peek(): Token {
    return this.tokens[this.index] ?? this.tokens[this.tokens.length - 1]!
  }

  private consume(): Token {
    const token = this.peek()
    this.index++
    return token
  }

  private fail(message: string, token = this.peek()): never {
    throw new ExpressionEvaluationError(`${message} at offset ${token.offset}`, {
      expression: this.source,
      offset: token.offset,
    })
  }
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = []
  let offset = 0
  while (offset < source.length) {
    const char = source[offset]!
    if (/\s/.test(char)) { offset++; continue }

    if (char === '"' || char === "'") {
      const quote = char
      const start = offset++
      let value = ''
      let closed = false
      while (offset < source.length) {
        const current = source[offset++]!
        if (current === quote) { closed = true; break }
        if (current === '\\') {
          const escaped = source[offset++]
          if (escaped === undefined) break
          const escapes: Record<string, string> = { n: '\n', r: '\r', t: '\t', '\\': '\\', '"': '"', "'": "'" }
          value += escapes[escaped] ?? escaped
        } else value += current
      }
      if (!closed) throw new ExpressionEvaluationError(`Unterminated string at offset ${start}`)
      tokens.push({ type: 'string', value, offset: start })
      continue
    }

    if (/\d/.test(char)) {
      const start = offset
      while (offset < source.length && /[\d.]/.test(source[offset]!)) offset++
      const value = source.slice(start, offset)
      if (!/^\d+(\.\d+)?$/.test(value)) {
        throw new ExpressionEvaluationError(`Invalid number "${value}" at offset ${start}`)
      }
      tokens.push({ type: 'number', value, offset: start })
      continue
    }

    if (/[A-Za-z_$]/.test(char)) {
      const start = offset
      while (offset < source.length && /[A-Za-z0-9_.$]/.test(source[offset]!)) offset++
      const value = source.slice(start, offset)
      tokens.push({
        type: value === 'contains' || value === 'in' ? 'operator' : 'identifier',
        value,
        offset: start,
      })
      continue
    }

    const pair = source.slice(offset, offset + 2)
    if (['&&', '||', '==', '!=', '>=', '<='].includes(pair)) {
      tokens.push({ type: 'operator', value: pair, offset })
      offset += 2
      continue
    }
    if (['!', '>', '<', '+', '-', '*', '/', '%'].includes(char)) {
      tokens.push({ type: 'operator', value: char, offset: offset++ })
      continue
    }
    if (['(', ')', '[', ']', ','].includes(char)) {
      tokens.push({ type: 'punctuation', value: char, offset: offset++ })
      continue
    }
    throw new ExpressionEvaluationError(`Unexpected character "${char}" at offset ${offset}`)
  }
  tokens.push({ type: 'eof', value: '', offset: source.length })
  return tokens
}
