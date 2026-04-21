export const formatTime = (seconds: number) => {
  const isNegative = seconds < 0;
  const absSeconds = Math.abs(seconds);
  const mins = Math.floor(absSeconds / 60);
  const secs = Math.floor(absSeconds % 60);
  const ms = Math.floor((absSeconds % 1) * 100);
  const sign = isNegative ? '-' : '';
  return `${sign}${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
};

export const formatBarBeat = (time: number, bpm: number, timeSignature: [number, number]) => {
  if (time < 0) return 'PRE';
  const beatsPerSecond = bpm / 60;
  const secondsPerBeat = 1 / beatsPerSecond;
  const beatsPerBar = timeSignature[0];
  const totalBeats = Math.floor(time / secondsPerBeat);
  const bar = Math.floor(totalBeats / beatsPerBar) + 1;
  const beat = (totalBeats % beatsPerBar) + 1;
  return `${bar}.${beat}`;
};
