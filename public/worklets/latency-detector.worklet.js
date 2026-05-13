/**
 * AudioWorklet processor for detecting audio beeps above a threshold.
 * Runs in a separate audio thread for low-latency processing.
 */
class LatencyDetectorProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.threshold = 0.1;
    this.isWaiting = false;
    this.beepTime = 0;
    this.port.onmessage = (event) => {
      if (event.data.type === 'SET_BEEP_TIME') {
        this.beepTime = event.data.beepTime;
        this.isWaiting = true;
      } else if (event.data.type === 'SET_THRESHOLD') {
        this.threshold = event.data.threshold;
      } else if (event.data.type === 'RESET') {
        this.isWaiting = false;
        this.beepTime = 0;
      }
    };
  }

  process(inputs, outputs, parameters) {
    if (!this.isWaiting || this.beepTime === 0) {
      return true;
    }

    const input = inputs[0];
    if (!input || input.length === 0) {
      return true;
    }

    const channelData = input[0];
    if (!channelData || channelData.length === 0) {
      return true;
    }

    const currentTime = currentFrame / sampleRate;

    if (currentTime < this.beepTime) {
      return true;
    }

    for (let i = 0; i < channelData.length; i++) {
      if (Math.abs(channelData[i]) > this.threshold) {
        const sampleTime = currentTime + (i / sampleRate);
        const latencyMs = (sampleTime - this.beepTime) * 1000;

        this.port.postMessage({
          type: 'BEEP_DETECTED',
          latencyMs,
          sampleTime,
          beepTime: this.beepTime
        });

        this.isWaiting = false;
        return true;
      }
    }

    if (currentTime > this.beepTime + 1.0) {
      this.port.postMessage({
        type: 'BEEP_TIMEOUT',
        beepTime: this.beepTime
      });
      this.isWaiting = false;
    }

    return true;
  }
}

registerProcessor('latency-detector-processor', LatencyDetectorProcessor);
