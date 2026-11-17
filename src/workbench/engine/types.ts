export const W = 1080;
export const H = 1920;

export type Voice =
  | 'marimba'
  | 'bell'
  | 'pluck'
  | 'click'
  | 'blip'
  | 'thud'
  | 'pad'
  | 'tick'
  | 'kalimba'
  | 'celesta'
  | 'rhodes'
  | 'pizzicato';

export type StageStyle = 'paper' | 'bauhaus' | 'blueprint' | 'oscilloscope' | 'editorial' | 'concert';

export interface AudioEvent {
  t: number;
  f: number;
  v?: number;
  voice: Voice;
  d?: number;
  pan?: number;
}

export interface Theme {
  name: string;
  labelZh: string;
  style: StageStyle;
  isLight: boolean;
  bg: [string, string];
  accent: string[];
  ink: string;
  subInk: string;
  accentInk: string;
  muted: string;
  grid: string;
  successInk: string;
}

export type Ctx = CanvasRenderingContext2D;

export interface Scene {
  duration: number;
  audio: AudioEvent[];
  echo?: boolean;
  draw: (ctx: Ctx, t: number) => void;
}

export interface BuildCtx {
  rng: () => number;
  theme: Theme;
  seed: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Builder = (c: BuildCtx, p: any) => Scene;

export interface VideoSpec {
  id: string;
  engine: string;
  params: unknown;
  seed: number;
  theme: number;
  category: string;
  catLabel: string;
  title: string;
  hook: string;
  description: string;
  tags: string[];
  filename: string;
}
