/**
 * AudioWorklet processor for recording microphone audio
 * Uses AudioContext's clock (currentTime) for sample-accurate timing
 * Share the same clock as playback - symmetric jitter for better sync
 * Maintains a 2-second rolling buffer for pre-roll support
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
    this._audioData = []; // Array of Float32Array for current recording
    this._rollingBuffer = []; // Circular buffer: {data, frame} - 2 seconds
    this._rollingBufferDuration = 2; // 2 seconds rolling buffer
    this._recordingStartFrame = 0; // REAL TIME frame when recording started
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
    
    // Handle stop/start flags from messages
    if (this._shouldStop) {
      this._shouldStop = false;
      if (this._isRecording) {
        this._isRecording = false;
        const [audioData, recordingStartTime] = this._flush();
        // Send recorded data back to main thread
        this.port.postMessage({
          type: 'RECORDING_STOPPED',
          audioData: audioData,
          recordingStartTime: recordingStartTime,
        });
      }
    }
    
    if (this._shouldStart) {
      this._shouldStart = false;
      if (!this._isRecording) {
        this._isRecording = true;
        this._audioData = [];
        
        // Record from 1s before current frame (message received)
        // Since message is sent at pre-roll start (1 bar before punch-in),
        // this gives ~1s of head before punchInUserTime
        this._recordingStartFrame = currentFrame - this._sampleRate;
        
        this.port.postMessage({
          type: 'RECORDING_STARTED',
          startTime: this._recordingStartFrame / sampleRate,
          sampleRate: this._sampleRate,
          currentTime: currentTime,
        });
      }
    }
    
    // Always capture to rolling buffer (when playing)
    if (inputs && inputs[0] && inputs[0][0]) {
      const channelData = inputs[0][0]; // First channel (mono)
      const copy = new Float32Array(channelData.length);
      copy.set(channelData);
      
      // Add to rolling buffer
      this._rollingBuffer.push({
        data: copy,
        frame: currentFrame,
      });
      
      // Trim old data (keep 2 seconds)
      const maxFrames = this._rollingBufferDuration * sampleRate;
      while (this._rollingBuffer.length > 0) {
        if (currentFrame - this._rollingBuffer[0].frame > maxFrames) {
          this._rollingBuffer.shift();
        } else {
          break;
        }
      }
    }
    
    // If recording, store in _audioData
    if (this._isRecording && inputs && inputs[0] && inputs[0][0]) {
      const channelData = inputs[0][0];
      const copy = new Float32Array(channelData.length);
      copy.set(channelData);
      this._audioData.push({ data: copy, frame: currentFrame });
    }

    return true;
  }

  _flush() {
    if (this._audioData.length === 0) return [new Float32Array(0), 0];

    // Combine all chunks into one Float32Array (NO filtering - keep all audio)
    const totalLength = this._audioData.reduce((sum, chunk) => sum + chunk.data.length, 0);
    const combinedData = new Float32Array(totalLength);
    let offset = 0;
    
    this._audioData.forEach(chunk => {
      combinedData.set(chunk.data, offset);
      offset += chunk.data.length;
    });

    this._audioData = [];
    return [combinedData, this._recordingStartFrame / sampleRate];
  }
}

registerProcessor('recorder-worklet', RecorderWorkletProcessor);
