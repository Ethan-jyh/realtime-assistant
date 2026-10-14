import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';

const MAX_LINE_BYTES = 262144;
const NATIVE_CODES = new Set(['tap_create_failed', 'tap_format_failed', 'tap_uid_failed',
  'unsupported_audio_format', 'aggregate_create_failed', 'io_create_failed',
  'audio_start_failed', 'internal_error', 'unsupported_os']);
interface Options {
  executable: string; onPcm: (frame: Float32Array) => void;
  onError: (error: NativeSystemAudioError) => void; spawn?: typeof nodeSpawn;
}
export class NativeSystemAudioError extends Error {
  constructor(readonly code: string, readonly status?: number) { super(code); }
}
interface Session {
  generation: number; child: ChildProcess; ready: boolean; ended: boolean;
  pending: Buffer; resampler?: Resampler16k; promise: Promise<void>;
  resolve: () => void; reject: (error: Error) => void;
  timer?: ReturnType<typeof setTimeout>; detach: () => void;
}
// Streaming windowed-sinc interpolation filters above the output Nyquist limit.
// Retain phase and a bounded history across packet boundaries. Widen the filter
// for high native rates to keep its transition band stable in hertz.
class Resampler16k {
  private buffer = new Float32Array(0);
  private base = 0; private next = 0; private first = 0;
  private readonly radius: number;
  constructor(readonly rate: number) { this.radius = Math.ceil(32 * Math.max(1, rate / 48000)); }
  push(input: Float32Array): Float32Array {
    if (this.rate === 16000) return input;
    if (this.base === 0 && this.buffer.length === 0) this.first = input[0];
    const data = new Float32Array(this.buffer.length + input.length);
    data.set(this.buffer); data.set(input, this.buffer.length);
    const end = this.base + data.length, step = this.rate / 16000;
    const cutoff = Math.min(1, 16000 / this.rate) * 0.45;
    const output: number[] = [];
    while (this.next + this.radius < end) {
      const center = Math.floor(this.next);
      let sum = 0, weights = 0;
      for (let index = center - this.radius + 1; index <= center + this.radius; index++) {
        const distance = index - this.next;
        if (Math.abs(distance) >= this.radius) continue;
        const sinc = distance === 0 ? 2 * cutoff : Math.sin(2 * Math.PI * cutoff * distance) / (Math.PI * distance);
        const weight = sinc * (0.5 + 0.5 * Math.cos(Math.PI * distance / this.radius));
        sum += (index < 0 ? this.first : data[index - this.base]) * weight; weights += weight;
      }
      output.push(sum / weights); this.next += step;
    }
    const keepFrom = Math.max(this.base, Math.floor(this.next) - this.radius);
    this.buffer = data.slice(keepFrom - this.base); this.base = keepFrom;
    return Float32Array.from(output);
  }
}

export class NativeSystemAudio {
  private generation = 0;
  private session: Session | null = null;
  private cleanups = new Set<Promise<void>>();
  constructor(private readonly options: Options) {}
  get running(): boolean { return this.session?.ready === true; }
  start(): Promise<void> {
    if (this.session) return this.session.promise;
    let child: ChildProcess;
    try {
      // stderr is ignored at the OS boundary; never pass machine details to logs.
      child = (this.options.spawn ?? nodeSpawn)(this.options.executable, [], {
        stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true
      });
    } catch { return Promise.reject(new NativeSystemAudioError('SYSTEM_AUDIO_SPAWN_FAILED')); }
    let resolve!: () => void, reject!: (error: Error) => void;
    const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
    const session: Session = { generation: ++this.generation, child, ready: false, ended: false,
      pending: Buffer.alloc(0), promise, resolve, reject, detach: () => {} };
    this.session = session;
    const onData = (data: Buffer | string) => {
      if (!this.isCurrent(session)) return;
      try { this.consume(session, Buffer.isBuffer(data) ? data : Buffer.from(data)); }
      catch { this.fail(session, 'SYSTEM_AUDIO_PROTOCOL_ERROR'); }
    };
    const onExit = () => {
      session.ended = true;
      if (this.isCurrent(session)) this.fail(session, 'SYSTEM_AUDIO_HELPER_EXITED');
    };
    const onError = () => { if (this.isCurrent(session)) this.fail(session, 'SYSTEM_AUDIO_SPAWN_FAILED'); };
    const onStreamError = () => { if (this.isCurrent(session)) this.fail(session, 'SYSTEM_AUDIO_STREAM_FAILED'); };
    child.on('error', onError); child.on('exit', onExit); child.on('close', onExit);
    child.stdout?.on('data', onData); child.stdout?.on('error', onStreamError);
    child.stdin?.on('error', onStreamError);
    session.detach = () => {
      child.stdout?.off('data', onData); child.off('exit', onExit); child.off('close', onExit);
      // Keep sanitizing error listeners for late EventEmitter errors after stop.
    };
    session.timer = setTimeout(() => this.fail(session, 'SYSTEM_AUDIO_START_TIMEOUT'), 15000);
    if (!child.stdin || !child.stdout) this.fail(session, 'SYSTEM_AUDIO_SPAWN_FAILED');
    return promise;
  }
  private isCurrent(session: Session): boolean {
    return this.session === session && session.generation === this.generation;
  }
  private consume(session: Session, chunk: Buffer): void {
    let offset = 0;
    while (offset < chunk.length && this.isCurrent(session)) {
      const newline = chunk.indexOf(10, offset), end = newline < 0 ? chunk.length : newline;
      const segment = chunk.subarray(offset, end);
      if (session.pending.length + segment.length > MAX_LINE_BYTES) throw new Error();
      session.pending = session.pending.length ? Buffer.concat([session.pending, segment]) : Buffer.from(segment);
      if (newline < 0) return;
      const line = session.pending; session.pending = Buffer.alloc(0);
      if (!line.length) throw new Error();
      this.packet(session, JSON.parse(line.toString('utf8')) as unknown); offset = newline + 1;
    }
  }
  private packet(session: Session, value: unknown): void {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    const record = value as Record<string, unknown>;
    if (record.type === 'error') {
      const code = typeof record.code === 'string' && NATIVE_CODES.has(record.code)
        ? `SYSTEM_AUDIO_${record.code.toUpperCase()}` : 'SYSTEM_AUDIO_NATIVE_ERROR';
      const status = typeof record.status === 'number' && Number.isInteger(record.status) &&
        record.status >= -2147483648 && record.status <= 2147483647 ? record.status : undefined;
      this.fail(session, code, status); return;
    }
    if (record.type === 'ready') {
      if (session.ready || typeof record.sampleRate !== 'number' || !Number.isFinite(record.sampleRate) ||
          record.sampleRate < 8000 || record.sampleRate > 384000 || record.channels !== 1 || record.format !== 'f32le') throw new Error();
      session.resampler = new Resampler16k(record.sampleRate);
      session.ready = true; clearTimeout(session.timer); session.resolve(); return;
    }
    if (record.type !== 'pcm' || !session.ready || typeof record.data !== 'string' ||
        record.data.length === 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(record.data)) throw new Error();
    const bytes = Buffer.from(record.data, 'base64');
    if (bytes.length === 0 || bytes.length % 4 || bytes.length > 153600) throw new Error();
    const input = new Float32Array(bytes.length / 4);
    if (input.length > session.resampler!.rate / 4) throw new Error();
    for (let index = 0; index < input.length; index++) {
      const sample = bytes.readFloatLE(index * 4);
      if (!Number.isFinite(sample)) throw new Error(); input[index] = sample;
    }
    const output = session.resampler!.push(input);
    if (output.length && this.isCurrent(session)) {
      try { this.options.onPcm(output); }
      catch { this.fail(session, 'SYSTEM_AUDIO_CONSUMER_FAILED'); }
    }
  }
  private fail(session: Session, code: string, status?: number): void {
    if (!this.isCurrent(session)) return;
    this.session = null; ++this.generation; clearTimeout(session.timer);
    const error = new NativeSystemAudioError(code, status);
    if (!session.ready) session.reject(error);
    this.scheduleCleanup(session);
    if (session.ready) try { this.options.onError(error); } catch { /* Cleanup still runs. */ }
  }
  private scheduleCleanup(session: Session): Promise<void> {
    const work = this.reap(session); this.cleanups.add(work);
    void work.finally(() => this.cleanups.delete(work)); return work;
  }
  private async reap(session: Session): Promise<void> {
    const { child } = session;
    let timer: ReturnType<typeof setTimeout> | undefined, finish!: () => void;
    const exited = new Promise<void>(resolve => { finish = resolve; });
    const onExit = () => { session.ended = true; finish(); };
    child.once('exit', onExit); child.once('close', onExit);
    const wait = () => Promise.race([exited, new Promise<void>(resolve => { timer = setTimeout(resolve, 500); })])
      .finally(() => clearTimeout(timer));
    try {
      if (!session.ended && child.exitCode === null && child.signalCode === null) {
        try { child.stdin?.end('stop\n'); } catch { /* Continue to signals. */ }
        await wait();
        for (const signal of ['SIGTERM', 'SIGKILL'] as const) {
          if (session.ended) break;
          try { child.kill(signal); } catch { /* Already exited or inaccessible. */ }
          await wait();
        }
      }
    } finally {
      clearTimeout(timer); child.off('exit', onExit); child.off('close', onExit);
      session.detach(); child.stdin?.destroy(); child.stdout?.destroy(); session.pending = Buffer.alloc(0);
    }
  }
  async stop(): Promise<void> {
    const session = this.session;
    if (session) {
      this.session = null; ++this.generation; clearTimeout(session.timer);
      if (!session.ready) session.reject(new NativeSystemAudioError('SYSTEM_AUDIO_STOPPED'));
      this.scheduleCleanup(session);
    }
    await Promise.all([...this.cleanups]);
  }
}
