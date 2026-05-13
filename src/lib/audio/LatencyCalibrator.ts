/**
 * LatencyCalibrator - Shared module for audio latency calibration
 * Uses AudioWorklet for cross-browser compatibility (Firefox + Chrome)
 */

export interface LatencyCalibrationOptions {
  numTests?: number;
  threshold?: number;
  beepFrequency?: number;
  beepDuration?: number;
  testInterval?: number;
  timeoutMs?: number;
}

export interface LatencyCalibrationResult {
  success: boolean;
  latencies: number[];
  averageLatencyMs: number;
  error?: string;
}

export interface LatencyCalibrationCallbacks {
  onProgress?: (progress: number) => void;
  onTestComplete?: (testIndex: number, latencyMs: number | null) => void;
  onComplete?: (result: LatencyCalibrationResult) => void;
  onError?: (error: string) => void;
}

export class LatencyCalibrator {
  private audioContext: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private callbacks: LatencyCalibrationCallbacks;
  private options: Required<LatencyCalibrationOptions>;
  
  private detectedLatencies: number[] = [];
  private currentTest = 0;
  private isRunning = false;
  private timeoutId: NodeJS.Timeout | null = null;

  constructor(
    callbacks: LatencyCalibrationCallbacks = {},
    options: LatencyCalibrationOptions = {}
  ) {
    this.callbacks = callbacks;
    this.options = {
      numTests: 5,
      threshold: 0.1,
      beepFrequency: 1000,
      beepDuration: 0.05,
      testInterval: 300,
      timeoutMs: 5000,
      ...options
    };
  }

  async calibrate(): Promise<void> {
    if (this.isRunning) {
      this.callbacks.onError?.('Calibration already running');
      return;
    }

    this.isRunning = true;
    this.detectedLatencies = [];
    this.currentTest = 0;

    try {
      // Get microphone stream with raw audio settings
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        }
      });

      // Create AudioContext
      this.audioContext = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();

      // Load and initialize AudioWorklet
      try {
        await this.audioContext.audioWorklet.addModule(
          '/worklets/latency-detector.worklet.js'
        );
      } catch (err) {
        console.warn('AudioWorklet not supported, falling back to ScriptProcessor', err);
        await this.calibrateWithScriptProcessor();
        return;
      }

      // Create source from microphone stream
      this.source = this.audioContext.createMediaStreamSource(this.stream);

      // Create AudioWorklet node
      this.workletNode = new AudioWorkletNode(this.audioContext, 'latency-detector-processor');

      // Set threshold
      this.workletNode.port.postMessage({
        type: 'SET_THRESHOLD',
        threshold: this.options.threshold
      });

      // Connect: source -> worklet -> destination (for beep to play)
      this.source.connect(this.workletNode);
      this.workletNode.connect(this.audioContext.destination);

      // Listen for messages from the worklet
      this.workletNode.port.onmessage = (event) => {
        this.handleWorkletMessage(event.data);
      };

      // Start the first test
      this.runNextTest();

    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      this.cleanup();
      this.callbacks.onError?.(`Microphone access denied or audio error: ${errorMsg}`);
    }
  }

  private async calibrateWithScriptProcessor(): Promise<void> {
    // Fallback for browsers not supporting AudioWorklet
    if (!this.audioContext || !this.stream) {
      this.callbacks.onError?.('AudioContext or stream not initialized');
      return;
    }

    const ctx = this.audioContext;
    const stream = this.stream;
    const processor = ctx.createScriptProcessor(512, 1, 1);
    const source = ctx.createMediaStreamSource(stream);

    source.connect(processor);
    processor.connect(ctx.destination);

    const beepTime = 0;
    let isWaitingForBeep = false;

    processor.onaudioprocess = (e) => {
      if (!isWaitingForBeep || beepTime === 0) return;

      const data = e.inputBuffer.getChannelData(0);
      const currentTime = ctx.currentTime;

      if (currentTime < beepTime) return;

      for (let i = 0; i < data.length; i++) {
        if (Math.abs(data[i]) > this.options.threshold) {
          const sampleTime = currentTime + (i / ctx.sampleRate);
          const latencyMs = (sampleTime - beepTime) * 1000;

      if (latencyMs < 1000) {
            this.detectedLatencies.push(latencyMs);
          }

          isWaitingForBeep = false;
          processor.disconnect();
          source.disconnect();

          // Run next test or finish
          this.currentTest++;
          if (this.currentTest < this.options.numTests) {
            setTimeout(() => this.runNextTestWithProcessor(ctx, stream), this.options.testInterval);
          } else {
            this.finishCalibration();
          }
          return;
        }
      }

      if (currentTime > beepTime + 1.0) {
        isWaitingForBeep = false;
        this.currentTest++;
        if (this.currentTest < this.options.numTests) {
          setTimeout(() => this.runNextTestWithProcessor(ctx, stream), 100);
        } else {
          this.finishCalibration();
        }
      }
    };

    // Start first test
    this.runNextTestWithProcessor(ctx, stream);
  }

  private runNextTestWithProcessor(ctx: AudioContext, stream: MediaStream) {
    if (this.currentTest >= this.options.numTests) {
      return;
    }

    this.callbacks.onProgress?.(this.currentTest / this.options.numTests * 100);

    const beepTime = ctx.currentTime + 0.5;
    const isWaitingForBeep = true;

    // Schedule beep
    const osc = ctx.createOscillator();
    const env = ctx.createGain();

    osc.type = 'square';
    osc.frequency.value = this.options.beepFrequency;

    env.gain.setValueAtTime(0, beepTime);
    env.gain.linearRampToValueAtTime(1, beepTime + 0.005);
    env.gain.exponentialRampToValueAtTime(0.001, beepTime + this.options.beepDuration);

    osc.connect(env);
    env.connect(ctx.destination);

    osc.start(beepTime);
    osc.stop(beepTime + 0.1);
  }

  private handleWorkletMessage(data: any) {
    if (data.type === 'BEEP_DETECTED') {
      const latencyMs = data.latencyMs;
      
      if (latencyMs < 1000) {
        this.detectedLatencies.push(latencyMs);
        this.callbacks.onTestComplete?.(this.currentTest, latencyMs);
      }

      this.currentTest++;

      if (this.currentTest < this.options.numTests) {
        this.callbacks.onProgress?.(this.currentTest / this.options.numTests * 100);
        setTimeout(() => this.runNextTest(), this.options.testInterval);
      } else {
        this.finishCalibration();
      }
    } else if (data.type === 'BEEP_TIMEOUT') {
      this.currentTest++;

      if (this.currentTest < this.options.numTests) {
        setTimeout(() => this.runNextTest(), 100);
      } else {
        this.finishCalibration();
      }
    }
  }

  private runNextTest() {
    if (!this.audioContext || !this.workletNode || this.currentTest >= this.options.numTests) {
      return;
    }

    this.callbacks.onProgress?.(this.currentTest / this.options.numTests * 100);

    // Schedule beep
    const beepTime = this.audioContext.currentTime + 0.5;
    
    // Tell worklet to start listening
    this.workletNode.port.postMessage({
      type: 'SET_BEEP_TIME',
      beepTime
    });

    // Create and play beep
    const osc = this.audioContext.createOscillator();
    const env = this.audioContext.createGain();

    osc.type = 'square';
    osc.frequency.value = this.options.beepFrequency;

    env.gain.setValueAtTime(0, beepTime);
    env.gain.linearRampToValueAtTime(1, beepTime + 0.005);
    env.gain.exponentialRampToValueAtTime(0.001, beepTime + this.options.beepDuration);

    osc.connect(env);
    env.connect(this.audioContext.destination);

    osc.start(beepTime);
    osc.stop(beepTime + 0.1);
  }

  private finishCalibration(): void {
    const success = this.detectedLatencies.length > 0;
    const averageLatencyMs = success
      ? Math.round(this.detectedLatencies.reduce((a, b) => a + b, 0) / this.detectedLatencies.length)
      : 0;

    const result: LatencyCalibrationResult = {
      success,
      latencies: this.detectedLatencies,
      averageLatencyMs,
      error: success ? undefined : 'Could not detect the test tone. Ensure your speakers are audible to the microphone.'
    };

    this.cleanup();
    this.callbacks.onComplete?.(result);
  }

  cancel() {
    this.isRunning = false;
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
    this.cleanup();
    this.callbacks.onError?.('Calibration cancelled');
  }

  private cleanup() {
    this.isRunning = false;

    // Disconnect worklet node
    if (this.workletNode) {
      try {
        this.workletNode.disconnect();
        this.workletNode.port.onmessage = null;
      } catch (e) {
        // Ignore disconnect errors
      }
      this.workletNode = null;
    }

    // Disconnect source
    if (this.source) {
      try {
        this.source.disconnect();
      } catch (e) {
        // Ignore
      }
      this.source = null;
    }

    // Close AudioContext
    if (this.audioContext && this.audioContext.state !== 'closed') {
      try {
        this.audioContext.close();
      } catch (e) {
        // Ignore
      }
    }
    this.audioContext = null;

    // Stop media stream
    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
    }
  }
}
