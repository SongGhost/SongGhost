/**
 * Web Audio telephone-band EQ for call-in / voicemail playback.
 * Classic mobile-speaker band: ~300 Hz–3400 Hz with a light presence boost.
 */

const HP_HZ = 300;
const LP_HZ = 3400;
/** Subtle lift so the bandpassed voice still reads like a phone speaker. */
const PHONE_GAIN = 1.35;

export type TelephoneEQChain = {
  /** High-pass entry — connect the source here. */
  input: BiquadFilterNode;
  /** Output gain — connect this to the destination / mix bus. */
  output: GainNode;
  highpass: BiquadFilterNode;
  lowpass: BiquadFilterNode;
  boost: GainNode;
};

/**
 * Wire a telephone bandpass after `sourceNode` and return the filter chain.
 *
 * Graph: source → highpass(300 Hz) → lowpass(3400 Hz) → boost → (caller connects output)
 */
export function applyTelephoneEQ(
  audioContext: AudioContext | BaseAudioContext,
  sourceNode: AudioNode,
): TelephoneEQChain {
  const highpass = audioContext.createBiquadFilter();
  highpass.type = "highpass";
  highpass.frequency.value = HP_HZ;
  highpass.Q.value = Math.SQRT1_2;

  const lowpass = audioContext.createBiquadFilter();
  lowpass.type = "lowpass";
  lowpass.frequency.value = Math.min(LP_HZ, audioContext.sampleRate / 2 - 1);
  lowpass.Q.value = Math.SQRT1_2;

  const boost = audioContext.createGain();
  boost.gain.value = PHONE_GAIN;

  sourceNode.connect(highpass);
  highpass.connect(lowpass);
  lowpass.connect(boost);

  return {
    input: highpass,
    output: boost,
    highpass,
    lowpass,
    boost,
  };
}
