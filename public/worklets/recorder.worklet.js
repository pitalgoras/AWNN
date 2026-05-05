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
    this._processCount = 0;
    this._shouldStop = false;
    this._shouldStart = false;
    
    this.port.onmessage = (event) => {
      if (event.data.type === 'STOP_RECORDING') {
        this._shouldStop = true;
        this.port.postMessage({
          type: 'DEBUG',
          msg: 'STOP_RECORDING flag set',
        });
      } else if (event.data.type === 'START_RECORDING') {
        this._shouldStart = true;
        this.port.postMessage({
          type: 'DEBUG',
          msg: 'START_RECORDING flag set',
        });
      }
    };
  }

  process(inputs, outputs, parameters) {
    this._processCount++;
    
    // Handle stop/start flags from messages (more reliable than parameters)
    if (this._shouldStop) {
      this._shouldStop = false;
      if (this._isRecording) {
        this._isRecording = false;
        this._flush();
        this.port.postMessage({
          type: 'RECORDING_STOPPED',
          stopTime: currentFrame / sampleRate,
          currentTime: currentTime,
        });
      }
    }
    
    if (this._shouldStart) {
      this._shouldStart = false;
      if (!this._isRecording) {
        this._isRecording = true;
        this._audioData = [];
        this._recordingStartTime = currentFrame / sampleRate;
        this.port.postMessage({
          type: 'RECORDING_STARTED',
          startTime: this._recordingStartTime,
          sampleRate: this._sampleRate,
          currentTime: currentTime,
        });
      }
    }
    
    // Debug: log every 1000 process calls
    if (this._processCount % 1000 === 0) {
      const inputLen = (inputs && inputs[0] && inputs[0].length) ? inputs[0].length : 0;
      this.port.postMessage({
        type: 'DEBUG',
        processCount: this._processCount,
        isRecording: this._isRecording,
        inputLength: inputLen,
      });
    }

    // Defensive check: ensure inputs exist and have channels
    if (!inputs || inputs.length === 0) {
      return true;
    }

    const input = inputs[0]; // First input (MediaStreamSource)
    if (!input || input.length === 0) {
      return true; // No channels available yet
    }

    // Backup: also check parameter (in case message was missed)
    const shouldRecord = parameters.isRecording[0] >= 0.5;
    if (shouldRecord !== this._isRecording) {
      this.port.postMessage({
        type: 'DEBUG',
        msg: 'Parameter change detected (backup check)',
        shouldRecord,
        isRecording: this._isRecording,
      });
    }
    
    if (this._isRecording && input[0]) {
      // Store a copy of the audio data
      const channelData = input[0]; // First channel (mono)
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
