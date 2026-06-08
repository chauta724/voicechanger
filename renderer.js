// ─── Effects list ─────────────────────────────────────────────────────────────
const FX_LIST = [
  { id: 'robot',       label: 'Robot',         icon: '🤖' },
  { id: 'chipmunk',    label: 'Chipmunk',      icon: '🐿️' },
  { id: 'demon',       label: 'Demon',         icon: '😈' },
  { id: 'cave',        label: 'Cave Echo',     icon: '🏔️' },
  { id: 'telephone',   label: 'Telephone',     icon: '📞' },
  { id: 'underwater',  label: 'Underwater',    icon: '🌊' },
  { id: 'radio',       label: 'Walkie Talkie', icon: '📻' },
  { id: 'tremolo',     label: 'Tremolo',       icon: '〰️' },
  { id: 'chorus',      label: 'Chorus',        icon: '🎶' },
  { id: 'megaphone',   label: 'Megaphone',     icon: '📢' },
  { id: 'eightbit',    label: '8-bit',         icon: '👾' },
];

const CORE_ACTIONS = [
  { id: 'mic_toggle', label: 'Toggle Mic on/off' },
  { id: 'gain_up',    label: 'Gain +0.5x' },
  { id: 'gain_down',  label: 'Gain -0.5x' },
  { id: 'pitch_up',   label: 'Pitch +1 semitone' },
  { id: 'pitch_down', label: 'Pitch -1 semitone' },
];

// ─── State ────────────────────────────────────────────────────────────────────
let audioCtx, micStream, sourceNode, analyserNode, gainNode, distNode;
let babyOsc = null, babyGain = null;
let fxNodes = {}, activeEffects = {}, isRunning = false, animFrame;

// Dual output: two destinations via MediaStreamDestination
let dest1Node = null, dest2Node = null;
let out1Elem = null, out2Elem = null; // <audio> elements for device routing

// Keybinds: { actionId: keyString }
let keybinds = JSON.parse(localStorage.getItem('vc_keybinds') || '{}');
let listeningFor = null;

const visCtx = document.getElementById('visCanvas').getContext('2d');

// ─── Build effect buttons ─────────────────────────────────────────────────────
const fxGrid = document.getElementById('fxGrid');
FX_LIST.forEach(f => {
  const b = document.createElement('div');
  b.className = 'fx-btn';
  b.id = 'fx-' + f.id;
  b.innerHTML = `<span class="fx-icon">${f.icon}</span>${f.label}<br><span class="fx-key" id="fk-${f.id}">—</span>`;
  b.addEventListener('click', () => toggleFx(f.id));
  fxGrid.appendChild(b);
});

// ─── Build keybind table ──────────────────────────────────────────────────────
function buildKbTable() {
  const tbody = document.getElementById('kbBody');
  tbody.innerHTML = '';
  const all = [...CORE_ACTIONS, ...FX_LIST.map(f => ({ id: 'fx_' + f.id, label: f.icon + ' ' + f.label }))];
  all.forEach(a => {
    const key = keybinds[a.id] || '';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="kb-action">${a.label}</td>
      <td><span class="kb-badge" id="kb-${a.id}" data-action="${a.id}">${key || 'click to bind'}</span></td>
      <td>${key ? `<button class="kb-clear" data-action="${a.id}" title="Clear">✕</button>` : ''}</td>`;
    tbody.appendChild(tr);
  });
  // Update fx key badges on buttons
  FX_LIST.forEach(f => {
    const k = keybinds['fx_' + f.id];
    const el = document.getElementById('fk-' + f.id);
    if (el) el.textContent = k || '—';
  });
}
buildKbTable();

// Keybind badge click → start listening
document.getElementById('kbBody').addEventListener('click', e => {
  const badge = e.target.closest('.kb-badge');
  const clear = e.target.closest('.kb-clear');
  if (clear) {
    delete keybinds[clear.dataset.action];
    localStorage.setItem('vc_keybinds', JSON.stringify(keybinds));
    buildKbTable();
    return;
  }
  if (badge) startListening(badge.dataset.action);
});

function startListening(actionId) {
  listeningFor = actionId;
  const badge = document.getElementById('kb-' + actionId);
  if (badge) { badge.textContent = '…'; badge.classList.add('listening'); }
  document.getElementById('kbModal').classList.add('show');
  document.getElementById('kbModalAction').textContent =
    [...CORE_ACTIONS, ...FX_LIST.map(f => ({ id: 'fx_' + f.id, label: f.label }))].find(a => a.id === actionId)?.label || actionId;
}

document.getElementById('kbModalCancel').addEventListener('click', () => {
  listeningFor = null;
  document.getElementById('kbModal').classList.remove('show');
  buildKbTable();
});

// ─── Global keydown → keybind capture or action ───────────────────────────────
document.addEventListener('keydown', e => {
  // Skip if typing in an input/select
  if (['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;

  if (listeningFor) {
    e.preventDefault();
    const key = formatKey(e);
    if (key === 'Escape') { listeningFor = null; document.getElementById('kbModal').classList.remove('show'); buildKbTable(); return; }
    keybinds[listeningFor] = key;
    localStorage.setItem('vc_keybinds', JSON.stringify(keybinds));
    listeningFor = null;
    document.getElementById('kbModal').classList.remove('show');
    buildKbTable();
    return;
  }

  const key = formatKey(e);
  for (const [actionId, boundKey] of Object.entries(keybinds)) {
    if (boundKey === key) {
      e.preventDefault();
      triggerAction(actionId);
    }
  }
});

function formatKey(e) {
  const parts = [];
  if (e.ctrlKey)  parts.push('Ctrl');
  if (e.altKey)   parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  const k = e.key;
  if (!['Control','Alt','Shift','Meta'].includes(k)) parts.push(k.length === 1 ? k.toUpperCase() : k);
  return parts.join('+');
}

function triggerAction(actionId) {
  if (actionId === 'mic_toggle') { isRunning ? stopMic() : startMic(); return; }
  if (actionId === 'gain_up')    { const s = document.getElementById('slGain'); s.value = Math.min(4, parseFloat(s.value) + 0.5); s.dispatchEvent(new Event('input')); return; }
  if (actionId === 'gain_down')  { const s = document.getElementById('slGain'); s.value = Math.max(0, parseFloat(s.value) - 0.5); s.dispatchEvent(new Event('input')); return; }
  if (actionId === 'pitch_up')   { const s = document.getElementById('slPitch'); s.value = Math.min(24, parseInt(s.value) + 1); s.dispatchEvent(new Event('input')); return; }
  if (actionId === 'pitch_down') { const s = document.getElementById('slPitch'); s.value = Math.max(-24, parseInt(s.value) - 1); s.dispatchEvent(new Event('input')); return; }
  if (actionId.startsWith('fx_')) toggleFx(actionId.slice(3));
}

// ─── Device enumeration ───────────────────────────────────────────────────────
async function enumerateDevices() {
  try {
    // Request mic permission first so labels are visible
    const tmp = await navigator.mediaDevices.getUserMedia({ audio: true });
    tmp.getTracks().forEach(t => t.stop());
  } catch (e) {}

  const devices = await navigator.mediaDevices.enumerateDevices();
  const inputs  = devices.filter(d => d.kind === 'audioinput');
  const outputs = devices.filter(d => d.kind === 'audiooutput');

  const selIn  = document.getElementById('selInput');
  const selO1  = document.getElementById('selOutput1');
  const selO2  = document.getElementById('selOutput2');

  selIn.innerHTML  = inputs.map(d  => `<option value="${d.deviceId}">${d.label || 'Mic ' + d.deviceId.slice(0,6)}</option>`).join('');
  selO1.innerHTML  = outputs.map(d => `<option value="${d.deviceId}">${d.label || 'Output ' + d.deviceId.slice(0,6)}</option>`).join('');
  selO2.innerHTML  = '<option value="">— None —</option>' +
    outputs.map(d => `<option value="${d.deviceId}">${d.label || 'Output ' + d.deviceId.slice(0,6)}</option>`).join('');
}
enumerateDevices();
navigator.mediaDevices.addEventListener('devicechange', enumerateDevices);

// ─── Slider wiring ────────────────────────────────────────────────────────────
function updateSlider(sid, vid, fmt) {
  document.getElementById(vid).textContent = fmt(document.getElementById(sid).value);
}

document.getElementById('slGain').addEventListener('input', function() {
  updateSlider('slGain','vGain', v => parseFloat(v).toFixed(1)+'x');
  if (gainNode) gainNode.gain.setTargetAtTime(parseFloat(this.value), audioCtx.currentTime, 0.02);
});
document.getElementById('slPitch').addEventListener('input', function() {
  updateSlider('slPitch','vPitch', v => (v>0?'+':'')+v+' st');
});
document.getElementById('slDist').addEventListener('input', function() {
  updateSlider('slDist','vDist', v => v);
  if (distNode) distNode.curve = makeDistCurve(parseFloat(this.value));
});
document.getElementById('slBaby').addEventListener('input', function() {
  updateSlider('slBaby','vBaby', v => Math.round(v*100)+'%');
  if (isRunning) setBabyAmount(parseFloat(this.value));
});
document.getElementById('sl8bit').addEventListener('input', function() {
  updateSlider('sl8bit','v8bit', v => v+' bit');
});
document.getElementById('sl8rate').addEventListener('input', function() {
  updateSlider('sl8rate','v8rate', v => Math.round(v/1000)+'k Hz');
});

// ─── Audio helpers ─────────────────────────────────────────────────────────────
function makeDistCurve(amount) {
  const n = 256, curve = new Float32Array(n), k = amount || 0.001;
  for (let i = 0; i < n; i++) { const x = i*2/n-1; curve[i] = (Math.PI+k)*x/(Math.PI+k*Math.abs(x)); }
  return curve;
}

function make8bitNode() {
  const node = audioCtx.createScriptProcessor(4096, 1, 1);
  node.onaudioprocess = e => {
    const inp = e.inputBuffer.getChannelData(0);
    const out = e.outputBuffer.getChannelData(0);
    const bits = parseInt(document.getElementById('sl8bit').value);
    const rate = parseInt(document.getElementById('sl8rate').value);
    const step = Math.max(1, Math.round(audioCtx.sampleRate / rate));
    const levels = Math.pow(2, bits);
    let held = 0;
    for (let i = 0; i < inp.length; i++) {
      if (i % step === 0) held = Math.round(inp[i] * levels/2) / (levels/2);
      out[i] = held;
    }
  };
  return node;
}

function buildFxNodes() {
  fxNodes['robot'] = (() => {
    const r = audioCtx.createOscillator(), ring = audioCtx.createGain();
    r.frequency.value = 60; r.start(); r.connect(ring.gain);
    return { entry: ring, exit: ring };
  })();
  fxNodes['chipmunk'] = (() => { const g = audioCtx.createGain(); return { entry:g, exit:g }; })();
  fxNodes['demon']    = (() => { const g = audioCtx.createGain(); return { entry:g, exit:g }; })();
  fxNodes['cave'] = (() => {
    const d = audioCtx.createDelay(5); d.delayTime.value = 0.3;
    const f = audioCtx.createDelay(5); f.delayTime.value = 0.6;
    const g = audioCtx.createGain(); g.gain.value = 0.45;
    const g2 = audioCtx.createGain(); g2.gain.value = 0.25;
    const inp = audioCtx.createGain();
    inp.connect(d); inp.connect(f); d.connect(g); f.connect(g2); g.connect(inp); g2.connect(inp);
    return { entry: inp, exit: inp };
  })();
  fxNodes['telephone'] = (() => {
    const lo = audioCtx.createBiquadFilter(); lo.type='highpass'; lo.frequency.value=300;
    const hi = audioCtx.createBiquadFilter(); hi.type='lowpass';  hi.frequency.value=3000;
    lo.connect(hi); return { entry:lo, exit:hi };
  })();
  fxNodes['underwater'] = (() => {
    const f = audioCtx.createBiquadFilter(); f.type='lowpass'; f.frequency.value=400; f.Q.value=3;
    return { entry:f, exit:f };
  })();
  fxNodes['radio'] = (() => {
    const lo = audioCtx.createBiquadFilter(); lo.type='highpass'; lo.frequency.value=500;
    const hi = audioCtx.createBiquadFilter(); hi.type='lowpass';  hi.frequency.value=2500;
    const d = audioCtx.createWaveShaper(); d.curve = makeDistCurve(200);
    lo.connect(hi); hi.connect(d); return { entry:lo, exit:d };
  })();
  fxNodes['tremolo'] = (() => {
    const osc = audioCtx.createOscillator(); osc.frequency.value = 8;
    const g = audioCtx.createGain(); g.gain.value = 0.5;
    const inp = audioCtx.createGain();
    osc.connect(g); g.connect(inp.gain); osc.start();
    return { entry:inp, exit:inp };
  })();
  fxNodes['chorus'] = (() => {
    const d1 = audioCtx.createDelay(1); d1.delayTime.value = 0.03;
    const d2 = audioCtx.createDelay(1); d2.delayTime.value = 0.05;
    const g = audioCtx.createGain(); g.gain.value = 0.4;
    const inp = audioCtx.createGain();
    inp.connect(d1); inp.connect(d2); d1.connect(g); d2.connect(g); inp.connect(g);
    return { entry:inp, exit:g };
  })();
  fxNodes['megaphone'] = (() => {
    const lo = audioCtx.createBiquadFilter(); lo.type='highpass'; lo.frequency.value=600;
    const hi = audioCtx.createBiquadFilter(); hi.type='lowpass';  hi.frequency.value=2800;
    const d = audioCtx.createWaveShaper(); d.curve = makeDistCurve(100);
    lo.connect(hi); hi.connect(d); return { entry:lo, exit:d };
  })();
  fxNodes['eightbit'] = (() => { const n = make8bitNode(); return { entry:n, exit:n }; })();
}

function reconnectChain() {
  if (!audioCtx) return;
  try {
    sourceNode.disconnect(); analyserNode.disconnect(); gainNode.disconnect(); distNode.disconnect();
    for (const k of Object.keys(fxNodes)) {
      try { fxNodes[k].entry.disconnect(); } catch(e) {}
      try { if (fxNodes[k].exit !== fxNodes[k].entry) fxNodes[k].exit.disconnect(); } catch(e) {}
    }
    if (dest1Node) try { dest1Node.disconnect(); } catch(e) {}
    if (dest2Node) try { dest2Node.disconnect(); } catch(e) {}

    let last = sourceNode;
    const connect = n => { last.connect(n); last = n; };
    connect(analyserNode);
    connect(gainNode);
    connect(distNode);
    for (const f of FX_LIST) {
      if (activeEffects[f.id] && fxNodes[f.id]) {
        connect(fxNodes[f.id].entry);
        if (fxNodes[f.id].exit !== fxNodes[f.id].entry) last = fxNodes[f.id].exit;
      }
    }
    // Primary output
    last.connect(dest1Node);
    // Virtual output (if selected)
    const o2id = document.getElementById('selOutput2').value;
    if (o2id && dest2Node) last.connect(dest2Node);
  } catch(e) { console.error(e); }
}

// ─── Mic start / stop ─────────────────────────────────────────────────────────
document.getElementById('micBtn').addEventListener('click', () => {
  if (!isRunning) startMic(); else stopMic();
});

async function startMic() {
  try {
    const inputDeviceId = document.getElementById('selInput').value;
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: { deviceId: inputDeviceId ? { exact: inputDeviceId } : undefined,
               echoCancellation: true, noiseSuppression: false, autoGainControl: false }
    });

    audioCtx = new AudioContext();
    sourceNode   = audioCtx.createMediaStreamSource(micStream);
    analyserNode = audioCtx.createAnalyser(); analyserNode.fftSize = 128;
    gainNode     = audioCtx.createGain(); gainNode.gain.value = parseFloat(document.getElementById('slGain').value);
    distNode     = audioCtx.createWaveShaper(); distNode.curve = makeDistCurve(parseFloat(document.getElementById('slDist').value)); distNode.oversample = '4x';

    // Primary output — MediaStreamDestination → <audio> sinkId
    dest1Node = audioCtx.createMediaStreamDestination();
    out1Elem = new Audio(); out1Elem.srcObject = dest1Node.stream; out1Elem.play();
    const o1id = document.getElementById('selOutput1').value;
    if (o1id && out1Elem.setSinkId) await out1Elem.setSinkId(o1id).catch(()=>{});

    // Virtual output
    dest2Node = audioCtx.createMediaStreamDestination();
    out2Elem = new Audio(); out2Elem.srcObject = dest2Node.stream; out2Elem.play();
    const o2id = document.getElementById('selOutput2').value;
    if (o2id && out2Elem.setSinkId) await out2Elem.setSinkId(o2id).catch(()=>{});

    buildFxNodes();
    reconnectChain();
    setBabyAmount(parseFloat(document.getElementById('slBaby').value));

    isRunning = true;
    document.getElementById('micBtn').classList.add('active');
    document.getElementById('micLabel').textContent = 'Stop Mic';
    document.getElementById('statusDot').classList.add('live');
    document.getElementById('statusText').textContent = 'Live — processing audio';
    drawVis();
  } catch(e) {
    document.getElementById('statusText').textContent = 'Error: ' + e.message;
    console.error(e);
  }
}

function stopMic() {
  isRunning = false;
  if (animFrame) cancelAnimationFrame(animFrame);
  if (micStream)  micStream.getTracks().forEach(t => t.stop());
  if (out1Elem)  { out1Elem.pause(); out1Elem = null; }
  if (out2Elem)  { out2Elem.pause(); out2Elem = null; }
  if (audioCtx)  audioCtx.close();
  if (babyOsc)   { try { babyOsc.stop(); } catch(e){} babyOsc = null; babyGain = null; }
  dest1Node = null; dest2Node = null;
  document.getElementById('micBtn').classList.remove('active');
  document.getElementById('micLabel').textContent = 'Start Mic';
  document.getElementById('statusDot').classList.remove('live');
  document.getElementById('statusText').textContent = 'Mic off';
  const c = document.getElementById('visCanvas');
  visCtx.clearRect(0, 0, c.width, c.height);
}

// Output device changes while running
document.getElementById('selOutput1').addEventListener('change', async function() {
  if (out1Elem && this.value && out1Elem.setSinkId) await out1Elem.setSinkId(this.value).catch(()=>{});
});
document.getElementById('selOutput2').addEventListener('change', async function() {
  if (out2Elem && this.value && out2Elem.setSinkId) await out2Elem.setSinkId(this.value).catch(()=>{});
  if (isRunning) reconnectChain();
});

// ─── Effects ──────────────────────────────────────────────────────────────────
function toggleFx(id) {
  activeEffects[id] = !activeEffects[id];
  document.getElementById('fx-' + id).classList.toggle('active', !!activeEffects[id]);
  if (id === 'chipmunk') { document.getElementById('slPitch').value = activeEffects[id] ? 12 : 0; document.getElementById('slPitch').dispatchEvent(new Event('input')); }
  if (id === 'demon')    { document.getElementById('slPitch').value = activeEffects[id] ? -10 : 0; document.getElementById('slPitch').dispatchEvent(new Event('input')); }
  if (id === 'eightbit' && isRunning) {
    try { fxNodes['eightbit'].entry.disconnect(); } catch(e) {}
    const n = make8bitNode(); fxNodes['eightbit'] = { entry:n, exit:n };
  }
  if (isRunning) reconnectChain();
}

// ─── Baby noise ───────────────────────────────────────────────────────────────
function setBabyAmount(v) {
  if (!audioCtx) return;
  if (v > 0) {
    if (!babyOsc) {
      babyOsc = audioCtx.createOscillator(); babyGain = audioCtx.createGain();
      babyOsc.type = 'sine'; babyOsc.frequency.value = 800 + Math.random()*400;
      babyOsc.connect(babyGain); babyGain.connect(dest1Node); 
      if (dest2Node) babyGain.connect(dest2Node);
      babyOsc.start();
      setInterval(() => { if (babyOsc) babyOsc.frequency.setTargetAtTime(600 + Math.random()*600, audioCtx.currentTime, 0.05); }, 180);
    }
    babyGain.gain.setTargetAtTime(v * 0.3, audioCtx.currentTime, 0.05);
  } else if (babyGain) {
    babyGain.gain.setTargetAtTime(0, audioCtx.currentTime, 0.05);
  }
}

// ─── Visualizer ───────────────────────────────────────────────────────────────
function drawVis() {
  if (!isRunning) return;
  const canvas = document.getElementById('visCanvas');
  const W = canvas.width, H = canvas.height;
  visCtx.clearRect(0, 0, W, H);
  const data = new Uint8Array(analyserNode.frequencyBinCount);
  analyserNode.getByteFrequencyData(data);
  const bw = W / data.length - 1;
  for (let i = 0; i < data.length; i++) {
    const v = data[i] / 255;
    visCtx.fillStyle = `hsl(${260 + v*60}, 70%, ${40 + v*30}%)`;
    visCtx.fillRect(i*(bw+1), H - Math.max(2, v*H), bw, Math.max(2, v*H));
  }
  animFrame = requestAnimationFrame(drawVis);
}

// ─── Link helper ──────────────────────────────────────────────────────────────
function openLink(url) { require('electron').shell.openExternal(url); }
