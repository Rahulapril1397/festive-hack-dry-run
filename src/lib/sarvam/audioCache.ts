import type { TtsAudio } from "./client";

/** Small LRU of generated announcements keyed by (language, text): repeats are instant. */
export class AudioCache {
  private map = new Map<string, TtsAudio>();
  constructor(private readonly max = 400) {}
  static key(lang: string, text: string) {
    return `${lang}\u0000${text}`;
  }
  get(lang: string, text: string): TtsAudio | undefined {
    const k = AudioCache.key(lang, text);
    const v = this.map.get(k);
    if (v) {
      this.map.delete(k);
      this.map.set(k, v);
    }
    return v;
  }
  set(lang: string, text: string, v: TtsAudio) {
    const k = AudioCache.key(lang, text);
    this.map.delete(k);
    this.map.set(k, v);
    while (this.map.size > this.max) this.map.delete(this.map.keys().next().value!);
  }
  get size() {
    return this.map.size;
  }
}

const g = globalThis as unknown as { __pehleAudioCache?: AudioCache };
export const audioCache = (g.__pehleAudioCache ??= new AudioCache());
