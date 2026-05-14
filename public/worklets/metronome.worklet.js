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
    this.logOnce = {};
    this.processCallCount = 0;

    this.port.onmessage = (e) => {
      const { type, ...data } = e.data;
      console.log('MW msg:', type, JSON.stringify(data));
      switch (type) {
        case 'CONFIGURE':
          console.log('MW CONFIGURE: bpm=' + data.bpm + ' currentFrame=' + this.currentFrame + ' setting nextBeatFrame=' + this.currentFrame + '+' + Math.round(this.sampleRate * 60 / data.bpm));
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
          console.log('MW ENABLE: ' + data.enabled + ' (framesPerBeat=' + this.framesPerBeat + ')');
          this.enabled = data.enabled;
          break;
        case 'RESET':
          console.log('MW RESET: frame=' + (data.frame || 0) + ' framesPerBeat=' + this.framesPerBeat + ' nextBeatFrame was=' + this.nextBeatFrame + ' will be=' + ((data.frame || 0) + this.framesPerBeat));
          this.currentFrame = data.frame || 0;
          this.nextBeatFrame = this.currentFrame + this.framesPerBeat;
          this.beatIndex = 0;
          break;
        case 'SET_CLICK_SOUNDS':
          console.log('MW SET_CLICK_SOUNDS: downbeat=' + (data.downbeat?.length || 0) + ' offbeat=' + (data.offbeat?.length || 0));
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
    this.processCallCount++;
    if (!this.enabled) return true;
    if (this.framesPerBeat === 0) {
      if (!this.logOnce.fpbZero) { this.logOnce.fpbZero = true; console.log('MW: framesPerBeat=0 — skipping'); }
      return true;
    }

    const output = outputs[0];
    if (!output || !output[0]) {
      if (!this.logOnce.noOutput) { this.logOnce.noOutput = true; console.log('MW: no output channel'); }
      return true;
    }

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

        if (this.beatCount <= 3) {
          console.log('MW BEAT #' + this.beatCount + ' at frame=' + this.currentFrame + ' nextBeat=' + this.nextBeatFrame + ' isDownbeat=' + isDownbeat + ' remaining=' + remaining);
        }

        const click = isDownbeat ? this.downbeatSamples : this.offbeatSamples;
        if (click) {
          const copyLen = Math.min(click.length, remaining);
          for (let j = 0; j < copyLen; j++) {
            channel[written + j] += click[j];
          }
          if (this.beatCount <= 3) {
            console.log('MW BEAT #' + this.beatCount + ' click.length=' + click.length + ' copyLen=' + copyLen + ' remaining=' + remaining + ' written=' + written);
            if (copyLen < click.length) {
              console.log('MW *** TRUNCATED: only placed ' + copyLen + ' of ' + click.length + ' click samples!');
            }
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
