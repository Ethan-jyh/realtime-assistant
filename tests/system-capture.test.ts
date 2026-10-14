import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcess, spawn as nodeSpawn } from 'node:child_process';
import { afterEach, expect, test, vi } from 'vitest';
import { NativeSystemAudio } from '../src/main/audio/system-capture';

class FakeChild extends EventEmitter {
  stdin = new PassThrough(); stdout = new PassThrough(); stderr = null;
  exitCode: number | null = null; signalCode: NodeJS.Signals | null = null;
  signals: string[] = []; ignoreStop = false;
  constructor() {
    super(); this.stdin.on('finish', () => {
      if (!this.ignoreStop) queueMicrotask(() => this.exit());
    });
  }
  kill(signal: string = 'SIGTERM') { this.signals.push(signal); return true; }
  exit(code = 0) { this.exitCode = code; this.emit('exit', code, null); this.emit('close', code, null); }
  line(value: unknown) { this.stdout.write(JSON.stringify(value) + '\n'); }
}
function fixture() {
  const children: FakeChild[] = [], frames: Float32Array[] = [], errors: Error[] = [];
  const spawn = vi.fn(() => {
    const child = new FakeChild(); children.push(child);
    return child as unknown as ChildProcess;
  }) as unknown as typeof nodeSpawn;
  const audio = new NativeSystemAudio({ executable: '/fake/audio-only', spawn,
    onPcm: frame => frames.push(frame), onError: error => errors.push(error) });
  return { audio, children, frames, errors, spawn };
}
const ready = (rate = 48000) => ({ type: 'ready', sampleRate: rate, channels: 1, format: 'f32le' });
function pcm(values: readonly number[] | Float32Array) {
  const bytes = Buffer.alloc(values.length * 4);
  values.forEach((value, index) => bytes.writeFloatLE(value, index * 4));
  return { type: 'pcm', data: bytes.toString('base64') };
}
afterEach(() => vi.useRealTimers());

test('start waits for ready, shares an in-flight start, and preserves fragmented Float32 packets', async () => {
  const f = fixture(); const first = f.audio.start(); const second = f.audio.start();
  expect(f.audio.running).toBe(false); expect(f.children).toHaveLength(1);
  let settled = false; void first.then(() => { settled = true; });
  await Promise.resolve(); expect(settled).toBe(false);
  const text = JSON.stringify(ready(16000)) + '\n' + JSON.stringify(pcm([0.25, -0.5, 1, 0])) + '\n';
  f.children[0].stdout.write(text.slice(0, 13));
  f.children[0].stdout.write(text.slice(13));
  await Promise.all([first, second]);
  expect(f.audio.running).toBe(true);
  expect([...f.frames[0]]).toEqual([0.25, -0.5, 1, 0]);
  await f.audio.stop(); expect(f.audio.running).toBe(false); expect(f.errors).toEqual([]);
});

test('48k and fractional 44.1k resampling retain continuity independent of packet splits', async () => {
  for (const rate of [48000, 44100]) {
    const input = Float32Array.from({ length: rate / 5 }, (_, i) => Math.sin(i * 2 * Math.PI * 1000 / rate));
    const collect = async (split: boolean) => {
      const f = fixture(); const start = f.audio.start(); f.children[0].line(ready(rate)); await start;
      if (split) for (let i = 0; i < input.length; i += 137) f.children[0].line(pcm(input.subarray(i, i + 137)));
      else f.children[0].line(pcm(input));
      await f.audio.stop(); return f.frames.flatMap(frame => [...frame]);
    };
    const whole = await collect(false), split = await collect(true);
    expect(split).toEqual(whole);
    expect(whole.length).toBeGreaterThan(3160); expect(whole.length).toBeLessThanOrEqual(3200);
    const rms = Math.sqrt(whole.slice(100).reduce((sum, x) => sum + x * x, 0) / (whole.length - 100));
    expect(rms).toBeGreaterThan(0.69); expect(rms).toBeLessThan(0.72);
  }
});

test('downsampling filters frequencies above the 16k output Nyquist limit', async () => {
  const f = fixture(); const start = f.audio.start(); f.children[0].line(ready()); await start;
  f.children[0].line(pcm(Float32Array.from({ length: 9600 }, (_, i) => Math.sin(i * 2 * Math.PI * 12000 / 48000))));
  const values = f.frames.flatMap(frame => [...frame]).slice(100);
  expect(values.length).toBeGreaterThan(3000);
  expect(Math.sqrt(values.reduce((sum, x) => sum + x * x, 0) / values.length)).toBeLessThan(0.03);
  await f.audio.stop();
});

test.each([
  ready(NaN), { ...ready(), channels: 2 }, { ...ready(), format: 's16le' },
  { type: 'pcm', data: 'AAAA' }, { type: 'error', code: 'tap_create_failed', status: -1 }
])('invalid startup packets reject and tear down without exposing raw input: %j', async packet => {
  const f = fixture(); const start = f.audio.start();
  const assertion = expect(start).rejects.toThrow(/SYSTEM_AUDIO_/);
  f.children[0].line(packet); await assertion; await f.audio.stop();
  expect(f.audio.running).toBe(false); expect(f.errors).toEqual([]);
});

test.each(['not json\n', '{"type":"private_device_name"}\n', 'x'.repeat(300000)])(
  'malformed or oversized lines fail with static errors', async line => {
    const f = fixture(); const start = f.audio.start();
    const assertion = expect(start).rejects.toThrow('SYSTEM_AUDIO_PROTOCOL_ERROR');
    f.children[0].stdout.write(line); await assertion; await f.audio.stop();
    expect(f.errors).toEqual([]);
  });

test.each(['?', 'AA==', Buffer.from([0, 0, 192, 127]).toString('base64')])(
  'invalid base64, partial floats, or NaN never reach the PCM consumer: %s', async data => {
    const f = fixture(); const start = f.audio.start(); f.children[0].line(ready(16000)); await start;
    f.children[0].line({ type: 'pcm', data }); await f.audio.stop();
    expect(f.frames).toEqual([]); expect(f.errors[0].message).toBe('SYSTEM_AUDIO_PROTOCOL_ERROR');
  });

test('unexpected helper exit fails capture once and allows restart', async () => {
  const f = fixture(); const start = f.audio.start(); f.children[0].line(ready(16000)); await start;
  f.children[0].exit(1);
  expect(f.audio.running).toBe(false); expect(f.errors).toHaveLength(1);
  const restart = f.audio.start(); f.children[1].line(ready(16000)); await restart;
  await f.audio.stop(); expect(f.errors).toHaveLength(1);
});

test('stop cancels pending start and old generation callbacks cannot leak into a restart', async () => {
  const f = fixture(); const start = f.audio.start();
  const assertion = expect(start).rejects.toThrow('SYSTEM_AUDIO_STOPPED');
  await f.audio.stop(); await assertion;
  const restart = f.audio.start(); f.children[1].line(ready(16000)); await restart;
  f.children[0].line(ready(16000)); f.children[0].line(pcm([0.75])); f.children[0].exit(1);
  f.children[1].line(pcm([0.25]));
  expect(f.frames.map(frame => [...frame])).toEqual([[0.25]]);
  expect(f.audio.running).toBe(true); expect(f.errors).toEqual([]); await f.audio.stop();
});

test('startup timeout stops a helper that never confirms readiness', async () => {
  vi.useFakeTimers(); const f = fixture(); const start = f.audio.start();
  const assertion = expect(start).rejects.toThrow('SYSTEM_AUDIO_START_TIMEOUT');
  await vi.advanceTimersByTimeAsync(31000); await assertion;
  expect(f.audio.running).toBe(false); expect(f.errors).toEqual([]); await f.audio.stop();
});

test('stop is bounded even when a helper ignores stdin, SIGTERM and SIGKILL', async () => {
  vi.useFakeTimers(); const f = fixture(); const start = f.audio.start();
  f.children[0].ignoreStop = true; f.children[0].line(ready()); await start;
  const stop = f.audio.stop(); await vi.advanceTimersByTimeAsync(3000); await stop;
  expect(f.audio.running).toBe(false); expect(f.children[0].signals).toContain('SIGTERM');
  expect(f.children[0].signals).toContain('SIGKILL'); expect(f.errors).toEqual([]);
});

test('spawn exceptions reject safely without retaining device or process details', async () => {
  const errors: Error[] = [];
  const audio = new NativeSystemAudio({ executable: '/fake/audio-only', onPcm: () => {},
    onError: error => errors.push(error), spawn: (() => { throw Error('private_path'); }) as typeof nodeSpawn });
  await expect(audio.start()).rejects.toThrow('SYSTEM_AUDIO_SPAWN_FAILED');
  expect(errors).toEqual([]); await audio.stop();
});

test('high native rates still suppress aliasing above the 16k output Nyquist limit', async () => {
  const f = fixture(); const start = f.audio.start(); f.children[0].line(ready(384000)); await start;
  const samples = Float32Array.from({ length: 38400 }, (_, i) => Math.sin(i * 2 * Math.PI * 12000 / 384000));
  f.children[0].line(pcm(samples));
  const values = f.frames.flatMap(frame => [...frame]).slice(100);
  expect(values.length).toBeGreaterThan(1400);
  expect(Math.sqrt(values.reduce((sum, x) => sum + x * x, 0) / values.length)).toBeLessThan(0.03);
  await f.audio.stop();
});

test('post-ready native errors retain only static code and numeric status and notify once', async () => {
  const f = fixture(); const start = f.audio.start(); f.children[0].line(ready(16000)); await start;
  f.children[0].line({ type: 'error', code: 'audio_start_failed', status: -50, detail: 'private_device_name' });
  f.children[0].exit(1); await f.audio.stop();
  expect(f.errors).toHaveLength(1);
  expect(f.errors[0]).toMatchObject({ code: 'SYSTEM_AUDIO_AUDIO_START_FAILED', status: -50 });
  expect(f.errors[0].message).not.toContain('private_device_name');
});
