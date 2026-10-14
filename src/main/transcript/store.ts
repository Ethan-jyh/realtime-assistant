import { AudioSourceId } from '../../shared/contracts';

export interface Segment {
  sourceId: AudioSourceId;
  streamEpoch: number;
  segmentId: string;
  revision: number;
  text: string;
  isFinal: boolean;
  startMs?: number | null;
  endMs?: number | null;
}

export function putSegment(rows: Map<string, Segment>, next: Segment): boolean {
  const key = JSON.stringify([next.sourceId, next.streamEpoch, next.segmentId]);
  const old = rows.get(key);
  if (old) {
    if (old.isFinal) return false;
    if (next.revision <= old.revision) return false;
  }
  rows.set(key, { ...next });
  return true;
}
