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

    // headLength sent per-recording via START_RECORDING, never >1s.
    // Rolling buffer: 2s covers max headLength with margin.
    this._rollingBufferDuration = 2.0;
    this._recordingStartFrame = 0; // Frame where definitive capture begins
    this._sampleRate = sampleRate;
    this._processCount = 0;
    this._shouldStop = false;
    this._anchoredFrame = 0; // Shared-clock frame of punch-in point (from worklet)
    this._headLength = 1.0; // Overwritten by START_RECORDING message

    this._rollingBuffer = []; // Single buffer: head + recording
    this._sessionId = 0;
    this._sessionProcessCount = 0;
    this._sessionPushCount = 0;

    // Accumulator: pre-allocated 4096-sample buffer to cut allocations
    // from ~344/s (one Float32Array per process() call) to ~11/s.
    this._accBuffer = new Float32Array(4096);
    this._accPos = 0;
    this._accStartFrame = 0;

    this.port.onmessage = (event) => {
      if (event.data.type === 'STOP_RECORDING') {
        this._shouldStop = true;
        this.port.postMessage({
          type: 'DEBUG',
          msg: 'STOP_RECORDING flag set',
        });
      } else if (event.data.type === 'START_RECORDING') {
        this._shouldStop = false;
        this._sessionId = event.data.sessionId || 0;
        this._recordingStartFrame = event.data.recordingStartFrame || Math.round(currentTime * sampleRate);
        this._anchoredFrame = this._recordingStartFrame;
        this._isRecording = true;
        this._sessionProcessCount = 0;
        this._sessionPushCount = 0;
        // headLength sent per-recording from main thread (per-clip, adjustable in SyncTool)
        if (event.data.headLength !== undefined) {
          this._headLength = event.data.headLength;
        }

        this.port.postMessage({
          type: 'RECORDING_STARTED',
          startTime: this._recordingStartFrame / sampleRate,
          anchoredFrame: this._anchoredFrame,
          currentTime: currentTime,
          sessionId: this._sessionId,
          msg: 'Recording: anchorFrame=' + this._anchoredFrame + ', recordingStartFrame=' + this._recordingStartFrame,
        });
      }
    };
  }

  process(inputs, outputs, parameters) {
    this._processCount++;
    if (this._isRecording) this._sessionProcessCount++;

    // Accumulate audio input into pre-allocated buffer (avoids ~344 allocs/s)
    if (inputs && inputs[0] && inputs[0][0]) {
      const channelData = inputs[0][0];

      if (this._accPos === 0) {
        this._accStartFrame = currentFrame;
      }

      const remaining = this._accBuffer.length - this._accPos;
      let srcOffset = 0;
      if (channelData.length > remaining) {
        // Fill current accumulator chunk and push
        this._accBuffer.set(channelData.subarray(0, remaining), this._accPos);
        this._accPos = this._accBuffer.length;
        this._pushAccumulator();
        srcOffset = remaining;
      }

      // Copy the rest (if any) into a fresh accumulator slot
      if (srcOffset < channelData.length) {
        if (this._accPos === 0) {
          this._accStartFrame = currentFrame + srcOffset;
        }
        const tailLen = channelData.length - srcOffset;
        this._accBuffer.set(channelData.subarray(srcOffset), this._accPos);
        this._accPos += tailLen;
        if (this._accPos >= 4096) {
          this._pushAccumulator();
        }
      }

      // Trim old data only before recording starts
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

    // Handle stop flag — run after input so the last samples are captured
    if (this._shouldStop) {
      this._shouldStop = false;
      if (this._isRecording) {
        this._isRecording = false;
        this._pushAccumulator();
        const flushed = this._flush();
        this.port.postMessage({
          type: 'RECORDING_STOPPED',
          audioData: flushed[0],
          anchoredFrame: flushed[1],
          rollingOffset: flushed[2],
          sessionId: this._sessionId,
        });
      }
    }

    return true;
  }

  _pushAccumulator() {
    if (this._accPos === 0) return;
    this._sessionPushCount++;
    this._rollingBuffer.push({ data: this._accBuffer.slice(0, this._accPos), frame: this._accStartFrame });
    this._accPos = 0;
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
      sessionProcessCount: this._sessionProcessCount,
      sessionPushCount: this._sessionPushCount,
    });
    this._rollingBuffer = [];
    return [result, returnAnchorFrame, rollingOffset];
  }
}

registerProcessor('recorder-worklet', RecorderWorkletProcessor);
