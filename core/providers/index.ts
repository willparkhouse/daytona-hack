/**
 * Provider factory — one line to swap the whole game between local dirs and Daytona.
 * Default is `local`: no cloud, no keys, deterministic.
 */
import type { SandboxProvider } from '../types'
import { LocalProvider } from './local'
import { DaytonaProvider } from './daytona'

export { LocalProvider } from './local'
export { DaytonaProvider } from './daytona'

export type ProviderName = 'local' | 'daytona'

export function makeProvider(name: ProviderName): SandboxProvider {
  switch (name) {
    case 'local':
      return new LocalProvider()
    case 'daytona':
      return new DaytonaProvider()
    default: {
      const _exhaustive: never = name
      throw new Error(`unknown provider: ${String(_exhaustive)}`)
    }
  }
}
