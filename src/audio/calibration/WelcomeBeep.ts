/**
 * WelcomeBeep — plays a short notification beep when the audio engine
 * initializes. Programmatic oscillator-based, no external asset needed.
 */
export class WelcomeBeep {
  private ctx: AudioContext | null = null
  private played = false

  constructor(ctx: AudioContext) {
    this.ctx = ctx
  }

  /** Play the welcome beep. Safe to call multiple times — only plays once. */
  play(): void {
    if (this.played || !this.ctx) return
    this.played = true

    // Two-tone rising beep: 440Hz → 880Hz, 100ms each
    const now = this.ctx.currentTime + 0.1
    const gain = this.ctx.createGain()
    gain.gain.value = 0.08
    gain.connect(this.ctx.destination)

    const osc1 = this.ctx.createOscillator()
    osc1.type = 'sine'
    osc1.frequency.value = 440
    osc1.connect(gain)
    osc1.start(now)
    osc1.stop(now + 0.1)

    const osc2 = this.ctx.createOscillator()
    osc2.type = 'sine'
    osc2.frequency.value = 880
    osc2.connect(gain)
    osc2.start(now + 0.12)
    osc2.stop(now + 0.22)

    // Schedule gain cleanup
    gain.gain.setValueAtTime(0.08, now)
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35)
    setTimeout(() => gain.disconnect(), 500)
  }

  /** Allow replay (e.g. after AudioContext resume) */
  reset(): void {
    this.played = false
  }
}
