// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

const tag = (view, offset) => String.fromCharCode(...new Uint8Array(view.buffer, view.byteOffset + offset, 4))

export function readPcmWav(buffer) {
  const bytes = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : buffer
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 44) throw new Error('Invalid WAV header')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (tag(view, 0) !== 'RIFF' || tag(view, 8) !== 'WAVE') throw new Error('Expected WAV audio')
  const end = view.getUint32(4, true) + 8
  if (end > bytes.byteLength || end < 44) throw new Error('Truncated WAV audio')
  let format
  const data = []
  for (let offset = 12; offset < end;) {
    if (offset + 8 > end) throw new Error('Truncated WAV chunk')
    const id = tag(view, offset)
    const size = view.getUint32(offset + 4, true)
    const start = offset + 8
    if (start + size > end) throw new Error('Truncated WAV chunk')
    if (id === 'fmt ') {
      if (size < 16) throw new Error('Invalid WAV format')
      format = {
        encoding: view.getUint16(start, true), channels: view.getUint16(start + 2, true),
        sampleRate: view.getUint32(start + 4, true), byteRate: view.getUint32(start + 8, true),
        blockAlign: view.getUint16(start + 12, true), bits: view.getUint16(start + 14, true)
      }
    } else if (id === 'data') data.push(bytes.subarray(start, start + size))
    offset = start + size + (size % 2)
  }
  if (!format || ![1, 3].includes(format.encoding) || !format.channels || !format.sampleRate ||
      ![8, 16, 24, 32].includes(format.bits) || (format.encoding === 3 && format.bits !== 32) ||
      format.blockAlign !== format.channels * format.bits / 8 ||
      format.byteRate !== format.sampleRate * format.blockAlign) throw new Error('Unsupported WAV format')
  if (!data.length || data.some(part => !part.length || part.length % format.blockAlign)) throw new Error('Invalid WAV samples')
  return { format, data }
}

/** Combine PCM samples, not RIFF files. The export keeps the original synthesis rate (1x). */
export function mergePcmWavs(buffers) {
  if (!buffers.length) throw new Error('No audio to export')
  const waves = buffers.map(readPcmWav)
  const format = waves[0].format
  if (waves.some(wav => Object.keys(format).some(key => wav.format[key] !== format[key]))) throw new Error('WAV formats differ')
  const parts = waves.flatMap(wav => wav.data)
  const size = parts.reduce((sum, part) => sum + part.length, 0)
  if (size > 0xffffffff - 36) throw new Error('WAV export is too large')
  const result = new ArrayBuffer(44 + size + size % 2)
  const view = new DataView(result)
  const bytes = new Uint8Array(result)
  const writeTag = (offset, value) => [...value].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)))
  writeTag(0, 'RIFF'); view.setUint32(4, result.byteLength - 8, true); writeTag(8, 'WAVE')
  writeTag(12, 'fmt '); view.setUint32(16, 16, true)
  view.setUint16(20, format.encoding, true); view.setUint16(22, format.channels, true)
  view.setUint32(24, format.sampleRate, true); view.setUint32(28, format.byteRate, true)
  view.setUint16(32, format.blockAlign, true); view.setUint16(34, format.bits, true)
  writeTag(36, 'data'); view.setUint32(40, size, true)
  let offset = 44
  for (const part of parts) { bytes.set(part, offset); offset += part.length }
  return result
}
