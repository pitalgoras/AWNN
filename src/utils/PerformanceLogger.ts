type LogSubscriber = (status: string) => void;

class PerformanceLogger {
  private subscribers: LogSubscriber[] = [];
  private logs: string[] = [];

  log(code: number, detail?: string) {
    const messages: Record<number, string> = {
      1: 'Initializing audio engine...',
      4: 'Generating metronome...',
      6: 'Updating track positions...',
      7: 'Starting recording...',
      8: 'Stopping recording...',
      10: `Importing audio: ${detail || ''}`,
      13: 'Decoding audio...',
    };
    const msg = messages[code] || `Event ${code}`;
    const timestamp = new Date().toISOString();
    const fullMsg = `[${timestamp}] ${msg}`;
    this.logs.push(fullMsg);
    this.subscribers.forEach(fn => fn(fullMsg));
  }

  subscribe(fn: LogSubscriber) {
    this.subscribers.push(fn);
    return () => {
      this.subscribers = this.subscribers.filter(s => s !== fn);
    };
  }

  downloadLog() {
    const blob = new Blob([this.logs.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `perf-log-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }
}

export const perfLogger = new PerformanceLogger();
