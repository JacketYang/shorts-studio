import { zipSync } from 'fflate';

/** 触发浏览器下载（使用真实 DOM 锚点，不提前 revoke URL） */
export function saveUrl(url: string, filename: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => a.remove(), 2000);
}

export function saveBlob(blob: Blob, filename: string) {
  saveUrl(URL.createObjectURL(blob), filename);
}

/** 备用方案：系统“另存为”对话框 */
export async function saveWithPicker(blob: Blob, filename: string, ext: string) {
  const w = window as unknown as { showSaveFilePicker?: (o: unknown) => Promise<{ createWritable: () => Promise<{ write: (b: Blob) => Promise<void>; close: () => Promise<void> }> }> };
  if (!w.showSaveFilePicker) throw new Error('当前浏览器不支持“另存为”选择器');
  const h = await w.showSaveFilePicker({
    suggestedName: filename,
    types: [{ description: 'Video', accept: { [ext === 'mp4' ? 'video/mp4' : 'video/webm']: ['.' + ext] } }],
  });
  const wr = await h.createWritable();
  await wr.write(blob);
  await wr.close();
}

export function openInNewTab(url: string) {
  window.open(url, '_blank', 'noopener');
}

export async function buildZip(files: { name: string; blob?: Blob; text?: string }[]): Promise<Blob> {
  const obj: Record<string, Uint8Array> = {};
  for (const f of files) {
    if (f.blob) obj[f.name] = new Uint8Array(await f.blob.arrayBuffer());
    else obj[f.name] = new TextEncoder().encode(f.text ?? '');
  }
  const out = zipSync(obj, { level: 0 });
  return new Blob([out as BlobPart], { type: 'application/zip' });
}

export async function copyText(s: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(s);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = s;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

export const isEmbedded = () => {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
};
