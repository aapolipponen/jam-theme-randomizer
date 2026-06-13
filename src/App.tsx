import { useState, useCallback, useRef, useEffect } from "react";
import { THEMES, type Theme } from "./themes";
import ParticleBackground from "./components/ParticleBackground";
import SlotMachine from "./components/SlotMachine";
import ThemeReveal from "./components/ThemeReveal";
import ThemeShowcase from "./components/ThemeShowcase";
import Confetti from "./components/Confetti";

type AppState = "idle" | "spinning" | "revealed";

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  return reduced;
}

export default function App() {
  const [state, setState] = useState<AppState>("idle");
  const [showShowcase, setShowShowcase] = useState(false);
  const [selectedTheme, setSelectedTheme] = useState<Theme | null>(null);
  const [resetToken, setResetToken] = useState(0);
  const [showConfetti, setShowConfetti] = useState(false);
  const [showReveal, setShowReveal] = useState(false);
  const [showFlash, setShowFlash] = useState(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const reducedMotion = usePrefersReducedMotion();

  const playRevealSound = useCallback(() => {
    if (reducedMotion) return;
    try {
      if (!audioCtxRef.current) {
        audioCtxRef.current = new AudioContext();
      }
      const ctx = audioCtxRef.current;
      const freqs = [523.25, 659.25, 783.99, 1046.5];
      freqs.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = freq;
        osc.type = "sine";
        gain.gain.setValueAtTime(0, ctx.currentTime + i * 0.1);
        gain.gain.linearRampToValueAtTime(
          0.15,
          ctx.currentTime + i * 0.1 + 0.05
        );
        gain.gain.linearRampToValueAtTime(
          0.1,
          ctx.currentTime + i * 0.1 + 0.5
        );
        gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 2.5);
        osc.start(ctx.currentTime + i * 0.1);
        osc.stop(ctx.currentTime + 2.5);
      });
    } catch {
      // Audio unavailable
    }
  }, [reducedMotion]);

  const handleSpin = useCallback(() => {
    if (state !== "idle") return;
    setState("spinning");
    setShowReveal(false);
    setShowConfetti(false);
    setShowFlash(false);
  }, [state]);

  const handleSpinComplete = useCallback(
    (theme: Theme) => {
      setSelectedTheme(theme);
      setState("revealed");
      if (reducedMotion) {
        setShowReveal(true);
        return;
      }
      setShowFlash(true);
      setTimeout(() => {
        setShowFlash(false);
        setShowReveal(true);
        setShowConfetti(true);
        playRevealSound();
      }, 200);
    },
    [playRevealSound, reducedMotion]
  );

  const handleReset = useCallback(() => {
    setState("idle");
    setSelectedTheme(null);
    setShowReveal(false);
    setShowConfetti(false);
    setShowFlash(false);
    setResetToken((t) => t + 1);
  }, []);

  const toggleShowcase = useCallback(() => {
    setShowShowcase((open) => !open);
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.code === "KeyH") {
        e.preventDefault();
        toggleShowcase();
        return;
      }
      if (e.code === "Escape" && showShowcase) {
        e.preventDefault();
        setShowShowcase(false);
        return;
      }
      if (e.code === "Space" && state === "idle" && !showShowcase) {
        e.preventDefault();
        handleSpin();
      }
      if (e.code === "Escape" && state === "revealed") {
        handleReset();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [state, showShowcase, handleSpin, handleReset, toggleShowcase]);

  return (
    <div className="relative w-full h-screen bg-gray-950 overflow-hidden font-inter">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_rgba(88,28,135,0.2)_0%,_rgba(15,23,42,0.8)_50%,_rgba(2,6,23,1)_100%)]" />
      <div
        className="absolute inset-0 opacity-[0.025]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(139,92,246,0.4) 1px, transparent 1px), linear-gradient(90deg, rgba(139,92,246,0.4) 1px, transparent 1px)",
          backgroundSize: "60px 60px",
        }}
      />
      {!reducedMotion && (
        <ParticleBackground intensity={state === "spinning" ? 2 : 1} />
      )}

      <div className="relative z-10 h-full px-4">
        <div
          className={`absolute inset-x-4 top-[8vh] sm:top-[10vh] text-center pointer-events-none transition-opacity duration-500 ${
            state === "idle" ? "opacity-100" : "opacity-0"
          }`}
        >
          <h1 className="text-4xl sm:text-5xl md:text-6xl font-orbitron font-black text-transparent bg-clip-text bg-gradient-to-r from-violet-400 via-purple-300 to-indigo-400 mb-1">
            TIETOVERKOSTO
          </h1>
          <h2 className="text-xl sm:text-2xl md:text-3xl font-orbitron font-bold text-white/60 tracking-widest">
            Jamit
          </h2>
        </div>

        <div className="flex h-full flex-col items-center justify-center py-6 sm:py-8">
          <div className="w-full max-w-4xl">
            <SlotMachine
              spinning={state === "spinning"}
              themes={THEMES}
              resetToken={resetToken}
              onSpinComplete={handleSpinComplete}
              reducedMotion={reducedMotion}
            />
          </div>
        </div>
      </div>

      <ThemeShowcase themes={THEMES} visible={showShowcase} />

      {showFlash && !reducedMotion && (
        <div className="fixed inset-0 z-50 bg-white pointer-events-none animate-[reveal-scale_0.3s_ease-out]" />
      )}

      {selectedTheme && (
        <ThemeReveal theme={selectedTheme} visible={showReveal} />
      )}

      {!reducedMotion && <Confetti active={showConfetti} />}
    </div>
  );
}
