import { useEffect, useRef } from "react";

interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  size: number;
  opacity: number;
  hue: number;
  life: number;
  maxLife: number;
}

const FOCAL_LENGTH = 420;
const Z_MIN = 80;
const Z_MAX = 1200;

function project(
  p: Particle,
  centerX: number,
  centerY: number
): { sx: number; sy: number; scale: number } {
  const scale = FOCAL_LENGTH / (FOCAL_LENGTH + p.z);
  return {
    sx: centerX + p.x * scale,
    sy: centerY + p.y * scale,
    scale,
  };
}

export default function ParticleBackground({ intensity = 1 }: { intensity?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const animFrameRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener("resize", resize);

    const createParticle = (): Particle => ({
      x: (Math.random() - 0.5) * canvas.width * 1.4,
      y: (Math.random() - 0.5) * canvas.height * 1.4,
      z: Math.random() * (Z_MAX - Z_MIN) + Z_MIN,
      vx: (Math.random() - 0.5) * 0.6,
      vy: (Math.random() - 0.5) * 0.6 - 0.15,
      vz: (Math.random() - 0.5) * 0.8,
      size: Math.random() * 3 + 1.5,
      opacity: Math.random() * 0.45 + 0.2,
      hue: Math.random() * 60 + 240,
      life: 0,
      maxLife: Math.random() * 300 + 200,
    });

    const count = Math.floor(68 * intensity);
    for (let i = 0; i < count; i++) {
      const p = createParticle();
      p.life = Math.random() * p.maxLife;
      particlesRef.current.push(p);
    }

    const animate = () => {
      const centerX = canvas.width / 2;
      const centerY = canvas.height / 2;

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      particlesRef.current.forEach((p, i) => {
        p.x += p.vx;
        p.y += p.vy;
        p.z += p.vz;
        p.life++;

        const { sx, sy } = project(p, centerX, centerY);
        const offScreen =
          sx < -50 ||
          sx > canvas.width + 50 ||
          sy < -50 ||
          sy > canvas.height + 50 ||
          p.z < Z_MIN ||
          p.z > Z_MAX;

        if (p.life > p.maxLife || offScreen) {
          particlesRef.current[i] = createParticle();
        }
      });

      const projected = particlesRef.current.map((p) => ({
        p,
        ...project(p, centerX, centerY),
      }));

      for (let i = 0; i < projected.length; i++) {
        for (let j = i + 1; j < projected.length; j++) {
          const a = projected[i].p;
          const b = projected[j].p;
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const dz = a.z - b.z;
          const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (dist < 200) {
            const lineAlpha =
              0.22 * (1 - dist / 240) * Math.min(projected[i].scale, projected[j].scale);
            ctx.beginPath();
            ctx.moveTo(projected[i].sx, projected[i].sy);
            ctx.lineTo(projected[j].sx, projected[j].sy);
            ctx.strokeStyle = `hsla(270, 70%, 60%, ${lineAlpha})`;
            ctx.lineWidth = 0.75;
            ctx.stroke();
          }
        }
      }

      projected.sort((a, b) => b.p.z - a.p.z);

      projected.forEach(({ p, sx, sy, scale }) => {
        const lifeRatio = p.life / p.maxLife;
        const fadeIn = Math.min(lifeRatio * 5, 1);
        const fadeOut = Math.max(1 - (lifeRatio - 0.7) / 0.3, 0);
        const depthAlpha = 0.7 + scale * 0.3;
        const alpha = p.opacity * fadeIn * (lifeRatio > 0.7 ? fadeOut : 1) * depthAlpha;
        const radius = p.size * scale;

        ctx.beginPath();
        ctx.arc(sx, sy, radius, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(${p.hue}, 80%, 70%, ${alpha})`;
        ctx.fill();

        ctx.beginPath();
        ctx.arc(sx, sy, radius * 3, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(${p.hue}, 80%, 70%, ${alpha * 0.2})`;
        ctx.fill();
      });

      animFrameRef.current = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(animFrameRef.current);
      particlesRef.current = [];
    };
  }, [intensity]);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 pointer-events-none z-0"
      style={{ opacity: 0.78 }}
    />
  );
}
