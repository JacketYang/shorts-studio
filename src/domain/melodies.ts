import { mulberry32 } from './hash.ts';
import type { MelodyEntry, MelodyNote } from './types.ts';

function makeNotes(pitches: number[], step = 1): MelodyNote[] {
  return pitches.map((pitch, idx) => ({
    beat: idx * step,
    pitch,
    dur: step,
    vel: 88,
  }));
}

const NOTE_BASE_SEMITONES: Record<string, number> = {
  C: 0,
  'C#': 1,
  DB: 1,
  D: 2,
  'D#': 3,
  EB: 3,
  E: 4,
  F: 5,
  'F#': 6,
  GB: 6,
  G: 7,
  'G#': 8,
  AB: 8,
  A: 9,
  'A#': 10,
  BB: 10,
  B: 11,
};

export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/**
 * Parses compact note notation like "C4:1, E4:1, G4:0.5, C5:1.5" or "60:1, 64:1, 67:1, 72:2".
 * Duration suffix is optional (defaults to 1 beat).
 */
export function parseNoteSequence(input: string): { notes: MelodyNote[]; error?: string } {
  const tokens = input
    .split(/[\s,;]+/)
    .map((t) => t.trim())
    .filter(Boolean);

  if (tokens.length < 4) {
    return { notes: [], error: '旋律至少需要 4 个音符（示例：C4:1, E4:1, G4:1, C5:2 或 60:1, 64:1, 67:1, 72:2）' };
  }

  const notes: MelodyNote[] = [];
  let cursorBeat = 0;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const [pitchRaw, durRaw] = token.split(':');
    const dur = durRaw !== undefined ? Number(durRaw) : 1;
    if (!Number.isFinite(dur) || dur <= 0 || dur > 16) {
      return { notes: [], error: `第 ${i + 1} 个音符时值无效 "${token}"（需大于 0 且 <= 16 拍）` };
    }

    let midi: number | null = null;
    if (/^\d{1,3}$/.test(pitchRaw)) {
      midi = Number(pitchRaw);
    } else {
      const m = /^([A-Ga-g])([#bB]?)(-?\d)$/.exec(pitchRaw);
      if (m) {
        const key = `${m[1].toUpperCase()}${m[2] === '#' ? '#' : m[2] ? 'B' : ''}`;
        const semi = NOTE_BASE_SEMITONES[key];
        const octave = Number(m[3]);
        if (semi !== undefined) {
          midi = (octave + 1) * 12 + semi;
        }
      }
    }

    if (midi === null || !Number.isInteger(midi) || midi < 21 || midi > 108) {
      return {
        notes: [],
        error: `第 ${i + 1} 个音符音高无效 "${pitchRaw}"（支持 MIDI 21-108 或音名如 C4、F#4、Bb3）`,
      };
    }

    notes.push({
      beat: Number(cursorBeat.toFixed(4)),
      pitch: midi,
      dur: Number(dur.toFixed(4)),
      vel: 90,
    });
    cursorBeat += dur;
  }

  return { notes };
}

export function generateProceduralMelody(seed: number, id: string, title: string, scaleName: string): MelodyEntry {
  const rng = mulberry32(seed);
  const scales: Record<string, number[]> = {
    pentatonic: [60, 62, 64, 67, 69, 72, 74, 76, 79],
    minor: [57, 59, 60, 62, 64, 65, 67, 69, 71, 72],
    lydian: [60, 62, 64, 66, 67, 69, 71, 72, 74],
  };
  const pool = scales[scaleName] ?? scales.pentatonic;
  const notes: MelodyNote[] = [];
  let idx = 2;
  for (let i = 0; i < 16; i++) {
    const jump = Math.floor(rng() * 5) - 2;
    idx = Math.max(0, Math.min(pool.length - 1, idx + jump));
    notes.push({
      beat: i * 0.5,
      pitch: pool[idx],
      dur: 0.5,
      vel: 78 + Math.floor(rng() * 26),
    });
  }
  return {
    schema: 'melody/1',
    id,
    title,
    composer: 'Procedural Engine',
    death_year: null,
    source_url: 'internal://procedural-melody-generator',
    license: 'original',
    key: `${scaleName} (seed ${seed})`,
    tempo_bpm: 112,
    time_signature: '4/4',
    recognizability: 3,
    tags: ['procedural', scaleName],
    tracks: [{ name: 'lead', notes }],
    loopable: true,
    last_used_at: null,
  };
}

export const INITIAL_MELODIES: MelodyEntry[] = [
  {
    schema: 'melody/1',
    id: 'pd:canon-in-d',
    title: 'Canon in D (Main Theme)',
    composer: 'Johann Pachelbel',
    death_year: 1706,
    source_url: 'https://www.mutopiaproject.org/cgibin/make-table.cgi?Composer=PachelbelJ',
    license: 'public-domain',
    key: 'D major',
    tempo_bpm: 96,
    time_signature: '4/4',
    recognizability: 5,
    tags: ['baroque', 'famous', 'slow-build'],
    tracks: [{ name: 'lead', notes: makeNotes([78, 76, 74, 73, 71, 69, 71, 73, 74, 73, 71, 69, 67, 66, 67, 64], 1) }],
    loopable: true,
    last_used_at: '2026-11-08T17:00:00Z',
  },
  {
    schema: 'melody/1',
    id: 'pd:ode-to-joy',
    title: 'Ode to Joy (Symphony No. 9)',
    composer: 'Ludwig van Beethoven',
    death_year: 1827,
    source_url: 'https://www.mutopiaproject.org/cgibin/make-table.cgi?Composer=BeethovenLv',
    license: 'public-domain',
    key: 'C major',
    tempo_bpm: 112,
    time_signature: '4/4',
    recognizability: 5,
    tags: ['classical', 'anthem'],
    tracks: [{ name: 'lead', notes: makeNotes([64, 64, 65, 67, 67, 65, 64, 62, 60, 60, 62, 64, 64, 62, 62], 1) }],
    loopable: true,
    last_used_at: '2026-11-09T17:00:00Z',
  },
  {
    schema: 'melody/1',
    id: 'pd:fur-elise',
    title: 'Für Elise',
    composer: 'Ludwig van Beethoven',
    death_year: 1827,
    source_url: 'https://www.mutopiaproject.org/cgibin/make-table.cgi?Composer=BeethovenLv',
    license: 'public-domain',
    key: 'A minor',
    tempo_bpm: 118,
    time_signature: '3/8',
    recognizability: 5,
    tags: ['classical', 'piano'],
    tracks: [{ name: 'lead', notes: makeNotes([76, 75, 76, 75, 76, 71, 74, 72, 69, 60, 64, 69, 71, 64, 68, 71, 72], 0.5) }],
    loopable: true,
    last_used_at: '2026-11-05T17:00:00Z',
  },
  {
    schema: 'melody/1',
    id: 'pd:mountain-king',
    title: 'In the Hall of the Mountain King',
    composer: 'Edvard Grieg',
    death_year: 1907,
    source_url: 'https://www.mutopiaproject.org/cgibin/make-table.cgi?Composer=GriegE',
    license: 'public-domain',
    key: 'B minor',
    tempo_bpm: 124,
    time_signature: '4/4',
    recognizability: 5,
    tags: ['escalation', 'dramatic'],
    tracks: [{ name: 'lead', notes: makeNotes([59, 61, 62, 64, 66, 62, 66, 65, 61, 65, 64, 60, 64, 59, 61, 62], 0.5) }],
    loopable: true,
    last_used_at: '2026-11-06T17:00:00Z',
  },
  {
    schema: 'melody/1',
    id: 'pd:turkish-march',
    title: 'Turkish March (Rondo Alla Turca)',
    composer: 'Wolfgang Amadeus Mozart',
    death_year: 1791,
    source_url: 'https://www.mutopiaproject.org/cgibin/make-table.cgi?Composer=MozartWA',
    license: 'public-domain',
    key: 'A minor',
    tempo_bpm: 132,
    time_signature: '2/4',
    recognizability: 5,
    tags: ['classical', 'fast'],
    tracks: [{ name: 'lead', notes: makeNotes([71, 69, 68, 69, 72, 74, 72, 71, 72, 76, 77, 76, 75, 76, 83, 81], 0.5) }],
    loopable: true,
    last_used_at: null,
  },
  {
    schema: 'melody/1',
    id: 'pd:eine-kleine',
    title: 'Eine kleine Nachtmusik',
    composer: 'Wolfgang Amadeus Mozart',
    death_year: 1791,
    source_url: 'https://www.mutopiaproject.org/cgibin/make-table.cgi?Composer=MozartWA',
    license: 'public-domain',
    key: 'G major',
    tempo_bpm: 128,
    time_signature: '4/4',
    recognizability: 5,
    tags: ['classical', 'bright'],
    tracks: [{ name: 'lead', notes: makeNotes([67, 62, 67, 62, 67, 62, 67, 71, 74, 72, 69, 72, 69, 72, 69, 66], 0.5) }],
    loopable: true,
    last_used_at: null,
  },
  {
    schema: 'melody/1',
    id: 'pd:swan-lake',
    title: 'Swan Lake Theme',
    composer: 'Pyotr Ilyich Tchaikovsky',
    death_year: 1893,
    source_url: 'https://www.mutopiaproject.org/cgibin/make-table.cgi?Composer=TchaikovskyPI',
    license: 'public-domain',
    key: 'B minor',
    tempo_bpm: 92,
    time_signature: '4/4',
    recognizability: 5,
    tags: ['romantic', 'melancholic'],
    tracks: [{ name: 'lead', notes: makeNotes([78, 71, 73, 74, 76, 78, 74, 78, 74, 78, 71, 74, 71, 67, 74, 71], 1) }],
    loopable: true,
    last_used_at: null,
  },
  {
    schema: 'melody/1',
    id: 'pd:sugar-plum-fairy',
    title: 'Dance of the Sugar Plum Fairy',
    composer: 'Pyotr Ilyich Tchaikovsky',
    death_year: 1893,
    source_url: 'https://www.mutopiaproject.org/cgibin/make-table.cgi?Composer=TchaikovskyPI',
    license: 'public-domain',
    key: 'E minor',
    tempo_bpm: 108,
    time_signature: '2/4',
    recognizability: 5,
    tags: ['celesta', 'bell-like'],
    tracks: [{ name: 'lead', notes: makeNotes([79, 76, 79, 78, 75, 76, 74, 74, 74, 73, 73, 73, 72, 72, 72, 71], 0.5) }],
    loopable: true,
    last_used_at: null,
  },
  {
    schema: 'melody/1',
    id: 'pd:william-tell',
    title: 'William Tell Overture (Finale)',
    composer: 'Gioachino Rossini',
    death_year: 1868,
    source_url: 'https://www.mutopiaproject.org/cgibin/make-table.cgi?Composer=RossiniG',
    license: 'public-domain',
    key: 'E major',
    tempo_bpm: 144,
    time_signature: '2/4',
    recognizability: 5,
    tags: ['fast', 'race'],
    tracks: [{ name: 'lead', notes: makeNotes([59, 59, 59, 59, 59, 59, 59, 59, 64, 66, 68, 59, 59, 59, 64, 68], 0.5) }],
    loopable: true,
    last_used_at: null,
  },
  {
    schema: 'melody/1',
    id: 'pd:greensleeves',
    title: 'Greensleeves',
    composer: 'Traditional',
    death_year: null,
    source_url: 'https://www.mutopiaproject.org/cgibin/make-table.cgi?Composer=Traditional',
    license: 'public-domain',
    key: 'A minor',
    tempo_bpm: 96,
    time_signature: '6/8',
    recognizability: 4,
    tags: ['folk', 'loop'],
    tracks: [{ name: 'lead', notes: makeNotes([69, 72, 74, 76, 77, 76, 74, 71, 67, 69, 71, 72, 69, 69, 68, 69], 1) }],
    loopable: true,
    last_used_at: null,
  },
  {
    schema: 'melody/1',
    id: 'pd:minuet-in-g',
    title: 'Minuet in G Major',
    composer: 'Christian Petzold',
    death_year: 1733,
    source_url: 'https://www.mutopiaproject.org/cgibin/make-table.cgi?Composer=BachJS',
    license: 'public-domain',
    key: 'G major',
    tempo_bpm: 112,
    time_signature: '3/4',
    recognizability: 5,
    tags: ['baroque', 'clean'],
    tracks: [{ name: 'lead', notes: makeNotes([74, 67, 69, 71, 72, 74, 67, 67, 76, 72, 74, 76, 78, 79, 67, 67], 1) }],
    loopable: true,
    last_used_at: null,
  },
  {
    schema: 'melody/1',
    id: 'pd:moonlight-sonata',
    title: 'Moonlight Sonata (1st Mvt)',
    composer: 'Ludwig van Beethoven',
    death_year: 1827,
    source_url: 'https://www.mutopiaproject.org/cgibin/make-table.cgi?Composer=BeethovenLv',
    license: 'public-domain',
    key: 'C# minor',
    tempo_bpm: 84,
    time_signature: '4/4',
    recognizability: 5,
    tags: ['arpeggio', 'atmospheric'],
    tracks: [{ name: 'lead', notes: makeNotes([56, 61, 64, 56, 61, 64, 56, 61, 64, 56, 61, 64, 57, 61, 64, 57], 0.5) }],
    loopable: true,
    last_used_at: null,
  },
  {
    schema: 'melody/1',
    id: 'pd:spring-vivaldi',
    title: 'The Four Seasons: Spring',
    composer: 'Antonio Vivaldi',
    death_year: 1741,
    source_url: 'https://www.mutopiaproject.org/cgibin/make-table.cgi?Composer=VivaldiA',
    license: 'public-domain',
    key: 'E major',
    tempo_bpm: 120,
    time_signature: '4/4',
    recognizability: 5,
    tags: ['baroque', 'uplifting'],
    tracks: [{ name: 'lead', notes: makeNotes([64, 68, 68, 68, 66, 64, 71, 71, 69, 68, 68, 68, 66, 64, 71, 71], 0.5) }],
    loopable: true,
    last_used_at: null,
  },
  {
    schema: 'melody/1',
    id: 'pd:carmen-habanera',
    title: 'Habanera (Carmen)',
    composer: 'Georges Bizet',
    death_year: 1875,
    source_url: 'https://www.mutopiaproject.org/cgibin/make-table.cgi?Composer=BizetG',
    license: 'public-domain',
    key: 'D minor',
    tempo_bpm: 104,
    time_signature: '2/4',
    recognizability: 4,
    tags: ['chromatic', 'opera'],
    tracks: [{ name: 'lead', notes: makeNotes([74, 73, 72, 72, 71, 70, 69, 69, 68, 67, 66, 65, 64, 62, 64, 69], 0.5) }],
    loopable: true,
    last_used_at: null,
  },
  {
    schema: 'melody/1',
    id: 'pd:gymnopedie-1',
    title: 'Gymnopédie No. 1',
    composer: 'Erik Satie',
    death_year: 1925,
    source_url: 'https://www.mutopiaproject.org/cgibin/make-table.cgi?Composer=SatieE',
    license: 'public-domain',
    key: 'D major',
    tempo_bpm: 78,
    time_signature: '3/4',
    recognizability: 4,
    tags: ['calm', 'ambient'],
    tracks: [{ name: 'lead', notes: makeNotes([78, 81, 79, 78, 73, 71, 73, 74, 69, 66, 69, 71, 73, 74, 76, 73], 1) }],
    loopable: true,
    last_used_at: null,
  },
  {
    schema: 'melody/1',
    id: 'pd:flight-bumblebee',
    title: 'Flight of the Bumblebee',
    composer: 'Nikolai Rimsky-Korsakov',
    death_year: 1908,
    source_url: 'https://www.mutopiaproject.org/cgibin/make-table.cgi?Composer=RimskyKorsakovN',
    license: 'public-domain',
    key: 'A minor',
    tempo_bpm: 152,
    time_signature: '2/4',
    recognizability: 5,
    tags: ['fast', 'chromatic'],
    tracks: [{ name: 'lead', notes: makeNotes([76, 75, 74, 73, 74, 73, 72, 71, 72, 71, 70, 69, 68, 69, 70, 71], 0.25) }],
    loopable: true,
    last_used_at: null,
  },
  generateProceduralMelody(5521, 'gen:pentatonic-5521', 'Procedural Pentatonic #5521', 'pentatonic'),
  generateProceduralMelody(8841, 'gen:pentatonic-8841', 'Procedural Pentatonic #8841', 'pentatonic'),
  generateProceduralMelody(3141, 'gen:lydian-3141', 'Procedural Lydian #3141', 'lydian'),
  generateProceduralMelody(2718, 'gen:minor-2718', 'Procedural Harmonic Minor #2718', 'minor'),
];
