import type { Song } from '../engine/music.ts';

/** 全部为公版（Public Domain）旋律，声音由程序合成，可放心发布 */
export const SONGS: Song[] = [
  { id: 'ode', name: "Ode to Joy", notes: 'E4 E4 F4 G4 G4 F4 E4 D4 C4 C4 D4 E4 E4:1.5 D4:.5 D4:2 E4 E4 F4 G4 G4 F4 E4 D4 C4 C4 D4 E4 D4:1.5 C4:.5 C4:2' },
  { id: 'elise', name: 'Für Elise', notes: 'E5:.5 D#5:.5 E5:.5 D#5:.5 E5:.5 B4:.5 D5:.5 C5:.5 A4:1.5 R:.5 C4:.5 E4:.5 A4:.5 B4:1.5 R:.5 E4:.5 G#4:.5 B4:.5 C5:1.5 R:.5 E4:.5 E5:.5 D#5:.5 E5:.5 D#5:.5 E5:.5 B4:.5 D5:.5 C5:.5 A4:1.5 R:.5 C4:.5 E4:.5 A4:.5 B4:1.5 R:.5 E4:.5 C5:.5 B4:.5 A4:2' },
  { id: 'canon', name: 'Canon in D', notes: 'F#5 E5 D5 C#5 B4 A4 B4 C#5 D5 C#5 B4 A4 G4 F#4 G4 E4 F#5:.5 F#5:.5 E5:.5 E5:.5 D5:.5 D5:.5 C#5:.5 C#5:.5 B4:.5 B4:.5 A4:.5 A4:.5 B4:.5 B4:.5 C#5:.5 C#5:.5 D5:.5 D5:.5 C#5:.5 C#5:.5 B4:.5 B4:.5 A4:.5 A4:.5 G4:.5 G4:.5 F#4:.5 F#4:.5 G4:.5 G4:.5 E4:2' },
  { id: 'mountain', name: 'In the Hall of the Mountain King', notes: 'B3:.5 C#4:.5 D4:.5 E4:.5 F#4:.5 D4:.5 F#4:1 F4:.5 C#4:.5 F4:1 E4:.5 C4:.5 E4:1 B3:.5 C#4:.5 D4:.5 E4:.5 F#4:.5 D4:.5 F#4:.5 B4:.5 A4:.5 F#4:.5 D4:.5 F#4:.5 A4:2' },
  { id: 'twinkle', name: 'Twinkle, Twinkle, Little Star', notes: 'C4 C4 G4 G4 A4 A4 G4:2 F4 F4 E4 E4 D4 D4 C4:2 G4 G4 F4 F4 E4 E4 D4:2 G4 G4 F4 F4 E4 E4 D4:2 C4 C4 G4 G4 A4 A4 G4:2 F4 F4 E4 E4 D4 D4 C4:2' },
  { id: 'birthday', name: 'Happy Birthday', notes: 'G4:.75 G4:.25 A4 G4 C5 B4:2 G4:.75 G4:.25 A4 G4 D5 C5:2 G4:.75 G4:.25 G5 E5 C5 B4 A4 F5:.75 F5:.25 E5 C5 D5 C5:2' },
  { id: 'jingle', name: 'Jingle Bells', notes: 'E4 E4 E4:2 E4 E4 E4:2 E4 G4 C4:1.5 D4:.5 E4:4 F4 F4 F4:1.5 F4:.5 F4 E4 E4 E4:.5 E4:.5 E4 D4 D4 E4 D4:2 G4:2' },
  { id: 'greensleeves', name: 'Greensleeves', notes: 'A4 C5:2 D5 E5:1.5 F5:.5 E5 D5:2 B4 G4:1.5 A4:.5 B4 C5:2 A4 A4:1.5 G#4:.5 A4 B4:2 G#4 E4:2 A4 C5:2 D5 E5:1.5 F5:.5 E5 D5:2 B4 G4:1.5 A4:.5 B4 C5:1.5 B4:.5 A4 G#4:1.5 F#4:.5 G#4 A4:3' },
  { id: 'brahms', name: "Brahms' Lullaby", notes: 'E4:.5 E4:.5 G4:2 E4:.5 E4:.5 G4:2 E4:.5 G4:.5 C5:1.5 B4:.5 A4:.5 A4:.5 G4:2 D4:.5 E4:.5 F4:1.5 D4:.5 D4:.5 E4:.5 F4:2 D4:.5 F4:.5 B4:1.5 A4:.5 G4:.5 B4:.5 C5:3' },
  { id: 'jacques', name: 'Frère Jacques', notes: 'C4 D4 E4 C4 C4 D4 E4 C4 E4 F4 G4:2 E4 F4 G4:2 G4:.5 A4:.5 G4:.5 F4:.5 E4 C4 G4:.5 A4:.5 G4:.5 F4:.5 E4 C4 C4 G3 C4:2 C4 G3 C4:2' },
  { id: 'rowboat', name: 'Row, Row, Row Your Boat', notes: 'C4:1 C4:1 C4:.75 D4:.25 E4:1.5 E4:.75 D4:.25 E4:.75 F4:.25 G4:3 C5:.33 C5:.33 C5:.34 G4:.33 G4:.33 G4:.34 E4:.33 E4:.33 E4:.34 C4:.33 C4:.33 C4:.34 G4:.75 F4:.25 E4:.75 D4:.25 C4:3' },
  { id: 'turkish', name: 'Turkish March', notes: 'B4:.5 A4:.5 G#4:.5 A4:.5 C5:2 D5:.5 C5:.5 B4:.5 C5:.5 E5:2 F5:.5 E5:.5 D#5:.5 E5:.5 B5:.5 A5:.5 G#5:.5 A5:.5 B5:.5 A5:.5 G#5:.5 A5:.5 C6:2 A5:1 C6:1 B5:.5 A5:.5 G5:.5 A5:.5 B5:2' },
  { id: 'nachtmusik', name: 'Eine kleine Nachtmusik', notes: 'G4:1 R:.5 D4:.5 G4:1 R:.5 D4:.5 G4:.5 D4:.5 G4:.5 B4:.5 D5:2 C5:1 R:.5 A4:.5 C5:1 R:.5 A4:.5 C5:.5 A4:.5 F#4:.5 A4:.5 D4:2' },
  { id: 'minuet', name: 'Minuet in G', notes: 'D5:1 G4:.5 A4:.5 B4:.5 C5:.5 D5:1 G4:1 G4:1 E5:1 C5:.5 D5:.5 E5:.5 F#5:.5 G5:1 G4:1 G4:1 C5:1 D5:.5 C5:.5 B4:.5 A4:.5 B4:1 C5:.5 B4:.5 A4:.5 G4:.5 F#4:1 G4:.5 A4:.5 B4:.5 G4:.5 B4:2' },
  { id: 'grace', name: 'Amazing Grace', notes: 'G4:1 C5:2 E5:.5 C5:.5 E5:2 D5:1 C5:2 A4:1 G4:2 G4:1 C5:2 E5:.5 C5:.5 E5:2 D5:1 G5:3 E5:1 G5:1.5 E5:.5 G5:.5 E5:.5 C5:2 A4:.5 G4:.5 G4:1 C5:2 E5:.5 D5:.5 C5:3' },
  { id: 'silent', name: 'Silent Night', notes: 'G4:1.5 A4:.5 G4:1 E4:3 G4:1.5 A4:.5 G4:1 E4:3 D5:2 D5:1 B4:3 C5:2 C5:1 G4:3 A4:2 A4:1 C5:1.5 B4:.5 A4:1 G4:1.5 A4:.5 G4:1 E4:3 A4:2 A4:1 C5:1.5 B4:.5 A4:1 G4:1.5 A4:.5 G4:1 E4:3 D5:2 D5:1 F5:1.5 D5:.5 B4:1 C5:3 E5:3 C5:1 G4:1 E4:1 G4:1.5 F4:.5 D4:1 C4:3' },
  { id: 'joy', name: 'Joy to the World', notes: 'C5:1.5 B4:.5 A4:1 G4:1.5 F4:.5 E4:1 D4:1 C4:2 G4:1 A4:1.5 A4:.5 B4:1.5 B4:.5 C5:3 C5:.5 C5:.5 B4:.5 A4:.5 G4:1.5 G4:.5 F4:.5 E4:.5 C5:.5 C5:.5 B4:.5 A4:.5 G4:1.5 G4:.5 F4:.5 E4:.5 E4:.5 E4:.5 E4:.5 E4:.5 E4:.5 F4:.5 G4:1 F4:.5 E4:.5 D4:.5 D4:.5 D4:.5 D4:.5 D4:.5 E4:.5 F4:1 E4:.5 D4:.5 C4:3' },
  { id: 'auld', name: 'Auld Lang Syne', notes: 'D4:1 G4:1.5 G4:.5 G4:1 B4:1 A4:1.5 G4:.5 A4:1 B4:.5 A4:.5 G4:1 G4:.5 E4:.5 D4:2 D4:1 G4:1.5 G4:.5 G4:1 B4:1 A4:1.5 G4:.5 A4:1 B4:.5 A4:.5 G4:1 E4:.5 G4:.5 D5:3 D5:1 B4:1.5 B4:.5 B4:1 G4:1 A4:1.5 G4:.5 A4:1 B4:.5 A4:.5 G4:1 G4:.5 E4:.5 D4:2' },
  { id: 'saints', name: 'When the Saints Go Marching In', notes: 'C4 E4 F4 G4:3 C4 E4 F4 G4:3 C4 E4 F4 G4:2 E4:2 C4:2 E4:2 D4:4 E4 E4 D4 C4:2 C4 E4 D4:3 C4:2 E4 F4 G4:3 C4 E4 F4 G4:3 C4 E4 F4 G4:2 E4:2 C4:2 E4:2 D4:3 R:1 D4 E4 F4:2 E4:2 D4:2 C4:4' },
  { id: 'london', name: 'London Bridge Is Falling Down', notes: 'G4:1.5 A4:.5 G4 F4 E4 F4 G4:2 D4 E4 F4:2 E4 F4 G4:2 G4:1.5 A4:.5 G4 F4 E4 F4 G4:2 D4 G4 E4 C4:2' },
  { id: 'mary', name: 'Mary Had a Little Lamb', notes: 'E4 D4 C4 D4 E4 E4 E4:2 D4 D4 D4:2 E4 G4 G4:2 E4 D4 C4 D4 E4 E4 E4 E4 D4 D4 E4 D4 C4:3' },
  { id: 'hotcross', name: 'Hot Cross Buns', notes: 'E4 D4 C4:2 E4 D4 C4:2 C4:.5 C4:.5 C4:.5 C4:.5 D4:.5 D4:.5 D4:.5 D4:.5 E4 D4 C4:2' },
  { id: 'oldmac', name: 'Old MacDonald Had a Farm', notes: 'G4 G4 G4 D4 E4 E4 D4:2 B4 B4 A4 A4 G4:3 D4 G4 G4 G4 D4 E4 E4 D4:2 B4 B4 A4 A4 G4:3' },
  { id: 'beethoven5', name: "Beethoven's 5th Symphony", notes: 'R:.5 G4:.5 G4:.5 G4:.5 D#4:3 R:.5 F4:.5 F4:.5 F4:.5 D4:3 R:.5 G4:.5 G4:.5 G4:.5 D#5:2 C#5:.5 C#5:.5 C#5:.5 A#4:3 R:.5 G4:.5 G4:.5 G4:.5 D#4:3' },
  { id: 'prelude', name: 'Bach Prelude in C', notes: 'C4:.5 E4:.5 G4:.5 C5:.5 E5:.5 G4:.5 C5:.5 E5:.5 C4:.5 E4:.5 G4:.5 C5:.5 E5:.5 G4:.5 C5:.5 E5:.5 C4:.5 D4:.5 A4:.5 D5:.5 F5:.5 A4:.5 D5:.5 F5:.5 C4:.5 D4:.5 A4:.5 D5:.5 F5:.5 A4:.5 D5:.5 F5:.5 B3:.5 D4:.5 G4:.5 D5:.5 F5:.5 G4:.5 D5:.5 F5:.5 B3:.5 D4:.5 G4:.5 D5:.5 F5:.5 G4:.5 D5:.5 F5:.5 C4:.5 E4:.5 G4:.5 C5:.5 E5:.5 G4:.5 C5:.5 E5:.5 C4:.5 E4:.5 G4:.5 C5:.5 E5:.5 G4:.5 C5:.5 E5:.5' },
  { id: 'carol', name: 'Carol of the Bells', notes: 'G4:.75 F#4:.25 G4:.5 E4:.5 G4:.75 F#4:.25 G4:.5 E4:.5 G4:.75 F#4:.25 G4:.5 E4:.5 G4:.75 F#4:.25 G4:.5 E4:.5 A4:.75 G#4:.25 A4:.5 F#4:.5 A4:.75 G#4:.25 A4:.5 F#4:.5 B4:.75 A#4:.25 B4:.5 G4:.5 B4:.75 A#4:.25 B4:.5 G4:.5 G4:.75 F#4:.25 G4:.5 E4:.5 G4:2' },
  { id: 'moonlight', name: 'Moonlight Sonata', notes: 'G#3:.5 C#4:.5 E4:.5 G#3:.5 C#4:.5 E4:.5 G#3:.5 C#4:.5 E4:.5 G#3:.5 C#4:.5 E4:.5 A3:.5 C#4:.5 E4:.5 A3:.5 C#4:.5 E4:.5 A3:.5 D4:.5 F#4:.5 A3:.5 D4:.5 F#4:.5 G#3:.5 C4:.5 F#4:.5 G#3:.5 C4:.5 E4:.5 G#3:.5 C#4:.5 E4:.5 G#3:.5 C#4:.5 E4:.5' },
];

export const songById = (id: string) => SONGS.find((s) => s.id === id) ?? SONGS[0];
