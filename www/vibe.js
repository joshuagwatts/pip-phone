const rt = {
  gl: null,
  canvas: null,
  prog: null,
  buf: null,
  loc: {},
  raf: 0,
  clock: 0,
  lastTs: 0,
  bassGain: 2,
  speed: 1,
};

const mic = {
  ctx: null,
  stream: null,
  analyser: null,
  freq: null,
  listening: false,
};

export function wrap(src) {
  const header = `precision highp float;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_clock;
uniform float u_bass;
uniform float u_mid;
uniform float u_high;
uniform float u_energy;
uniform float u_fft[64];
#ifndef iTime
#define iTime u_time
#define iResolution vec3(u_resolution, 1.0)
#endif
`;
  let body = String(src || "").replace(/^\s*#version[^\n]*\n/, "").replace(/precision\s+\w+\s+float\s*;/g, "");
  if (/void\s+mainImage\s*\(/.test(body) && !/void\s+main\s*\s*\(/.test(body)) {
    body += "\nvoid main(){ vec4 col; mainImage(col, gl_FragCoord.xy); gl_FragColor = col; }\n";
  }
  return header + body;
}

export function compile(canvas, src) {
  if (!canvas) return "no canvas";
  const gl = canvas.getContext("webgl", { antialias: false, alpha: false, preserveDrawingBuffer: false });
  if (!gl) return "WebGL missing";
  rt.gl = gl;
  rt.canvas = canvas;
  const vs = gl.createShader(gl.VERTEX_SHADER);
  gl.shaderSource(vs, "attribute vec2 a_pos; void main(){ gl_Position = vec4(a_pos, 0.0, 1.0); }");
  gl.compileShader(vs);
  const fs = gl.createShader(gl.FRAGMENT_SHADER);
  gl.shaderSource(fs, wrap(src));
  gl.compileShader(fs);
  if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) return gl.getShaderInfoLog(fs) || "fragment compile failed";
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.bindAttribLocation(prog, 0, "a_pos");
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return gl.getProgramInfoLog(prog) || "link failed";
  if (rt.prog) gl.deleteProgram(rt.prog);
  rt.prog = prog;
  if (!rt.buf) {
    rt.buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, rt.buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  }
  const u = (name) => gl.getUniformLocation(prog, name);
  rt.loc = {
    res: u("u_resolution"),
    time: u("u_time"),
    clock: u("u_clock"),
    bass: u("u_bass"),
    mid: u("u_mid"),
    high: u("u_high"),
    energy: u("u_energy"),
    fft: u("u_fft"),
  };
  return "";
}

export function readFft() {
  const bins = new Float32Array(64);
  if (!mic.analyser || !mic.freq) {
    return { bass: 0, mid: 0, high: 0, energy: 0, bins, listening: mic.listening };
  }
  mic.analyser.getByteFrequencyData(mic.freq);
  const n = mic.freq.length;
  const hz = (mic.ctx && mic.ctx.sampleRate ? mic.ctx.sampleRate : 44100) / (mic.analyser.fftSize || 2048);
  let bass = 0, mid = 0, high = 0, bN = 0, mN = 0, hN = 0;
  for (let i = 0; i < n; i++) {
    const f = i * hz;
    const v = mic.freq[i] / 255;
    if (i < 64) bins[i] = v;
    if (f >= 20 && f < 140) { bass += v; bN += 1; }
    else if (f >= 140 && f < 2000) { mid += v; mN += 1; }
    else if (f >= 2000 && f < 10000) { high += v; hN += 1; }
  }
  bass = bN ? Math.min(1, (bass / bN) * 2.2) : 0;
  mid = mN ? Math.min(1, mid / mN) : 0;
  high = hN ? Math.min(1, high / hN) : 0;
  const energy = Math.min(1, bass * 0.5 + mid * 0.35 + high * 0.15);
  return { bass, mid, high, energy, bins, listening: mic.listening };
}

function frame(ts) {
  rt.raf = 0;
  const gl = rt.gl;
  const canvas = rt.canvas;
  if (!gl || !canvas || !rt.prog) return;
  const dt = rt.lastTs ? Math.min(0.05, (ts - rt.lastTs) / 1000) : 0.016;
  rt.lastTs = ts;
  const fft = readFft();
  const bass = fft.bass || 0;
  rt.clock += dt * (0.18 + bass * rt.bassGain * 3.4) * rt.speed;
  const w = canvas.clientWidth || 1;
  const h = canvas.clientHeight || 1;
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.useProgram(rt.prog);
  gl.bindBuffer(gl.ARRAY_BUFFER, rt.buf);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.uniform2f(rt.loc.res, canvas.width, canvas.height);
  gl.uniform1f(rt.loc.time, rt.clock);
  gl.uniform1f(rt.loc.clock, ts / 1000);
  gl.uniform1f(rt.loc.bass, bass);
  gl.uniform1f(rt.loc.mid, fft.mid || 0);
  gl.uniform1f(rt.loc.high, fft.high || 0);
  gl.uniform1f(rt.loc.energy, fft.energy || 0);
  if (rt.loc.fft) gl.uniform1fv(rt.loc.fft, fft.bins);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  rt.raf = requestAnimationFrame(frame);
}

export function startLoop() {
  if (!rt.raf) {
    rt.lastTs = 0;
    rt.raf = requestAnimationFrame(frame);
  }
}

export function stopLoop() {
  if (rt.raf) cancelAnimationFrame(rt.raf);
  rt.raf = 0;
}

export async function startMic() {
  stopMic();
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false }, video: false });
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const src = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.72;
  src.connect(analyser);
  mic.ctx = ctx;
  mic.stream = stream;
  mic.analyser = analyser;
  mic.freq = new Uint8Array(analyser.frequencyBinCount);
  mic.listening = true;
  if (ctx.state === "suspended") await ctx.resume();
}

export function stopMic() {
  mic.listening = false;
  if (mic.stream) mic.stream.getTracks().forEach((t) => t.stop());
  if (mic.ctx) mic.ctx.close().catch(() => {});
  mic.stream = null;
  mic.ctx = null;
  mic.analyser = null;
  mic.freq = null;
}

export function isListening() {
  return mic.listening;
}

export function setGain(n) {
  rt.bassGain = Number(n) || 2;
}

export function setSpeed(n) {
  rt.speed = Number(n) || 1;
}
