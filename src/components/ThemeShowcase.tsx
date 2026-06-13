import { type Theme } from "../themes";

interface ThemeShowcaseProps {
  themes: Theme[];
  visible: boolean;
}

export default function ThemeShowcase({ themes, visible }: ThemeShowcaseProps) {
  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-30 bg-gray-950/95 backdrop-blur-sm">
      <header className="absolute inset-x-4 top-[8vh] sm:top-[10vh] text-center animate-[reveal-scale_0.5s_ease-out]">
        <p className="font-inter text-lg sm:text-xl md:text-2xl text-white/35 tracking-[0.35em] uppercase">
          Mahdolliset teemat
        </p>
      </header>

      <div className="flex h-full items-center justify-center px-4">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-6 sm:gap-8 md:gap-10">
          {themes.map((theme, index) => (
            <div
              key={theme.name}
              className="flex min-h-[11rem] flex-col items-center justify-center rounded-2xl border border-white/[0.06] bg-white/[0.02] px-12 py-16 sm:min-h-[12rem] sm:px-14 sm:py-20 md:min-h-[13rem] md:min-w-[16rem] md:px-16 md:py-24 min-w-[13rem] sm:min-w-[14.5rem]"
              style={{
                animation: `reveal-scale 0.45s ease-out ${index * 0.05}s both`,
              }}
            >
              <span className="mb-5 text-4xl sm:text-5xl md:text-5xl">{theme.emoji}</span>
              <h3 className="text-center font-orbitron text-base sm:text-lg md:text-xl font-medium leading-snug text-white/75">
                {theme.name}
              </h3>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
