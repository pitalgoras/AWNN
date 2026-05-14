class MetronomeWorklet extends AudioWorkletProcessor {
  constructor() {
    super();
    this.framesPerBeat = 0;
    this.pendingFramesPerBeat = null;
    this.beatsPerBar = 4;
    this.pendingBeatsPerBar = null;
    this.sampleRate = 44100;
    this.enabled = false;
    this.downbeatSamples = null;
    this.offbeatSamples = null;
    this.nextBeatFrame = 0;
  this.beatIndex = 0;
  this.currentFrame = 0;
  this.beatCount = 0;

  this.port.onmessage = (e) => {
    const { type, ...data } = e.data;
    switch (type) {
      case 'CONFIGURE':
        this.framesPerBeat = Math.round(this.sampleRate * 60 / data.bpm);
        this.nextBeatFrame = this.currentFrame + this.framesPerBeat;
        this.beatsPerBar = data.beatsPerBar || 4;
        this.beatIndex = 0;
        this.beatCount = 0;
        this.sampleRate = data.sampleRate || this.sampleRate;
        this.enabled = data.enabled !== false;
        break;
      case 'SET_TEMPO':
        this.pendingFramesPerBeat = Math.round(this.sampleRate * 60 / data.bpm);
        break;
      case 'SET_SIGNATURE':
        this.pendingBeatsPerBar = data.beatsPerBar;
        break;
      case 'ENABLE':
        this.enabled = data.enabled;
        break;
      case 'RESET':
        this.currentFrame = data.frame || 0;
        this.nextBeatFrame = this.currentFrame + this.framesPerBeat;
        this.beatIndex = 0;
        break;
      case 'SET_CLICK_SOUNDS':
        this.downbeatSamples = data.downbeat;
        this.offbeatSamples = data.offbeat;
        break;
      case 'STATUS':
        this.port.postMessage({
          type: 'STATUS_REPLY',
          currentFrame: this.currentFrame,
          nextBeatFrame: this.nextBeatFrame,
          framesPerBeat: this.framesPerBeat,
          sampleRate: this.sampleRate,
          enabled: this.enabled,
          beatIndex: this.beatIndex,
          beatCount: this.beatCount,
          beatsPerBar: this.beatsPerBar,
          hasClicks: this.downbeatSamples != null && this.offbeatSamples != null,
        });
        break;
    }
  };
}

process(inputs, outputs) {
    if (!this.enabled || this.framesPerBeat === 0) return true;
    const output = outputs[0];
    if (!output || !output[0]) return true;

    const channel = output[0];
    let written = 0;

    while (written < channel.length) {
      const remaining = channel.length - written;
      const samplesUntilBeat = this.nextBeatFrame - this.currentFrame;

      if (samplesUntilBeat <= 0) {
        const isDownbeat = this.beatIndex % this.beatsPerBar === 0;

        if (isDownbeat && this.pendingBeatsPerBar != null) {
          this.beatsPerBar = this.pendingBeatsPerBar;
          this.pendingBeatsPerBar = null;
          this.beatIndex = 0;
        }

        if (this.pendingFramesPerBeat != null) {
          this.framesPerBeat = this.pendingFramesPerBeat;
          this.pendingFramesPerBeat = null;
        }

        this.nextBeatFrame += this.framesPerBeat;
        this.beatIndex++;
        this.beatCount++;

        const click = isDownbeat ? this.downbeatSamples : this.offbeatSamples;
        if (click) {
          const copyLen = Math.min(click.length, channel.length - written);
          for (let j = 0; j < copyLen; j++) {
            channel[written + j] += click[j];
          }
        }
        continue;
      }

      const step = Math.min(remaining, samplesUntilBeat);
      this.currentFrame += step;
      written += step;
    }

    return true;
  }
}

registerProcessor('metronome-processor', MetronomeWorklet);
