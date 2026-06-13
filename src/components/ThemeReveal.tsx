import { type Theme } from "../themes";

interface ThemeRevealProps {
  theme: Theme;
  visible: boolean;
}

export default function ThemeReveal({ theme, visible }: ThemeRevealProps) {
  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center pointer-events-none">
      <div className="absolute inset-0 bg-gray-950/50 backdrop-blur-3xl animate-[reveal-scale_0.6s_ease-out]" />

      <div
        className="absolute inset-0 animate-[reveal-scale_0.6s_ease-out] motion-reduce:animate-none"
        style={{
          background: `radial-gradient(circle at center, ${theme.color}30 0%, transparent 70%)`,
        }}
      />

      <div className="relative z-10 animate-[reveal-scale_0.8s_ease-out] motion-reduce:animate-none text-center pointer-events-auto">
        <div className="text-7xl sm:text-8xl md:text-9xl -mt-8 mb-6 motion-safe:animate-bounce">
          {theme.emoji}
        </div>

        <div className="mb-4">
          <span className="text-sm sm:text-base font-inter font-semibold tracking-[0.3em] uppercase text-violet-300">
            Tämän jamin teema on
          </span>
        </div>

        <h1
          className="text-4xl sm:text-5xl md:text-7xl lg:text-8xl font-orbitron font-black text-white mb-8 relative"
          style={{
            textShadow: `0 0 30px ${theme.color}, 0 0 60px ${theme.color}80, 0 0 120px ${theme.color}40`,
          }}
        >
          {theme.name}
        </h1>

        <div className="mx-auto w-64 sm:w-96 h-1 rounded-full bg-gradient-to-r from-transparent via-violet-500 to-transparent" />
      </div>
    </div>
  );
}
