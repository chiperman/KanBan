type WebkitWindow = Window & {
  webkitAudioContext?: typeof AudioContext;
};

let audioContext: AudioContext | null = null;

function getAudioContext() {
  if (typeof window === "undefined") return null;
  if (audioContext?.state === "closed") audioContext = null;
  if (audioContext) return audioContext;

  const AudioContextConstructor = window.AudioContext
    ?? (window as WebkitWindow).webkitAudioContext;
  if (!AudioContextConstructor) return null;

  try {
    audioContext = new AudioContextConstructor();
    return audioContext;
  } catch {
    return null;
  }
}

function withAudio(callback: (context: AudioContext, start: number) => void) {
  const context = getAudioContext();
  if (!context) return;

  try {
    if (context.state === "suspended") void context.resume().catch(() => undefined);
    callback(context, context.currentTime);
  } catch {
    // Audio is decorative; an unavailable device must not affect the login flow.
  }
}

export function playKeyboardSound() {
  withAudio((context, start) => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "square";
    oscillator.frequency.setValueAtTime(760, start);
    oscillator.frequency.exponentialRampToValueAtTime(520, start + 0.035);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.035, start + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.045);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(start);
    oscillator.stop(start + 0.05);
  });
}

export function playPowerSound(powered: boolean) {
  withAudio((context, start) => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const fromFrequency = powered ? 180 : 420;
    const toFrequency = powered ? 420 : 180;
    oscillator.type = "triangle";
    oscillator.frequency.setValueAtTime(fromFrequency, start);
    oscillator.frequency.exponentialRampToValueAtTime(toFrequency, start + 0.14);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.08, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.2);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(start);
    oscillator.stop(start + 0.21);
  });
}
