export interface AutoAnswerSegment { id: string; text: string }

/** Keeps final transcript segments until a whole settled batch can be submitted. */
export class AutoAnswerQueue {
 private pending: AutoAnswerSegment[] = [];
 private seen = new Set<string>();
 private provisional = new Set<string>();
 private anonymousSpeech = false;
 private timer: ReturnType<typeof setTimeout> | null = null;
 private activityAt = 0;
 private busy = false;
 private sequence = 0;
 private turnSequence = 0;

 constructor(
  private run: (question: string, segments?: AutoAnswerSegment[], turnId?: string) => void,
  private ready: () => boolean,
  private silenceMs = 900,
  private provisionalWatchdogMs = 8000,
 ) {}

 get snapshot(): AutoAnswerSegment[] { return this.pending.map(entry => ({...entry})); }

 offer(text: string, id?: string) {
  if (id !== undefined) this.provisional.delete(id);
  this.anonymousSpeech = false;
  if (!text.trim()) { this.schedule(); return; }
  const key = id ?? `anonymous-${++this.sequence}`;
  if (!this.seen.has(key)) {
   this.seen.add(key);
   this.pending.push({id: key, text});
   this.activityAt = Date.now();
  }
  this.schedule();
 }

 speech(id?: string) {
  if (id !== undefined) {
   if (this.seen.has(id)) return;
   this.provisional.add(id);
  } else this.anonymousSpeech = true;
  this.activityAt = Date.now();
  this.schedule();
 }

 completed() { this.busy = false; this.schedule(); }
 retry() { this.schedule(); }

 /** Restore interrupted originals ahead of finals received while answering. */
 requeue(entries: AutoAnswerSegment[]) {
  const restored = new Map<string, AutoAnswerSegment>();
  for (const entry of [...entries, ...this.pending]) {
   if (!entry.text.trim() || restored.has(entry.id)) continue;
   restored.set(entry.id, {...entry});
   this.seen.add(entry.id);
  }
  this.pending = [...restored.values()];
  this.schedule();
 }

 discard(id: string) {
  this.pending = this.pending.filter(entry => entry.id !== id);
  this.provisional.delete(id);
  this.seen.add(id);
  this.schedule();
 }

 /** Suspend lifecycle activity without losing final questions or dedup state.
  * Pause/auto-off must abandon provisional speech because its final may never
  * arrive. The watchdog alone never forces an incomplete batch to answer.
  * The caller releases an active answer via completed(), then retries on resume.
  */
 suspend() {
  this.cancelTimer();
  this.provisional.clear();
  this.anonymousSpeech = false;
 }

 clear() {
  this.cancelTimer();
  this.pending = [];
  this.seen.clear();
  this.provisional.clear();
  this.anonymousSpeech = false;
  this.busy = false;
 }

 private cancelTimer() {
  if (this.timer !== null) clearTimeout(this.timer);
  this.timer = null;
 }

 private schedule() {
  this.cancelTimer();
  if (this.busy || !this.pending.length) return;
  if (this.provisional.size || this.anonymousSpeech) {
   // A missing final stops scheduling after the watchdog. Never answer its
   // incomplete batch; a later final or discard can release the saved finals.
   const remaining = this.activityAt + this.provisionalWatchdogMs - Date.now();
   if (remaining > 0) this.timer = setTimeout(() => { this.timer = null; }, remaining);
   return;
  }
  const delay = Math.max(0, this.activityAt + this.silenceMs - Date.now());
  this.timer = setTimeout(() => {
   this.timer = null;
   if (this.busy || !this.ready()) return;
   const batch = this.snapshot;
   if (!batch.length) return;
   this.pending = [];
   this.busy = true;
   try {
    const question = batch.length === 1 ? batch[0].text : batch.map((entry, index) => `${index + 1}. ${entry.text}`).join('\n');
    this.run(question, batch, `auto-turn-${++this.turnSequence}`);
   } catch {
    // Preserve a failed submission, but require an explicit retry/new event.
    this.busy = false;
    this.requeue(batch);
    this.cancelTimer();
   }
  }, delay);
 }
}
