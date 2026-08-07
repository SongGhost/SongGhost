/**
 * Telephone-style bandpass (≈300 Hz–3400 Hz) for SongHost Studio call-in clips.
 *
 * Applies cascaded biquad high-pass + low-pass on 16-bit mono/stereo WAV PCM.
 * Non-WAV uploads pass through unchanged (MediaRecorder webm/mp4 need a decoder).
 */

const HP_HZ = 300;
const LP_HZ = 3400;

type BiquadCoeffs = {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
};

type BiquadState = { z1: number; z2: number };

function highpassCoeffs(sampleRate: number, freq: number): BiquadCoeffs {
  const w0 = (2 * Math.PI * freq) / sampleRate;
  const cos = Math.cos(w0);
  const sin = Math.sin(w0);
  const alpha = sin / (2 * Math.SQRT1_2);
  const a0 = 1 + alpha;
  return {
    b0: ((1 + cos) / 2) / a0,
    b1: (-(1 + cos)) / a0,
    b2: ((1 + cos) / 2) / a0,
    a1: (-2 * cos) / a0,
    a2: (1 - alpha) / a0,
  };
}

function lowpassCoeffs(sampleRate: number, freq: number): BiquadCoeffs {
  const w0 = (2 * Math.PI * freq) / sampleRate;
  const cos = Math.cos(w0);
  const sin = Math.sin(w0);
  const alpha = sin / (2 * Math.SQRT1_2);
  const a0 = 1 + alpha;
  return {
    b0: ((1 - cos) / 2) / a0,
    b1: (1 - cos) / a0,
    b2: ((1 - cos) / 2) / a0,
    a1: (-2 * cos) / a0,
    a2: (1 - alpha) / a0,
  };
}

function processBiquad(
  input: Float32Array,
  coeffs: BiquadCoeffs,
  state: BiquadState,
): Float32Array {
  const out = new Float32Array(input.length);
  let { z1, z2 } = state;
  const { b0, b1, b2, a1, a2 } = coeffs;
  for (let i = 0; i < input.length; i++) {
    const x = input[i]!;
    const y = b0 * x + z1;
    z1 = b1 * x - a1 * y + z2;
    z2 = b2 * x - a2 * y;
    out[i] = y;
  }
  state.z1 = z1;
  state.z2 = z2;
  return out;
}

function readAscii(buf: Buffer, offset: number, len: number): string {
  return buf.toString("ascii", offset, offset + len);
}

function isWavBuffer(buf: Buffer): boolean {
  return (
    buf.length >= 44 &&
    readAscii(buf, 0, 4) === "RIFF" &&
    readAscii(buf, 8, 4) === "WAVE"
  );
}

function findChunk(
  buf: Buffer,
  id: string,
): { offset: number; size: number } | null {
  let offset = 12;
  while (offset + 8 <= buf.length) {
    const chunkId = readAscii(buf, offset, 4);
    const size = buf.readUInt32LE(offset + 4);
    const dataOffset = offset + 8;
    if (chunkId === id) {
      return { offset: dataOffset, size };
    }
    offset = dataOffset + size + (size % 2);
  }
  return null;
}

/**
 * Apply telephone bandpass when the payload is 16-bit PCM WAV.
 * Returns `{ buffer, applied }` so callers can report processing status.
 */
export function applyTelephoneBandpass(buffer: Buffer): {
  buffer: Buffer;
  applied: boolean;
} {
  if (!isWavBuffer(buffer)) {
    return { buffer, applied: false };
  }

  const fmt = findChunk(buffer, "fmt ");
  const data = findChunk(buffer, "data");
  if (!fmt || !data || fmt.size < 16) {
    return { buffer, applied: false };
  }

  const audioFormat = buffer.readUInt16LE(fmt.offset);
  const numChannels = buffer.readUInt16LE(fmt.offset + 2);
  const sampleRate = buffer.readUInt32LE(fmt.offset + 4);
  const bitsPerSample = buffer.readUInt16LE(fmt.offset + 14);

  if (audioFormat !== 1 || bitsPerSample !== 16 || numChannels < 1) {
    return { buffer, applied: false };
  }

  const sampleCount = Math.floor(data.size / 2);
  const samples = new Float32Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    samples[i] = buffer.readInt16LE(data.offset + i * 2) / 32768;
  }

  const hp = highpassCoeffs(sampleRate, HP_HZ);
  const lp = lowpassCoeffs(sampleRate, Math.min(LP_HZ, sampleRate / 2 - 1));

  // Process each channel independently.
  const filtered = new Float32Array(sampleCount);
  for (let ch = 0; ch < numChannels; ch++) {
    const channel = new Float32Array(Math.floor(sampleCount / numChannels));
    for (let i = 0, j = ch; j < sampleCount; i++, j += numChannels) {
      channel[i] = samples[j]!;
    }
    const hpState: BiquadState = { z1: 0, z2: 0 };
    const lpState: BiquadState = { z1: 0, z2: 0 };
    const afterHp = processBiquad(channel, hp, hpState);
    const afterLp = processBiquad(afterHp, lp, lpState);
    for (let i = 0, j = ch; j < sampleCount; i++, j += numChannels) {
      filtered[j] = afterLp[i]!;
    }
  }

  const out = Buffer.from(buffer);
  for (let i = 0; i < sampleCount; i++) {
    const clamped = Math.max(-1, Math.min(1, filtered[i]!));
    out.writeInt16LE((clamped * 32767) | 0, data.offset + i * 2);
  }

  return { buffer: out, applied: true };
}
