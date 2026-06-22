import { runMlsTest, SAFE_AMPLITUDES, LOUD_AMPLITUDES, DEFAULT_GAPS_MS } from './test-mls';
import type { MlsResult } from './test-mls';
import { runClapTest } from './test-clap';
import type { ClapTestResult } from './test-clap';
import { runBeepTest } from './test-beeps';
import type { BeepResult } from './test-beeps';
import { runBeepFreqTest } from './test-beepfreq';
import type { BeepFreqResult } from './test-beepfreq';
import { runEarlyBeepTest } from './test-beep-early';
import type { EarlyBeepResult } from './test-beep-early';
import { runMetaFreqTest } from './test-metafreq';
import type { MetaFreqResult, MetaFreqPoint } from './test-metafreq';
import { computeRMS } from './analysis';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

interface HistoryEntry {
  amplitude: number;
  latencyMs: number;
  stdDev: number;
  matchedBursts: number;
  totalBursts: number;
  extra?: string;
}

const beepHistory: HistoryEntry[] = [];
const beepfreqHistory: HistoryEntry[] = [];
const mlsHistory: HistoryEntry[] = [];
const clapHistory: HistoryEntry[] = [];

function addToHistory(arr: HistoryEntry[], entry: HistoryEntry) {
  arr.unshift(entry);
  if (arr.length > 3) arr.length = 3;
}

function renderHistoryTable(entries: HistoryEntry[], extraLabel?: string): string {
  if (entries.length === 0) return '';
  let html = '<table class="sweep-table"><tr><th>#</th><th>Amp</th><th>Lat(ms)</th><th>σ(ms)</th><th>Match</th>';
  if (extraLabel) html += `<th>${extraLabel}</th>`;
  html += '</tr>';
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    html += `<tr>
      <td>${i + 1}</td>
      <td>${e.amplitude.toFixed(2)}</td>
      <td>${e.latencyMs.toFixed(1)}</td>
      <td>${e.stdDev.toFixed(1)}</td>
      <td style="color:${e.matchedBursts >= 3 ? '#86efac' : '#fca5a5'}">${e.matchedBursts}/${e.totalBursts}</td>`;
    if (extraLabel) html += `<td style="color:#71717a;font-size:10px">${e.extra ?? ''}</td>`;
    html += '</tr>';
  }
  html += '</table>';
  return html;
}

let ctx: AudioContext | null = null;
let workletNode: AudioWorkletNode | null = null;
let workletNodeB: AudioWorkletNode | null = null;
let micStream: MediaStream | null = null;
let outputAnalyser: AnalyserNode | null = null;
let inputAnalyser: AnalyserNode | null = null;
let isInitialized = false;
let lastMlsResults: SweepResult[] | undefined;
let healthPollTimer: ReturnType<typeof setInterval> | null = null;
let initFailed = false;
let initRunning = false;
let vuTimer: ReturnType<typeof setInterval> | null = null;
let noiseFloorRms = 0;
let noiseFloorTargetAmp = 0.2;
let feedbackEnabled = true;
let inputVuElement: HTMLDivElement;
let inputVuVal: HTMLSpanElement;
let clapAbortController: AbortController | null = null;
let isClapRunning = false;
let isEarlyRunning = false;
let isMetaFreqRunning = false;
let isReacquiring = false;
const logBuffer: string[] = [];
let deviceChangeHandler: (() => void) | null = null;

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

/* ── Logging ────────────────────────────────────────── */

function log(msg: string, className = '') {
  const ts = new Date().toISOString().slice(11, 23);
  const tag = className ? `[${className}] ` : '';
  const entry = `[${ts}] ${tag}${msg}`;
  logBuffer.push(entry);
  const el = $<HTMLTextAreaElement>('log');
  const append = el.value === '— waiting for init —' ? entry : el.value + '\n' + entry;
  el.value = append;
  el.scrollTop = el.scrollHeight;
  console.log(entry);
}

function logDiag(id: string, html: string, className = '') {
  const el = $(id);
  el.innerHTML = html;
  if (className) el.className = className;
}

function readOL(label: string) {
  const ms = ctx ? Math.round((ctx.outputLatency || 0) * 1000) : -1;
  log(`${label}: ${ms}ms outputLatency`);
  const trace = $('settle-trace');
  trace.innerHTML += `${label}: ${ms}ms<br>`;
  return ms;
}

/* ── Button State ────────────────────────────────────── */

function setButtonsLoading() {
  $('status').textContent = 'Initializing audio...';
  $('status').className = 'msg pending';
  for (const id of ['btn-mls', 'btn-beep', 'btn-beepfreq', 'btn-clap', 'btn-diagnose', 'btn-refresh', 'btn-capture-noise', 'btn-early', 'btn-metafreq', 'btn-reacquire-mic', 'btn-full-restart']) {
    const b = $(id) as HTMLButtonElement;
    b.disabled = true;
  }
  log('Initialization started...');
}

function setButtonsReady() {
  for (const id of ['btn-mls', 'btn-beep', 'btn-beepfreq', 'btn-clap', 'btn-diagnose', 'btn-refresh', 'btn-capture-noise', 'btn-early', 'btn-metafreq', 'btn-reacquire-mic', 'btn-full-restart']) {
    const b = $(id) as HTMLButtonElement;
    b.disabled = false;
  }
  log('Ready', 'ok');
}

function setButtonsFailed(msg: string) {
  initFailed = true;
  initRunning = false;
  $('status').textContent = `✗ ${msg}`;
  $('status').className = 'msg err';
  for (const id of ['btn-mls', 'btn-beep', 'btn-beepfreq', 'btn-clap', 'btn-diagnose', 'btn-early', 'btn-metafreq']) {
    const b = $(id) as HTMLButtonElement;
    b.disabled = true;
    b.title = `Init failed: ${msg}`;
  }
  ($('btn-refresh') as HTMLButtonElement).disabled = false;
  ($('btn-reacquire-mic') as HTMLButtonElement).disabled = false;
  ($('btn-full-restart') as HTMLButtonElement).disabled = false;
  log(`❌ ${msg}`, 'err');
}

/* ── VU Meter ────────────────────────────────────────── */

function setupVUMeters() {
  inputVuElement = $('vu-in');
  inputVuVal = $('vu-in-val');
}

function updateOutputVu(rms: number) {
  const el = $('vu-out');
  const val = $('vu-out-val');
  const pct = Math.min(100, rms / 0.5 * 100);
  el.style.width = `${pct}%`;
  val.textContent = `RMS ${rms.toFixed(5)} · ${(20 * Math.log10(rms + 1e-10)).toFixed(1)}dBFS`;
}

function updateInputVu(rms: number, peak: number) {
  const pct = Math.min(100, rms / 0.5 * 100);
  inputVuElement.style.width = `${pct}%`;
  inputVuVal.textContent = `RMS ${rms.toFixed(5)} · Peak ${peak.toFixed(5)} · ${(20 * Math.log10(rms + 1e-10)).toFixed(1)}dBFS`;
}

function startVUPoll() {
  stopVUPoll();
  vuTimer = setInterval(() => {
    if (outputAnalyser) {
      const buf = new Float32Array(outputAnalyser.fftSize);
      outputAnalyser.getFloatTimeDomainData(buf);
      let sumSq = 0, peak = 0;
      for (let i = 0; i < buf.length; i++) {
        const s = buf[i];
        sumSq += s * s;
        const abs = Math.abs(s);
        if (abs > peak) peak = abs;
      }
      const rms = Math.sqrt(sumSq / buf.length);
      updateOutputVu(rms);
    }
    if (inputAnalyser) {
      const buf = new Float32Array(inputAnalyser.fftSize);
      inputAnalyser.getFloatTimeDomainData(buf);
      let sumSq = 0, peak = 0;
      for (let i = 0; i < buf.length; i++) {
        const s = buf[i];
        sumSq += s * s;
        const abs = Math.abs(s);
        if (abs > peak) peak = abs;
      }
      const rms = Math.sqrt(sumSq / buf.length);
      updateInputVu(rms, peak);
    }
  }, 80);
}

function stopVUPoll() {
  if (vuTimer) { clearInterval(vuTimer); vuTimer = null; }
}

/* ── Feedback Toggle ──────────────────────────────────── */

function toggleFeedback() {
  const btn = $('btn-feedback');
  const newState = !feedbackEnabled;
  feedbackEnabled = newState;
  btn.textContent = newState ? 'Mute Feedback' : 'Unmute Feedback';
  btn.className = newState ? 'btn-secondary btn-sm' : 'btn-secondary btn-sm';
  if (workletNode) workletNode.port.postMessage({ type: 'TOGGLE_FEEDBACK', enabled: newState });
  log(`Feedback ${newState ? 'enabled' : 'muted'}`, 'ok');
}

/* ── Health Poll ─────────────────────────────────────── */

let lastProcessCount = -1;

function startHealthPoll() {
  stopHealthPoll();
  healthPollTimer = setInterval(async () => {
    if (!ctx || !workletNode) return;
    const h = await pingWorklet(workletNode, 200);
    const elapsed = ctx.currentTime.toFixed(1);
    if (h.ok) {
      logDiag('worklet-status',
        `🟢 ctx.state=${ctx.state} · currentTime=${elapsed}s · frame=${h.currentFrame} · process() calls=${h.processCount} · wl.state=${h.state}`,
        'ok');
      if (lastProcessCount === -1 || h.processCount !== lastProcessCount) {
        log(`health: process() count=${h.processCount} (+${h.processCount! - Math.max(lastProcessCount, 0)}) · worklet state=${h.state}`, 'ok');
        lastProcessCount = h.processCount!;
      }
    } else {
      logDiag('worklet-status',
        `🔴 ctx.state=${ctx.state} · currentTime=${elapsed}s · worklet ${h.error}`,
        'err');
      log(`health: worklet ${h.error}`, 'err');
    }
  }, 1000);
}

function stopHealthPoll() {
  if (healthPollTimer) { clearInterval(healthPollTimer); healthPollTimer = null; }
}

/* ── Device Info ──────────────────────────────────────── */

async function enumerateAllDevices() {
  if (!micStream) { log('No mic stream — init not complete yet', 'err'); return; }
  const track = micStream.getAudioTracks()[0];
  const settings = track?.getSettings();
  const activeId = settings?.deviceId || '';
  const allDevices = await navigator.mediaDevices.enumerateDevices();

  const html = ['<table class="device-table">',
    '<tr><th>Kind</th><th>Label</th><th title="groupId links input/output pairs on the same physical device">Group</th><th>DeviceId</th></tr>'];
  for (const d of allDevices) {
    const active = d.kind === 'audioinput' && d.deviceId === activeId;
    const shortId = d.deviceId.length > 20 ? d.deviceId.slice(0, 17) + '…' : d.deviceId;
    html.push(`<tr class="${active ? 'active' : ''}">
      <td>${d.kind.replace('audio', '')}</td>
      <td>${d.label || '(no label)'}</td>
      <td style="font-size:10px">${d.groupId.slice(0, 12)}…</td>
      <td title="${d.deviceId}">${shortId}</td>
    </tr>`);
  }
  html.push('</table>');
  $('device-list').innerHTML = html.join('');

  // Show active track settings
  const settingLines: string[] = [];
  if (settings) {
    const known = ['deviceId', 'groupId', 'channelCount', 'sampleRate', 'autoGainControl', 'echoCancellation', 'noiseSuppression'];
    for (const k of known) {
      const v = (settings as Record<string, unknown>)[k];
      if (v !== undefined) settingLines.push(`${k}: ${v}`);
    }
  }
  $('device-settings').textContent = settingLines.length ? `Active track: ${settingLines.join(', ')}` : '';
}

/* ── AEC State ──────────────────────────────────────────── */

function showAecState() {
  if (!micStream) { $('aec-state').textContent = '—'; return; }
  const track = micStream.getAudioTracks()[0];
  const settings = track?.getSettings();
  if (!settings) { $('aec-state').textContent = 'unknown'; return; }
  const ec = settings.echoCancellation;
  const ns = settings.noiseSuppression;
  const agc = settings.autoGainControl;
  const parts: string[] = [];
  if (ec !== undefined) parts.push(`AEC=${ec}`);
  if (ns !== undefined) parts.push(`NS=${ns}`);
  if (agc !== undefined) parts.push(`AGC=${agc}`);
  const el = $('aec-state');
  if (ec === false && ns === false && agc === false) {
    el.textContent = `${parts.join(', ')} ✓ raw`;
    el.style.color = '#86efac';
  } else {
    el.textContent = `${parts.join(', ')} ⚠ may process`;
    el.style.color = '#facc15';
  }
}

/* ── Device Change Auto-Reacquire ──────────────────────── */

function registerDeviceChangeHandler() {
  if (deviceChangeHandler) {
    navigator.mediaDevices.removeEventListener('devicechange', deviceChangeHandler);
  }
  deviceChangeHandler = () => {
    log('Device change detected — auto re-acquiring mic', 'ok');
    reacquireMic();
  };
  navigator.mediaDevices.addEventListener('devicechange', deviceChangeHandler);
}

/* ── Mic Re-acquire (resets AEC filter) ────────────────── */

async function reacquireMic() {
  if (!ctx || isReacquiring) return;
  isReacquiring = true;
  try {
    log('Re-acquiring mic...', 'ok');
    // Stop existing mic
    if (micStream) {
      micStream.getTracks().forEach(t => t.stop());
      micStream = null;
    }
    // Re-request
    const isChrome = /Chrome/.test(navigator.userAgent) && !/Edg/.test(navigator.userAgent);
    const audioConstraints = isChrome
      ? { echoCancellation: { exact: false }, noiseSuppression: { exact: false }, autoGainControl: { exact: false } }
      : { echoCancellation: false, noiseSuppression: false, autoGainControl: false, sampleRate: ctx.sampleRate };
    micStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints as MediaStreamConstraints });
    log('getUserMedia OK after re-acquire');

    // Reconnect to worklet nodes
    const micSrc = ctx.createMediaStreamSource(micStream);
    const mixerNode = ctx.createGain();
    mixerNode.gain.value = 1;
    micSrc.connect(inputAnalyser!);
    micSrc.connect(mixerNode);
    mixerNode.connect(workletNode!);
    if (workletNodeB) {
      const mixerB = ctx.createGain();
      mixerB.gain.value = 1;
      micSrc.connect(mixerB);
      mixerB.connect(workletNodeB);
    }
    log('Mic reconnected to worklet nodes');

    showAecState();
    enumerateAllDevices();

    // Auto-run early beep test
    log('Auto-running Early AEC Beep test after re-acquire...');
    if (ctx && workletNode) {
      const result = await runEarlyBeepTest(ctx, workletNode);
      const el = $('early-result');
      if (result.success) {
        el.className = 'result ok';
        el.innerHTML = `Latency <strong>${result.latencyMs.toFixed(1)}ms</strong> ±${result.stdDev.toFixed(1)}ms (auto after re-acquire)`;
      } else {
        el.className = 'result info';
        el.innerHTML = `Early test: ${result.error || 'no result'} — try higher amplitude or Run manually`;
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`Re-acquire failed: ${msg}`, 'err');
  } finally {
    isReacquiring = false;
  }
}

/* ── Canvas: Meta-Freq Graph ───────────────────────────── */

function renderMetaFreqGraph(canvas: HTMLCanvasElement, points: MetaFreqPoint[]) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  const ctx2d = canvas.getContext('2d');
  if (!ctx2d) return;
  ctx2d.scale(dpr, dpr);
  const w = rect.width;
  const h = rect.height;

  ctx2d.fillStyle = '#000';
  ctx2d.fillRect(0, 0, w, h);

  if (points.length < 2) return;

  const minFreq = points[0].frequencyHz;
  const maxFreq = points[points.length - 1].frequencyHz;
  const logMin = Math.log(minFreq);
  const logMax = Math.log(maxFreq);
  const logRange = logMax - logMin;

  const amps = points.map(p => p.amplitudeDb);
  const minAmp = Math.min(...amps);
  const maxAmp = Math.max(...amps);
  const ampRange = Math.max(maxAmp - minAmp, 1);

  const padX = 40;
  const padY = 20;
  const plotW = w - padX * 2;
  const plotH = h - padY * 2;

  // Grid
  ctx2d.strokeStyle = '#1c1c1f';
  ctx2d.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = padY + (i / 4) * plotH;
    ctx2d.beginPath();
    ctx2d.moveTo(padX, y);
    ctx2d.lineTo(w - padX, y);
    ctx2d.stroke();
  }

  // Plot line
  ctx2d.beginPath();
  ctx2d.strokeStyle = '#22c55e';
  ctx2d.lineWidth = 2;
  for (let i = 0; i < points.length; i++) {
    const x = padX + ((Math.log(points[i].frequencyHz) - logMin) / logRange) * plotW;
    const y = padY + (1 - (points[i].amplitudeDb - minAmp) / ampRange) * plotH;
    if (i === 0) ctx2d.moveTo(x, y);
    else ctx2d.lineTo(x, y);
  }
  ctx2d.stroke();

  // Peak marker
  const bestIdx = points.reduce((best, p, i, arr) => p.amplitudeRms > arr[best].amplitudeRms ? i : best, 0);
  const bestX = padX + ((Math.log(points[bestIdx].frequencyHz) - logMin) / logRange) * plotW;
  const bestY = padY + (1 - (points[bestIdx].amplitudeDb - minAmp) / ampRange) * plotH;
  ctx2d.beginPath();
  ctx2d.arc(bestX, bestY, 5, 0, Math.PI * 2);
  ctx2d.fillStyle = '#fbbf24';
  ctx2d.fill();

  // Axis labels
  ctx2d.fillStyle = '#71717a';
  ctx2d.font = '9px monospace';
  const freqLabels = [points[0], points[Math.floor(points.length / 2)], points[points.length - 1]];
  for (const fl of freqLabels) {
    const x = padX + ((Math.log(fl.frequencyHz) - logMin) / logRange) * plotW;
    ctx2d.fillText(`${fl.frequencyHz}Hz`, x - 15, h - 4);
  }
  ctx2d.fillText(`${minAmp.toFixed(0)}dB`, 2, padY + 10);
  ctx2d.fillText(`${maxAmp.toFixed(0)}dB`, 2, h - padY);
  ctx2d.fillStyle = '#fbbf24';
  ctx2d.fillText(`★ ${points[bestIdx].frequencyHz}Hz`, bestX - 20, Math.max(bestY - 8, 10));
}

/* ── Canvas: Clap Waveform ─────────────────────────────── */

function renderClapWaveform(
  canvas: HTMLCanvasElement,
  recorded: Float32Array,
  beatMs: number[],
  clapMs: number[],
  latencyMs: number,
) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  const ctx2d = canvas.getContext('2d');
  if (!ctx2d) return;
  ctx2d.scale(dpr, dpr);
  const w = rect.width;
  const h = rect.height;

  ctx2d.fillStyle = '#18181b';
  ctx2d.fillRect(0, 0, w, h);

  const len = recorded.length;
  if (len === 0) return;

  // Draw waveform
  const midY = h / 2;
  const blockSize = Math.ceil(len / w);
  ctx2d.beginPath();
  ctx2d.moveTo(0, midY);
  for (let x = 0; x < w; x++) {
    const start = Math.floor(x * len / w);
    const end = Math.floor((x + 1) * len / w);
    let peak = 0;
    for (let j = start; j < end && j < len; j++) peak = Math.max(peak, Math.abs(recorded[j]));
    ctx2d.lineTo(x, midY - peak * midY * 0.8);
  }
  ctx2d.strokeStyle = '#3b82f6';
  ctx2d.lineWidth = 1;
  ctx2d.stroke();

  // Draw beat markers (gold vertical lines)
  for (const bm of beatMs) {
    const x = (bm / (len / 44100) / (len / 44100)) * w;  // normalize
    const xPos = (bm / 1000) / (recorded.length / 44100 / 1000) * w;
    ctx2d.beginPath();
    ctx2d.moveTo(xPos, 0);
    ctx2d.lineTo(xPos, h);
    ctx2d.strokeStyle = '#fbbf24';
    ctx2d.lineWidth = 1;
    ctx2d.setLineDash([2, 3]);
    ctx2d.stroke();
    ctx2d.setLineDash([]);
  }

  // Draw clap markers (cyan vertical lines)
  for (const cm of clapMs) {
    const xPos = (cm / 1000) / (recorded.length / 44100 / 1000) * w;
    ctx2d.beginPath();
    ctx2d.moveTo(xPos, 0);
    ctx2d.lineTo(xPos, h);
    ctx2d.strokeStyle = '#22d3ee';
    ctx2d.lineWidth = 2;
    ctx2d.stroke();
  }

  // Center line
  ctx2d.beginPath();
  ctx2d.moveTo(w / 2, 0);
  ctx2d.lineTo(w / 2, h);
  ctx2d.strokeStyle = '#52525b';
  ctx2d.lineWidth = 1;
  ctx2d.setLineDash([4, 4]);
  ctx2d.stroke();
  ctx2d.setLineDash([]);

  ctx2d.fillStyle = '#71717a';
  ctx2d.font = '9px monospace';
  ctx2d.fillText(`${beatMs.length} beats, ${clapMs.length} claps, ${latencyMs.toFixed(0)}ms offset`, 4, 12);
}

/* ── Noise Floor ──────────────────────────────────────── */

async function captureNoiseFloor() {
  if (!ctx || !workletNode) {
    log('Noise floor: context not ready', 'err');
    return;
  }
  const wn = workletNode;
  log('Capturing noise floor (0.5s silence)...');
  $('btn-capture-noise').textContent = 'Capturing...';
  ($('btn-capture-noise') as HTMLButtonElement).disabled = true;

  const sr = ctx.sampleRate;
  const duration = Math.round(0.5 * sr);
  const startFrame = Math.round((ctx.currentTime + 0.1) * sr);

  const recorded = await new Promise<Float32Array>((resolve, reject) => {
    const timeout = setTimeout(() => { cleanup(); reject(new Error('timeout')); }, 5000);
    const handler = (e: MessageEvent) => {
      if (e.data.type === 'RESULT') {
        clearTimeout(timeout);
        cleanup();
        resolve(e.data.frames);
      }
    };
    const cleanup = () => wn.port.removeEventListener('message', handler);
    wn.port.addEventListener('message', handler);
    wn.port.postMessage({ type: 'START', startFrame, duration });
  });

  noiseFloorRms = computeRMS(recorded);
  const noiseFloorDb = 20 * Math.log10(noiseFloorRms + 1e-10);
  noiseFloorTargetAmp = Math.max(0.02, Math.min(0.8, noiseFloorRms * 20));

  $('nf-rms').textContent = noiseFloorRms.toFixed(6);
  $('nf-rms').className = '';
  $('nf-dbfs').textContent = `${noiseFloorDb.toFixed(1)}dBFS`;
  $('nf-dbfs').className = '';
  $('nf-target').textContent = `${noiseFloorTargetAmp.toFixed(3)}`;
  $('nf-target').className = '';

  showGainHint(noiseFloorDb);
  log(`Noise floor: ${noiseFloorDb.toFixed(1)}dBFS RMS=${noiseFloorRms.toFixed(6)} targetAmp=${noiseFloorTargetAmp.toFixed(3)}`, 'ok');

  ($('btn-capture-noise') as HTMLButtonElement).disabled = false;
  $('btn-capture-noise').textContent = 'Capture Noise Floor';
};

function showGainHint(_noiseFloorDb: number) {
  // Noise floor is unreliable with Bluetooth noise gates — no gain advice
  $('gain-hint').textContent = '';
}

/* ── Amplitude Ladder ──────────────────────────────────── */

function generateAmplitudes(): number[] {
  const loudMode = ($('mls-loud-mode') as HTMLInputElement).checked;
  return loudMode ? [...LOUD_AMPLITUDES] : [...SAFE_AMPLITUDES];
}

function readMlsGaps(): number[] {
  const raw = ($('mls-gaps') as HTMLInputElement).value;
  const gaps = raw.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n) && n > 0);
  return gaps.length >= 4 ? gaps.slice(0, 4) : [...DEFAULT_GAPS_MS];
}

/* ── Latency Clustering ────────────────────────────────── */

interface LatencyCluster {
  latencyMs: number;
  stddev: number;
  count: number;
  amplitudes: number[];
}

function findLatencyCluster(results: SweepResult[]): LatencyCluster | null {
  const good = results.filter(r => r.matchedBursts >= 3 && !r.error);
  if (good.length < 2) return null;

  const bins = new Map<number, SweepResult[]>();
  for (const r of good) {
    const bin = Math.round(r.latencyMs / 5) * 5;
    if (!bins.has(bin)) bins.set(bin, []);
    bins.get(bin)!.push(r);
  }

  let largest: SweepResult[] = [];
  for (const group of bins.values()) {
    if (group.length > largest.length) largest = group;
  }
  if (largest.length < 2) return null;

  const latencies = largest.map(r => r.latencyMs);
  const mean = latencies.reduce((a, b) => a + b, 0) / latencies.length;
  const variance = latencies.reduce((a, b) => a + (b - mean) ** 2, 0) / latencies.length;
  return { latencyMs: mean, stddev: Math.sqrt(variance), count: largest.length, amplitudes: largest.map(r => r.amplitude) };
}

/* ── Sweep History (localStorage) ──────────────────────── */

const HISTORY_KEY = 'awnn-cal-history';

interface SweepHistoryEntry {
  timestamp: string;
  userAgent: string;
  micDeviceId: string;
  latencyMs: number;
  stddev: number;
  amplitudeCount: number;
}

function getSweepHistory(micDeviceId: string): SweepHistoryEntry[] {
  try {
    const all: SweepHistoryEntry[] = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    return all.filter(h => h.userAgent === navigator.userAgent && h.micDeviceId === micDeviceId);
  } catch { return []; }
}

function storeSweep(entry: SweepHistoryEntry) {
  try {
    const all: SweepHistoryEntry[] = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    const mine = all.filter(h => h.userAgent === navigator.userAgent && h.micDeviceId === entry.micDeviceId);
    const others = all.filter(h => !(h.userAgent === navigator.userAgent && h.micDeviceId === entry.micDeviceId));
    mine.push(entry);
    while (mine.length > 5) mine.shift();
    localStorage.setItem(HISTORY_KEY, JSON.stringify([...others, ...mine]));
  } catch { /* localStorage may be full */ }
}

/* ── MLS with Level Sweep ─────────────────────────────── */

interface SweepResult {
  amplitude: number;
  p2n: number;
  latencyMs: number;
  confidence: number;
  stdDev: number;
  matchedBursts: number;
  totalBursts: number;
  error?: string;
  recordedSamples: number;
  inputRms: number;
  inputPeak: number;
  matchedExpectedSamples: number[];
  matchedDetectedSamples: number[];
  xcorrLatencyMs: number;
  xcorrConfidence: number;
}

async function runMlsWithSweep(ctx: AudioContext, wn: AudioWorkletNode, amplitudes: number[], gapMs: number[], bandpass: boolean): Promise<SweepResult[]> {
  wn.port.postMessage({ type: 'RESET' });
  const results: SweepResult[] = [];
  for (const amp of amplitudes) {
    log(`MLS sweep: amplitude=${amp.toFixed(2)}`);
    const r = await runMlsTest(ctx, wn, { amplitude: amp, gapMs, bandpass });
    results.push({
      amplitude: amp,
      p2n: r.p2n,
      latencyMs: r.latencyMs,
      confidence: r.confidence,
      stdDev: r.stdDev,
      matchedBursts: r.matchedBursts,
      totalBursts: r.totalBursts,
      error: r.error,
      recordedSamples: r.recordedSamples,
      inputRms: r.inputRms,
      inputPeak: r.inputPeak,
      matchedExpectedSamples: r.matchedExpectedSamples,
      matchedDetectedSamples: r.matchedDetectedSamples,
      xcorrLatencyMs: r.xcorrLatencyMs,
      xcorrConfidence: r.xcorrConfidence,
    });
  }
  return results;
}

function renderSweepTable(results: SweepResult[], cluster?: LatencyCluster | null) {
  const el = $('sweep-section');
  if (results.length === 0) { el.style.display = 'none'; return; }
  el.style.display = 'block';
  const best = results.reduce((a, b) => a.matchedBursts > b.matchedBursts ? a : b);
  let html = '<table class="sweep-table"><tr><th>Amp</th><th>Edge#</th><th>Lat(ms)</th><th>σ(ms)</th><th>P2N(dB)</th><th>RMS</th><th>Status</th></tr>';
  for (const r of results) {
    const isBest = r === best;
    const inCluster = cluster && cluster.amplitudes.includes(r.amplitude);
    const edgeRatio = r.totalBursts > 0 ? `${r.matchedBursts}/${r.totalBursts}` : '—';
    html += `<tr style="${inCluster ? 'background:#1e293b' : isBest ? 'background:#18181b' : ''}">
      <td>${r.amplitude.toFixed(2)}</td>
      <td style="color:${r.matchedBursts >= 3 ? '#86efac' : '#fca5a5'}">${edgeRatio}</td>
      <td>${r.latencyMs.toFixed(1)}${inCluster ? ' ←' : ''}</td>
      <td style="color:${r.stdDev < 30 ? '#86efac' : '#fca5a5'}">${r.stdDev.toFixed(1)}</td>
      <td style="color:#71717a;font-size:10px">${r.p2n > 0 ? r.p2n.toFixed(1) : '—'}</td>
      <td>${r.inputRms.toFixed(5)}</td>
      <td>${r.error ? '✗' : '✓'}</td>
    </tr>`;
  }
  if (cluster) {
    html += `<tr style="background:#1e1b4b;font-weight:600">
      <td colspan="7" style="padding:6px;color:#a5b4fc;font-size:11px">
        Cluster: ${cluster.latencyMs.toFixed(1)}ms ±${cluster.stddev.toFixed(1)}ms across ${cluster.count} amplitudes (${cluster.amplitudes.map(a => a.toFixed(2)).join(', ')})
      </td>
    </tr>`;
  }
  html += '</table>';
  $('sweep-table-container').innerHTML = html;
}

/* ── AudioWorklet Init ──────────────────────────────── */

async function ensureWorkletReady(gestureType?: string): Promise<boolean> {
  if (isInitialized && ctx && workletNode) return true;
  if (initRunning) return false;
  initRunning = true;

  const isRealGesture = !gestureType || REAL_GESTURES.has(gestureType);

  try {
    // ─── Create AudioContext ───
    if (!ctx) {
      logDiag('worklet-status', 'Creating AudioContext...', 'pending');
      ctx = new AudioContext({ sampleRate: 44100, latencyHint: 0 });
      log('Created AudioContext');
      readOL('T0: after new AudioContext()');
    }

    // ─── Load worklet module ───
    if (!workletNode) {
      $('status').textContent = 'Loading worklet module...';
      logDiag('worklet-status', 'Loading worklet module...', 'pending');
      await ctx.audioWorklet.addModule('/worklets/calibration-test.worklet.js');
      log('addModule OK');
      readOL('T3: after addModule');

      $('status').textContent = 'Creating AudioWorkletNode...';
      logDiag('worklet-status', 'Creating AudioWorkletNode...', 'pending');

      workletNode = new AudioWorkletNode(ctx, 'test-recorder', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        channelCount: 1,
        channelCountMode: 'explicit',
      });

      workletNode.addEventListener('processorerror', () => {
        log(`⚠ processorerror: worklet-side error occurred!`, 'err');
        logDiag('worklet-status', `🔴 processorerror — worklet crashed`, 'err');
      });
      workletNode.port.addEventListener('messageerror', (e: Event) => {
        log(`⚠ messageerror on port: ${e}`, 'err');
      });

      let heartbeatCount = 0;
      workletNode.port.addEventListener('message', (e: MessageEvent) => {
        if (e.data.type === 'HEARTBEAT') {
          heartbeatCount++;
          logDiag('heartbeat-status',
            `💓 heartbeat #${heartbeatCount} · process() calls=${e.data.processCount}`,
            'ok');
        }
      });
      workletNode.port.start();

      log('AudioWorkletNode created');
      readOL('T4: after AudioWorkletNode');

      // ─── Create workletNodeB for overlapping chunks ───
      workletNodeB = new AudioWorkletNode(ctx, 'test-recorder', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        channelCount: 1,
        channelCountMode: 'explicit',
      });
      workletNodeB.port.start();
      log('AudioWorkletNodeB created');
    }

    // ─── Setup output audio graph (no mic needed yet) ───
    if (!outputAnalyser) {
      log('Setting up output audio graph...');
      $('status').textContent = 'Connecting audio graph...';
      logDiag('worklet-status', 'Connecting audio graph...', 'pending');

      const mixer = ctx.createGain();
      mixer.gain.value = 1;

      const extActivator = ctx.createOscillator();
      extActivator.frequency.value = 20;
      const extActivatorGain = ctx.createGain();
      extActivatorGain.gain.value = 0.001;
      extActivator.connect(extActivatorGain);
      extActivatorGain.connect(mixer);
      extActivator.start();

      mixer.connect(workletNode);

      outputAnalyser = ctx.createAnalyser();
      outputAnalyser.fftSize = 1024;
      outputAnalyser.smoothingTimeConstant = 0.3;
      workletNode.connect(outputAnalyser);
      workletNodeB?.connect(outputAnalyser);
      outputAnalyser.connect(ctx.destination);

      inputAnalyser = ctx.createAnalyser();
      inputAnalyser.fftSize = 1024;
      inputAnalyser.smoothingTimeConstant = 0.3;

      log('Output graph ready (20Hz activator → mixer → worklet → outputAnalyser → destination)');
      readOL('T5: after connect');
    }

    // ─── Resume AudioContext ───
    if (ctx.state === 'suspended') {
      $('status').textContent = 'Resuming AudioContext...';
      log(`ctx.state=suspended, calling resume() (gesture: ${gestureType || 'none'}, isReal: ${isRealGesture})...`);
      try {
        await Promise.race([
          ctx.resume(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('resume timed out')), 3000)),
        ]);
      } catch (e) {
        log(`ctx.resume() failed (${e})`, 'err');
        // Not a real gesture — register one-shot click listener to complete init later
        if (!isRealGesture) {
          const onTap = () => {
            document.removeEventListener('click', onTap);
            document.removeEventListener('touchstart', onTap);
            log('Tap detected — completing init');
            ensureWorkletReady('click');
          };
          document.addEventListener('click', onTap, { once: true });
          document.addEventListener('touchstart', onTap, { once: true });
          $('status').textContent = '⏳ Tap the screen to activate audio';
          $('status').className = 'msg';
        } else {
          $('status').textContent = `✗ AudioContext resume failed — try Force Init`;
          $('status').className = 'msg err';
        }
        initRunning = false;
        return false;
      }
      log(`ctx.state=${ctx.state} after resume()`);
    }
    readOL('T1: after resume()');

    // ─── Get mic access ───
    if (!micStream) {
      $('status').textContent = 'Requesting microphone access...';
      logDiag('worklet-status', 'Requesting mic permission...', 'pending');

      const isChrome = /Chrome/.test(navigator.userAgent) && !/Edg/.test(navigator.userAgent);
      const audioConstraints = isChrome
        ? { echoCancellation: { exact: false }, noiseSuppression: { exact: false }, autoGainControl: { exact: false } }
        : { echoCancellation: false, noiseSuppression: false, autoGainControl: false, sampleRate: ctx.sampleRate };
      micStream = await Promise.race([
        navigator.mediaDevices.getUserMedia({ audio: audioConstraints }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('getUserMedia timed out after 10s')), 10000)),
      ]);
      log('getUserMedia OK');
      readOL('T2: after getUserMedia');

      const micSrc = ctx.createMediaStreamSource(micStream);
      const mixerNode = ctx.createGain();
      mixerNode.gain.value = 1;
      micSrc.connect(inputAnalyser!);
      micSrc.connect(mixerNode);
      mixerNode.connect(workletNode!);
      const mixerNodeB = ctx.createGain();
      mixerNodeB.gain.value = 1;
      micSrc.connect(mixerNodeB);
      mixerNodeB.connect(workletNodeB!);
      log('Mic connected to both worklet nodes');
    }

    // ─── Settle + display ───
    const probe = (delay: number, label: string) =>
      new Promise<void>(r => setTimeout(() => { readOL(label); r(); }, delay));

    await probe(0, 'T6: yield(0)');
    await probe(50, 'T7: yield(50ms)');
    await probe(100, 'T8: yield(+100ms)');

    const settledMs = readOL('T9: settled');
    $('status').textContent = `✓ Audio initialized (${ctx.state})`;
    $('status').className = 'ok';
    $('outputLat').textContent = `${settledMs}ms`;
    $('baseLat').textContent = `${Math.round((ctx.baseLatency || 0) * 1000)}ms`;
    $('heuristic').textContent = `${Math.round(2 * settledMs)}ms`;

    const track = micStream!.getAudioTracks()[0];
    const settings = track.getSettings();
    const inputId = settings.deviceId || '';
    const inputLabel = track.label || 'Unknown mic';
    const allDevices = await navigator.mediaDevices.enumerateDevices();
    const inputName = allDevices.find(d => d.kind === 'audioinput' && d.deviceId === inputId)?.label || inputLabel;
    const outputId = (ctx as AudioContext & { sinkId?: string }).sinkId || '';
    const outputName = outputId
      ? allDevices.find(d => d.kind === 'audiooutput' && d.deviceId === outputId)?.label || outputId
      : '(system default)';
    $('inputDevice').textContent = inputName;
    $('inputDevice').title = inputId;
    $('outputDevice').textContent = outputName;
    $('outputDevice').title = outputId || 'default';

    ($('settle-trace') as HTMLDivElement).innerHTML += `<span class="settled">→ used: ${settledMs}ms for heuristic</span><br>`;

    isInitialized = true;
    initRunning = false;
    log('✅ ensureWorkletReady() complete', 'ok');
    logDiag('worklet-status', '✅ Worklet ready — PING to verify', 'ok');

    setButtonsReady();
    startHealthPoll();
    startVUPoll();

    enumerateAllDevices();

    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`❌ init failed: ${msg}`, 'err');
    setButtonsFailed(msg);
    return false;
  }
}

/* ── Init ────────────────────────────────────────── */

setupVUMeters();

const REAL_GESTURES = new Set(['touchstart', 'click', 'mousedown', 'keydown']);
const GESTURE_EVENTS = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'click', 'scroll'];

function triggerInit(event: Event) {
  if (isInitialized) {
    // Init complete — cleanup listeners so no further calls
    GESTURE_EVENTS.forEach(e => window.removeEventListener(e, triggerInit, { capture: true }));
    return;
  }
  log(`Triggered by ${event.type}`);
  ensureWorkletReady(event.type);
}

GESTURE_EVENTS.forEach(e => window.addEventListener(e, triggerInit, { capture: true, passive: true }));

/* ── PING/PONG ────────────────────────────────────────── */

async function pingWorklet(
  node: AudioWorkletNode,
  timeoutMs = 1000,
): Promise<{ ok: boolean; currentFrame?: number; state?: string; processCount?: number; onmessageCount?: number; error?: string }> {
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve({ ok: false, error: 'no pong' }), timeoutMs);
    const handler = (e: MessageEvent) => {
      if (e.data.type === 'PONG') {
        clearTimeout(timer);
        node.port.removeEventListener('message', handler);
        resolve({
          ok: true,
          currentFrame: e.data.currentFrame,
          state: e.data.state,
          processCount: e.data.processCount,
          onmessageCount: e.data.onmessageCount,
        });
      }
    };
    node.port.addEventListener('message', handler);
    node.port.postMessage({ type: 'PING' });
  });
}

/* ── Diagnose ────────────────────────────────────────── */

async function runDiagnose() {
  const diag = $('diag-result');
  diag.innerHTML = 'Running diagnostics...';

  const lines: string[] = [];
  lines.push(`navigator.userAgent: ${navigator.userAgent}`);

  if (!ctx) {
    lines.push('AudioContext: null');
    diag.innerHTML = lines.join('<br>');
    return;
  }

  lines.push(`ctx.state: ${ctx.state}`);
  lines.push(`ctx.sampleRate: ${ctx.sampleRate}`);
  lines.push(`ctx.currentTime: ${ctx.currentTime.toFixed(3)}s`);
  lines.push(`ctx.baseLatency: ${(ctx.baseLatency * 1000).toFixed(1)}ms`);
  lines.push(`ctx.outputLatency: ${((ctx.outputLatency || 0) * 1000).toFixed(1)}ms`);
  lines.push(`expectedFrame: ${Math.round(ctx.currentTime * ctx.sampleRate)}`);

  if (micStream) {
    const track = micStream.getAudioTracks()[0];
    const settings = track?.getSettings();
    lines.push(`mic track: ${track?.label || 'unknown'}`);
    lines.push(`mic deviceId: ${settings?.deviceId || 'unknown'}`);
    lines.push(`mic channelCount: ${settings?.channelCount || 'unknown'}`);
  }

  lines.push(`noiseFloor: ${noiseFloorRms.toFixed(6)} (${(20 * Math.log10(noiseFloorRms + 1e-10)).toFixed(1)}dBFS)`);

  if (workletNode) {
    const h = await pingWorklet(workletNode, 200);
    if (h.ok) {
      lines.push(`PONG: OK`);
      lines.push(`  currentFrame: ${h.currentFrame}`);
      lines.push(`  process() count: ${h.processCount}`);
      lines.push(`  onmessage count: ${h.onmessageCount}`);
      lines.push(`  worklet state: ${h.state}`);

      const times: number[] = [];
      for (let i = 0; i < 5; i++) {
        const t0 = performance.now();
        const r = await pingWorklet(workletNode, 500);
        if (r.ok) times.push(performance.now() - t0);
      }
      if (times.length > 0) {
        const avg = times.reduce((a, b) => a + b, 0) / times.length;
        lines.push(`PING roundtrip: avg ${avg.toFixed(1)}ms (${times.join(', ')}ms)`);
      }
    } else {
      lines.push(`PONG: FAILED — ${h.error}`);
    }
  } else {
    lines.push(`AudioWorkletNode: not created yet`);
  }

  diag.innerHTML = lines.join('<br>');
  log('Diagnose complete');
}

/* ── Diagnostics Dump ─────────────────────────────────── */

function buildDiagnosticsDump(mlsResults?: SweepResult[]) {
  const track = micStream?.getAudioTracks()[0];
  const settings = track?.getSettings();
  return {
    timestamp: new Date().toISOString(),
    userNote: ($('user-note') as HTMLInputElement).value || '(none)',
    userAgent: navigator.userAgent,
    platform: {
      os: navigator.platform,
      vendor: navigator.vendor,
      language: navigator.language,
    },
    audioContext: ctx ? {
      state: ctx.state,
      sampleRate: ctx.sampleRate,
      currentTime: ctx.currentTime.toFixed(3),
      baseLatencyMs: (ctx.baseLatency * 1000).toFixed(1),
      outputLatencyMs: ((ctx.outputLatency || 0) * 1000).toFixed(1),
    } : null,
    devices: micStream ? {
      activeTrack: {
        label: track?.label,
        deviceId: settings?.deviceId,
        groupId: settings?.groupId,
        channelCount: settings?.channelCount,
      },
    } : null,
    noiseFloor: {
      rms: noiseFloorRms,
      dbFS: 20 * Math.log10(noiseFloorRms + 1e-10),
      targetAmplitude: noiseFloorTargetAmp,
    },
    mlsResults: mlsResults ?? [],
    log: logBuffer,
  };
}

function downloadJSON(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/* ── Click Handlers ──────────────────────────────────── */

$('btn-mls').onclick = async () => {
  if (!isInitialized) { if (!initFailed) await ensureWorkletReady(); return; }
  if (!ctx || !workletNode) return;
  if (ctx.state === 'suspended') await ctx.resume();

  const health = await pingWorklet(workletNode);
  if (!health.ok) {
    log(`MLS: worklet not responding (${health.error})`, 'err');
    $('mls-result').className = 'err';
    $('mls-result').innerHTML = `Worklet not responding (${health.error})<br>
      <span style="font-size:10px">ctx.state=${ctx.state} · expectedFrame=${Math.round(ctx.currentTime * ctx.sampleRate)} · process()=${health.processCount ?? '?'}</span>`;
    return;
  }
  log(`MLS: worklet alive (frame=${health.currentFrame}, processCount=${health.processCount})`, 'ok');

  const btn = $('btn-mls') as HTMLButtonElement;
  const loopCb = $('mls-loop') as HTMLInputElement;
  btn.disabled = true;

  do {
    btn.textContent = loopCb.checked ? 'Looping...' : 'Running...';
    $('mls-result').textContent = '';

    const gapMs = readMlsGaps();
    const amplitudes = generateAmplitudes();
    const mlsBP = ($('mls-bp') as HTMLInputElement).checked;
    log(`MLS sweep: gaps=[${gapMs.join(',')}]ms, loudMode=${($('mls-loud-mode') as HTMLInputElement).checked}, bp=${mlsBP}`, 'ok');
    const results = await runMlsWithSweep(ctx, workletNode, amplitudes, gapMs, mlsBP);
    lastMlsResults = results;

    const cluster = findLatencyCluster(results);
    renderSweepTable(results, cluster);

    const track = micStream?.getAudioTracks()[0];
    const micDeviceId = track?.getSettings()?.deviceId || '';
    const localHistory = getSweepHistory(micDeviceId);

    const el = $('mls-result');
    if (cluster) {
      el.className = 'result ok';
      storeSweep({ timestamp: new Date().toISOString(), userAgent: navigator.userAgent, micDeviceId, latencyMs: cluster.latencyMs, stddev: cluster.stddev, amplitudeCount: cluster.count });

      let historyHtml = '';
      if (localHistory.length > 0) {
        const histMean = localHistory.reduce((a, b) => a + b.latencyMs, 0) / localHistory.length;
        const histDev = localHistory.length > 1 ? Math.sqrt(localHistory.reduce((a, b) => a + (b.latencyMs - histMean) ** 2, 0) / localHistory.length) : 0;
        const allHist = [...localHistory, { latencyMs: cluster.latencyMs }];
        const totalMean = allHist.reduce((a, b) => a + b.latencyMs, 0) / allHist.length;
        historyHtml = `<div style="font-size:10px;margin-top:4px;color:#6ee7b7">Consistent with ${localHistory.length} previous sweeps (avg ${histMean.toFixed(1)}ms ±${histDev.toFixed(1)}ms) — all-time avg ${totalMean.toFixed(1)}ms</div>`;
      }

      const best = results.reduce((a, b) => a.matchedBursts > b.matchedBursts ? a : b);
      const edgeHtml = best.matchedExpectedSamples.length > 0 ? renderMlsEdgeTable(best) : '';

      el.innerHTML = `
        <div>Latency <strong>${cluster.latencyMs.toFixed(1)}ms</strong> ±${cluster.stddev.toFixed(1)}ms · ${cluster.count} amplitudes agree</div>
        <div style="font-size:10px;margin-top:4px;color:#a5b4fc">Amplitudes: ${cluster.amplitudes.map(a => a.toFixed(2)).join(', ')}</div>
        ${historyHtml}
        ${edgeHtml}`;
      log(`MLS: cluster ${cluster.latencyMs.toFixed(1)}ms ±${cluster.stddev.toFixed(1)}ms across ${cluster.count} amplitudes`, 'ok');

      addToHistory(mlsHistory, {
        amplitude: cluster.amplitudes[0] ?? 0,
        latencyMs: cluster.latencyMs,
        stdDev: cluster.stddev,
        matchedBursts: cluster.count,
        totalBursts: amplitudes.length,
        extra: `${cluster.amplitudes.length}amps`,
      });
    } else {
      const edgeCount = results.filter(r => r.matchedBursts >= 3).length;
      if (edgeCount > 0) {
        el.className = 'result err';
        el.innerHTML = `<div>No cluster — ${edgeCount} amplitude(s) matched edges but disagree on latency</div>
          <div style="font-size:10px;margin-top:4px;color:#fca5a5">${results.length} amplitudes tested, ${edgeCount} with ≥3 edge matches</div>`;
        log(`MLS: no cluster — ${edgeCount}/${results.length} amplitudes with ≥3 edges but no agreement`, 'err');
      } else {
        el.className = 'result err';
        el.innerHTML = `<div>No valid measurements — 0 amplitudes matched ≥3 edges</div>
          <div style="font-size:10px;margin-top:4px;color:#fca5a5">${results.length} amplitudes tested, try louder amplitudes or shorter gaps</div>`;
        log(`MLS: no valid measurements — ${results.length} amplitudes all below edge threshold`, 'err');
      }
    }
    $('mls-history').innerHTML = renderHistoryTable(mlsHistory, 'Info');

    if (!loopCb.checked) break;
    await sleep(1500);
  } while (true);

  btn.disabled = false;
  btn.textContent = 'Run MLS Auto Test';
};

$('btn-clap').onclick = async () => {
  if (!isInitialized) { if (!initFailed) await ensureWorkletReady(); return; }
  if (!ctx || !workletNode || !workletNodeB) return;
  if (ctx.state === 'suspended') await ctx.resume();

  const btn = $('btn-clap') as HTMLButtonElement;

  if (clapAbortController) {
    clapAbortController.abort();
    clapAbortController = null;
    btn.textContent = 'Start Clap Test';
    return;
  }

  const health = await pingWorklet(workletNode);
  if (!health.ok) {
    log(`Clap: worklet not responding (${health.error})`, 'err');
    $('clap-result').className = 'err';
    $('clap-result').innerHTML = `Worklet not responding (${health.error})`;
    return;
  }

  clapAbortController = new AbortController();
  const signal = clapAbortController.signal;
  isClapRunning = true;
  btn.textContent = 'Stop';
  $('clap-result').textContent = '';
  $('clap-chunks-container').textContent = '';

  const bpm = parseInt(($('clap-bpm') as HTMLInputElement).value) || 120;
  const chunkSizeSec = parseInt(($('clap-chunk') as HTMLInputElement).value) || 2;
  const gapMs = parseInt(($('clap-gap') as HTMLInputElement).value) || 150;

  const chunkDisplay: string[] = [];
  const onProgress = (chunk: ClapChunk) => {
    const icon = chunk.confidence > 0.3 ? '✓' : '✗';
    chunkDisplay.push(`${icon} chunk #${chunk.idx}: ${chunk.latencyMs.toFixed(1)}ms ±${chunk.stdDev.toFixed(1)}ms (${chunk.matchedClaps}/${chunk.totalBeats} claps)`);
    $('clap-chunks-container').innerHTML = chunkDisplay.join('<br>');
  };

  const result = await runClapTest(ctx, [workletNode, workletNodeB], { bpm, chunkSizeSec, gapMs }, onProgress, signal);

  const el = $('clap-result');
  if (result.success) {
    el.className = 'result ok';
    el.innerHTML = `
      Latency: <strong>${result.latencyMs.toFixed(1)}ms</strong><br>
      Chunks used: ${result.chunksUsed}/${result.chunks.length}<br>
      StdDev: ${result.stdDev.toFixed(1)}ms<br>
      Confidence: ${(result.confidence * 100).toFixed(1)}%
    `;
    log(`Clap: latency=${result.latencyMs.toFixed(1)}ms chunks=${result.chunksUsed}/${result.chunks.length}`, 'ok');
  } else if (signal.aborted) {
    if (result.chunks.length > 0) {
      el.className = 'result info';
      el.innerHTML = `Stopped early — best estimate: <strong>${result.latencyMs.toFixed(1)}ms</strong> ±${result.stdDev.toFixed(1)}ms<br>Chunks: ${result.chunks.length} collected, ${result.chunksUsed} valid`;
      log(`Clap: stopped early — ${result.latencyMs.toFixed(1)}ms ${result.chunks.length} chunks`, 'ok');
    } else {
      el.className = 'result info';
      el.innerHTML = 'Stopped — no chunks collected';
    }
  } else {
    el.className = 'result err';
    el.innerHTML = `Failed: ${result.error}<br>${result.chunks.length > 0 ? `Best guess: ${result.latencyMs.toFixed(1)}ms, ${result.chunksUsed} valid chunks` : ''}`;
    log(`Clap: failed — ${result.error}`, 'err');
  }

  addToHistory(clapHistory, {
    amplitude: 0,
    latencyMs: result.latencyMs,
    stdDev: result.stdDev,
    matchedBursts: result.matchedClaps,
    totalBursts: result.totalBeats || 1,
  });
  $('clap-history').innerHTML = renderHistoryTable(clapHistory);

  btn.textContent = 'Start Clap Test';
  clapAbortController = null;
  isClapRunning = false;
};

$('btn-early').onclick = async () => {
  if (!isInitialized) { if (!initFailed) await ensureWorkletReady(); return; }
  if (!ctx || !workletNode) return;
  if (ctx.state === 'suspended') await ctx.resume();

  const health = await pingWorklet(workletNode);
  if (!health.ok) {
    log(`Early: worklet not responding (${health.error})`, 'err');
    $('early-result').className = 'err';
    $('early-result').innerHTML = `Worklet not responding (${health.error})`;
    return;
  }

  const btn = $('btn-early') as HTMLButtonElement;
  btn.disabled = true;

  const amp = parseFloat(($('early-amp') as HTMLInputElement).value) || 0.4;
  const result = await runEarlyBeepTest(ctx, workletNode, amp);

  const el = $('early-result');
  if (result.success) {
    el.className = 'result ok';
    el.innerHTML = `Latency: <strong>${result.latencyMs.toFixed(1)}ms</strong> ±${result.stdDev.toFixed(1)}ms<br>Trailing edges matched: ${result.matchedBursts}/${result.totalBursts}<br>Confidence: ${(result.confidence * 100).toFixed(1)}%`;
    log(`Early: latency=${result.latencyMs.toFixed(1)}ms matched=${result.matchedBursts}/${result.totalBursts}`, 'ok');
  } else {
    el.className = 'result err';
    el.innerHTML = `Failed: ${result.error}<br>${result.matchedBursts > 0 ? `Best match: ${result.latencyMs.toFixed(1)}ms, ${result.matchedBursts}/${result.totalBursts}` : ''}`;
    log(`Early: failed — ${result.error}`, 'err');
  }

  btn.disabled = false;
};

$('btn-metafreq').onclick = async () => {
  if (!isInitialized) { if (!initFailed) await ensureWorkletReady(); return; }
  if (!ctx || !workletNode) return;
  if (ctx.state === 'suspended') await ctx.resume();

  const health = await pingWorklet(workletNode);
  if (!health.ok) {
    log(`MetaFreq: worklet not responding (${health.error})`, 'err');
    return;
  }

  const btn = $('btn-metafreq') as HTMLButtonElement;
  btn.disabled = true;

  const progressEl = $('metafreq-progress');
  const canvas = $('metafreq-graph') as HTMLCanvasElement;
  const bestEl = $('metafreq-best');
  const resultEl = $('metafreq-result');

  const result = await runMetaFreqTest(ctx, workletNode, (point, done, total) => {
    progressEl.textContent = `${done}/${total} — ${point.frequencyHz}Hz: ${point.amplitudeDb.toFixed(1)}dB`;
  });

  progressEl.textContent = '';
  canvas.style.display = 'block';
  renderMetaFreqGraph(canvas, result.points);

  if (result.success) {
    bestEl.textContent = `★ Best frequency: ${result.peakFrequencyHz}Hz (${result.peakAmplitudeDb.toFixed(1)}dB)`;
    resultEl.className = 'result ok';
    resultEl.textContent = `${result.points.length} frequencies scanned`;
    resultEl.style.display = 'block';
    log(`MetaFreq: peak at ${result.peakFrequencyHz}Hz (${result.peakAmplitudeDb.toFixed(1)}dB)`, 'ok');
  } else {
    bestEl.textContent = '';
    resultEl.className = 'result err';
    resultEl.textContent = `Scan failed: ${result.error}`;
    resultEl.style.display = 'block';
    log(`MetaFreq: failed — ${result.error}`, 'err');
  }

  btn.disabled = false;
};

$('btn-beepfreq').onclick = async () => {
  if (!isInitialized) { if (!initFailed) await ensureWorkletReady(); return; }
  if (!ctx || !workletNode) return;
  if (ctx.state === 'suspended') await ctx.resume();

  const health = await pingWorklet(workletNode);
  if (!health.ok) {
    log(`BeepFreq: worklet not responding (${health.error})`, 'err');
    $('beepfreq-result').className = 'err';
    $('beepfreq-result').innerHTML = `Worklet not responding (${health.error})`;
    return;
  }
  log(`BeepFreq: worklet alive (frame=${health.currentFrame})`, 'ok');

  const btn = $('btn-beepfreq') as HTMLButtonElement;
  const loopCb = $('beepfreq-loop') as HTMLInputElement;
  btn.disabled = true;

  do {
    btn.textContent = loopCb.checked ? 'Looping...' : 'Running...';
    $('beepfreq-result').textContent = '';

    const freqHz = parseInt(($('beepfreq-freq') as HTMLInputElement).value) || 4000;
    const beepFreqAmp = parseFloat(($('beepfreq-amp') as HTMLInputElement).value) || 0.5;
    const useBP = ($('beepfreq-bp') as HTMLInputElement).checked;
    const result = await runBeepFreqTest(ctx, workletNode, { frequencyHz: freqHz, amplitude: beepFreqAmp, bandpass: useBP });

    const el = $('beepfreq-result');
    if (result.success) {
      el.className = 'result ok';
      el.innerHTML = `
        Latency: <strong>${result.latencyMs.toFixed(1)}ms</strong> ±${result.stdDev.toFixed(1)}ms<br>
        Trailing edges matched: ${result.matchedBursts}/${result.totalBursts} @ ${result.frequencyHz}Hz ${useBP ? '(filtered)' : '(raw)'}<br>
        Confidence: ${(result.confidence * 100).toFixed(1)}%<br>
        <div style="font-size:10px;margin-top:4px;color:#6ee7b7">
          Heuristic: ${Math.round(2 * (ctx!.outputLatency || 0) * 1000)}ms · Noise floor: ${(20 * Math.log10(result.noiseFloorRms + 1e-10)).toFixed(1)}dBFS · Peak: ${(20 * Math.log10(result.peakRms + 1e-10)).toFixed(1)}dBFS
        </div>
        ${renderBeepFreqEdgeTable(result)}`;
      log(`BeepFreq: latency=${result.latencyMs.toFixed(1)}ms ±${result.stdDev.toFixed(1)}ms matched=${result.matchedBursts}/${result.totalBursts} @ ${result.frequencyHz}Hz`, 'ok');
    } else {
      el.className = 'result err';
      el.innerHTML = `Failed: ${result.error}<br>
        ${result.matchedBursts > 0 ? `<span style="font-size:11px">Best match: ${result.latencyMs.toFixed(1)}ms, ${result.matchedBursts}/${result.totalBursts} bursts @ ${result.frequencyHz}Hz</span>` : ''}
        <div style="font-size:10px;margin-top:4px;color:#a1a1aa">Noise floor: ${(20 * Math.log10(result.noiseFloorRms + 1e-10)).toFixed(1)}dBFS · Detected edges: ${result.detectedEdges.length}</div>
        ${result.matchedBursts > 0 ? renderBeepFreqEdgeTable(result) : ''}`;
      log(`BeepFreq: failed — ${result.error}`, 'err');
    }

    addToHistory(beepfreqHistory, {
      amplitude: beepFreqAmp,
      latencyMs: result.latencyMs,
      stdDev: result.stdDev,
      matchedBursts: result.matchedBursts,
      totalBursts: result.totalBursts,
      extra: `${result.frequencyHz}Hz${useBP ? ' BP' : ' raw'}`,
    });
    $('beepfreq-history').innerHTML = renderHistoryTable(beepfreqHistory, 'Freq');

    if (!loopCb.checked) break;
    await sleep(1500);
  } while (true);

  btn.disabled = false;
  btn.textContent = 'Run Beep Freq Test';
};

function renderBeepFreqEdgeTable(result: BeepFreqResult): string {
  if (result.matchedDetectedSamples.length === 0 && result.detectedEdges.length === 0) return '';
  const sr = ctx?.sampleRate || 44100;
  let html = '<table class="sweep-table" style="margin-top:6px"><tr><th>#</th><th>Expected (smp)</th><th>Detected (smp)</th><th>Offset (ms)</th></tr>';
  for (let i = 0; i < result.matchedDetectedSamples.length; i++) {
    const offsetMs = ((result.matchedDetectedSamples[i] - result.matchedExpectedSamples[i]) / sr) * 1000;
    html += `<tr>
      <td>${i + 1}</td>
      <td>${result.matchedExpectedSamples[i]}</td>
      <td>${result.matchedDetectedSamples[i]}</td>
      <td style="color:${Math.abs(offsetMs - result.latencyMs) < result.stdDev * 1.5 ? '#86efac' : '#fca5a5'}">${offsetMs.toFixed(1)}</td>
    </tr>`;
  }
  html += '</table>';
  return html;
}

$('btn-beep').onclick = async () => {
  if (!isInitialized) { if (!initFailed) await ensureWorkletReady(); return; }
  if (!ctx || !workletNode) return;
  if (ctx.state === 'suspended') await ctx.resume();

  const health = await pingWorklet(workletNode);
  if (!health.ok) {
    log(`Beep: worklet not responding (${health.error})`, 'err');
    $('beep-result').className = 'err';
    $('beep-result').innerHTML = `Worklet not responding (${health.error})`;
    return;
  }
  log(`Beep: worklet alive (frame=${health.currentFrame})`, 'ok');

  const btn = $('btn-beep') as HTMLButtonElement;
  const loopCb = $('beep-loop') as HTMLInputElement;
  btn.disabled = true;

  do {
    btn.textContent = loopCb.checked ? 'Looping...' : 'Running...';
    $('beep-result').textContent = '';

    const beepAmp = parseFloat(($('beep-amp') as HTMLInputElement).value) || 0.3;
    const result = await runBeepTest(ctx, workletNode, beepAmp);

    const el = $('beep-result');
    if (result.success) {
      el.className = 'result ok';
      el.innerHTML = `
        Latency: <strong>${result.latencyMs.toFixed(1)}ms</strong> ±${result.stdDev.toFixed(1)}ms<br>
        Trailing edges matched: ${result.matchedBursts}/${result.totalBursts}<br>
        Confidence: ${(result.confidence * 100).toFixed(1)}%<br>
        <div style="font-size:10px;margin-top:4px;color:#6ee7b7">
          Heuristic: ${Math.round(2 * (ctx!.outputLatency || 0) * 1000)}ms · Noise floor: ${(20 * Math.log10(result.noiseFloorRms + 1e-10)).toFixed(1)}dBFS · Peak: ${(20 * Math.log10(result.peakRms + 1e-10)).toFixed(1)}dBFS
        </div>
        ${renderBeepEdgeTable(result)}`;
      log(`Beep: latency=${result.latencyMs.toFixed(1)}ms ±${result.stdDev.toFixed(1)}ms matched=${result.matchedBursts}/${result.totalBursts}`, 'ok');
    } else {
      el.className = 'result err';
      el.innerHTML = `Failed: ${result.error}<br>
        ${result.matchedBursts > 0 ? `<span style="font-size:11px">Best match: ${result.latencyMs.toFixed(1)}ms, ${result.matchedBursts}/${result.totalBursts} bursts</span>` : ''}
        <div style="font-size:10px;margin-top:4px;color:#a1a1aa">Noise floor: ${(20 * Math.log10(result.noiseFloorRms + 1e-10)).toFixed(1)}dBFS · Detected edges: ${result.detectedEdges.length}</div>
        ${result.matchedBursts > 0 ? renderBeepEdgeTable(result) : ''}`;
      log(`Beep: failed — ${result.error}`, 'err');
    }

    addToHistory(beepHistory, {
      amplitude: beepAmp,
      latencyMs: result.latencyMs,
      stdDev: result.stdDev,
      matchedBursts: result.matchedBursts,
      totalBursts: result.totalBursts,
    });
    $('beep-history').innerHTML = renderHistoryTable(beepHistory);

    if (!loopCb.checked) break;
    await sleep(1500);
  } while (true);

  btn.disabled = false;
  btn.textContent = 'Run Beep Test';
};

// Beep amplitude slider live value display
const beepAmpSlider = $('beep-amp') as HTMLInputElement;
const beepAmpVal = $('beep-amp-val');
if (beepAmpSlider && beepAmpVal) {
  beepAmpSlider.addEventListener('input', () => {
    beepAmpVal.textContent = parseFloat(beepAmpSlider.value).toFixed(2);
  });
}

// BeepFreq frequency slider live value display
const beepFreqSlider = $('beepfreq-freq') as HTMLInputElement;
const beepFreqVal = $('beepfreq-freq-val');
if (beepFreqSlider && beepFreqVal) {
  beepFreqSlider.addEventListener('input', () => {
    beepFreqVal.textContent = beepFreqSlider.value;
  });
}

// BeepFreq amplitude slider live value display
const beepFreqAmpSlider = $('beepfreq-amp') as HTMLInputElement;
const beepFreqAmpVal = $('beepfreq-amp-val');
if (beepFreqAmpSlider && beepFreqAmpVal) {
  beepFreqAmpSlider.addEventListener('input', () => {
    beepFreqAmpVal.textContent = parseFloat(beepFreqAmpSlider.value).toFixed(2);
  });
}

// Clap BPM slider live value display
const clapBpmSlider = $('clap-bpm') as HTMLInputElement;
const clapBpmVal = $('clap-bpm-val');
if (clapBpmSlider && clapBpmVal) {
  clapBpmSlider.addEventListener('input', () => {
    clapBpmVal.textContent = clapBpmSlider.value;
  });
}

// Clap chunk size slider live value display
const clapChunkSlider = $('clap-chunk') as HTMLInputElement;
const clapChunkVal = $('clap-chunk-val');
if (clapChunkSlider && clapChunkVal) {
  clapChunkSlider.addEventListener('input', () => {
    clapChunkVal.textContent = clapChunkSlider.value;
  });
}

// Clap gap slider live value display
const clapGapSlider = $('clap-gap') as HTMLInputElement;
const clapGapVal = $('clap-gap-val');
if (clapGapSlider && clapGapVal) {
  clapGapSlider.addEventListener('input', () => {
    clapGapVal.textContent = clapGapSlider.value;
  });
}

// Early amplitude slider live value display
const earlyAmpSlider = $('early-amp') as HTMLInputElement;
const earlyAmpVal = $('early-amp-val');
if (earlyAmpSlider && earlyAmpVal) {
  earlyAmpSlider.addEventListener('input', () => {
    earlyAmpVal.textContent = parseFloat(earlyAmpSlider.value).toFixed(2);
  });
}

function renderBeepEdgeTable(result: BeepResult): string {
  if (result.matchedDetectedSamples.length === 0 && result.detectedEdges.length === 0) return '';
  let html = '<table class="sweep-table" style="margin-top:6px"><tr><th>#</th><th>Expected (smp)</th><th>Detected (smp)</th><th>Offset (ms)</th></tr>';
  for (let i = 0; i < result.matchedDetectedSamples.length; i++) {
    const offsetMs = ((result.matchedDetectedSamples[i] - result.matchedExpectedSamples[i]) / 44100) * 1000;
    html += `<tr>
      <td>${i + 1}</td>
      <td>${result.matchedExpectedSamples[i]}</td>
      <td>${result.matchedDetectedSamples[i]}</td>
      <td style="color:${Math.abs(offsetMs - result.latencyMs) < result.stdDev * 1.5 ? '#86efac' : '#fca5a5'}">${offsetMs.toFixed(1)}</td>
    </tr>`;
  }
  html += '</table>';
  return html;
}

function renderMlsEdgeTable(result: SweepResult): string {
  if (result.matchedDetectedSamples.length === 0) return '';
  const sr = ctx?.sampleRate || 44100;
  let html = '<table class="sweep-table" style="margin-top:6px"><tr><th>#</th><th>Expected (smp)</th><th>Detected (smp)</th><th>Offset (ms)</th></tr>';
  for (let i = 0; i < result.matchedDetectedSamples.length; i++) {
    const offsetMs = ((result.matchedDetectedSamples[i] - result.matchedExpectedSamples[i]) / sr) * 1000;
    html += `<tr>
      <td>${i + 1}</td>
      <td>${result.matchedExpectedSamples[i]}</td>
      <td>${result.matchedDetectedSamples[i]}</td>
      <td style="color:${Math.abs(offsetMs - result.latencyMs) < result.stdDev * 1.5 || result.stdDev === 0 ? '#86efac' : '#fca5a5'}">${offsetMs.toFixed(1)}</td>
    </tr>`;
  }
  if (result.p2n > 0) {
    html += `<tr style="background:#1e1b4b"><td colspan="4" style="padding:4px;color:#a5b4fc;font-size:10px">
      Cross-correlation: ${result.xcorrLatencyMs.toFixed(1)}ms · P2N ${result.p2n.toFixed(1)}dB · conf ${result.xcorrConfidence.toFixed(3)}
    </td></tr>`;
  }
  html += '</table>';
  return html;
}

$('btn-refresh').onclick = async () => {
  if (!ctx) return;
  if (ctx.state === 'suspended') await ctx.resume();
  const ol = Math.round((ctx.outputLatency || 0) * 1000);
  const bl = Math.round((ctx.baseLatency || 0) * 1000);
  $('outputLat').textContent = `${ol}ms`;
  $('baseLat').textContent = `${bl}ms`;
  $('heuristic').textContent = `${Math.round(2 * ol)}ms`;
  const trace = $('settle-trace');
  trace.innerHTML += `<span class="settled">→ Refresh: ${ol}ms</span><br>`;
  log(`Refresh: outputLat=${ol}ms, baseLat=${bl}ms`);
};

$('btn-init').onclick = () => ensureWorkletReady();

$('btn-reacquire-mic').onclick = reacquireMic;

$('btn-full-restart').onclick = async () => {
  log('Full engine restart...');
  stopHealthPoll();
  stopVUPoll();
  if (clapAbortController) {
    clapAbortController.abort();
    clapAbortController = null;
  }
  if (micStream) {
    micStream.getTracks().forEach(t => t.stop());
    micStream = null;
  }
  if (ctx) {
    await ctx.close();
    ctx = null;
  }
  workletNode = null;
  workletNodeB = null;
  outputAnalyser = null;
  inputAnalyser = null;
  isInitialized = false;
  initFailed = false;
  initRunning = false;
  lastProcessCount = -1;
  $('outputLat').textContent = '—';
  $('baseLat').textContent = '—';
  $('heuristic').textContent = '—';
  $('settle-trace').innerHTML = '';
  $('worklet-status').className = 'msg pending';
  $('worklet-status').textContent = '⏳ Re-initializing...';
  log('State reset — re-acquiring audio...');
  await ensureWorkletReady();
};

$('btn-diagnose').onclick = runDiagnose;

$('btn-capture-noise').onclick = captureNoiseFloor;

$('btn-feedback').onclick = toggleFeedback;

$('btn-refresh-devices').onclick = enumerateAllDevices;

$('btn-copy-log').onclick = async () => {
  const text = ($('log') as HTMLTextAreaElement).value;
  try {
    await navigator.clipboard.writeText(text);
    log('Log copied to clipboard', 'ok');
  } catch {
    // Fallback: select all
    const ta = $('log') as HTMLTextAreaElement;
    ta.select();
    document.execCommand('copy');
    log('Log copied (fallback)', 'ok');
  }
};

$('btn-download-log').onclick = () => {
  const text = ($('log') as HTMLTextAreaElement).value;
  downloadJSON({ log: text }, `awnn-cal-log-${Date.now()}.json`);
  log('Log downloaded', 'ok');
};

$('btn-download-dump').onclick = () => {
  const dump = buildDiagnosticsDump();
  downloadJSON(dump, `awnn-cal-diagnostics-${Date.now()}.json`);
  log('Diagnostics downloaded', 'ok');
};

$('btn-upload-dump').onclick = async () => {
  const btn = $('btn-upload-dump') as HTMLButtonElement;
  const urlEl = $('upload-url');
  btn.disabled = true;
  btn.textContent = 'Uploading...';
  log('Uploading diagnostics...');
  try {
    const dump = buildDiagnosticsDump(lastMlsResults);
    const res = await fetch('/api/upload-debug-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(dump),
    });
    const data = await res.json() as { url?: string; error?: string };
    if (data.url) {
      urlEl.innerHTML = `<a href="${data.url}" target="_blank" style="color:#86efac">${data.url}</a>`;
      log(`Diagnostics uploaded: ${data.url}`, 'ok');
    } else {
      urlEl.textContent = `Upload failed: ${data.error || 'unknown'}`;
      urlEl.style.color = '#fca5a5';
      log(`Upload failed: ${data.error}`, 'err');
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    urlEl.textContent = `Upload error: ${msg}`;
    urlEl.style.color = '#fca5a5';
    log(`Upload error: ${msg}`, 'err');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Upload Diagnostics';
  }
};

/* ── Cleanup ──────────────────────────────────────────── */

window.addEventListener('beforeunload', () => {
  stopHealthPoll();
  stopVUPoll();
  micStream?.getTracks().forEach(t => t.stop());
  ctx?.close();
});
