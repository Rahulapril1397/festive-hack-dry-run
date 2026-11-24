/**
 * Microphone → 16 kHz mono 16-bit WAV in the browser (works the same on Chrome, Safari, Firefox,
 * whatever MediaRecorder container they produce). Needs a secure context (HTTPS or localhost).
 */
export const MAX_SECONDS = 30;

export function micSupport(): "ok" | "insecure" | "unsupported" {
  if (typeof window === "undefined") return "unsupported";
  if (!window.isSecureContext) return "insecure";
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") return "unsupported";
  return "ok";
}

export type Recording = { stop: () => Promise<Blob>; cancel: () => void };

export async function startRecording(onLevel?: (v: number) => void): Promise<Recording> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
  const rec = new MediaRecorder(stream);
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  rec.start(250);

  // simple input level meter for the UI
  const ctx = new AudioContext();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  ctx.createMediaStreamSource(stream).connect(analyser);
  const buf = new Uint8Array(analyser.fftSize);
  let raf = 0;
  const tick = () => {
    analyser.getByteTimeDomainData(buf);
    let peak = 0;
    for (const b of buf) peak = Math.max(peak, Math.abs(b - 128));
    onLevel?.(peak / 128);
    raf = requestAnimationFrame(tick);
  };
  if (onLevel) tick();

  const release = () => {
    cancelAnimationFrame(raf);
    stream.getTracks().forEach((t) => t.stop());
    void ctx.close();
  };

  return {
    cancel: () => {
      if (rec.state !== "inactive") rec.stop();
      release();
    },
    stop: () =>
      new Promise<Blob>((resolve, reject) => {
        rec.onstop = async () => {
          release();
          try {
            resolve(await toWav16k(new Blob(chunks, { type: rec.mimeType })));
          } catch (e) {
            reject(e);
          }
        };
        rec.stop();
      }),
  };
}

async function toWav16k(blob: Blob): Promise<Blob> {
  const decodeCtx = new AudioContext();
  const decoded = await decodeCtx.decodeAudioData(await blob.arrayBuffer());
  void decodeCtx.close();
  const rate = 16_000;
  const seconds = Math.min(decoded.duration, MAX_SECONDS);
  const off = new OfflineAudioContext(1, Math.ceil(seconds * rate), rate);
  const src = off.createBufferSource();
  src.buffer = decoded;
  src.connect(off.destination);
  src.start();
  const pcm = (await off.startRendering()).getChannelData(0);
  return encodeWav(pcm, rate);
}

export function encodeWav(samples: Float32Array, rate: number): Blob {
  const out = new DataView(new ArrayBuffer(44 + samples.length * 2));
  const str = (o: number, s: string) => [...s].forEach((ch, i) => out.setUint8(o + i, ch.charCodeAt(0)));
  str(0, "RIFF");
  out.setUint32(4, 36 + samples.length * 2, true);
  str(8, "WAVEfmt ");
  out.setUint32(16, 16, true);
  out.setUint16(20, 1, true); // PCM
  out.setUint16(22, 1, true); // mono
  out.setUint32(24, rate, true);
  out.setUint32(28, rate * 2, true);
  out.setUint16(32, 2, true);
  out.setUint16(34, 16, true);
  str(36, "data");
  out.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]!));
    out.setInt16(44 + i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true);
  }
  return new Blob([out.buffer], { type: "audio/wav" });
}
