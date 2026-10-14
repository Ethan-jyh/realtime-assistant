export type AudioSourceId = 'microphone' | 'system';

export interface SessionIdentity {
  sessionId: string;
  createdAt: number;
}

export interface PcmFrame {
  sourceId: AudioSourceId;
  streamEpoch: number;
  sequence: number;
  startSample: number;
  sampleRate: number;
  channels: number;
  pcm16: Uint8Array;
  startMs: number | null;
  durationMs: number;
}

export type TranscriptStatus =
  | { state: 'partial'; revision: number }
  | { state: 'final'; revision: number };

export interface TranscriptSegmentMetadata {
  sourceId: AudioSourceId;
  streamEpoch: number;
  segmentId: string;
  startMs: number | null;
  endMs: number | null;
  status: TranscriptStatus;
}

export interface TranscriptEvent {
  text: string;
  metadata: TranscriptSegmentMetadata;
}

export type AnswerStatus =
  | { state: 'streaming'; generation: number; requestId: string }
  | { state: 'completed'; generation: number; requestId: string; finishReason: 'stop' | 'length' | 'content_filter' | 'interrupted' }
  | { state: 'error'; generation: number; requestId: string; error: string };

export interface AnswerEvent {
  text: string;
  status: AnswerStatus;
}

export interface GapEvent {
  sourceId: AudioSourceId;
  streamEpoch: number;
  lostSeconds: number;
  reason: 'queue_overflow' | 'network_drop' | 'clock_drift';
}
