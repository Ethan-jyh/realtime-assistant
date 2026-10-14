export class RequestSlot {
  private current = 0;
  private done = true;

  begin(): number {
    this.done = false;
    return ++this.current;
  }

  accept(id: number): boolean {
    return id === this.current && !this.done;
  }

  finish(id: number): boolean {
    if (!this.accept(id)) return false;
    this.done = true;
    return true;
  }

  cancel(id?: number): boolean {
    if (id !== undefined && id !== this.current) return false;
    if (this.done) return false;
    this.done = true;
    return true;
  }

  getCurrent(): number {
    return this.current;
  }

  isDone(): boolean {
    return this.done;
  }
}
