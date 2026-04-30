export const LogIndex = {
  1: "Initializing Audio Engine",
  2: "Loading audio for Track {0}",
  3: "Generating waveform for Track {0}, Phrase {1}",
  4: "Generating metronome buffer",
  5: "Rendering multitrack canvas",
  6: "Syncing track position for Track {0}",
  7: "Starting recording on Track {0}",
  8: "Stopping recording",
  9: "Processing recorded audio",
  10: "Importing audio file {0}",
  11: "Updating zoom level to {0}",
  12: "Overlap solver: {0}",
  13: "Decoding audio data",
  14: "Multitrack initAllAudios",
  15: "Multitrack initWavesurfer for Track {0}",
  16: "Multitrack addTrack {0}",
  17: "Idle"
};

type LogEntry = [number, number, string | number | undefined, string | number | undefined];

class Logger {
  private logs: LogEntry[] = [];
  private currentStatus: string = "Idle";
  private listeners: Set<(status: string) => void> = new Set();
  private idleTimeout: number | null = null;

  log(id: keyof typeof LogIndex, paramA?: string | number, paramB?: string | number) {
    const now = performance.now();
    this.logs.push([now, id, paramA, paramB]);
    
    let msg = LogIndex[id];
    if (paramA !== undefined) msg = msg.replace('{0}', String(paramA));
    if (paramB !== undefined) msg = msg.replace('{1}', String(paramB));
    
    this.currentStatus = msg;
    this.notify();

    // Auto-idle after 2 seconds of no new logs
    if (this.idleTimeout) window.clearTimeout(this.idleTimeout);
    this.idleTimeout = window.setTimeout(() => {
      this.currentStatus = "Idle";
      this.notify();
    }, 2000);
  }

  setStatus(msg: string) {
    this.currentStatus = msg;
    this.notify();
  }

  subscribe(fn: (status: string) => void) {
    this.listeners.add(fn);
    fn(this.currentStatus);
    return () => { this.listeners.delete(fn); };
  }

  private notify() {
    this.listeners.forEach(fn => fn(this.currentStatus));
  }

  generateLogFile() {
    let out = "--- MESSAGE INDEX ---\n";
    for (const [id, msg] of Object.entries(LogIndex)) {
      out += `${id}: ${msg}\n`;
    }
    out += "\n--- EVENT LOG (Time ms, Msg ID, Param A, Param B) ---\n";
    for (const entry of this.logs) {
      out += `${entry[0].toFixed(2)}, ${entry[1]}, ${entry[2] ?? ''}, ${entry[3] ?? ''}\n`;
    }
    return out;
  }

  downloadLog() {
    const blob = new Blob([this.generateLogFile()], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `performance_log_${new Date().toISOString()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }
}

export const perfLogger = new Logger();
