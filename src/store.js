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

/**
 * Shortcuts are bound to physical key positions, not characters: an operator
 * running a Thai keyboard layout still gets Q W E R T where the caps say so.
 * KEYS is what we print on the card, CODES is what we listen for.
 */
export const KEYS = {
  a: ['Q', 'W', 'E', 'R', 'T'],
  b: ['U', 'I', 'O', 'P', '['],
};

export const CODES = {
  a: ['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT'],
  b: ['KeyU', 'KeyI', 'KeyO', 'KeyP', 'BracketLeft'],
};

export function defaults() {
  return {
    matchNo: 1,
    sound: true,
    rules: { target: 15, deuce: true, cap: 0 },
    teams: {
      a: { name: 'ทีมชาวบ้าน', color: '#3B6BFF', players: [] },
      b: { name: 'ทีมศิลปิน', color: '#FF4438', players: [] },
    },
  };
}

/** Fill in anything a stored or preset-loaded match is missing. */
export function hydrate(saved) {
  const base = defaults();
  if (!saved) return base;
  return {
    ...base,
    ...saved,
    rules: { ...base.rules, ...saved.rules },
    teams: {
      a: { ...base.teams.a, ...saved.teams?.a },
      b: { ...base.teams.b, ...saved.teams?.b },
    },
  };
}

export function reset() {
  return defaults();
}

export function total(team) {
  return team.players.reduce((sum, p) => sum + p.points, 0);
}

/** Would `x` points beat `y` points under these rules? */
function wins(x, y, { target, deuce, cap }) {
  if (x <= y) return false;
  if (!deuce) return x >= target;
  if (cap > 0 && x >= cap) return true;
  return x >= target && x - y >= 2;
}

/**
 * One evaluation of the match, derived — never stored.
 * `matchPoint` is answered by asking whether one more point would end it,
 * so deuce, the cap and plain first-to-N all fall out of the same rule.
 */
export function evaluate(state) {
  const a = total(state.teams.a);
  const b = total(state.teams.b);
  const r = state.rules;

  let winner = null;
  if (wins(a, b, r)) winner = 'a';
  else if (wins(b, a, r)) winner = 'b';

  return {
    a,
    b,
    winner,
    matchPointA: !winner && wins(a + 1, b, r),
    matchPointB: !winner && wins(b + 1, a, r),
    deuceActive: r.deuce && !winner && a >= r.target - 1 && b >= r.target - 1,
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
