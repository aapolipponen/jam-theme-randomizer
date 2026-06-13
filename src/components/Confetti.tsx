import { useEffect, useRef } from "react";

interface ConfettiPiece {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rotation: number;
  rotationSpeed: number;
  width: number;
  height: number;
  color: string;
  opacity: number;
}

export default function Confetti({ active }: { active: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const piecesRef = useRef<ConfettiPiece[]>([]);
  const animRef = useRef<number>(0);

  useEffect(() => {
    if (!active) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const colors = [
      "#a855f7", "#ec4899", "#06b6d4", "#f59e0b",
      "#22c55e", "#ef4444", "#8b5cf6", "#84cc16",
      "#ffffff", "#fbbf24", "#f472b6", "#34d399",
    ];

    // Create confetti burst
    for (let i = 0; i < 150; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = Math.random() * 15 + 5;
      piecesRef.current.push({
        x: canvas.width / 2,
        y: canvas.height / 2,
        vx: Math.cos(angle) * speed + (Math.random() - 0.5) * 5,
        vy: Math.sin(angle) * speed - Math.random() * 10 - 5,
        rotation: Math.random() * 360,
        rotationSpeed: (Math.random() - 0.5) * 15,
        width: Math.random() * 10 + 5,
        height: Math.random() * 6 + 3,
        color: colors[Math.floor(Math.random() * colors.length)],
        opacity: 1,
      });
    }

    // Side cannons
    for (let i = 0; i < 60; i++) {
      const fromLeft = Math.random() > 0.5;
      piecesRef.current.push({
        x: fromLeft ? 0 : canvas.width,
        y: canvas.height * 0.6 + Math.random() * canvas.height * 0.3,
        vx: (fromLeft ? 1 : -1) * (Math.random() * 10 + 5),
        vy: -Math.random() * 15 - 5,
        rotation: Math.random() * 360,
        rotationSpeed: (Math.random() - 0.5) * 20,
        width: Math.random() * 12 + 4,
        height: Math.random() * 8 + 3,
        color: colors[Math.floor(Math.random() * colors.length)],
        opacity: 1,
      });
    }

    const gravity = 0.3;
    const friction = 0.99;

    const animate = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      let alive = false;
      piecesRef.current.forEach((p) => {
        p.vy += gravity;
        p.vx *= friction;
        p.x += p.vx;
        p.y += p.vy;
        p.rotation += p.rotationSpeed;

        if (p.y > canvas.height + 50) {
          p.opacity -= 0.02;
        }

        if (p.opacity <= 0) return;
        alive = true;

        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate((p.rotation * Math.PI) / 180);
        ctx.globalAlpha = p.opacity;
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.width / 2, -p.height / 2, p.width, p.height);
        ctx.restore();
      });

      if (alive) {
        animRef.current = requestAnimationFrame(animate);
      }
    };

    animate();

    return () => {
      cancelAnimationFrame(animRef.current);
      piecesRef.current = [];
    };
  }, [active]);

  if (!active) return null;

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 pointer-events-none z-50"
    />
  );
}
