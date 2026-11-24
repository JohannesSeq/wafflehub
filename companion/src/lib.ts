import { useEffect, useRef, useState } from 'react';
import { appStateSchema, type AppState } from './types';
import { initialState } from './defaults';

export async function api<T>(path: string, body?: unknown, method = 'POST', signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, { method: body === undefined ? 'GET' : method, headers: body === undefined ? undefined : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Something went wrong. Please try again.');
  return result as T;
}
export function useRoom() {
  const [state, setState] = useState<AppState>(initialState);
  const [ready, setReady] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'loading' | 'saved' | 'saving' | 'error'>('loading');
  const [saveError, setSaveError] = useState('');
  const queue = useRef(Promise.resolve());
  const latest = useRef(0);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    api<{ data: unknown }>('/api/state', undefined, 'GET', abort.signal).then(result => {
      if (abort.signal.aborted) return;
      setState(result.data ? appStateSchema.parse(result.data) : initialState());
      setReady(true); setSaveStatus('saved'); setSaveError('');
    }).catch(error => { if (!abort.signal.aborted) { setSaveStatus('error'); setSaveError(error.message); } });
    return () => abort.abort();
  }, [retry]);
  useEffect(() => {
    if (!ready) return;
    const revision = ++latest.current;
    setSaveStatus('saving');
    const timer = setTimeout(() => {
      queue.current = queue.current.catch(() => {}).then(async () => {
        try {
          await api('/api/state', state, 'PUT');
          if (revision === latest.current) { setSaveStatus('saved'); setSaveError(''); }
        } catch (error) {
          if (revision === latest.current) { setSaveStatus('error'); setSaveError((error as Error).message); }
        }
      });
    }, 650);
    return () => clearTimeout(timer);
  }, [state, ready]);
  function retrySave() {
    if (!ready) setRetry(n => n + 1);
    else setState(s => ({ ...s }));
  }
  return { state, setState, ready, saveStatus, saveError, retrySave };
}

let audioContext: AudioContext | undefined;
export function pop(enabled: boolean, love = false) {
  if (!enabled) return;
  try {
    audioContext ??= new AudioContext();
    void audioContext.resume();
    const time = audioContext.currentTime;
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(love ? 740 : 540, time);
    oscillator.frequency.exponentialRampToValueAtTime(love ? 980 : 290, time + 0.085);
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(0.045, time + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.12);
    oscillator.connect(gain); gain.connect(audioContext.destination);
    oscillator.start(time); oscillator.stop(time + 0.13);
  } catch { /* sound remains optional on browsers without Web Audio */ }
}

export async function readChatStream(response: Response, onText: (text: string) => void) {
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || `Chat request failed (${response.status}).`);
  }
  if (!response.body) throw new Error('The provider returned an empty response.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let total = '';
  function consume(line: string) {
    if (!line.startsWith('data:')) return;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') return;
    let chunk: { error?: { message?: string }; choices?: {delta?: {content?: string}}[] };
    try { chunk = JSON.parse(data); } catch { return; }
    if (chunk.error) throw new Error(chunk.error.message || 'The provider interrupted this response.');
    const text = chunk.choices?.[0]?.delta?.content;
    if (typeof text === 'string') { total += text; onText(total); }
  }
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';
      for (const line of lines) consume(line);
      if (done) { if (buffer.trim()) consume(buffer); break; }
    }
  } finally { reader.releaseLock(); }
  if (!total.trim()) throw new Error('The model returned no reply. Try a different model or increase the response limit.');
  return total;
}
export function downloadJSON(name: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function timeLabel(value: string) {
  return new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
