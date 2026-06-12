import React, { useEffect } from 'react';
import { useStore } from '../store/useStore';
import { AlertTriangle, Eye, RotateCcw, X } from 'lucide-react';

interface Props {
  onOpenCalibration: () => void;
}

export const DeviceChangeBanner: React.FC<Props> = ({ onOpenCalibration }) => {
  const deviceChangeNotif = useStore(s => s.deviceChangeNotif);
  const deviceLatencyCache = useStore(s => s.deviceLatencyCache);
  const setDeviceChangeNotif = useStore(s => s.setDeviceChangeNotif);

  useEffect(() => {
    if (!deviceChangeNotif) return;
    const timer = setTimeout(() => setDeviceChangeNotif(null), 6000);
    return () => clearTimeout(timer);
  }, [deviceChangeNotif, setDeviceChangeNotif]);

  if (!deviceChangeNotif) return null;

  const cachedProfile = deviceLatencyCache[deviceChangeNotif.deviceFingerprint];
  const isKnown = !!cachedProfile;

  return (
    <div className="fixed top-0 left-0 right-0 z-[9999] flex justify-center pointer-events-none">
      <div className={`pointer-events-auto mt-2 mx-2 max-w-lg w-full rounded-lg border shadow-lg transition-all ${
        isKnown
          ? 'bg-zinc-800 border-zinc-700'
          : 'bg-amber-900/80 border-amber-600'
      }`}>
        <div className="flex items-start gap-2 p-3">
          <AlertTriangle className={`w-4 h-4 shrink-0 mt-0.5 ${isKnown ? 'text-zinc-400' : 'text-amber-300'}`} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <span className={`text-[11px] font-bold ${isKnown ? 'text-zinc-200' : 'text-amber-100'}`}>
                Audio device changed
              </span>
              <button onClick={() => setDeviceChangeNotif(null)} className={`p-0.5 rounded transition-colors ${isKnown ? 'hover:bg-zinc-700 text-zinc-500' : 'hover:bg-amber-800 text-amber-300'}`}>
                <X className="w-3 h-3" />
              </button>
            </div>
            <div className="mt-1 text-[10px] leading-snug text-zinc-400">
              <span className="font-mono">{deviceChangeNotif.deviceFingerprint}</span>
              <span className="mx-1">&middot;</span>
              <span>out={deviceChangeNotif.outputLatencyMs}ms base={deviceChangeNotif.baseLatencyMs}ms</span>
            </div>
            {isKnown ? (
              <div className="mt-1.5 flex items-center gap-2">
                <span className="text-[9px] text-emerald-400 font-mono">
                  Stored: {cachedProfile.totalRoundtripMs}ms
                  {cachedProfile.captureOutputLatencyMs !== undefined && (
                    <span className="text-zinc-500">
                      {' '}(Δhw={cachedProfile.totalRoundtripMs - (cachedProfile.captureOutputLatencyMs + cachedProfile.captureBaseLatencyMs)}ms)
                    </span>
                  )}
                </span>
                <button
                  onClick={() => { setDeviceChangeNotif(null); onOpenCalibration(); }}
                  className="text-[9px] text-zinc-400 hover:text-zinc-200 underline underline-offset-2 font-medium flex items-center gap-0.5"
                >
                  <RotateCcw className="w-2.5 h-2.5" />
                  Recalibrate
                </button>
              </div>
            ) : (
              <div className="mt-1.5">
                <button
                  onClick={() => { setDeviceChangeNotif(null); onOpenCalibration(); }}
                  className="inline-flex items-center gap-1 px-2 py-1 bg-amber-600 hover:bg-amber-500 text-white rounded text-[9px] font-bold transition-colors"
                >
                  <Eye className="w-2.5 h-2.5" />
                  Calibrate
                </button>
                <span className="ml-1.5 text-[9px] text-amber-300/70">Recommended for new device</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
