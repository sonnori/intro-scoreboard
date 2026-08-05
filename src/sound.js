/** Small WebAudio cues. Nothing loads from disk, nothing blocks the UI. */

let ctx;

function ac() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function tone(freq, { at = 0, dur = 0.12, gain = 0.16, type = 'triangle' } = {}) {
  const c = ac();
  const t0 = c.currentTime + at;
  const osc = c.createOscillator();
  const amp = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  amp.gain.setValueAtTime(0.0001, t0);
  amp.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
  amp.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(amp).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

export const sfx = {
  score(side) {
    const base = side === 'a' ? 660 : 588;
    tone(base, { dur: 0.09, gain: 0.13 });
    tone(base * 1.5, { at: 0.055, dur: 0.14, gain: 0.1 });
  },
  undo() {
    tone(300, { dur: 0.1, gain: 0.09, type: 'sine' });
  },
  win() {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
      tone(f, { at: i * 0.11, dur: 0.5, gain: 0.14, type: 'sawtooth' })
    );
  },
};
