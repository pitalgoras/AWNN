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
    this._audioData = []; // Array of {data, frame} for current recording
    this._rollingBuffer = []; // Circular buffer: {data, frame} - 2 seconds
    this._rollingBufferDuration = 2; // 2 seconds rolling buffer
    this._recordingStartFrame = 0;
    this._sampleRate = sampleRate;
    this._processCount = 0;
    this._shouldStop = false;
    this._shouldStart = false;
    this._startFrame = 0; // Frame to start recording from (for pre-roll)
    
    this.port.onmessage = (event) => {
      if (event.data.type === 'STOP_RECORDING') {
        this._shouldStop = true;
        this.port.postMessage({
          type: 'DEBUG',
          msg: 'STOP_RECORDING flag set',
        });
      } else if (event.data.type === 'START_RECORDING') {
        this._shouldStart = true;
        this._startFrame = event.data.startFrame || 0; // Frame to start from (0 = now)
        this.port.postMessage({
          type: 'DEBUG',
          msg: 'START_RECORDING flag set',
          startFrame: this._startFrame,
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
        const [audioData, startTime] = this._flush();
        this.port.postMessage({
          type: 'RECORDING_STOPPED',
          stopTime: currentFrame / sampleRate,
          currentTime: currentTime,
          audioData: audioData,
          sampleRate: this._sampleRate,
          recordingStartTime: startTime,
          length: audioData.length,
        }, [audioData.buffer]);
      }
    }
    
    if (this._shouldStart) {
      this._shouldStart = false;
      if (!this._isRecording) {
        this._isRecording = true;
        this._audioData = [];
        this._recordingStartFrame = this._startFrame || currentFrame;
        
        // Retrieve audio from rolling buffer starting at _recordingStartFrame
        if (this._startFrame && this._startFrame < currentFrame) {
          // Pre-roll case: get audio from rolling buffer
          const relevantEntries = this._rollingBuffer.filter(
            entry => entry.frame >= this._startFrame && entry.frame <= currentFrame
          );
          this._audioData = [...relevantEntries];
        }
        
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
    
    // If recording, also store in _audioData (for live punch-in case)
    if (this._isRecording && inputs && inputs[0] && inputs[0][0]) {
      const channelData = inputs[0][0];
      const copy = new Float32Array(channelData.length);
      copy.set(channelData);
      
      // Only add if not already in _audioData (avoid duplicates from rolling buffer)
      if (!this._startFrame || this._startFrame >= currentFrame) {
        this._audioData.push({
          data: copy,
          frame: currentFrame,
        });
      }
    }

    return true;
  }

  _flush() {
    if (this._audioData.length === 0) return [new Float32Array(0), 0];

    // Combine all chunks into one Float32Array
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
