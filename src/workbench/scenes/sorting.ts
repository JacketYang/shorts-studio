import type { AudioEvent, Builder } from '../engine/types';
import { TAU, clamp, hsl, text } from '../engine/util';

type Op = [number, number, number];

export const ALGOS: Record<string, { label: string; big: string }> = {
  bubble: { label: 'Bubble Sort', big: 'O(n²)' },
  insertion: { label: 'Insertion Sort', big: 'O(n²)' },
  selection: { label: 'Selection Sort', big: 'O(n²)' },
  quick: { label: 'Quick Sort', big: 'O(n log n)' },
  merge: { label: 'Merge Sort', big: 'O(n log n)' },
  heap: { label: 'Heap Sort', big: 'O(n log n)' },
  shell: { label: 'Shell Sort', big: 'O(n^1.5)' },
  comb: { label: 'Comb Sort', big: 'O(n²) → O(n log n)' },
  cocktail: { label: 'Cocktail Shaker Sort', big: 'O(n²)' },
  radix: { label: 'Radix Sort (LSD)', big: 'O(d·n)' },
  oddeven: { label: 'Odd-Even Sort', big: 'O(n²)' },
};

function runAlgo(name: string, init: number[]): Op[] {
  const a = init.slice();
  const n = a.length;
  const ops: Op[] = [];
  const cmp = (i: number, j: number) => { ops.push([0, i, j]); };
  const swap = (i: number, j: number) => { const t = a[i]; a[i] = a[j]; a[j] = t; ops.push([1, i, j]); };
  const set = (i: number, v: number) => { a[i] = v; ops.push([2, i, v]); };
  switch (name) {
    case 'bubble':
      for (let i = 0; i < n - 1; i++) {
        let sw = false;
        for (let j = 0; j < n - 1 - i; j++) { cmp(j, j + 1); if (a[j] > a[j + 1]) { swap(j, j + 1); sw = true; } }
        if (!sw) break;
      }
      break;
    case 'insertion':
      for (let i = 1; i < n; i++) {
        let j = i;
        while (j > 0) { cmp(j - 1, j); if (a[j - 1] > a[j]) { swap(j - 1, j); j--; } else break; }
      }
      break;
    case 'selection':
      for (let i = 0; i < n - 1; i++) {
        let m = i;
        for (let j = i + 1; j < n; j++) { cmp(j, m); if (a[j] < a[m]) m = j; }
        if (m !== i) swap(i, m);
      }
      break;
    case 'quick': {
      const qs = (lo: number, hi: number) => {
        if (lo >= hi) return;
        const pv = a[hi];
        let i = lo;
        for (let j = lo; j < hi; j++) { cmp(j, hi); if (a[j] < pv) { if (i !== j) swap(i, j); i++; } }
        if (i !== hi) swap(i, hi);
        qs(lo, i - 1);
        qs(i + 1, hi);
      };
      qs(0, n - 1);
      break;
    }
    case 'merge': {
      const ms = (lo: number, hi: number) => {
        if (hi <= lo) return;
        const mid = (lo + hi) >> 1;
        ms(lo, mid);
        ms(mid + 1, hi);
        const L = a.slice(lo, mid + 1), Rr = a.slice(mid + 1, hi + 1);
        let i = 0, j = 0, k = lo;
        while (i < L.length && j < Rr.length) {
          cmp(lo + i, mid + 1 + j);
          if (L[i] <= Rr[j]) set(k++, L[i++]); else set(k++, Rr[j++]);
        }
        while (i < L.length) set(k++, L[i++]);
        while (j < Rr.length) set(k++, Rr[j++]);
      };
      ms(0, n - 1);
      break;
    }
    case 'heap': {
      const sift = (r0: number, end: number) => {
        let r = r0;
        for (;;) {
          const l = 2 * r + 1;
          if (l >= end) break;
          let big = r;
          cmp(l, big);
          if (a[l] > a[big]) big = l;
          if (l + 1 < end) { cmp(l + 1, big); if (a[l + 1] > a[big]) big = l + 1; }
          if (big === r) break;
          swap(r, big);
          r = big;
        }
      };
      for (let i = (n >> 1) - 1; i >= 0; i--) sift(i, n);
      for (let e = n - 1; e > 0; e--) { swap(0, e); sift(0, e); }
      break;
    }
    case 'shell':
      for (let gap = n >> 1; gap > 0; gap >>= 1)
        for (let i = gap; i < n; i++) {
          let j = i;
          while (j >= gap) { cmp(j - gap, j); if (a[j - gap] > a[j]) { swap(j - gap, j); j -= gap; } else break; }
        }
      break;
    case 'comb': {
      let gap = n, sorted = false;
      while (!sorted) {
        gap = Math.floor(gap / 1.3);
        if (gap <= 1) { gap = 1; sorted = true; }
        for (let i = 0; i + gap < n; i++) { cmp(i, i + gap); if (a[i] > a[i + gap]) { swap(i, i + gap); sorted = false; } }
      }
      break;
    }
    case 'cocktail': {
      let start = 0, end = n - 1, sw = true;
      while (sw) {
        sw = false;
        for (let i = start; i < end; i++) { cmp(i, i + 1); if (a[i] > a[i + 1]) { swap(i, i + 1); sw = true; } }
        if (!sw) break;
        sw = false;
        end--;
        for (let i = end - 1; i >= start; i--) { cmp(i, i + 1); if (a[i] > a[i + 1]) { swap(i, i + 1); sw = true; } }
        start++;
      }
      break;
    }
    case 'radix': {
      const mx = Math.max(...a);
      for (let e = 1; mx / e >= 1; e *= 10) {
        const bk: number[][] = Array.from({ length: 10 }, () => []);
        for (let i = 0; i < n; i++) { cmp(i, i); bk[Math.floor(a[i] / e) % 10].push(a[i]); }
        let k = 0;
        for (const b of bk) for (const v of b) set(k++, v);
      }
      break;
    }
    case 'oddeven': {
      let sorted = false;
      while (!sorted) {
        sorted = true;
        for (let i = 1; i < n - 1; i += 2) { cmp(i, i + 1); if (a[i] > a[i + 1]) { swap(i, i + 1); sorted = false; } }
        for (let i = 0; i < n - 1; i += 2) { cmp(i, i + 1); if (a[i] > a[i + 1]) { swap(i, i + 1); sorted = false; } }
      }
      break;
    }
  }
  return ops;
}

export const buildSorting: Builder = (c, p) => {
  const algo: string = p.algo;
  const n: number = p.n;
  const view: 'bars' | 'circle' | 'dots' | 'pyramid' = p.view;
  const rng = c.rng;
  const init = Array.from({ length: n }, (_, i) => i + 1);
  if (p.start === 'reversed') init.reverse();
  else for (let i = n - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [init[i], init[j]] = [init[j], init[i]]; }
  const ops = runAlgo(algo, init);
  const sortDur = clamp(ops.length / 180, p.minDur ?? 14, p.maxDur ?? 28);
  const snaps = Math.floor(sortDur * 60);
  const per = ops.length / snaps;
  const disp = init.slice();
  const frames: Uint16Array[] = [];
  const hl: Int16Array[] = [];
  const cmpC: number[] = [], wrC: number[] = [];
  const audio: AudioEvent[] = [];
  const freq = (v: number) => 150 * Math.pow(2, (3.2 * v) / n);
  let oi = 0, cc = 0, wc = 0;
  for (let s = 0; s < snaps; s++) {
    const end = s === snaps - 1 ? ops.length : Math.floor((s + 1) * per);
    let ta = -1, tb = -1;
    while (oi < end) {
      const [k, x, y] = ops[oi++];
      if (k === 1) { const t = disp[x]; disp[x] = disp[y]; disp[y] = t; wc++; ta = x; tb = y; }
      else if (k === 2) { disp[x] = y; wc++; ta = x; tb = -1; }
      else { cc++; ta = x; tb = y; }
    }
    frames.push(Uint16Array.from(disp));
    hl.push(Int16Array.from([ta, tb]));
    cmpC.push(cc); wrC.push(wc);
    if (ta >= 0) audio.push({ t: s / 60 + 0.1, f: freq(disp[ta]), voice: 'blip', v: 0.35, pan: (ta / n - 0.5) * 0.8 });
    if (tb >= 0 && s % 2 === 0) audio.push({ t: s / 60 + 0.1, f: freq(disp[tb]), voice: 'blip', v: 0.25, pan: (tb / n - 0.5) * 0.8 });
  }
  const sweepT = sortDur + 0.5;
  const sweepD = 1.5;
  for (let i = 0; i < n; i += Math.max(1, Math.floor(n / 60))) audio.push({ t: sweepT + (i / n) * sweepD + 0.1, f: freq(i + 1), voice: 'bell', v: 0.4, pan: (i / n - 0.5) * 0.8 });
  const duration = sweepT + sweepD + 1.3;
  const info = ALGOS[algo];

  return {
    duration,
    audio,
    echo: false,
    draw(ctx, t) {
      const s = clamp(Math.floor(t * 60), 0, snaps - 1);
      const arr = frames[s];
      const h = hl[s];
      const sweeping = t >= sweepT;
      const sw = sweeping ? ((t - sweepT) / sweepD) * n : -1;
      const hot = (i: number) => (t < sortDur && (i === h[0] || i === h[1])) || (sweeping && i <= sw);
      const col = (i: number, v: number) => (sweeping && i <= sw ? hsl((v / n) * 300, 90, 76) : t < sortDur && (i === h[0] || i === h[1]) ? '#ffffff' : hsl((v / n) * 300, 85, 58));
      if (view === 'bars') {
        const bw = 960 / n, base = 1440, mh = 930;
        for (let i = 0; i < n; i++) {
          const v = arr[i];
          ctx.fillStyle = col(i, v);
          const ht = (v / n) * mh;
          ctx.fillRect(60 + i * bw, base - ht, Math.max(1, bw - (bw > 5 ? 1.5 : 0.3)), ht);
        }
      } else if (view === 'dots') {
        const bw = 960 / n, base = 1440, mh = 930;
        const r = Math.min(11, bw * 0.45);
        for (let i = 0; i < n; i++) {
          const v = arr[i];
          ctx.fillStyle = col(i, v);
          ctx.beginPath();
          ctx.arc(60 + (i + 0.5) * bw, base - (v / n) * mh, hot(i) ? r * 1.5 : r, 0, TAU);
          ctx.fill();
        }
      } else if (view === 'pyramid') {
        const rh = 1020 / n;
        for (let i = 0; i < n; i++) {
          const v = arr[i];
          const wd = (v / n) * 940;
          ctx.fillStyle = col(i, v);
          ctx.fillRect(540 - wd / 2, 390 + i * rh, wd, Math.max(1, rh - 1));
        }
      } else {
        const cx = 540, cy = 900, r = 450;
        for (let i = 0; i < n; i++) {
          const a0 = -Math.PI / 2 + (i / n) * TAU;
          ctx.fillStyle = col(i, arr[i]);
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.arc(cx, cy, hot(i) ? r + 14 : r, a0, a0 + (TAU / n) * 1.04);
          ctx.closePath();
          ctx.fill();
        }
      }
      text(ctx, info.label, 540, 1560, 70, '#ffffff');
      text(ctx, info.big + '  ·  ' + n + ' elements', 540, 1637, 42, '#ffd166');
      text(ctx, `${cmpC[s].toLocaleString('en-US')} comparisons · ${wrC[s].toLocaleString('en-US')} writes`, 540, 1705, 34, '#ffffff', { alpha: 0.65, weight: 600 });
    },
  };
};
