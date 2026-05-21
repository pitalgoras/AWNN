import React, { useMemo } from 'react';
import { ProbeCycleData, matchEnvelope } from '../../lib/audio/LatencyCalibrator';

interface Props {
  cycle: ProbeCycleData | null
  cycleCount: number
  floorPeak?: number
}

export const ProbeMonitor: React.FC<Props> = ({ cycle, cycleCount, floorPeak = 0 }) => {
  const levels = useMemo(() => cycle?.levels || [0.95, 0.7, 0.5, 0.3, 0.1], [cycle])

  const matched = useMemo(() => {
    if (!cycle) return null
    return matchEnvelope(
      cycle.envelope, cycle.levels, cycle.noiseFrames,
      cycle.silenceFrames, cycle.cycleGapFrames, cycle.windowFrames,
    )
  }, [cycle])

  const floorRms = matched ? Math.min(...matched.perLevelRms.filter(r => r > 0.001)) || floorPeak : floorPeak || 0.001
  const hasReverbFloors = matched ? matched.perLevelReverbFloor.some(v => v > 0) : false

  const delayMs = useMemo(() => {
    if (!cycle || !matched) return null
    return Math.round(matched.delayWindows * cycle.windowFrames / cycle.sampleRate * 1000)
  }, [cycle, matched])

  // Detect clipping in per-level RMS
  const clippingLevels = useMemo(() => {
    if (!matched) return new Set<number>()
    const clip: Set<number> = new Set()
    // If any level's RMS > 0.6 it's likely clipping (noise crest factor ~3-4x RMS)
    matched.perLevelRms.forEach((r, i) => {
      if (r > 0.6) clip.add(i)
    })
    return clip
  }, [matched])

  // Compute optimal amplitude
  const optimalAmp = useMemo(() => {
    if (!matched) return null
    const targetRms = 0.173
    let bestIdx = -1
    let bestDiff = Infinity
    for (let i = 0; i < matched.perLevelRms.length; i++) {
      const r = matched.perLevelRms[i]
      if (r < 0.001) continue
      const diff = Math.abs(r - targetRms)
      if (diff < bestDiff) { bestDiff = diff; bestIdx = i }
    }
    if (bestIdx < 0) return null
    return Math.max(0.05, Math.min(1.0,
      levels[bestIdx] * (targetRms / Math.max(matched.perLevelRms[bestIdx], 1e-10))
    ))
  }, [matched, levels])

  return (
    <div className="text-xs leading-relaxed">
      {/* Level row: show RMS with clipping indicator */}
      <div className="flex gap-2 flex-wrap mb-1.5">
        {levels.map((level, i) => {
          const rms = matched?.perLevelRms[i]
          const isClipping = clippingLevels.has(i)
          return (
            <div key={level} className="flex items-center gap-1">
              <span className="text-zinc-500 font-mono w-9 text-right">{level.toFixed(2)}</span>
              <span className={`font-mono font-bold ${
                rms && rms > 0.001
                  ? isClipping
                    ? 'text-red-400'
                    : rms > floorRms * 2
                      ? 'text-emerald-400'
                      : 'text-zinc-400'
                  : 'text-zinc-700'
              }`}>
                {isClipping ? 'CLIP' : (rms && rms > 0.001 ? `${(20 * Math.log10(rms / Math.max(floorRms || 0.001, 1e-10))).toFixed(0)}dB` : '---')}
              </span>
            </div>
          )
        })}
      </div>

      {/* Meta row */}
      <div className="flex gap-3 text-zinc-400 text-[11px] flex-wrap">
        <span>Cycle: <span className="text-zinc-200 font-mono">{cycleCount}</span></span>
        <span>Floor: <span className="text-zinc-200 font-mono">{floorPeak.toFixed(4)}</span></span>
        {delayMs !== null && <span>Delay: <span className="text-zinc-200 font-mono">{delayMs}ms</span></span>}
        {matched && <span>Q: <span className="text-zinc-200 font-mono">{matched.matchQuality.toFixed(2)}</span></span>}
        {optimalAmp !== null && (
          <span>Opt: <span className="text-blue-400 font-mono font-bold">{optimalAmp.toFixed(3)}</span></span>
        )}
      </div>

      {/* Per-level details (collapsible) */}
      {cycle && matched && (
        <details className="text-[10px] text-zinc-500 mt-1">
          <summary className="cursor-pointer hover:text-zinc-300">Details</summary>
          <div className="mt-1 space-y-0.5">
            {matched.perLevelRms.map((rms, i) => {
              const snr = floorRms > 0 ? 20 * Math.log10(rms / Math.max(floorRms, 1e-10)) : -100
              const reverbFloor = matched.perLevelReverbFloor[i]
              const reverbSnr = reverbFloor > 0.001 ? 20 * Math.log10(rms / reverbFloor) : NaN
              const isClipping = clippingLevels.has(i)
              return (
                <div key={i} className="flex gap-3 font-mono">
                  <span className="w-10 text-right">{levels[i].toFixed(2)}</span>
                  <span>RMS: {rms.toFixed(4)}</span>
                  <span>SNR: {snr.toFixed(0)}dB</span>
                  {hasReverbFloors && reverbSnr !== undefined && !isNaN(reverbSnr) && (
                    <span className="text-cyan-500">{reverbSnr.toFixed(0)}dBvR</span>
                  )}
                  {isClipping && <span className="text-red-400">CLIP</span>}
                  {!hasReverbFloors && (
                    <span className={rms > floorRms * 2 ? 'text-emerald-500' : 'text-red-500'}>
                      {rms > floorRms * 2 ? 'OK' : '---'}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        </details>
      )}
    </div>
  )
}
