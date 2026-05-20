import React, { useMemo } from 'react';
import { ProbeCycleData, matchEnvelope } from '../../lib/audio/LatencyCalibrator';

interface Props {
  cycle: ProbeCycleData | null
  cycleCount: number
}

function formatDB(rms: number, floorRms: number): string {
  if (rms < 0.001) return '---'
  const snr = floorRms > 0 ? 20 * Math.log10(rms / Math.max(floorRms, 1e-10)) : -100
  return `${snr.toFixed(0)}dB`
}

export const ProbeMonitor: React.FC<Props> = ({ cycle, cycleCount }) => {
  const levels = useMemo(() => cycle?.levels || [0.95, 0.7, 0.5, 0.3, 0.1], [cycle])

  const matched = useMemo(() => {
    if (!cycle) return null
    return matchEnvelope(
      cycle.envelope, cycle.levels, cycle.noiseFrames,
      cycle.silenceFrames, cycle.cycleGapFrames, cycle.windowFrames,
    )
  }, [cycle])

  const floorRms = matched ? Math.min(...matched.perLevelRms) || 0.001 : 0.001

  // Compute optimal amplitude from current cycle
  const optimalAmp = useMemo(() => {
    if (!matched) return null
    const detectable = matched.perLevelRms.filter(r => r > floorRms * 2)
    if (detectable.length === 0) return null
    const targetRms = 0.173
    let bestRms = detectable[0]
    let bestLevel = matched.perLevelRms.indexOf(bestRms) >= 0
      ? levels[matched.perLevelRms.indexOf(bestRms)]
      : 0.5
    let bestDiff = Math.abs(bestRms - targetRms)
    for (const r of detectable) {
      const idx = matched.perLevelRms.indexOf(r)
      const lvl = levels[idx]
      const diff = Math.abs(r - targetRms)
      if (diff < bestDiff) { bestDiff = diff; bestRms = r; bestLevel = lvl }
    }
    return Math.max(0.05, Math.min(1.0, bestLevel * (targetRms / Math.max(bestRms, 1e-10))))
  }, [matched, levels, floorRms])

  return (
    <div className="text-xs leading-relaxed">
      {/* Level row */}
      <div className="flex gap-3 flex-wrap mb-1.5">
        {levels.map((level, i) => {
          const rms = matched?.perLevelRms[i]
          return (
            <div key={level} className="flex items-center gap-1">
              <span className="text-zinc-500 font-mono w-10 text-right">{level.toFixed(2)}</span>
              <span className={`font-mono font-bold ${
                rms && rms > 0.001 ? (
                  rms > floorRms * 2
                    ? (rms > 0.9 ? 'text-red-400' : 'text-emerald-400')
                    : 'text-zinc-400'
                ) : 'text-zinc-700'
              }`}>
                {rms && rms > 0.001 ? formatDB(rms, floorRms) : '---'}
              </span>
            </div>
          )
        })}
      </div>

      {/* Meta row */}
      <div className="flex gap-4 text-zinc-400 text-[11px]">
        <span>Cycle: <span className="text-zinc-200 font-mono">{cycleCount}</span></span>
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
              return (
                <div key={i} className="flex gap-3 font-mono">
                  <span className="w-10 text-right">{levels[i].toFixed(2)}</span>
                  <span>RMS: {rms.toFixed(4)}</span>
                  <span>SNR: {snr.toFixed(0)}dB</span>
                  <span className={rms > floorRms * 2 ? 'text-emerald-500' : 'text-red-500'}>
                    {rms > floorRms * 2 ? 'DETECTED' : '---'}
                  </span>
                </div>
              )
            })}
          </div>
        </details>
      )}
    </div>
  )
}
