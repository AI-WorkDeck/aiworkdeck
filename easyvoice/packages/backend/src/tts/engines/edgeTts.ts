import { Readable } from 'stream'
import { EdgeTTS } from '../../lib/node-edge-tts/edge-tts-fixed'
import { TTSEngine, TtsOptions } from '../types'
import path from 'path'

export class EdgeTtsEngine implements TTSEngine {
  name = 'edge-tts'

  async synthesize(text: string, options: TtsOptions): Promise<Buffer | Readable> {
    const {
      speed = 1.0,
      voice = 'en-US-AriaNeural',
      pitch,
      rate,
      volume,
      stream,
      outputType,
      saveSubtitles,
      output,
    } = options
    let finaleType = outputType ? outputType : stream ? 'stream' : 'buffer'
    const lang = /([a-zA-Z]{2,5}-[a-zA-Z]{2,5}\b)/.exec(voice)?.[1]
    const tts = new EdgeTTS({
      voice,
      lang,
      outputFormat: 'audio-24khz-96kbitrate-mono-mp3',
      saveSubtitles,
      timeout: 30_000,
    })
    console.log(`run with nodejs edge-tts service...`)
    const bufferOrStream = await tts.ttsPromise(text, {
      outputType: finaleType as any,
      audioPath: output,
    })
    return bufferOrStream instanceof Buffer ? bufferOrStream : (bufferOrStream as Readable)
  }

  async getSupportedLanguages(): Promise<string[]> {
    return ['en-US', 'zh-CN', 'fr-FR', 'de-DE']
  }

  async getVoiceOptions(): Promise<string[]> {
    return [
      'en-AU-NatashaNeural',
      'en-AU-WilliamNeural',
      'en-CA-ClaraNeural',
      'en-CA-LiamNeural',
      'en-GB-LibbyNeural',
      'en-GB-MaisieNeural',
      'en-GB-RyanNeural',
      'en-GB-SoniaNeural',
      'en-GB-ThomasNeural',
      'en-HK-SamNeural',
      'en-HK-YanNeural',
      'en-IE-ConnorNeural',
      'en-IE-EmilyNeural',
      'en-IN-NeerjaExpressiveNeural',
      'en-IN-NeerjaNeural',
      'en-IN-PrabhatNeural',
      'en-KE-AsiliaNeural',
      'en-KE-ChilembaNeural',
      'en-NG-AbeoNeural',
      'en-NG-EzinneNeural',
      'en-NZ-MitchellNeural',
      'en-NZ-MollyNeural',
      'en-PH-JamesNeural',
      'en-PH-RosaNeural',
      'en-SG-LunaNeural',
      'en-SG-WayneNeural',
      'en-TZ-ElimuNeural',
      'en-TZ-ImaniNeural',
      'en-US-AnaNeural',
      'en-US-AndrewMultilingualNeural',
      'en-US-AndrewNeural',
      'en-US-AriaNeural',
      'en-US-AvaMultilingualNeural',
      'en-US-AvaNeural',
      'en-US-BrianMultilingualNeural',
      'en-US-BrianNeural',
      'en-US-ChristopherNeural',
      'en-US-EmmaMultilingualNeural',
      'en-US-EmmaNeural',
      'en-US-EricNeural',
      'en-US-GuyNeural',
      'en-US-JennyNeural',
      'en-US-MichelleNeural',
      'en-US-RogerNeural',
      'en-US-SteffanNeural',
      'en-ZA-LeahNeural',
      'en-ZA-LukeNeural',
      'zh-CN-XiaoxiaoNeural',
      'zh-CN-XiaoyiNeural',
      'zh-CN-YunjianNeural',
      'zh-CN-YunxiNeural',
      'zh-CN-YunxiaNeural',
      'zh-CN-YunyangNeural',
      'zh-CN-liaoning-XiaobeiNeural',
      'zh-CN-shaanxi-XiaoniNeural',
      'zh-HK-HiuGaaiNeural',
      'zh-HK-HiuMaanNeural',
      'zh-HK-WanLungNeural',
      'zh-TW-HsiaoChenNeural',
      'zh-TW-HsiaoYuNeural',
      'zh-TW-YunJheNeural',
    ]
  }
}

if (require.main === module) {
  ;(async function test() {
    const ttsEngine = new EdgeTtsEngine()
    const voices = await ttsEngine.getVoiceOptions()
    console.log('Available voices:', voices)

    const text = `
The Lantern in the Woods
In a small village nestled between rolling hills and a dense forest, there lived an old woman named Elara. She was known for her peculiar habit of wandering into the woods every night, carrying a glowing lantern. The villagers whispered about her—some said she was a witch, others believed she was searching for a lost treasure. But no one dared to follow her.
One autumn evening, a curious boy named Finn decided to uncover the truth. As the sun dipped below the horizon, he watched Elara shuffle toward the trees, her lantern casting a warm golden light. Finn grabbed his coat and followed at a distance, his heart pounding with excitement and fear.
The forest was alive with sounds—crickets chirping, leaves rustling in the wind—but Elara moved with purpose, her steps steady. Finn struggled to keep up, ducking under branches and tripping over roots. The lantern’s light bobbed ahead like a guiding star. After what felt like hours, Elara stopped in a small clearing. Finn hid behind a tree, peering out.
In the center of the clearing stood an ancient oak, its gnarled branches stretching toward the sky. Elara hung her lantern on a low branch, and to Finn’s astonishment, the tree began to glow faintly. Tiny lights, like fireflies, emerged from the bark, swirling around the lantern. The air hummed with a soft, melodic sound, and Finn felt a strange warmth wash over him.
Elara knelt before the tree and whispered something Finn couldn’t hear. The lights danced faster, then spiraled upward, vanishing into the night sky. She stood, retrieved her lantern, and turned back toward the village. Finn stayed hidden until she was gone, then crept toward the oak. The glow had faded, but the tree felt alive, its trunk warm to the touch.
The next day, Finn couldn’t resist telling his friends what he’d seen. They laughed, calling it a wild tale, but that night, he returned to the clearing alone. The oak stood silent, no lights, no hum. Disappointed, he sat beneath it, wondering if he’d imagined everything. Then, a faint glow flickered in the branches above. A single light floated down, hovering before him. It pulsed, as if alive, and Finn felt a whisper in his mind: “Keep it safe.”
Startled, he ran home, the words echoing in his ears. From then on, Finn visited the oak often, though the lights never returned. He never saw Elara go back either—she passed away that winter, her lantern left on her porch. The villagers forgot her strange walks, but Finn didn’t. Years later, as an old man, he hung a lantern on that same oak every autumn, hoping the lights would dance again. They never did, but the warmth remained—a quiet secret between him and the woods.
    `
    const fs = await import('fs/promises')
    const path = await import('path')
    const audioBuffer = (await ttsEngine.synthesize(`This is a direct test ` + text, {
      voice: 'en-US-AnaNeural',
      speed: 1,
      stream: false,
      outputType: 'buffer',
    })) as Buffer
    console.log('Audio buffer:', audioBuffer)
    await fs.writeFile(path.resolve(__dirname, './edge_test.mp3'), audioBuffer)
    console.log('Test audio audioBuffer saved to test.mp3')

    const audioStream = (await ttsEngine.synthesize('This is a streaming test.' + text, {
      voice: 'en-US-AvaNeural',
      speed: 1.0,
      stream: true,
    })) as Readable
    console.log('Streaming audio...')
    audioStream.pipe(
      require('fs').createWriteStream(path.resolve(__dirname, './edge_test_stream.mp3'))
    )
    audioStream.on('close', () => {
      console.log('Test audio audioStream saved to test_stream.mp3')
    })
  })()
}
