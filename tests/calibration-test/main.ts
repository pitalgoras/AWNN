import { runMlsTest } from './test-mls';
import { runClapTest } from './test-clap';
import { computeRMS } from './analysis';

let ctx: AudioContext | null = null;
let workletNode: AudioWorkletNode | null = null;
let micStream: MediaStream | null = null;
let outputAnalyser: AnalyserNode | null = null;
let inputAnalyser: AnalyserNode | null = null;
let isInitialized = false;
let healthPollTimer: ReturnType<typeof setInterval> | null = null;
let initFailed = false;
let initRunning = false;
let vuTimer: ReturnType<typeof setInterval> | null = null;
let noiseFloorRms = 0;
let noiseFloorTargetAmp = 0.2;
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
  if (!micStream) return;
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

function showGainHint(noiseFloorDb: number) {
  const hint = $('gain-hint');
  const isMobile = /Android|iPhone|iPad|iPod|webOS/i.test(navigator.userAgent);
  if (isMobile) {
    hint.textContent = '📱 Mic gain not adjustable on this platform. Ensure mic is close to speaker.';
    return;
  }
  if (noiseFloorDb < -50) {
    hint.textContent = '🔊 Mic level seems very low. Increase system mic gain (Settings → Sound → Input → raise mic volume).';
  } else if (noiseFloorDb > -20) {
    hint.textContent = '🔉 Mic level is high (noisy environment or gain too high). Decrease system mic gain if possible.';
  } else {
    hint.textContent = '✓ Mic level looks reasonable.';
  }
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
}

async function runMlsWithSweep(ctx: AudioContext, wn: AudioWorkletNode, amplitudes: number[]): Promise<SweepResult[]> {
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
    });
    // Stop early if strong result
    if (r.peakToNoise >= 18 && r.success) break;
  }
  return results;
}

function renderSweepTable(results: SweepResult[]) {
  const el = $('sweep-section');
  if (results.length === 0) { el.style.display = 'none'; return; }
  el.style.display = 'block';
  const best = results.reduce((a, b) => a.p2n > b.p2n ? a : b);
  let html = '<table class="sweep-table"><tr><th>Amp</th><th>P2N(dB)</th><th>Latency(ms)</th><th>RMS</th><th>Status</th></tr>';
  for (const r of results) {
    const isBest = r === best;
    html += `<tr style="${isBest ? 'background:#1e293b' : ''}">
      <td>${r.amplitude.toFixed(2)}</td>
      <td style="color:${r.p2n >= 18 ? '#86efac' : '#fca5a5'}">${r.p2n.toFixed(1)}</td>
      <td>${r.latencyMs.toFixed(1)}</td>
      <td>${r.inputRms.toFixed(5)}</td>
      <td>${r.error ? '✗' : '✓'}</td>
    </tr>`;
  }
  html += '</table>';
  $('sweep-table-container').innerHTML = html;
}

/* ── AudioWorklet Init ──────────────────────────────── */

async function ensureWorkletReady(): Promise<boolean> {
  if (isInitialized && ctx && workletNode) return true;
  if (initRunning) return false;
  initRunning = true;

  setButtonsLoading();

  try {
    logDiag('worklet-status', 'Creating AudioContext...', 'pending');

    ctx = new AudioContext({ sampleRate: 44100, latencyHint: 0 });
    log('Created AudioContext');
    readOL('T0: after new AudioContext()');

    $('status').textContent = 'Resuming AudioContext...';
    if (ctx.state === 'suspended') {
      log(`ctx.state=suspended, calling resume()...`);
      await ctx.resume();
      log(`ctx.state=${ctx.state} after resume()`);
    }
    readOL('T1: after resume()');

    $('status').textContent = 'Requesting microphone access...';
    logDiag('worklet-status', 'Requesting mic permission...', 'pending');

    const isChrome = /Chrome/.test(navigator.userAgent) && !/Edg/.test(navigator.userAgent);
    const audioConstraints = isChrome
      ? { echoCancellation: { exact: false }, noiseSuppression: { exact: false }, autoGainControl: { exact: false } }
      : { echoCancellation: false, noiseSuppression: false, autoGainControl: false, sampleRate: ctx.sampleRate };
    micStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
    log('getUserMedia OK');
    readOL('T2: after getUserMedia');

    const micSrc = ctx.createMediaStreamSource(micStream);

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

    // Persistent heartbeat listener
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

    log('AudioWorkletNode created (context is running)');
    readOL('T4: after AudioWorkletNode');

    $('status').textContent = 'Connecting audio graph...';
    logDiag('worklet-status', 'Connecting audio graph...', 'pending');

    // Audio graph:
    //   micSrc ──→ inputAnalyser  (tap, no intercept — parallel read-only VU)
    //          ──→ mixer ──→ worklet ──→ outputAnalyser ──→ destination
    //              ↑
    //   extActivator (20Hz@0.001) — keeps worklet input non-null for Chrome
    // Worklet also generates internal 20Hz@0.02 for audible monitoring.
    // During recording, worklet mutes mic pass-through in output to prevent probe
    // feedback, but the activators continue.
    const mixer = ctx.createGain();
    mixer.gain.value = 1;
    inputAnalyser = ctx.createAnalyser();
    inputAnalyser.fftSize = 1024;
    inputAnalyser.smoothingTimeConstant = 0.3;
    micSrc.connect(inputAnalyser);
    micSrc.connect(mixer);

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

    log('Audio graph: mic + 20Hz@0.001 → mixer → worklet → destination (+ internal 20Hz@0.02)');
    readOL('T5: after connect');

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

    const track = micStream.getAudioTracks()[0];
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

    // Auto-enumerate devices
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

function triggerInit() {
  GESTURE_EVENTS.forEach(e => window.removeEventListener(e, triggerInit, { capture: true }));
  log('First gesture detected — starting initialization');
  ensureWorkletReady();
}

const GESTURE_EVENTS = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'click', 'scroll'];
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

  // Determine amplitudes to sweep
  const amplitudes = noiseFloorTargetAmp > 0
    ? [noiseFloorTargetAmp, 0.1, 0.2, 0.4, 0.6]
    : [0.05, 0.1, 0.2, 0.4, 0.6];
  // Deduplicate and sort
  const uniqueAmps = [...new Set(amplitudes.map(a => Math.round(a * 100) / 100))].sort();

  const results = await runMlsWithSweep(ctx, workletNode, uniqueAmps);

  renderSweepTable(results);
  const best = results.reduce((a, b) => a.p2n > b.p2n ? a : b);

  const el = $('mls-result');
  if (best.p2n >= 18 && !best.error) {
    el.className = 'result ok';
    el.innerHTML = `
      <div>Amp ${best.amplitude.toFixed(2)}: Latency <strong>${best.latencyMs.toFixed(1)}ms</strong> · P2N ${best.peakToNoise.toFixed(1)}dB</div>
      <div style="font-size:10px;margin-top:4px;color:#6ee7b7">${results.length} sweep(s), best amp=${best.amplitude.toFixed(2)}</div>`;
    log(`MLS: latency=${best.latencyMs.toFixed(1)}ms P2N=${best.p2n.toFixed(1)}dB amp=${best.amplitude.toFixed(2)}`, 'ok');
  } else if (best.latencyMs > 0) {
    el.className = 'result err';
    el.innerHTML = `
      <div>Failed (best: amp=${best.amplitude.toFixed(2)}, P2N=${best.p2n.toFixed(1)}dB, need >18dB)</div>
      <div style="font-size:10px;margin-top:4px;color:#fca5a5">Best guess: ${best.latencyMs.toFixed(1)}ms · outputLat: ${((ctx.outputLatency || 0) * 1000).toFixed(0)}ms</div>`;
    log(`MLS: failed — best P2N=${best.p2n.toFixed(1)}dB at amp=${best.amplitude.toFixed(2)}`, 'err');
  } else {
    el.className = 'result err';
    el.innerHTML = 'MLS failed — no valid recording from worklet';
    log('MLS: failed — no recording', 'err');
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

/* ── Cleanup ──────────────────────────────────────────── */

window.addEventListener('beforeunload', () => {
  stopHealthPoll();
  stopVUPoll();
  micStream?.getTracks().forEach(t => t.stop());
  ctx?.close();
});
