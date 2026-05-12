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

    // Get headLength from processor options (passed from RecordingEngine)
    let headLength = 1.0;
    // Access processorOptions directly - no TypeScript syntax
    if (this.processorOptions && this.processorOptions.headLength !== undefined) {
      headLength = this.processorOptions.headLength;
    }
    // Rolling buffer should always be larger than headLength to work properly
    // Use at least 2 seconds or headLength + 1 second buffer
    this._rollingBufferDuration = Math.max(2.0, headLength + 1.0);
    this._recordingStartFrame = 0; // REAL TIME frame when actual audio capture began
    this._sampleRate = sampleRate;
    this._processCount = 0;
    this._shouldStop = false;
    this._anchoredFrame = 0; // Shared-clock frame of punch-in point (from main thread)
    this._headLength = headLength;

    this._rollingBuffer = []; // Initialize rolling buffer

    this.port.onmessage = (event) => {
      if (event.data.type === 'STOP_RECORDING') {
        this._shouldStop = true;
        this.port.postMessage({
          type: 'DEBUG',
          msg: 'STOP_RECORDING flag set',
        });
      } else if (event.data.type === 'START_RECORDING') {
        this._shouldStop = false;

        if (event.data.punchInUserTime_Real !== undefined) {
          // Receive anchor frame from main thread (AudioContext time based)
          this._anchoredFrame = Math.floor(event.data.punchInUserTime_Real * sampleRate);
          // Capture starts at the anchor frame — rolling buffer provides the head
          this._isRecording = true;
          this._audioData = [];
          this._recordingStartFrame = this._anchoredFrame;

          this.port.postMessage({
            type: 'RECORDING_STARTED',
            startTime: this._recordingStartFrame / sampleRate,
            anchoredFrame: this._anchoredFrame,
            currentTime: currentTime,
            msg: 'Recording: anchorFrame=' + this._anchoredFrame + ', recordingStartFrame=' + this._recordingStartFrame,
          });
        }
      }
    };
  }

  process(inputs, outputs, parameters) {
    this._processCount++;

    // Handle stop flag from messages
    if (this._shouldStop) {
      this._shouldStop = false;
      if (this._isRecording) {
        this._isRecording = false;
        const flushed = this._flush();
        // Send recorded data back to main thread
        this.port.postMessage({
          type: 'RECORDING_STOPPED',
          audioData: flushed[0],
          anchoredFrame: flushed[1],
          rollingOffset: flushed[2],
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

      // Trim old data (keep rollingBufferDuration seconds)
      const maxFrames = this._rollingBufferDuration * sampleRate;
      while (this._rollingBuffer.length > 0) {
        if (currentFrame - this._rollingBuffer[0].frame > maxFrames) {
          this._rollingBuffer.shift();
        } else {
          break;
        }
      }
    }

    // FIXED: If recording but current frame is before capture start, don't store audio
    // This allows the rolling buffer to accumulate pre-roll audio during the delay
    const isCapturing = this._isRecording && currentFrame >= this._recordingStartFrame;
    if (isCapturing && inputs && inputs[0] && inputs[0][0]) {
      const channelData = inputs[0][0];
      const copy = new Float32Array(channelData.length);
      copy.set(channelData);
      this._audioData.push({ data: copy, frame: currentFrame });
    }

    return true;
  }

  _flush() {
    // Combine the rolling buffer (pre-roll) with the recorded data
    // The rolling buffer provides the "head" audio before the punch-in point
    // Trim the head to exactly headLength seconds
    const allChunks = [];
    let rollingOffset = 0;
    const headCutoffFrame = this._recordingStartFrame - Math.floor(this._headLength * sampleRate);

    if (this._rollingBuffer.length > 0) {
      const recordStartFrame = this._recordingStartFrame;

      // Include rolling buffer data only within the last headLength seconds before recording start
      for (let i = 0; i < this._rollingBuffer.length; i++) {
        const chunk = this._rollingBuffer[i];
        const chunkEndFrame = chunk.frame + chunk.data.length;

        if (chunkEndFrame <= headCutoffFrame) {
          // Entirely before the head region — skip
          continue;
        }

        if (chunk.frame < headCutoffFrame) {
          // Partially overlaps the head region — trim the beginning
          const offset = headCutoffFrame - chunk.frame;
          if (offset > 0 && offset < chunk.data.length) {
            allChunks.push(chunk.data.subarray(offset));
            rollingOffset += chunk.data.length - offset;
          }
        } else if (chunk.frame < recordStartFrame) {
          // Fully within the head region — include entirely
          allChunks.push(chunk.data);
          rollingOffset += chunk.data.length;
        } else {
          break;
        }
      }
    }

    // Append the recorded audio data
    if (this._audioData.length > 0) {
      const totalRecordingLength = this._audioData.reduce((sum, chunk) => sum + chunk.data.length, 0);
      const combinedRecording = new Float32Array(totalRecordingLength);
      let offset = 0;
      this._audioData.forEach(chunk => {
        combinedRecording.set(chunk.data, offset);
        offset += chunk.data.length;
      });
      allChunks.push(combinedRecording);
    }

    // Combine everything into one array
    let totalLength = 0;
    allChunks.forEach(c => totalLength += c.length);
    const result = new Float32Array(totalLength);
    let offset = 0;
    allChunks.forEach(c => { result.set(c, offset); offset += c.length; });

    // FIXED: Return _anchoredFrame (the sync anchor from main thread) instead of _recordingStartFrame
    // _anchoredFrame represents the timeline-relative frame number for the punch-in point
    const returnAnchorFrame = this._anchoredFrame;
    this.port.postMessage({
      type: 'DEBUG',
      msg: '_flush() returning',
      recordingStartFrame: this._recordingStartFrame,
      anchoredFrame: returnAnchorFrame,
      rollingOffset: rollingOffset,
      audioDataLength: result.length,
      sampleRate: sampleRate,
    });
    this._audioData = [];
    return [result, returnAnchorFrame, rollingOffset];
  }
}

registerProcessor('recorder-worklet', RecorderWorkletProcessor);