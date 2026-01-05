import { Readable } from 'stream'

export interface TtsOptions {
  speed?: number // 语速，0.25-4.0
  rate?: number // 语速，0.25-4.0
  pitch?: number // 音调，-1.0 到 1.0
  volume?: number // 音量，0.0 到 1.0
  style?: string //  风格
  voice?: string // 音色名称
  format?: string // 音频格式
  language?: string // 语言代码，如 "en-US"
  stream?: boolean // 是否流式返回音频数据
  outputType?: string // buffer | stream | file
  output?: string // output path
  saveSubtitles?: boolean // saveSubtitles
}

export interface TTSEngine {
  name: string // 引擎名称
  synthesize(text: string, options: TtsOptions): Promise<Buffer | Readable> // 合成语音，返回音频 Buffer 或者 Readable
  getSupportedLanguages(): Promise<string[]> // 支持的语言列表
  getVoiceOptions?(): Promise<string[]> // 可选：支持的音色列表
  initialize?(): Promise<void> // 可选：初始化方法
}
