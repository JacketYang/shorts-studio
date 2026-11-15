import { clamp } from './util';

export interface Song {
  id: string;
  name: string;
  notes: string;
}

export interface Note {
  t: number;
  f: number;
  name: string;
  dur: number;
  idx: number;
  round: number;
  speed: number;
}

const SEMI: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

export function noteFreq(n: string): number {
  const m = /^([A-G])([#b]?)(\d)?$/.exec(n);
  if (!m) throw new Error('bad note ' + n);
  const s = SEMI[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  const midi = 12 * ((m[3] ? parseInt(m[3], 10) : 4) + 1) + s;
  return 440 * Math.pow(2, (midi - 69) / 12);
}

interface Tok { f: number; name: string; beats: number; rest: boolean }

export function parseSong(s: string): Tok[] {
  return s.trim().split(/\s+/).map((tok) => {
    const [n, b] = tok.split(':');
    const beats = b ? parseFloat(b) : 1;
    if (n === 'R') return { f: 0, name: 'R', beats, rest: true };
    return { f: noteFreq(n), name: n, beats, rest: false };
  });
}

export interface Plan {
  notes: Note[];
  end: number;
  rounds: number;
  unit: number;
}

export function planNotes(song: Song, o: { target?: number; lead?: number; rounds?: number; speedup?: number } = {}): Plan {
  const toks = parseSong(song.notes);
  const B = toks.reduce((a, t) => a + t.beats, 0);
  const sp = o.speedup ?? 1;
  const target = o.target ?? 26;
  const lead = o.lead ?? 0.9;
  const geo = (r: number) => { let s = 0; for (let i = 0; i < r; i++) s += Math.pow(sp, i); return s; };
  const unitFor = (r: number) => (target - lead - 0.8) / (B * geo(r));
  let rounds = o.rounds ?? 1;
  if (!o.rounds) while (rounds < 3 && unitFor(rounds) > 0.4) rounds++;
  const unit0 = clamp(unitFor(rounds), 0.13, 0.5);
  const notes: Note[] = [];
  let t = lead;
  let idx = 0;
  for (let r = 0; r < rounds; r++) {
    const unit = unit0 * Math.pow(sp, r);
    for (const k of toks) {
      if (!k.rest) {
        notes.push({ t, f: k.f, name: k.name, dur: clamp(k.beats * unit * 1.6, 0.3, 1.3), idx: idx++, round: r, speed: 1 / Math.pow(sp, r) });
      }
      t += k.beats * unit;
    }
  }
  return { notes, end: t, rounds, unit: unit0 };
}
