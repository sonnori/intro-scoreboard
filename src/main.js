import './style.css';
import { createArena } from './arena.js';
import { sfx } from './sound.js';
import { SWATCHES, KEYS, CODES, defaults, hydrate, reset, evaluate, makePlayer } from './store.js';
import * as net from './api.js';
import { PHOTOS } from './photos.js';

const $ = (id) => document.getElementById(id);

let state = defaults();
let presets = [];
let booting = true;
let applyingRemote = false;
const history = [];
let dismissedWinKey = null;
let lastWinKey = null;

const arena = createArena($('stage'));

/** Every mutating path funnels through here, so a viewer can never change the score. */
function requireControl() {
  if (net.api.authed) return true;
  openLogin();
  return false;
}

/* ── scoring ───────────────────────────────────────────── */

function playerById(team, id) {
  return state.teams[team].players.find((p) => p.id === id);
}

function award(team, id, delta, originEl) {
  if (!requireControl()) return;
  const status = evaluate(state);
  if (status.winner && delta > 0 && status.key !== dismissedWinKey) return; // match is over
  const player = playerById(team, id);
  if (!player) return;
  if (player.points + delta < 0) return;

  player.points += delta;
  history.push({ team, id, delta });
  if (history.length > 200) history.shift();

  if (delta > 0) {
    arena.pulse(team);
    if (state.sound) sfx.score(team);
    if (originEl) floatBump(originEl, team);
  }
  render();
}

function undo() {
  if (!requireControl()) return;
  const last = history.pop();
  if (!last) return;
  const player = playerById(last.team, last.id);
  if (player) player.points = Math.max(0, player.points - last.delta);
  dismissedWinKey = null;
  if (state.sound) sfx.undo();
  render();
}

function floatBump(el, team) {
  const box = el.getBoundingClientRect();
  const node = document.createElement('div');
  node.className = 'bump';
  node.textContent = '+1';
  node.style.left = `${box.left + box.width / 2}px`;
  node.style.top = `${box.top}px`;
  node.style.setProperty('--tc', state.teams[team].color);
  document.body.appendChild(node);
  setTimeout(() => node.remove(), 800);
}

/* ── render ────────────────────────────────────────────── */

const rosterSig = { a: null, b: null };

function rosterSignature(team) {
  return state.teams[team].players.map((p) => `${p.id}|${p.name}|${p.photo.length}`).join('~');
}

function buildRoster(team) {
  const host = team === 'a' ? $('rosterA') : $('rosterB');
  host.textContent = '';
  const frag = document.createDocumentFragment();

  state.teams[team].players.forEach((p, i) => {
    const card = document.createElement('button');
    card.className = 'player';
    card.dataset.id = p.id;
    card.dataset.team = team;
    card.setAttribute('aria-label', `ให้แต้ม ${p.name}`);

    const ava = document.createElement('div');
    ava.className = 'player__ava';
    if (p.photo) {
      const img = document.createElement('img');
      img.src = p.photo;
      img.alt = '';
      ava.appendChild(img);
    } else {
      ava.textContent = p.name.trim().slice(0, 1) || '?';
    }

    const name = document.createElement('div');
    name.className = 'player__name';
    name.textContent = p.name;

    const pts = document.createElement('div');
    pts.className = 'player__pts';
    pts.dataset.pts = p.id;
    pts.textContent = p.points;

    const edit = document.createElement('span');
    edit.className = 'player__edit';
    edit.dataset.edit = p.id;
    edit.setAttribute('role', 'button');
    edit.setAttribute('tabindex', '0');
    edit.title = 'แก้ไขผู้เล่น';
    edit.textContent = '✎';

    const minus = document.createElement('span');
    minus.className = 'player__minus';
    minus.dataset.minus = p.id;
    minus.setAttribute('role', 'button');
    minus.setAttribute('tabindex', '0');
    minus.title = 'ลบหนึ่งแต้ม';
    minus.textContent = '−';

    card.append(ava, name, pts, edit, minus);

    if (KEYS[team][i]) {
      const key = document.createElement('span');
      key.className = 'player__key';
      key.textContent = KEYS[team][i];
      card.appendChild(key);
    }
    frag.appendChild(card);
  });

  const add = document.createElement('button');
  add.className = 'addPlayer';
  add.dataset.add = team;
  add.innerHTML = '<b>+</b>เพิ่มผู้เล่น';
  frag.appendChild(add);

  host.appendChild(frag);
}

function render() {
  const s = evaluate(state);

  for (const team of ['a', 'b']) {
    const sig = rosterSignature(team);
    if (sig !== rosterSig[team]) {
      rosterSig[team] = sig;
      buildRoster(team);
    }
    state.teams[team].players.forEach((p) => {
      const el = document.querySelector(`[data-pts="${p.id}"]`);
      if (el && el.textContent !== String(p.points)) el.textContent = p.points;
    });
  }

  const upper = team => (team === 'a' ? 'A' : 'B');
  for (const team of ['a', 'b']) {
    const t = state.teams[team];
    document.documentElement.style.setProperty(`--${team}`, t.color);
    $(`name${upper(team)}`).textContent = t.name;
    const scoreEl = $(`score${upper(team)}`);
    const val = String(team === 'a' ? s.a : s.b);
    if (scoreEl.textContent !== val) {
      scoreEl.textContent = val;
      scoreEl.classList.add('pop');
      setTimeout(() => scoreEl.classList.remove('pop'), 200);
    }
    const stateEl = $(`state${upper(team)}`);
    const mp = team === 'a' ? s.matchPointA : s.matchPointB;
    const label = s.winner === team ? 'ชนะ' : mp ? 'แมตช์พอยต์' : '';
    if (stateEl.dataset.label !== label) {
      stateEl.dataset.label = label;
      stateEl.innerHTML = label ? `<i></i><b>${label}</b><i></i>` : '';
    }
    stateEl.classList.toggle('on', Boolean(label));
    stateEl.classList.toggle('mp', mp);
    document.querySelector(`.team--${team}`).classList.toggle('mp', mp);
  }

  arena.setAlert(
    s.matchPointA && s.matchPointB ? 'both' : s.matchPointA ? 'a' : s.matchPointB ? 'b' : null
  );

  $('matchLabel').textContent = `แมตช์ ${state.matchNo}`;
  $('targetLabel').textContent = state.rules.target;
  const deuceEl = $('deuceLabel');
  deuceEl.textContent = state.rules.deuce
    ? s.deuceActive
      ? 'ดิวส์'
      : 'ดิวส์ เปิด'
    : 'ดิวส์ ปิด';
  deuceEl.classList.toggle('live', s.deuceActive);

  $('undoBtn').disabled = history.length === 0;

  // the seam is the lead: A in front pushes it into B's half
  const span = Math.max(3, state.rules.target * 0.6);
  arena.setColors(state.teams.a.color, state.teams.b.color);
  arena.setSeam(Math.max(-1, Math.min(1, (s.a - s.b) / span)));
  const top = Math.max(s.a, s.b, 1);
  arena.setEnergy(s.a / top, s.b / top);

  // winner takeover
  const showWin = s.key && s.key !== dismissedWinKey;
  document.body.classList.toggle('won', Boolean(showWin));
  if (showWin) {
    const t = state.teams[s.winner];
    $('winnerName').textContent = t.name;
    $('winnerScore').textContent = `${s.a} – ${s.b}`;
    $('winner').style.setProperty('--wc', t.color);
    if (s.key !== lastWinKey) {
      lastWinKey = s.key;
      arena.burst(t.color);
      if (state.sound) sfx.win();
    }
  } else if (!s.key) {
    lastWinKey = null;
  }

  // Writing back a change that came from another screen would ping-pong forever.
  if (!booting && !applyingRemote && net.api.authed) net.saveMatch(state);
}

/* ── roster interaction ────────────────────────────────── */

document.querySelector('.rosters').addEventListener('click', (e) => {
  const editId = e.target.closest('[data-edit]')?.dataset.edit;
  const minusId = e.target.closest('[data-minus]')?.dataset.minus;
  const addTeam = e.target.closest('[data-add]')?.dataset.add;
  const card = e.target.closest('.player');

  if (addTeam) return openPlayerSheet(addTeam, null);
  if (editId) {
    e.stopPropagation();
    return openPlayerSheet(card.dataset.team, editId);
  }
  if (minusId) {
    e.stopPropagation();
    return award(card.dataset.team, minusId, -1);
  }
  if (card) award(card.dataset.team, card.dataset.id, 1, card);
});

/* ── player sheet ──────────────────────────────────────── */

const sheet = $('playerSheet');
let editing = { team: 'a', id: null };

function openPlayerSheet(team, id) {
  if (!requireControl()) return;
  const existing = id ? playerById(team, id) : null;
  editing = { team, id };
  $('sheetTitle').textContent = existing ? 'แก้ไขผู้เล่น' : 'เพิ่มผู้เล่น';
  $('playerName').value = existing?.name || '';
  $('deletePlayer').hidden = !existing;
  renderPhotoPicker();
  sheet.showModal();
  if (existing?.photo) loadCropSource(existing.photo);
  else clearCrop();
  setTimeout(() => $('playerName').focus(), 40);
}

/* ── crop ──────────────────────────────────────────────────
   The operator frames the shot here: drag to pan, scroll or
   drag the slider to zoom. What sits inside the circle is
   exactly what gets exported.
   ───────────────────────────────────────────────────────── */

const cropBox = $('cropBox');
const cropImg = $('cropImg');
const cropZoom = $('cropZoom');
const OUT_SIZE = 512;

const crop = { src: '', natW: 0, natH: 0, base: 1, zoom: 1, x: 0, y: 0 };
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const boxSize = () => cropBox.getBoundingClientRect().width || 260;

function clearCrop() {
  crop.src = '';
  crop.zoom = 1;
  crop.x = crop.y = 0;
  cropImg.hidden = true;
  cropImg.removeAttribute('src');
  $('cropEmpty').hidden = false;
  $('removePhoto').hidden = true;
  $('cropEmptyLabel').textContent = PHOTOS.length
    ? 'เลือกจากรูปด้านบน หรือกดที่นี่เพื่อเลือกไฟล์'
    : 'เลือกไฟล์จากเครื่อง';
  $('cropHint').hidden = true;
  cropZoom.disabled = true;
  cropZoom.value = '1';
}

function loadCropSource(src) {
  crop.src = src;
  crop.zoom = 1;
  crop.x = crop.y = 0;
  cropImg.hidden = false;
  cropImg.src = src;
  $('cropEmpty').hidden = true;
  $('removePhoto').hidden = false;
  $('cropHint').hidden = false;
  cropZoom.disabled = false;
  cropZoom.value = '1';
  const apply = () => {
    crop.natW = cropImg.naturalWidth;
    crop.natH = cropImg.naturalHeight;
    layoutCrop();
  };
  if (cropImg.complete && cropImg.naturalWidth) apply();
  else cropImg.onload = apply;
}

function layoutCrop() {
  if (!crop.src || !crop.natW) return;
  const box = boxSize();
  crop.base = Math.max(box / crop.natW, box / crop.natH); // cover
  const k = crop.base * crop.zoom;
  const w = crop.natW * k;
  const h = crop.natH * k;
  const maxX = Math.max(0, (w - box) / 2);
  const maxY = Math.max(0, (h - box) / 2);
  crop.x = clamp(crop.x, -maxX, maxX);
  crop.y = clamp(crop.y, -maxY, maxY);
  cropImg.style.width = `${w}px`;
  cropImg.style.height = `${h}px`;
  cropImg.style.transform = `translate(calc(-50% + ${crop.x}px), calc(-50% + ${crop.y}px))`;
}

function setZoom(z) {
  const next = clamp(z, 1, 4);
  const ratio = next / crop.zoom;
  crop.x *= ratio;
  crop.y *= ratio;
  crop.zoom = next;
  cropZoom.value = String(next);
  layoutCrop();
}

/** Render the circle's contents at OUT_SIZE, matching the on-screen framing exactly. */
function exportCrop() {
  if (!crop.src || !crop.natW) return '';
  const box = boxSize();
  const scale = OUT_SIZE / box;
  const k = crop.base * crop.zoom * scale;
  const w = crop.natW * k;
  const h = crop.natH * k;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = OUT_SIZE;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(cropImg, (OUT_SIZE - w) / 2 + crop.x * scale, (OUT_SIZE - h) / 2 + crop.y * scale, w, h);
  return canvas.toDataURL('image/jpeg', 0.82);
}

/** Cap the source before cropping so a 48 MP phone photo doesn't sit in memory. */
async function prepareSource(file, max = 1400) {
  const bitmap = await createImageBitmap(file);
  const k = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * k);
  canvas.height = Math.round(bitmap.height * k);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return canvas.toDataURL('image/jpeg', 0.9);
}

let dragFrom = null;

cropBox.addEventListener('pointerdown', (e) => {
  if (!crop.src) return;
  dragFrom = { x: e.clientX, y: e.clientY };
  cropBox.setPointerCapture(e.pointerId);
});

cropBox.addEventListener('pointermove', (e) => {
  if (!dragFrom) return;
  crop.x += e.clientX - dragFrom.x;
  crop.y += e.clientY - dragFrom.y;
  dragFrom = { x: e.clientX, y: e.clientY };
  layoutCrop();
});

for (const evt of ['pointerup', 'pointercancel']) {
  cropBox.addEventListener(evt, () => {
    dragFrom = null;
  });
}

cropBox.addEventListener(
  'wheel',
  (e) => {
    if (!crop.src) return;
    e.preventDefault();
    setZoom(crop.zoom * (e.deltaY < 0 ? 1.09 : 1 / 1.09));
  },
  { passive: false }
);

cropZoom.addEventListener('input', () => setZoom(parseFloat(cropZoom.value)));

$('cropEmpty').addEventListener('click', () => $('photoInput').click());
$('avatarPick').addEventListener('click', () => $('photoInput').click());

$('photoInput').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  loadCropSource(await prepareSource(file));
});

$('removePhoto').addEventListener('click', clearCrop);

$('playerForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = $('playerName').value.trim();
  if (!name) return;
  const photo = exportCrop();
  if (editing.id) {
    const p = playerById(editing.team, editing.id);
    p.name = name;
    p.photo = photo;
  } else {
    const p = makePlayer(name);
    p.photo = photo;
    state.teams[editing.team].players.push(p);
  }
  sheet.close();
  render();
});

$('cancelPlayer').addEventListener('click', () => sheet.close());

$('deletePlayer').addEventListener('click', () => {
  const team = state.teams[editing.team];
  const p = team.players.find((x) => x.id === editing.id);
  if (!p) return;
  if (!confirm(`ลบ ${p.name} ออกจาก${team.name}?`)) return;
  team.players = team.players.filter((x) => x.id !== editing.id);
  sheet.close();
  render();
});

/* ── settings drawer ───────────────────────────────────── */

function openDrawer(open) {
  document.body.classList.toggle('drawer-open', open);
  $('drawer').setAttribute('aria-hidden', String(!open));
  if (open) $('inputNameA').focus();
}

$('settingsBtn').addEventListener('click', () => requireControl() && openDrawer(true));
$('closeDrawer').addEventListener('click', () => openDrawer(false));
$('scrim').addEventListener('click', () => openDrawer(false));

for (const team of ['a', 'b']) {
  const up = team === 'a' ? 'A' : 'B';
  const input = $(`inputName${up}`);
  input.addEventListener('input', () => {
    state.teams[team].name = input.value || (team === 'a' ? 'ทีมซ้าย' : 'ทีมขวา');
    render();
  });

  const host = $(`swatch${up}`);
  SWATCHES.forEach((hex) => {
    const b = document.createElement('button');
    b.className = 'swatch';
    b.type = 'button';
    b.style.background = hex;
    b.style.color = hex;
    b.dataset.hex = hex;
    b.setAttribute('aria-label', hex);
    b.addEventListener('click', () => {
      state.teams[team].color = hex;
      syncDrawer();
      render();
    });
    host.appendChild(b);
  });
}

$('inputTarget').addEventListener('input', () => {
  const v = parseInt($('inputTarget').value, 10);
  state.rules.target = Number.isFinite(v) ? Math.min(999, Math.max(1, v)) : 1;
  dismissedWinKey = null;
  render();
});

document.querySelectorAll('[data-step]').forEach((btn) =>
  btn.addEventListener('click', () => {
    state.rules.target = Math.min(999, Math.max(1, state.rules.target + +btn.dataset.step));
    dismissedWinKey = null;
    syncDrawer();
    render();
  })
);

document.querySelectorAll('[data-cap]').forEach((btn) =>
  btn.addEventListener('click', () => {
    const next = state.rules.cap + +btn.dataset.cap;
    state.rules.cap = next <= 0 ? 0 : Math.min(999, Math.max(2, next));
    dismissedWinKey = null;
    syncDrawer();
    render();
  })
);

$('inputCap').addEventListener('input', () => {
  const v = parseInt($('inputCap').value, 10);
  state.rules.cap = Number.isFinite(v) && v > 0 ? Math.min(999, Math.max(2, v)) : 0;
  dismissedWinKey = null;
  render();
});

$('inputDeuce').addEventListener('change', () => {
  state.rules.deuce = $('inputDeuce').checked;
  dismissedWinKey = null;
  syncDrawer();
  render();
});

$('resetScores').addEventListener('click', () => {
  newMatch();
  openDrawer(false);
});

$('resetAll').addEventListener('click', () => {
  if (!confirm('ลบผู้เล่นทั้งหมดและตั้งกติกากลับค่าเริ่มต้น?')) return;
  state = reset();
  history.length = 0;
  dismissedWinKey = lastWinKey = null;
  rosterSig.a = rosterSig.b = null;
  syncDrawer();
  render();
  openDrawer(false);
});

function syncDrawer() {
  $('inputNameA').value = state.teams.a.name;
  $('inputNameB').value = state.teams.b.name;
  $('inputTarget').value = state.rules.target;
  $('inputCap').value = state.rules.cap || 0;
  $('inputDeuce').checked = state.rules.deuce;
  $('capField').classList.toggle('off', !state.rules.deuce);
  for (const team of ['a', 'b']) {
    const up = team === 'a' ? 'A' : 'B';
    $(`swatch${up}`)
      .querySelectorAll('.swatch')
      .forEach((b) =>
        b.setAttribute(
          'aria-pressed',
          String(b.dataset.hex.toLowerCase() === state.teams[team].color.toLowerCase())
        )
      );
  }
}

/* ── match lifecycle ───────────────────────────────────── */

function newMatch() {
  if (!requireControl()) return;
  for (const team of ['a', 'b']) state.teams[team].players.forEach((p) => (p.points = 0));
  state.matchNo += 1;
  history.length = 0;
  dismissedWinKey = lastWinKey = null;
  render();
}

$('playAgain').addEventListener('click', newMatch);

$('editScore').addEventListener('click', () => {
  dismissedWinKey = evaluate(state).key;
  render();
});

/* ── rail ──────────────────────────────────────────────── */

$('undoBtn').addEventListener('click', undo);

$('soundBtn').addEventListener('click', () => {
  state.sound = !state.sound;
  $('soundBtn').setAttribute('aria-pressed', String(state.sound));
  save(state);
});

$('cleanBtn').addEventListener('click', toggleClean);

function toggleClean() {
  const on = document.body.classList.toggle('clean');
  $('cleanBtn').setAttribute('aria-pressed', String(on));
}

$('fsBtn').addEventListener('click', () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen?.();
});

/* ── keyboard ──────────────────────────────────────────── */

/** Prefer the physical key position; fall back to the character it produced. */
const isKey = (e, code, letter) => (e.code ? e.code === code : e.key.toUpperCase() === letter);

function slotFor(e, team) {
  if (e.code) {
    const i = CODES[team].indexOf(e.code);
    if (i !== -1) return i;
  }
  return KEYS[team].indexOf(e.key.toUpperCase());
}

window.addEventListener('keydown', (e) => {
  const typing = e.target.matches('input, textarea') || sheet.open;
  if (typing) return;

  if ((e.metaKey || e.ctrlKey) && isKey(e, 'KeyZ', 'Z')) {
    e.preventDefault();
    return undo();
  }
  if (e.metaKey || e.ctrlKey || e.altKey) return;

  if (isKey(e, 'KeyH', 'H')) {
    e.preventDefault();
    return toggleClean();
  }
  if (e.key === 'Escape') return openDrawer(false);

  for (const team of ['a', 'b']) {
    const i = slotFor(e, team);
    if (i === -1) continue;
    const p = state.teams[team].players[i];
    if (!p) return;
    e.preventDefault();
    const card = document.querySelector(`.player[data-id="${p.id}"]`);
    award(team, p.id, 1, card);
    return;
  }
});

/* ── prepared photos ───────────────────────────────────── */

function renderPhotoPicker() {
  const host = $('libList');
  host.textContent = '';
  // The section stays even when the folder is empty — otherwise nobody would
  // ever learn the folder exists.
  $('libEmpty').hidden = PHOTOS.length > 0;
  if (!PHOTOS.length) return;

  for (const photo of PHOTOS) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'lib__item';
    card.title = `ใช้รูป ${photo.name}`;

    const ava = document.createElement('span');
    ava.className = 'lib__ava';
    const img = document.createElement('img');
    img.src = photo.url;
    img.alt = '';
    ava.appendChild(img);

    const label = document.createElement('span');
    label.className = 'lib__name';
    label.textContent = photo.name;

    card.append(ava, label);
    card.addEventListener('click', () => {
      loadCropSource(photo.url);
      // The filename is the name, so an operator picking a prepared face types nothing.
      const nameField = $('playerName');
      if (!nameField.value.trim()) nameField.value = photo.name;
      [...host.children].forEach((c) => c.classList.remove('lib__item--on'));
      card.classList.add('lib__item--on');
    });
    host.appendChild(card);
  }
}

/* ── presets ───────────────────────────────────────────── */

function renderPresets() {
  const host = $('presetList');
  host.textContent = '';
  if (!presets.length) {
    const empty = document.createElement('p');
    empty.className = 'hint';
    empty.textContent = 'ยังไม่มีชุดที่บันทึกไว้';
    host.appendChild(empty);
    return;
  }

  for (const preset of presets) {
    const row = document.createElement('div');
    row.className = 'preset';

    const name = document.createElement('span');
    name.className = 'preset__name';
    name.textContent = preset.name;

    const meta = document.createElement('span');
    meta.className = 'preset__meta';
    const count =
      (preset.teams?.a?.players?.length || 0) + (preset.teams?.b?.players?.length || 0);
    meta.textContent = `${count} คน · ${preset.rules?.target ?? '?'} แต้ม`;

    const use = document.createElement('button');
    use.className = 'btn';
    use.type = 'button';
    use.textContent = 'ใช้';
    use.addEventListener('click', () => loadPreset(preset));

    const del = document.createElement('button');
    del.className = 'btn btn--danger';
    del.type = 'button';
    del.textContent = 'ลบ';
    del.addEventListener('click', async () => {
      if (!confirm(`ลบชุด "${preset.name}"?`)) return;
      presets = await net.deletePreset(preset.id, presets);
      renderPresets();
    });

    row.append(name, meta, use, del);
    host.appendChild(row);
  }
}

function snapshotTeam(team) {
  return {
    name: team.name,
    color: team.color,
    players: team.players.map((p) => ({ name: p.name, photo: p.photo })),
  };
}

$('savePresetBtn').addEventListener('click', async () => {
  if (!requireControl()) return;
  const field = $('presetName');
  const name = field.value.trim();
  if (!name) {
    field.focus();
    return;
  }
  try {
    presets = await net.savePreset(
      {
        name,
        rules: { ...state.rules },
        teams: { a: snapshotTeam(state.teams.a), b: snapshotTeam(state.teams.b) },
      },
      presets
    );
    field.value = '';
    renderPresets();
  } catch (e) {
    alert(`บันทึกชุดไม่สำเร็จ: ${e.message}`);
  }
});

function loadPreset(preset) {
  if (!requireControl()) return;
  if (!confirm(`โหลดชุด "${preset.name}"? คะแนนปัจจุบันจะถูกล้าง`)) return;
  const build = (side) => {
    const src = preset.teams?.[side] || {};
    return {
      name: src.name || (side === 'a' ? 'ทีมซ้าย' : 'ทีมขวา'),
      color: src.color || defaults().teams[side].color,
      players: (src.players || []).map((p) => {
        const made = makePlayer(p.name);
        made.photo = p.photo || '';
        return made;
      }),
    };
  };
  state = hydrate({
    matchNo: state.matchNo + 1,
    sound: state.sound,
    rules: { ...defaults().rules, ...preset.rules },
    teams: { a: build('a'), b: build('b') },
  });
  history.length = 0;
  dismissedWinKey = lastWinKey = null;
  rosterSig.a = rosterSig.b = null;
  syncDrawer();
  render();
  openDrawer(false);
}

/* ── control access ────────────────────────────────────── */

const loginSheet = $('loginSheet');

function openLogin() {
  $('loginError').hidden = true;
  $('loginPassword').value = '';
  loginSheet.showModal();
  setTimeout(() => $('loginPassword').focus(), 40);
}

$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await net.login($('loginPassword').value);
    loginSheet.close();
    applyAccess();
    render();
  } catch (err) {
    const box = $('loginError');
    box.textContent = err.message;
    box.hidden = false;
  }
});

$('cancelLogin').addEventListener('click', () => loginSheet.close());

$('lockBtn').addEventListener('click', async () => {
  if (net.api.authed) {
    await net.logout();
    applyAccess();
  } else openLogin();
});

function applyAccess() {
  const onServer = net.api.mode === 'server';
  const label = $('modeLabel');
  if (!onServer) {
    label.hidden = !net.api.authed; // the login sheet already says where we are
    label.textContent = 'เก็บข้อมูลในเครื่องนี้';
  } else if (net.api.degraded) {
    // Deployed without a data store: each instance keeps its own copy, so two
    // devices would quietly disagree. Say it out loud.
    label.hidden = false;
    label.textContent = 'ยังไม่ได้ต่อที่เก็บข้อมูล — จออาจไม่ตรงกัน';
  } else {
    label.hidden = true;
  }
  $('lockBtn').hidden = false;
  $('lockBtn').textContent = net.api.authed ? 'ล็อก' : 'ปลดล็อก';
  document.body.classList.toggle('locked', !net.api.authed);
}

/* ── boot ──────────────────────────────────────────────── */

(async () => {
  const data = await net.bootstrap(defaults);
  state = hydrate(data.match);
  presets = data.presets || [];

  net.onSaveError((msg) => {
    const label = $('modeLabel');
    label.hidden = false;
    label.textContent = `บันทึกไม่ขึ้น server (${msg})`;
  });

  net.subscribe({
    match: (msg) => {
      state = hydrate(msg.match);
      rosterSig.a = rosterSig.b = null;
      applyingRemote = true;
      syncDrawer();
      render();
      applyingRemote = false;
    },
    presets: (msg) => {
      presets = msg.presets;
      renderPresets();
    },
  });

  applyAccess();
  $('soundBtn').setAttribute('aria-pressed', String(state.sound));
  syncDrawer();
  renderPresets();
  render();
  booting = false;

  // Ask on arrival rather than waiting for the first tap to be refused.
  if (!net.api.authed) openLogin();
})();
