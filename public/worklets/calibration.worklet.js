/**
 * Calibration worklet for sample-accurate peak detection.
 * Monitors mic input for rising edges above a threshold and reports
 * their exact AudioContext frame numbers back to the main thread.
 *
 * Edge detection uses hysteresis: a rising edge is registered when
 * the current sample is at or above threshold while the previous
 * sample was below threshold. Consecutive edges are suppressed if
 * they fall within minGapFrames of the last detected edge.
 *
 * Messages:
 *   START: { threshold, minGapFrames, startFrame } — begin monitoring
 *   STOP:  — stop monitoring, post back all detected edges
 */
class CalibrationProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.isMonitoring = false
    this.threshold = 0.05
    this.minGapFrames = 1500
    this.prevAbove = false
    this.lastEdgeFrame = -Infinity
    this.startFrame = 0
    this.edges = []
    this.processCount = 0

    this.port.onmessage = (event) => {
      const data = event.data
      if (data.type === 'START') {
        this.threshold = data.threshold ?? 0.05
        this.minGapFrames = data.minGapFrames ?? 1500
        this.startFrame = data.startFrame ?? 0
        this.prevAbove = false
        this.lastEdgeFrame = -Infinity
        this.edges = []
        this.isMonitoring = true
        this.processCount = 0
      } else if (data.type === 'STOP') {
        this.isMonitoring = false
        this.port.postMessage({
          type: 'EDGES',
          edges: this.edges,
          edgeCount: this.edges.length,
          processCount: this.processCount,
          startFrame: this.startFrame,
        })
      }
    }
  }

  process(inputs, outputs, parameters) {
    if (!this.isMonitoring) return true
    this.processCount++

    const input = inputs[0]
    // Log first process call to confirm audio flow
    if (this.processCount === 1 && input && input[0]) {
      this.port.postMessage({
        type: 'DEBUG',
        msg: 'First process() call',
        inputLength: input[0].length,
        firstFewSamples: Array.from(input[0].slice(0, 10)),
        currentFrame: currentFrame,
        startFrame: this.startFrame,
      })
    }

    if (!input || !input[0] || input[0].length === 0) return true

    const data = input[0]
    for (let i = 0; i < data.length; i++) {
      const frame = currentFrame + i
      if (frame < this.startFrame) continue
      const abs = Math.abs(data[i])
      const isAbove = abs >= this.threshold

      if (isAbove && !this.prevAbove) {
        // Rising edge
        if (frame - this.lastEdgeFrame >= this.minGapFrames) {
          this.edges.push(frame)
          this.lastEdgeFrame = frame
          // Report first few edges immediately for debugging
          if (this.edges.length <= 5) {
            this.port.postMessage({
              type: 'DEBUG',
              msg: 'Edge detected',
              frame: frame,
              amplitude: abs,
              threshold: this.threshold,
              edgeIndex: this.edges.length,
            })
          }
        }
      }
      this.prevAbove = isAbove
    }

    return true
  }
}

registerProcessor('calibration-processor', CalibrationProcessor)
