/**
 * AudioWorklet processor for recording microphone audio
 * Uses AudioContext's clock (currentTime) for sample-accurate timing
 * Share the same clock as playback - symmetric jitter for better sync
 * Maintains a 2-second rolling buffer for pre-roll support
 * 
 * Single-buffer approach:
 * - Rolling buffer captures continuously during playback
 * - At _recordingStartFrame, trimming stops — buffer keeps everything
 *   from (_recordingStartFrame - rollingBufferDuration) to stop time
 * - _flush() extracts head (last headLength seconds before recordingStartFrame)
 *   directly from the buffer, then includes the definitive recording portion
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

    // Get headLength from processor options (passed from RecordingEngine)
    let headLength = 1.0;
    // Access processorOptions directly - no TypeScript syntax
    if (this.processorOptions && this.processorOptions.headLength !== undefined) {
      headLength = this.processorOptions.headLength;
    }
    // Rolling buffer should always be larger than headLength to work properly
    // Use at least 2 seconds or headLength + 1 second buffer
    this._rollingBufferDuration = Math.max(2.0, headLength + 1.0);
    this._recordingStartFrame = 0; // Frame where definitive capture begins
    this._sampleRate = sampleRate;
    this._processCount = 0;
    this._shouldStop = false;
    this._anchoredFrame = 0; // Shared-clock frame of punch-in point (from main thread)
    this._headLength = headLength;

    this._rollingBuffer = []; // Single buffer: head + recording

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
          this._anchoredFrame = Math.floor(event.data.punchInUserTime_Real * sampleRate);
          this._isRecording = true;
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
        this.port.postMessage({
          type: 'RECORDING_STOPPED',
          audioData: flushed[0],
          anchoredFrame: flushed[1],
          rollingOffset: flushed[2],
        });
      }
    }

    // Add audio input to the single rolling buffer
    if (inputs && inputs[0] && inputs[0][0]) {
      const channelData = inputs[0][0];
      const copy = new Float32Array(channelData.length);
      copy.set(channelData);

      this._rollingBuffer.push({
        data: copy,
        frame: currentFrame,
      });

      // Trim old data only before recording starts
      // Once _recordingStartFrame is reached, stop trimming so the
      // full head-window + definitive recording is preserved in one buffer.
      // The head window (last headLength seconds before recordingStartFrame)
      // is extracted in _flush().
      if (!this._isRecording || currentFrame < this._recordingStartFrame) {
        const maxFrames = this._rollingBufferDuration * sampleRate;
        while (this._rollingBuffer.length > 0) {
          if (currentFrame - this._rollingBuffer[0].frame > maxFrames) {
            this._rollingBuffer.shift();
          } else {
            break;
          }
        }
      }
    }

    return true;
  }

  _flush() {
    // Single buffer contains both head and definitive recording.
    // Extract the head (last headLength seconds before _recordingStartFrame)
    // followed by all data from _recordingStartFrame onward.
    const allChunks = [];
    let rollingOffset = 0;
    const recordStartFrame = this._recordingStartFrame;
    const headCutoffFrame = recordStartFrame - Math.floor(this._headLength * sampleRate);

    for (let i = 0; i < this._rollingBuffer.length; i++) {
      const chunk = this._rollingBuffer[i];
      const chunkEndFrame = chunk.frame + chunk.data.length;

      if (chunkEndFrame <= headCutoffFrame) {
        // Too old for the head window — skip
        continue;
      }

      if (chunk.frame < recordStartFrame) {
        // This chunk is in the head region (before definitive recording starts)
        if (chunk.frame < headCutoffFrame) {
          // Partial overlap with head window — trim front
          const offset = headCutoffFrame - chunk.frame;
          if (offset > 0 && offset < chunk.data.length) {
            allChunks.push(chunk.data.subarray(offset));
            rollingOffset += chunk.data.length - offset;
          }
        } else {
          // Fully within head window
          allChunks.push(chunk.data);
          rollingOffset += chunk.data.length;
        }
      } else {
        // This chunk is part of the definitive recording (at/after recordStartFrame)
        allChunks.push(chunk.data);
      }
    }

    // Combine everything into one array
    let totalLength = 0;
    allChunks.forEach(c => totalLength += c.length);
    const result = new Float32Array(totalLength);
    let offset = 0;
    allChunks.forEach(c => { result.set(c, offset); offset += c.length; });

    const returnAnchorFrame = this._anchoredFrame;
    this.port.postMessage({
      type: 'DEBUG',
      msg: '_flush() returning',
      recordingStartFrame: recordStartFrame,
      anchoredFrame: returnAnchorFrame,
      rollingOffset: rollingOffset,
      totalLength: result.length,
      sampleRate: sampleRate,
    });
    this._rollingBuffer = [];
    return [result, returnAnchorFrame, rollingOffset];
  }
}

registerProcessor('recorder-worklet', RecorderWorkletProcessor);
