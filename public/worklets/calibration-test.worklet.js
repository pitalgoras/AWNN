class TestRecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buffer = [];
    this._recording = false;
    this._pending = false;
    this._startFrame = 0;
    this._duration = 0;
    this._stopFrame = 0;
    this._actualStartFrame = 0;
    this._inputCount = 0;
    this._processCount = 0;
    this._onmessageCount = 0;
    this._lastProcessFrame = 0;
    this._startupLogDone = false;

    // Internal 20Hz activator — keeps audio path alive and provides
    // a continuous signal for output monitoring. The 4000Hz bandpass
    // in MLS correlation removes this frequency entirely.
    this._activatorPhase = 0;
    this._activatorGain = 0.02;

    this.port.onmessage = (e) => {
      this._onmessageCount++;
      if (e.data.type === 'PING') {
        this.port.postMessage({
          type: 'PONG',
          currentFrame,
          state: this._recording ? 'recording' : this._pending ? 'pending' : 'idle',
          bufferLength: this._buffer.length,
          processCount: this._processCount,
          onmessageCount: this._onmessageCount,
        });
      } else if (e.data.type === 'START') {
        this._buffer = [];
        this._recording = false;
        this._pending = true;
        this._inputCount = 0;
        this._startFrame = e.data.startFrame;
        this._duration = e.data.duration;
        this._stopFrame = this._startFrame + this._duration;
      }
    };
  }
  process(inputs, outputs) {
    if (!this._startupLogDone) {
      console.log('[test-worklet] process() first call at frame', currentFrame);
      this._startupLogDone = true;
    }
    this._processCount++;
    this._lastProcessFrame = currentFrame;

    if (this._processCount % 100 === 0) {
      this.port.postMessage({ type: 'HEARTBEAT', processCount: this._processCount });
    }

    // Generate output: internal 20Hz tone + raw mic when idle.
    // During recording, mic pass-through is muted to avoid contaminating
    // the MLS probe playback with feedback.
    const out = outputs[0]?.[0];
    if (out) {
      const inp = inputs[0]?.[0];
      for (let i = 0; i < out.length; i++) {
        this._activatorPhase += 2 * Math.PI * 20 / sampleRate;
        if (this._activatorPhase > 2 * Math.PI) this._activatorPhase -= 2 * Math.PI;
        const activator = Math.sin(this._activatorPhase) * this._activatorGain;
        const mic = (this._recording || this._pending) ? 0 : (inp?.[i] ?? 0);
        out[i] = activator + mic;
      }
    }

    // Recording captures ONLY raw input (no activator), stored regardless
    // of the output pass-through mute state.
    if (this._pending && currentFrame >= this._startFrame) {
      this._recording = true;
      this._pending = false;
      this._actualStartFrame = currentFrame;
      this._stopFrame = currentFrame + this._duration;
    }
    if (this._recording) {
      if (inputs[0]?.[0]) {
        const ch = inputs[0][0];
        this._inputCount += ch.length;
        for (let i = 0; i < ch.length; i++) this._buffer.push(ch[i]);
      }
      if (currentFrame >= this._stopFrame) {
        this._recording = false;
        const frames = new Float32Array(this._buffer);
        this.port.postMessage(
          { type: 'RESULT', frames, actualStartFrame: this._actualStartFrame, actualEndFrame: currentFrame, inputSamples: this._inputCount },
          [frames.buffer],
        );
        this._buffer = [];
        this._inputCount = 0;
      }
    }
    return true;
  }
}
registerProcessor('test-recorder', TestRecorderProcessor);
