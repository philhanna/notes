export type JsonScalar = string | number | boolean | null
export type JsonValue = JsonScalar | JsonValue[] | { [key: string]: JsonValue }
export type PathSegment = string | number
export type JsonPath = readonly PathSegment[]

export type DomainErrorCode = 'invalid-path' | 'invalid-key' | 'duplicate-key' | 'invalid-destination' | 'cycle' | 'confirmation-required'
export class DomainError extends Error {
  constructor(public readonly code: DomainErrorCode, message: string) { super(message); this.name = 'DomainError' }
}

export const isObject = (value: JsonValue): value is Record<string, JsonValue> => typeof value === 'object' && value !== null && !Array.isArray(value)
export const valueType = (value: JsonValue) => value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value === 'object' ? 'object' : typeof value
export const clone = <T extends JsonValue>(value: T): T => structuredClone(value)
