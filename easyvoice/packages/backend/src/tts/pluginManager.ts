import { TTSEngine } from './types'

export class TtsPluginManager {
  private engines: Map<string, TTSEngine> = new Map()

  registerEngine(engine: TTSEngine) {
    this.engines.set(engine.name, engine)
  }

  async initializeEngines() {
    for (const engine of this.engines.values()) {
      if (engine.initialize) {
        try {
          await engine.initialize()
        } catch (error) {
          console.error(`Failed to initialize engine ${engine.name}:`, error)
          this.engines.has(engine.name) && this.engines.delete(engine.name)
        }
      }
    }
  }

  getEngine(name: string): TTSEngine | undefined {
    return this.engines.get(name)
  }

  getAllEngines(): TTSEngine[] {
    return Array.from(this.engines.values())
  }
}

export const ttsPluginManager = new TtsPluginManager()
