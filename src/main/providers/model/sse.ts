const MAX_LIMIT = 1024 * 1024; // 1 MB

export class SseDecoder {
  private decoder = new TextDecoder();
  private pending = '';
  private data: string[] = [];
  private currentEventBytes = 0;

  constructor(private emit: (value: string) => void) {}

  push(bytes: Uint8Array): void {
    this.consume(this.decoder.decode(bytes, { stream: true }), false);
  }

  end(): void {
    this.consume(this.decoder.decode(), true);
  }

  private consume(chunk: string, isEnd: boolean): void {
    this.pending += chunk;
    if (this.pending.length > MAX_LIMIT) {
      throw new Error('PROTOCOL_LIMIT');
    }

    for (;;) {
      const match = /\r\n|\n|\r/.exec(this.pending);
      if (!match) {
        if (isEnd && this.pending.length > 0) {
          // 在 stream 终结时，处理最后一行文本（若无换行符）
          this.processLine(this.pending);
          this.pending = '';
        }
        return;
      }

      const i = match.index;
      // 如果当前是 '\r' 且恰好在字符串末尾，且非 end，则可能等待随后的 '\n'
      if (!isEnd && this.pending[i] === '\r' && i === this.pending.length - 1) {
        return;
      }

      const line = this.pending.slice(0, i);
      this.pending = this.pending.slice(i + match[0].length);

      this.processLine(line);
    }
  }

  private processLine(line: string): void {
    if (line === '') {
      // 空行表示事件边界
      if (this.data.length > 0) {
        const payload = this.data.join('\n');
        this.emit(payload);
        this.data = [];
        this.currentEventBytes = 0;
      }
    } else if (line.startsWith(':')) {
      // 注释行忽略
      return;
    } else if (line.startsWith('data:')) {
      let content = line.slice(5);
      if (content.startsWith(' ')) {
        content = content.slice(1);
      }
      this.currentEventBytes += content.length;
      if (this.currentEventBytes > MAX_LIMIT) {
        throw new Error('PROTOCOL_LIMIT');
      }
      this.data.push(content);
    }
  }
}
