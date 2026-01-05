import { createApp } from './app'
import { AUDIO_DIR, PUBLIC_DIR, RATE_LIMIT, RATE_LIMIT_WINDOW, PORT } from './config'
import { ttsPluginManager } from './tts/pluginManager'

const app = createApp({
  isDev: process.env.NODE_ENV === 'development',
  rateLimit: RATE_LIMIT,
  rateLimitWindow: RATE_LIMIT_WINDOW,
  audioDir: AUDIO_DIR,
  publicDir: PUBLIC_DIR,
})

app.listen(PORT, async () => {
  await ttsPluginManager.initializeEngines()
  console.log(`Server running on port ${PORT}`)
})
