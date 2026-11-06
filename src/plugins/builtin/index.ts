import type { Plugin } from '../types'
import { syncPlugin } from './sync'

/** Plugins that ship with the app. They use the same API as installed plugins. */
export const builtinPlugins: Plugin[] = [syncPlugin]
