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
    this.threshold = 0.15
    this.minGapFrames = 2000
    this.prevAbove = false
    this.lastEdgeFrame = -Infinity
    this.startFrame = 0
    this.edges = []

    this.port.onmessage = (event) => {
      const data = event.data
      if (data.type === 'START') {
        this.threshold = data.threshold ?? 0.15
        this.minGapFrames = data.minGapFrames ?? 2000
        this.startFrame = data.startFrame ?? 0
        this.prevAbove = false
        this.lastEdgeFrame = -Infinity
        this.edges = []
        this.isMonitoring = true
      } else if (data.type === 'STOP') {
        this.isMonitoring = false
        this.port.postMessage({
          type: 'EDGES',
          edges: this.edges,
          startFrame: this.startFrame,
        })
      }
    }
  }

  process(inputs, outputs, parameters) {
    if (!this.isMonitoring) return true
    const input = inputs[0]
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
        }
      }
      this.prevAbove = isAbove
    }

    return true
  }
}

registerProcessor('calibration-processor', CalibrationProcessor)
