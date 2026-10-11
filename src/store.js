/** Match shape and rules. No DOM, no storage — persistence lives in api.js. */

export const SWATCHES = [
  '#12E3E3',
  '#3B6BFF',
  '#8B5CF6',
  '#FF2E88',
  '#FF4438',
  '#FF8A1F',
  '#FFC53D',
  '#A3E635',
  '#22C55E',
  '#E9EEF9',
];

/** Solo players get a colour by position, so nobody has to pick eight of them. */
export const SOLO_COLORS = [
  '#3B6BFF',
  '#FF4438',
  '#12E3E3',
  '#FFC53D',
  '#A3E635',
  '#FF2E88',
  '#8B5CF6',
  '#FF8A1F',
];

export const soloColor = (i) => SOLO_COLORS[i % SOLO_COLORS.length];

/**
 * Shortcuts are bound to physical key positions, not characters: an operator
 * running a Thai keyboard layout still gets Q W E R T where the caps say so.
 * KEYS is what we print on the card, CODES is what we listen for.
 */
export const KEYS = {
  a: ['Q', 'W', 'E', 'R', 'T'],
  b: ['U', 'I', 'O', 'P', '['],
  solo: ['Q', 'W', 'E', 'R', 'T', 'U', 'I', 'O'],
};

export const CODES = {
  a: ['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT'],
  b: ['KeyU', 'KeyI', 'KeyO', 'KeyP', 'BracketLeft'],
  solo: ['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT', 'KeyU', 'KeyI', 'KeyO'],
};

export function defaults() {
  return {
    matchNo: 1,
    sound: true,
    mode: 'team', // 'team' | 'solo'
    // track: count points with no finish line — no winner, no match point
    rules: { target: 15, deuce: true, cap: 0, track: false },
    teams: {
      a: { name: 'ทีมชาวบ้าน', color: '#3B6BFF', players: [] },
      b: { name: 'ทีมศิลปิน', color: '#FF4438', players: [] },
    },
    solo: { players: [] },
  };
}

/** Fill in anything a stored or preset-loaded match is missing. */
export function hydrate(saved) {
  const base = defaults();
  if (!saved) return base;
  return {
    ...base,
    ...saved,
    mode: saved.mode === 'solo' ? 'solo' : 'team',
    rules: { ...base.rules, ...saved.rules },
    teams: {
      a: { ...base.teams.a, ...saved.teams?.a },
      b: { ...base.teams.b, ...saved.teams?.b },
    },
    solo: { players: saved.solo?.players || [] },
  };
}

export function reset() {
  return defaults();
}

export function total(team) {
  return team.players.reduce((sum, p) => sum + p.points, 0);
}

/** The list a roster key points at — one accessor so callers never branch. */
export function rosterOf(state, key) {
  return key === 'solo' ? state.solo.players : state.teams[key].players;
}

/** Would `x` points beat `y` points under these rules? */
function wins(x, y, { target, deuce, cap }) {
  if (x <= y) return false;
  if (!deuce) return x >= target;
  if (cap > 0 && x >= cap) return true;
  return x >= target && x - y >= 2;
}

/** Highest score among everyone except `self`. */
const bestOther = (players, self) =>
  players.reduce((top, p) => (p.id === self ? top : Math.max(top, p.points)), 0);

function evaluateSolo(state) {
  const players = state.solo.players;
  const r = state.rules;
  const ranked = [...players].sort((x, y) => y.points - x.points);
  const top = ranked[0]?.points ?? 0;
  const runnerUp = ranked[1]?.points ?? 0;

  // A tie at the top is nobody's lead — the board should not crown one of them.
  const leader = ranked.length && top > runnerUp ? ranked[0] : null;

  let winner = null;
  if (!r.track && leader && wins(top, runnerUp, r)) winner = leader.id;

  const matchPoints = new Set();
  if (!r.track && !winner) {
    for (const p of players) {
      if (wins(p.points + 1, bestOther(players, p.id), r)) matchPoints.add(p.id);
    }
  }

  return {
    mode: 'solo',
    track: r.track,
    ranked,
    top,
    leaderId: leader?.id || null,
    runnerUpId: ranked[1]?.id || null,
    winner,
    winnerName: winner ? players.find((p) => p.id === winner)?.name : '',
    matchPoints,
    deuceActive:
      !r.track && r.deuce && !winner && ranked.length > 1 && top >= r.target - 1 && runnerUp >= r.target - 1,
    key: winner ? `${winner}:${top}:${runnerUp}` : null,
  };
}

/**
 * One evaluation of the match, derived — never stored.
 * `matchPoint` is answered by asking whether one more point would end it,
 * so deuce, the cap and plain first-to-N all fall out of the same rule.
 * With `track` on there is no finish line, so none of it applies.
 */
export function evaluate(state) {
  if (state.mode === 'solo') return evaluateSolo(state);

  const a = total(state.teams.a);
  const b = total(state.teams.b);
  const r = state.rules;

  let winner = null;
  if (!r.track) {
    if (wins(a, b, r)) winner = 'a';
    else if (wins(b, a, r)) winner = 'b';
  }

  return {
    mode: 'team',
    track: r.track,
    a,
    b,
    winner,
    winnerName: winner ? state.teams[winner].name : '',
    matchPointA: !r.track && !winner && wins(a + 1, b, r),
    matchPointB: !r.track && !winner && wins(b + 1, a, r),
    deuceActive: !r.track && r.deuce && !winner && a >= r.target - 1 && b >= r.target - 1,
    key: winner ? `${winner}:${a}:${b}` : null,
  };
}

export function makePlayer(name) {
  return {
    id: `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    name,
    photo: '',
    points: 0,
  };
}
