/**
 * AudioWorklet processor for recording microphone audio
 * Uses AudioContext's clock (currentTime) for sample-accurate timing
 * Share the same clock as playback - symmetric jitter for better sync
 */
class RecorderWorkletProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [{
      name: 'isRecording',
      defaultValue: 0,
      minValue: 0,
      maxValue: 1,
    }];
  }

  constructor() {
    super();
    this._isRecording = false;
    this._audioData = []; // Array of Float32Array per channel
    this._recordingStartTime = 0;
    this._sampleRate = sampleRate;
    
    this.port.onmessage = (event) => {
      if (event.data.type === 'SET_SAMPLE_RATE') {
        // Sample rate is already available as `sampleRate` global
      }
    };
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0]; // Mono or stereo input
    if (!input || input.length === 0) {
      return true;
    }

    const shouldRecord = parameters.isRecording[0] >= 0.5;
    
    if (shouldRecord && !this._isRecording) {
      // Start recording
      this._isRecording = true;
      this._audioData = [];
      this._recordingStartTime = currentFrame / sampleRate; // AudioContext time
      this.port.postMessage({
        type: 'RECORDING_STARTED',
        startTime: this._recordingStartTime,
        sampleRate: this._sampleRate,
        currentTime: currentTime, // AudioContext.currentTime
      });
    } else if (!shouldRecord && this._isRecording) {
      // Stop recording - flush data
      this._isRecording = false;
      this._flush();
      this.port.postMessage({
        type: 'RECORDING_STOPPED',
        stopTime: currentFrame / sampleRate,
        currentTime: currentTime,
      });
    }

    if (this._isRecording && input[0]) {
      // Store a copy of the audio data
      const channelData = input[0]; // Mono for now
      const copy = new Float32Array(channelData.length);
      copy.set(channelData);
      this._audioData.push({
        data: copy,
        time: currentFrame / sampleRate, // AudioContext time for this buffer
      });
    }

    return true;
  }

  _flush() {
    if (this._audioData.length === 0) return;

    // Combine all chunks into one Float32Array
    const totalLength = this._audioData.reduce((sum, chunk) => sum + chunk.data.length, 0);
    const combinedData = new Float32Array(totalLength);
    let offset = 0;
    
    this._audioData.forEach(chunk => {
      combinedData.set(chunk.data, offset);
      offset += chunk.data.length;
    });

    // Send to main thread
    this.port.postMessage({
      type: 'AUDIO_DATA',
      audioData: combinedData,
      sampleRate: this._sampleRate,
      startTime: this._recordingStartTime,
      length: totalLength,
    }, [combinedData.buffer]); // Transfer buffer, not copy

    this._audioData = [];
  }
}

registerProcessor('recorder-worklet', RecorderWorkletProcessor);
