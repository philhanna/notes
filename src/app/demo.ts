import type { JsonValue } from '../domain/types'

export const demoDocument: Record<string, JsonValue> = {
  Welcome: 'Select a value to edit it, or open a container to browse.',
  Examples: {
    Boolean: true,
    Number: 42,
    Empty: null,
    List: ['Array entries', 'can be reordered'],
  },
}
