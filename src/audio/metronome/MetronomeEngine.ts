import { ClickRenderer } from './ClickRenderer';

export class MetronomeEngine {
  private audioContext: AudioContext;
  private node: AudioWorkletNode | null = null;
  private initialized = false;

  constructor(audioContext: AudioContext) {
    this.audioContext = audioContext;
  }

  async init(gain: number): Promise<void> {
    if (this.initialized) return;
    await this.audioContext.audioWorklet.addModule('/worklets/metronome.worklet.js');
    this.node = new AudioWorkletNode(this.audioContext, 'metronome-processor');
    this.node.connect(this.audioContext.destination);

    this.loadSamples(gain);
    this.initialized = true;
  }

  private loadSamples(gain: number): void {
    if (!this.node) return;
    const sampleRate = this.audioContext.sampleRate;
    const downbeat = ClickRenderer.render(1500, 0.05, sampleRate, gain);
    const offbeat = ClickRenderer.render(1000, 0.05, sampleRate, gain);
    this.node.port.postMessage(
      { type: 'SET_CLICK_SOUNDS', downbeat, offbeat },
      [downbeat.buffer, offbeat.buffer]
    );
  }

  reloadSamples(gain: number): void {
    this.loadSamples(gain);
  }

  updateConfig(config: { bpm?: number; timeSignature?: [number, number]; isPlaying?: boolean }): void {
    if (!this.node) return;
    if (config.bpm !== undefined) {
      this.node.port.postMessage({ type: 'SET_TEMPO', bpm: config.bpm });
    }
    if (config.timeSignature !== undefined) {
      this.node.port.postMessage({ type: 'SET_SIGNATURE', beatsPerBar: config.timeSignature[0] });
    }
    if (config.isPlaying !== undefined) {
      this.node.port.postMessage({ type: 'ENABLE', enabled: config.isPlaying });
    }
  }

  resetToFrame(frame: number): void {
    this.node?.port.postMessage({ type: 'RESET', frame });
  }

  cleanup(): void {
    this.node?.disconnect();
    this.node = null;
    this.initialized = false;
  }
}
