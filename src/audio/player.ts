import * as Tone from 'tone';
import { DEFAULT_BPM } from '../engine/generate.ts';
import type { Riff } from '../engine/types.ts';
import { CountInVoice } from './countIn.ts';
import { GuitarVoice } from './guitar.ts';
import { GUITARS, defaultMixer, isAudible, type GuitarId, type MixerState } from './mixer.ts';
import { buildSchedule, positionAtTicks, type CursorPosition, type Schedule } from './schedule.ts';

export type PlayerOptions = { loop?: boolean; countIn?: boolean };
type CursorListener = (position: CursorPosition | null) => void;
type StateListener = (playing: boolean) => void;

type AudioGraph = {
  voices: Record<GuitarId, GuitarVoice>;
  countIn: CountInVoice;
  bus: Tone.ToneAudioNode[];
};

/**
 * Plays a riff on the Tone.js transport: both guitars, the count-in, looping,
 * live tempo, mute/solo/volume, and a cursor callback for the tab view.
 *
 * Audio nodes are created on first play, in whatever Tone context is current,
 * so the same class also works inside Tone.Offline.
 */
export class Player {
  private riff: Riff | null = null;
  private schedule: Schedule | null = null;
  private audio: AudioGraph | null = null;
  private loop: boolean;
  private countIn: boolean;
  private bpm = DEFAULT_BPM;
  private mixer: MixerState = defaultMixer();
  private playing = false;
  private stopEventId: number | null = null;
  private readonly cursorListeners = new Set<CursorListener>();
  private readonly stateListeners = new Set<StateListener>();

  constructor(options: PlayerOptions = {}) {
    this.loop = options.loop ?? true;
    this.countIn = options.countIn ?? true;
  }

  /**
   * Bound on first use to the context current at that moment, and kept. Inside Tone.Offline the
   * global context is only swapped while the setup callback runs, so later lookups would hit the wrong transport.
   */
  private boundTransport: ReturnType<typeof Tone.getTransport> | null = null;

  private get transport() {
    this.boundTransport ??= Tone.getTransport();
    return this.boundTransport;
  }

  private get draw() {
    return this.transport.context.draw;
  }

  private ticksToSeconds(ticks: number): number {
    return (ticks / this.transport.PPQ) * (60 / this.transport.bpm.value);
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  get currentRiff(): Riff | null {
    return this.riff;
  }

  /**
   * Load a riff. Its BPM becomes the playback tempo. If playing, the new riff starts
   * at once without another count-in (the listener already has the tempo).
   */
  load(riff: Riff): void {
    const wasPlaying = this.playing;
    if (wasPlaying) this.stop();
    this.riff = riff;
    this.bpm = riff.bpm;
    this.transport.bpm.value = riff.bpm;
    if (wasPlaying) this.startTransport(undefined, { countIn: false });
  }

  /** Start playback. Must be called from a user gesture the first time (browser audio unlock). */
  async play(): Promise<void> {
    await Tone.start();
    this.startTransport();
  }

  /** Start the transport without unlocking audio (used directly by offline rendering). */
  startTransport(time?: number, options: { countIn?: boolean } = {}): void {
    if (!this.riff) throw new Error('No riff loaded');
    if (this.playing) this.stop();
    this.ensureAudio();
    this.scheduleRiff(this.riff, options.countIn ?? this.countIn);
    this.transport.start(time);
    this.setPlaying(true);
  }

  stop(): void {
    this.transport.stop();
    this.transport.cancel(0);
    // Cursor updates already queued on Draw would otherwise land after the stop and leave a stale cursor.
    this.draw.cancel(0);
    this.stopEventId = null;
    if (this.audio) GUITARS.forEach((g) => this.audio?.voices[g].silence());
    this.setPlaying(false);
    this.emitCursor(null);
  }

  async toggle(): Promise<void> {
    if (this.playing) this.stop();
    else await this.play();
  }

  /** Changes the tempo live; note lengths follow because they are converted when each note plays. */
  setBpm(bpm: number): void {
    this.bpm = bpm;
    this.transport.bpm.value = bpm;
  }

  getBpm(): number {
    return this.bpm;
  }

  setLoop(loop: boolean): void {
    this.loop = loop;
    if (!this.playing) return;
    this.transport.loop = loop;
    if (loop) this.clearStopEvent();
    else this.scheduleStopEvent();
  }

  /** Takes effect on the next play. */
  setCountIn(countIn: boolean): void {
    this.countIn = countIn;
  }

  setMuted(id: GuitarId, muted: boolean): void {
    this.mixer[id].muted = muted;
    this.applyMixer();
  }

  setSolo(id: GuitarId, solo: boolean): void {
    this.mixer[id].solo = solo;
    this.applyMixer();
  }

  setVolume(id: GuitarId, db: number): void {
    this.mixer[id].volumeDb = db;
    this.applyMixer();
  }

  getMixer(): MixerState {
    return structuredClone(this.mixer);
  }

  onCursor(listener: CursorListener): () => void {
    this.cursorListeners.add(listener);
    return () => this.cursorListeners.delete(listener);
  }

  onStateChange(listener: StateListener): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  dispose(): void {
    this.stop();
    if (!this.audio) return;
    GUITARS.forEach((g) => this.audio?.voices[g].dispose());
    this.audio.countIn.dispose();
    this.audio.bus.forEach((n) => n.dispose());
    this.audio = null;
  }

  private ensureAudio(): AudioGraph {
    if (this.audio) return this.audio;
    const limiter = new Tone.Limiter(-1).toDestination();
    const compressor = new Tone.Compressor({ threshold: -18, ratio: 4, attack: 0.005, release: 0.1 }).connect(limiter);
    this.audio = {
      voices: {
        guitar1: new GuitarVoice({ pan: -0.8, detuneCents: 0, delaySeconds: 0 }, compressor),
        guitar2: new GuitarVoice({ pan: 0.8, detuneCents: 6, delaySeconds: 0.008 }, compressor),
      },
      countIn: new CountInVoice(compressor),
      bus: [compressor, limiter],
    };
    this.applyMixer();
    return this.audio;
  }

  private applyMixer(): void {
    if (!this.audio) return;
    // Ramp only while playing (avoids clicks); otherwise jump, so the first note isn't heard on a muted guitar.
    const immediate = !this.playing;
    for (const g of GUITARS) {
      this.audio.voices[g].setAudible(isAudible(this.mixer, g), immediate);
      this.audio.voices[g].setVolume(-6 + this.mixer[g].volumeDb, immediate);
    }
  }

  private scheduleRiff(riff: Riff, countIn: boolean): void {
    const audio = this.ensureAudio();
    const tr = this.transport;
    tr.cancel(0);
    tr.bpm.value = this.bpm;
    const s = buildSchedule(riff, { countIn, ppq: tr.PPQ });
    this.schedule = s;

    s.countIn.forEach((ticks, beat) => {
      tr.schedule((time) => audio.countIn.click(time, beat === 0), `${ticks}i`);
    });
    for (const g of GUITARS) {
      const voice = audio.voices[g];
      for (const note of s[g]) {
        // Converted when the note plays, so a live tempo change also changes note lengths.
        tr.schedule((time) => voice.play(note, this.ticksToSeconds(note.durationTicks), time), `${note.ticks}i`);
      }
    }

    tr.scheduleRepeat(
      (time) => {
        const position = positionAtTicks(s, tr.getTicksAtTime(time));
        this.draw.schedule(() => {
          if (this.playing) this.emitCursor(position);
        }, time);
      },
      `${s.ticksPerStep}i`,
      0,
    );

    tr.setLoopPoints(`${s.riffStart}i`, `${s.riffEnd}i`);
    tr.loop = this.loop;
    if (!this.loop) this.scheduleStopEvent();
  }

  private scheduleStopEvent(): void {
    if (!this.schedule || this.stopEventId !== null) return;
    this.stopEventId = this.transport.scheduleOnce((time) => {
      this.draw.schedule(() => this.stop(), time);
    }, `${this.schedule.riffEnd}i`);
  }

  private clearStopEvent(): void {
    if (this.stopEventId === null) return;
    this.transport.clear(this.stopEventId);
    this.stopEventId = null;
  }

  private setPlaying(playing: boolean): void {
    if (this.playing === playing) return;
    this.playing = playing;
    this.stateListeners.forEach((l) => l(playing));
  }

  private emitCursor(position: CursorPosition | null): void {
    this.cursorListeners.forEach((l) => l(position));
  }
}
