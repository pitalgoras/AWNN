import { runMlsTest } from './test-mls';
import { runClapTest } from './test-clap';
import { computeRMS } from './analysis';

let ctx: AudioContext | null = null;
let workletNode: AudioWorkletNode | null = null;
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
const logBuffer: string[] = [];

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
  for (const id of ['btn-mls', 'btn-clap', 'btn-diagnose', 'btn-refresh', 'btn-capture-noise']) {
    const b = $(id) as HTMLButtonElement;
    b.disabled = true;
  }
  log('Initialization started...');
}

function setButtonsReady() {
  for (const id of ['btn-mls', 'btn-clap', 'btn-diagnose', 'btn-refresh', 'btn-capture-noise']) {
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
  for (const id of ['btn-mls', 'btn-clap', 'btn-diagnose']) {
    const b = $(id) as HTMLButtonElement;
    b.disabled = true;
    b.title = `Init failed: ${msg}`;
  }
  ($('btn-refresh') as HTMLButtonElement).disabled = false;
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
  const amps: number[] = [];
  for (let a = 0.05; a <= 0.80; a *= 1.5) {
    amps.push(Math.round(a * 1000) / 1000);
  }
  return amps;
}

/* ── Latency Clustering ────────────────────────────────── */

interface LatencyCluster {
  latencyMs: number;
  stddev: number;
  count: number;
  amplitudes: number[];
}

function findLatencyCluster(results: SweepResult[]): LatencyCluster | null {
  const good = results.filter(r => r.p2n >= 18 && !r.error);
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
  error?: string;
  recordedSamples: number;
  inputRms: number;
  inputPeak: number;
  endLatencyMs: number;
  endConfidence: number;
  latencySource: 'start-correlation' | 'end-detection' | 'average';
}

async function runMlsWithSweep(ctx: AudioContext, wn: AudioWorkletNode, amplitudes: number[]): Promise<SweepResult[]> {
  wn.port.postMessage({ type: 'RESET' });
  const results: SweepResult[] = [];
  for (const amp of amplitudes) {
    log(`MLS sweep: amplitude=${amp.toFixed(2)}`);
    const r = await runMlsTest(ctx, wn, { amplitude: amp });
    results.push({
      amplitude: amp,
      p2n: r.peakToNoise,
      latencyMs: r.latencyMs,
      confidence: r.confidence,
      error: r.error,
      recordedSamples: r.recordedSamples,
      inputRms: r.inputRms,
      inputPeak: r.inputPeak,
      endLatencyMs: r.endLatencyMs,
      endConfidence: r.endConfidence,
      latencySource: r.latencySource,
    });
  }
  return results;
}

function renderSweepTable(results: SweepResult[], cluster?: LatencyCluster | null) {
  const el = $('sweep-section');
  if (results.length === 0) { el.style.display = 'none'; return; }
  el.style.display = 'block';
  const best = results.reduce((a, b) => a.p2n > b.p2n ? a : b);
  let html = '<table class="sweep-table"><tr><th>Amp</th><th>P2N(dB)</th><th>Lat(ms)</th><th>End(ms)</th><th>Src</th><th>RMS</th><th>Status</th></tr>';
  for (const r of results) {
    const isBest = r === best;
    const inCluster = cluster && cluster.amplitudes.includes(r.amplitude);
    const srcLabel = r.latencySource === 'end-detection' ? 'END' : 'START';
    html += `<tr style="${inCluster ? 'background:#1e293b' : isBest ? 'background:#18181b' : ''}">
      <td>${r.amplitude.toFixed(2)}</td>
      <td style="color:${r.p2n >= 18 ? '#86efac' : '#fca5a5'}">${r.p2n.toFixed(1)}</td>
      <td>${r.latencyMs.toFixed(1)}${inCluster ? ' ←' : ''}</td>
      <td style="color:${r.endConfidence > 0.3 ? '#86efac' : '#71717a'}">${r.endLatencyMs.toFixed(1)}</td>
      <td style="font-size:10px;color:${r.latencySource === 'end-detection' ? '#fbbf24' : '#71717a'}">${srcLabel}</td>
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
      log('Mic connected to worklet');
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
  btn.disabled = true;
  btn.textContent = 'Running...';
  $('mls-result').textContent = '';

  const amplitudes = generateAmplitudes();
  const results = await runMlsWithSweep(ctx, workletNode, amplitudes);
  lastMlsResults = results;

  const cluster = findLatencyCluster(results);
  renderSweepTable(results, cluster);

  const track = micStream?.getAudioTracks()[0];
  const micDeviceId = track?.getSettings()?.deviceId || '';
  const history = getSweepHistory(micDeviceId);

  const el = $('mls-result');
  if (cluster) {
    el.className = 'result ok';
    storeSweep({ timestamp: new Date().toISOString(), userAgent: navigator.userAgent, micDeviceId, latencyMs: cluster.latencyMs, stddev: cluster.stddev, amplitudeCount: cluster.count });

    let historyHtml = '';
    if (history.length > 0) {
      const histMean = history.reduce((a, b) => a + b.latencyMs, 0) / history.length;
      const histDev = history.length > 1 ? Math.sqrt(history.reduce((a, b) => a + (b.latencyMs - histMean) ** 2, 0) / history.length) : 0;
      const allHist = [...history, { latencyMs: cluster.latencyMs }];
      const totalMean = allHist.reduce((a, b) => a + b.latencyMs, 0) / allHist.length;
      historyHtml = `<div style="font-size:10px;margin-top:4px;color:#6ee7b7">Consistent with ${history.length} previous sweeps (avg ${histMean.toFixed(1)}ms ±${histDev.toFixed(1)}ms) — all-time avg ${totalMean.toFixed(1)}ms</div>`;
    }

    el.innerHTML = `
      <div>Latency <strong>${cluster.latencyMs.toFixed(1)}ms</strong> ±${cluster.stddev.toFixed(1)}ms · ${cluster.count} amplitudes agree</div>
      <div style="font-size:10px;margin-top:4px;color:#a5b4fc">Amplitudes: ${cluster.amplitudes.map(a => a.toFixed(2)).join(', ')}</div>
      ${historyHtml}`;
    log(`MLS: cluster ${cluster.latencyMs.toFixed(1)}ms ±${cluster.stddev.toFixed(1)}ms across ${cluster.count} amplitudes`, 'ok');
  } else {
    const p2nCount = results.filter(r => r.p2n >= 18).length;
    if (p2nCount > 0) {
      el.className = 'result err';
      el.innerHTML = `<div>No cluster — ${p2nCount} amplitude(s) passed P2N but disagree on latency</div>
        <div style="font-size:10px;margin-top:4px;color:#fca5a5">${results.length} amplitudes tested, ${p2nCount} with P2N≥18dB</div>`;
      log(`MLS: no cluster — ${p2nCount}/${results.length} amplitudes with P2N≥18dB but no agreement`, 'err');
    } else {
      el.className = 'result err';
      el.innerHTML = `<div>No valid measurements — 0 amplitudes passed P2N≥18dB threshold</div>
        <div style="font-size:10px;margin-top:4px;color:#fca5a5">${results.length} amplitudes tested, check mic→speaker path</div>`;
      log(`MLS: no valid measurements — ${results.length} amplitudes all below P2N threshold`, 'err');
    }
  }

  btn.disabled = false;
  btn.textContent = 'Run MLS Auto Test';
};

$('btn-clap').onclick = async () => {
  if (!isInitialized) { if (!initFailed) await ensureWorkletReady(); return; }
  if (!ctx || !workletNode) return;
  if (ctx.state === 'suspended') await ctx.resume();

  const health = await pingWorklet(workletNode);
  if (!health.ok) {
    log(`Clap: worklet not responding (${health.error})`, 'err');
    $('clap-result').className = 'err';
    $('clap-result').innerHTML = `Worklet not responding (${health.error})<br>
      <span style="font-size:10px">ctx.state=${ctx.state}</span>`;
    return;
  }
  log(`Clap: worklet alive (frame=${health.currentFrame})`, 'ok');

  const btn = $('btn-clap') as HTMLButtonElement;
  btn.disabled = true;
  btn.textContent = 'Running...';
  $('clap-result').textContent = '';

  const bpmInput = $('bpm') as HTMLInputElement;
  const bpm = parseInt(bpmInput.value) || 120;
  const result = await runClapTest(ctx, workletNode, bpm);

  const el = $('clap-result');
  if (result.success) {
    el.className = 'result ok';
    el.innerHTML = `
      Latency: <strong>${result.latencyMs.toFixed(1)}ms</strong><br>
      Claps matched: ${result.clapCount}<br>
      StdDev: ${result.stdDev.toFixed(1)}ms<br>
      Confidence: ${(result.confidence * 100).toFixed(1)}%
    `;
    log(`Clap: latency=${result.latencyMs.toFixed(1)}ms matched=${result.clapCount}`, 'ok');
  } else {
    el.className = 'result err';
    el.innerHTML = `Failed: ${result.error}<br>
      ${result.latencyMs > 0 ? `(best guess: ${result.latencyMs.toFixed(1)}ms, ${result.clapCount} claps)` : ''}
    `;
    log(`Clap: failed — ${result.error}`, 'err');
  }

  btn.disabled = false;
  btn.textContent = 'Run Clap Test';
};

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
