class CalibrationProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this._recording = false
    this._buffer = null
    this._writeIdx = 0
    this._startFrame = 0
    this._maxFrames = Math.floor(30 * sampleRate) // 30s max

    this.port.onmessage = (event) => {
      const data = event.data
      if (data.type === 'START') {
        this._recording = true
        this._startFrame = currentFrame
        this._writeIdx = 0
        this._buffer = new Float32Array(this._maxFrames)
        this.port.postMessage({ type: 'STARTED', startFrame: this._startFrame })
      } else if (data.type === 'STOP') {
        this.flush()
      }
    }
  }

  flush() {
    if (!this._recording || !this._buffer) return
    this._recording = false
    const actual = this._buffer.subarray(0, this._writeIdx)
    this.port.postMessage(
      { type: 'TRACE', frames: actual, startFrame: this._startFrame, endFrame: this._startFrame + this._writeIdx },
      [actual.buffer],
    )
    this._buffer = null
  }

  process(inputs, _outputs, _parameters) {
    const input = inputs[0]
    const inData = input && input[0]
    if (!inData || !this._recording) return true

    const remain = this._maxFrames - this._writeIdx
    const copyLen = Math.min(inData.length, remain)
    if (copyLen > 0) {
      this._buffer.set(inData.subarray(0, copyLen), this._writeIdx)
      this._writeIdx += copyLen
    }
    if (this._writeIdx >= this._maxFrames) {
      this.flush()
    }
    return true
  }
}

registerProcessor('calibration-processor', CalibrationProcessor)
