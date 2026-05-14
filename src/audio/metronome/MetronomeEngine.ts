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

    this.node.port.onmessage = (e) => {
      if (e.data?.type === 'STATUS_REPLY') {
        console.log('MetronomeWorklet status:', e.data);
      }
    };

    this.loadSamples(gain);
    this.node.port.postMessage({
      type: 'CONFIGURE',
      bpm: 120,
      beatsPerBar: 4,
      sampleRate: this.audioContext.sampleRate,
      enabled: false,
    });
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

  get debug() {
    return {
      send: (msg: Record<string, unknown>) => {
        this.node?.port.postMessage(msg);
        console.log('MetronomeDebug: sent', msg);
      },
      postMessage: (msg: Record<string, unknown>, transfer?: Transferable[]) => {
        this.node?.port.postMessage(msg, transfer as any);
        console.log('MetronomeDebug: sent with transfer', msg);
      },
      config: (bpm: number, beatsPerBar: number) => {
        this.node?.port.postMessage({ type: 'CONFIGURE', bpm, beatsPerBar, sampleRate: this.audioContext.sampleRate, enabled: true });
        console.log('MetronomeDebug: CONFIGURE', { bpm, beatsPerBar });
      },
      reset: (frame = 0) => {
        this.node?.port.postMessage({ type: 'RESET', frame });
        console.log('MetronomeDebug: RESET', { frame });
      },
      enable: (v: boolean) => {
        this.node?.port.postMessage({ type: 'ENABLE', enabled: v });
        console.log('MetronomeDebug: ENABLE', v);
      },
      get node() { return this.node; },
      get initialized() { return this.initialized; },
    };
  }
}
