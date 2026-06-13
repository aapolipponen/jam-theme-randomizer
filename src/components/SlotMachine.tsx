import { useEffect, useRef, useState, useCallback } from "react";
import { type Theme } from "../themes";

// ─── Layout constants ────────────────────────────────────────────────────────

const ITEM_HEIGHT = 90;
const VISIBLE_ITEMS = 5;
const CENTER_ROW = Math.floor(VISIBLE_ITEMS / 2);
const PERSPECTIVE = 900;
const IDLE_TILT_X = 7.5;
const RENDER_BUFFER = 4;

// ─── Physics constants ───────────────────────────────────────────────────────
//
// The core model is:
//
//   a = F_motor - F_aero - F_bearing - F_detent - F_detentDamp - F_nearMiss
//
// F_detent  = detentStrength * sin(2π * x / ITEM_HEIGHT)
//
// This creates a sinusoidal energy landscape with valleys at every symbol.
// At high speed the strip blows right through them. As it slows the wells
// capture it and pull it cleanly onto the nearest symbol. No velocity hacks,
// no minimum timers, no centering tween.

const PHYSICS = {
  // ── Pull stroke ──────────────────────────────────────────────────────────
  /** Base acceleration during pull phase (px/s²) */
  pullForce: 20000,
  /** ±fraction randomised per spin so outcomes aren't perfectly repeatable */
  pullVariance: 0.22,
  /** How long the lever stroke pushes (seconds) */
  pullDuration: 0.38,
  /** Force tapers to (1 - taper) fraction at end of stroke */
  pullTaper: 0.15,
  /**
   * Brief counter-impulse at t=0 (fraction of pullForce, lasts one substep).
   * Mimics real lever backlash — the reel rocks slightly back before launching.
   */
  prePullKick: 0.28,

  // ── Drag ─────────────────────────────────────────────────────────────────
  /** Quadratic (air/fluid) drag: F = k * v * |v| */
  dragCoeff: 0.000055,
  /** Linear bearing drag: F = c * v */
  bearingDrag: 0.018,

  // ── Detent (sinusoidal notch force) ──────────────────────────────────────
  /**
   * Amplitude of the sinusoidal restoring force (px/s²).
   * Too low → strip overshoots, needs centering patch.
   * Too high → strip stutters/sticks at high speed.
   */
  detentStrength: 50,
  /**
   * Extra viscous damping applied inside the detent well.
   * Activates gradually as speed falls below detentEngageSpeed.
   * Kills residual oscillation without teleporting velocity.
   */
  detentDamp: 3.0,
  /**
   * Speed below which detent damping starts blending in (px/s).
   * Derived from referenceSpeed in createConfig() so it scales with pull.
   */
  detentEngageRatio: 0.30,

  // ── Integration ──────────────────────────────────────────────────────────
  /** Max substeps per frame. 8 substeps @ 60fps = effectively 480Hz physics. */
  maxSubsteps: 8,
  /** Each substep is at most this many seconds. */
  maxSubDt: 1 / 240,

  // ── Settle gate ──────────────────────────────────────────────────────────
  /** Physics is "done" when speed is below this (px/s). */
  settleMaxSpeed: 1.0,
  /**
   * Max distance from a detent centre for the final snap (px).
   * At this distance the error is sub-pixel and invisible.
   */
  snapThreshold: 0.8,

  // ── Audio / visual scaling ───────────────────────────────────────────────
  referenceSpeedFactor: 0.68,
  shakeMaxDivisor: 210,
} as const;

// ─── Near-miss constants ─────────────────────────────────────────────────────
//
// A near-miss is engineered by:
//   1. Flagging the spin at config-creation time (probability).
//   2. Once speed drops below engageRatio * referenceSpeed, latching onto
//      the next detent CREST ahead in the direction of motion.
//      Crests are the unstable equilibria halfway between symbol wells:
//        x_crest = (k + 0.5) * ITEM_HEIGHT  for integer k
//   3. Applying a narrow Gaussian braking force centred on that crest:
//        F_brake = brakeStrength * gaussian(dx, sigma) * sign(v)
//      This bleeds kinetic energy only in a small window around the crest,
//      leaving the reel stranded there with near-zero velocity.
//   4. Applying a tiny random nudge (±nudgeSpeed) once |v| < nudgeThreshold
//      near the crest. This tips the reel left or right — natural detent
//      physics carries it the rest of the way into the winning symbol.

const NEAR_MISS = {
  /** Fraction of spins that become near-misses. Keep ≤ 0.20 or it feels rigged. */
  probability: 0.25,
  /**
   * Speed at which we latch the target crest (fraction of referenceSpeed).
   * Too high → might pick a crest too far away.
   * Too low  → not enough energy left to reach it.
   */
  engageRatio: 0.32,
  /**
   * Gaussian brake amplitude (px/s²). Strong enough to kill remaining KE
   * in the window, but not so strong it causes a visible lurch.
   */
  brakeStrength: 14_000,
  /**
   * σ of the Gaussian brake window as a fraction of ITEM_HEIGHT.
   * 0.28 → brake is meaningfully active within ≈ ±25px of the crest.
   */
  brakeSigma: 0.28,
  /** Velocity applied at the crest to tip the reel one way (px/s). */
  nudgeSpeed: 7,
  /** Speed below which the nudge fires (reel must be nearly stopped at crest). */
  nudgeThreshold: 12,
  /**
   * > 0.5 biases toward tipping forward to the next symbol ("almost won").
   * 0.5 = pure coin flip.
   */
  forwardBias: 0.55,
  /**
   * How many crests ahead of the natural stopping point to target.
   * 0 = the very last possible switch (most dramatic).
   * 1 = one symbol earlier (slightly earlier tension).
   */
  crestsAhead: 0,
} as const;

// ─── Types ───────────────────────────────────────────────────────────────────

interface PhysicsConfig {
  pullForce: number;
  pullDuration: number;
  pullTaper: number;
  prePullKick: number;
  dragCoeff: number;
  bearingDrag: number;
  detentStrength: number;
  detentDamp: number;
  detentEngageSpeed: number;
  settleMaxSpeed: number;
  snapThreshold: number;
  shakeMax: number;
  referenceSpeed: number;
  nearMiss: boolean;
  nearMissEngageSpeed: number;
  nearMissBrakeStrength: number;
  nearMissSigma: number;
  nearMissNudge: number;
  nearMissNudgeThreshold: number;
}

interface ReelState {
  position: number;
  velocity: number;
  accel: number;
  pullElapsed: number;
  kickApplied: boolean;
  /** Position of the crest we are steering toward; null until latched. */
  nearMissCrestPos: number | null;
  /** True once the one-shot micro-nudge has fired. */
  nearMissNudged: boolean;
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function themeAtIndex(themes: Theme[], index: number): Theme {
  const n = themes.length;
  return themes[((index % n) + n) % n];
}

/** Strip index of the symbol currently centred in the viewport. */
function centerStripIndex(position: number): number {
  return Math.floor((position + CENTER_ROW * ITEM_HEIGHT) / ITEM_HEIGHT);
}

function detentOffsetForStripIndex(stripIndex: number): number {
  return stripIndex * ITEM_HEIGHT - CENTER_ROW * ITEM_HEIGHT;
}

function randomIdleOffset(themes: Theme[]): number {
  return detentOffsetForStripIndex(
    Math.floor(Math.random() * themes.length)
  );
}

/**
 * Distance from `position` to the nearest detent centre, plus the exact
 * snapped position.
 */
function nearestDetentOffset(position: number): {
  dist: number;
  snapped: number;
} {
  const nearest = Math.round(
    (position + CENTER_ROW * ITEM_HEIGHT) / ITEM_HEIGHT
  );
  const snapped = detentOffsetForStripIndex(nearest);
  return { dist: position - snapped, snapped };
}

/**
 * Next detent CREST ahead of `position` in the positive direction.
 * Crests sit at (k + 0.5) * ITEM_HEIGHT the unstable midpoints between wells.
 * `skips` lets you target 1 or 2 crests further ahead.
 */
function nextCrestAhead(position: number, skips = 0): number {
  const k = Math.floor(position / ITEM_HEIGHT);
  return (k + 0.5 + skips) * ITEM_HEIGHT;
}

function isNearCrest(
  position: number,
  crestPos: number,
  threshold = 3
): boolean {
  return Math.abs(position - crestPos) < threshold;
}

// ─── Config factory ──────────────────────────────────────────────────────────

function createConfig(): PhysicsConfig {
  const v = PHYSICS.pullVariance;
  const pullForce =
    PHYSICS.pullForce * (1 - v / 2 + Math.random() * v);
  const referenceSpeed =
    pullForce * PHYSICS.pullDuration * PHYSICS.referenceSpeedFactor;
  const nearMiss = Math.random() < NEAR_MISS.probability;

  return {
    pullForce,
    pullDuration: PHYSICS.pullDuration,
    pullTaper: PHYSICS.pullTaper,
    prePullKick: PHYSICS.prePullKick,
    dragCoeff: PHYSICS.dragCoeff,
    bearingDrag: PHYSICS.bearingDrag,
    detentStrength: PHYSICS.detentStrength,
    detentDamp: PHYSICS.detentDamp,
    detentEngageSpeed: referenceSpeed * PHYSICS.detentEngageRatio,
    settleMaxSpeed: PHYSICS.settleMaxSpeed,
    snapThreshold: PHYSICS.snapThreshold,
    shakeMax: referenceSpeed / PHYSICS.shakeMaxDivisor,
    referenceSpeed,
    nearMiss,
    nearMissEngageSpeed: referenceSpeed * NEAR_MISS.engageRatio,
    nearMissBrakeStrength: NEAR_MISS.brakeStrength,
    nearMissSigma: NEAR_MISS.brakeSigma * ITEM_HEIGHT,
    nearMissNudge: NEAR_MISS.nudgeSpeed,
    nearMissNudgeThreshold: NEAR_MISS.nudgeThreshold,
  };
}

// ─── Core physics step ───────────────────────────────────────────────────────
//
// Forces applied every substep:
//
//   F_motor      - accelerating pull during the lever stroke
//   F_aero       - quadratic drag ∝ v²
//   F_bearing    - linear bearing/rail friction ∝ v
//   F_detent     - sinusoidal restoring force toward nearest symbol centre
//   F_detentDamp - viscous damping that blends in deep in a well at low speed
//   F_nearMiss   - Gaussian braking pulse centred on the target crest (conditional)
//
// Returns the number of symbol-boundary crossings this frame (for tick audio).

function stepPhysics(
  state: ReelState,
  cfg: PhysicsConfig,
  dt: number
): number {
  const steps = clamp(
    Math.ceil(dt / PHYSICS.maxSubDt),
    1,
    PHYSICS.maxSubsteps
  );
  const subDt = dt / steps;
  let ticks = 0;
  let lastStripIdx = centerStripIndex(state.position);

  for (let s = 0; s < steps; s++) {
    // ── Pre-pull backlash (one-shot) ───────────────────────────────────
    if (!state.kickApplied) {
      state.velocity -= cfg.pullForce * cfg.prePullKick * subDt;
      state.kickApplied = true;
    }

    // ── Motor (pull stroke) ────────────────────────────────────────────
    let motor = 0;
    if (state.pullElapsed < cfg.pullDuration) {
      const t = state.pullElapsed / cfg.pullDuration;
      motor = cfg.pullForce * (1 - t * cfg.pullTaper);
      state.pullElapsed += subDt;
    }

    const v = state.velocity;
    const speed = Math.abs(v);

    // ── Drag ───────────────────────────────────────────────────────────
    const aero    = cfg.dragCoeff * v * speed;   // quadratic
    const bearing = cfg.bearingDrag * v;          // linear

    // ── Detent (sinusoidal potential well) ─────────────────────────────
    //
    //   U(x) = -(A * H / 2π) · cos(2π·x / H)
    //   F(x) = -dU/dx = A · sin(2π·x / H)
    //
    // Subtracted from acceleration → wells at k*H, crests at (k+0.5)*H.
    const phase     = (2 * Math.PI * state.position) / ITEM_HEIGHT;
    const detent    = cfg.detentStrength * Math.sin(phase);

    // Detent damping: blends in as speed drops, strongest at well bottom
    const wellDepth  = clamp(1 - speed / cfg.detentEngageSpeed, 0, 1);
    const inWell     = clamp(Math.cos(phase), 0, 1);
    const detentDamp = cfg.detentDamp * v * wellDepth * inWell;

    // ── Near-miss Gaussian brake ───────────────────────────────────────
    let nearMissBrake = 0;

    if (cfg.nearMiss && state.pullElapsed >= cfg.pullDuration && v > 0) {
      // Latch the target crest once slow enough
      if (
        state.nearMissCrestPos === null &&
        speed < cfg.nearMissEngageSpeed
      ) {
        state.nearMissCrestPos = nextCrestAhead(
          state.position,
          NEAR_MISS.crestsAhead
        );
      }

      if (state.nearMissCrestPos !== null) {
        const dx    = state.position - state.nearMissCrestPos;
        const sigma = cfg.nearMissSigma;

        // Gaussian braking window centred on crest
        const gaussian    = Math.exp(-(dx * dx) / (2 * sigma * sigma));
        nearMissBrake = cfg.nearMissBrakeStrength * gaussian * Math.sign(v);

        // One-shot micro-nudge: tips the reel once truly stranded
        if (
          !state.nearMissNudged &&
          isNearCrest(state.position, state.nearMissCrestPos) &&
          speed < cfg.nearMissNudgeThreshold
        ) {
          state.velocity +=
            (Math.random() < NEAR_MISS.forwardBias ? 1 : -1) *
            cfg.nearMissNudge;
          state.nearMissNudged = true;
        }
      }
    }

    // ── Semi-implicit Euler integration ───────────────────────────────
    const accel    = motor - aero - bearing - detent - detentDamp - nearMissBrake;
    state.accel    = accel;
    state.velocity += accel * subDt;
    state.position += state.velocity * subDt;

    // Track symbol boundary crossings for tick audio
    const newIdx = centerStripIndex(state.position);
    if (newIdx !== lastStripIdx) {
      ticks++;
      lastStripIdx = newIdx;
    }
  }

  return ticks;
}

/**
 * True when the reel has physically stopped on (or within snapThreshold of)
 * a detent centre. No time gate — pure energy condition.
 */
function isSettled(state: ReelState, cfg: PhysicsConfig): boolean {
  if (state.pullElapsed < cfg.pullDuration) return false;
  if (Math.abs(state.velocity) > cfg.settleMaxSpeed) return false;
  const { dist } = nearestDetentOffset(state.position);
  return Math.abs(dist) <= cfg.snapThreshold;
}

// ─── Component ────────────────────────────────────────────────────────────────

interface SlotMachineProps {
  spinning: boolean;
  themes: Theme[];
  resetToken: number;
  onSpinComplete: (theme: Theme) => void;
  reducedMotion?: boolean;
}

export default function SlotMachine({
  spinning,
  themes,
  resetToken,
  onSpinComplete,
  reducedMotion = false,
}: SlotMachineProps) {
  // Pick once on first render so the reel isn't stuck on index 0 until useEffect.
  const initialPositionRef = useRef<number | null>(null);
  if (initialPositionRef.current === null && themes.length > 0) {
    initialPositionRef.current = randomIdleOffset(themes);
  }
  const initialPosition = initialPositionRef.current ?? 0;

  const [offset, setOffset] = useState(initialPosition);
  const [frameMotion, setFrameMotion] = useState({
    shake: 0,
    rotateX: IDLE_TILT_X,
    rotateY: 0,
    rotateZ: 0,
  });
  const [spinStretch, setSpinStretch] = useState(1);

  const completedRef    = useRef(false);
  const rafRef          = useRef<number>(0);
  const spinIdRef       = useRef(0);
  const lastAccelRef    = useRef(0);
  const lastTimeRef     = useRef(0);
  const audioCtxRef     = useRef<AudioContext | null>(null);

  const physicsRef = useRef<ReelState>({
    position: initialPosition,
    velocity: 0,
    accel: 0,
    pullElapsed: 0,
    kickApplied: false,
    nearMissCrestPos: null,
    nearMissNudged: false,
  });

  // ── Audio ─────────────────────────────────────────────────────────────────

  const getAudioCtx = useCallback((): AudioContext | null => {
    try {
      if (!audioCtxRef.current) audioCtxRef.current = new AudioContext();
      return audioCtxRef.current;
    } catch {
      return null;
    }
  }, []);

  /**
   * Tick click — pitch and volume rise as strip slows, giving the
   * characteristic slot-machine sound of slowing, heavier clicks.
   */
  const playTick = useCallback(
    (speed: number, refSpeed: number) => {
      if (reducedMotion) return;
      const ctx = getAudioCtx();
      if (!ctx) return;
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      // 0 = fast, 1 = nearly stopped
      const slowFactor = clamp(1 - speed / refSpeed, 0, 1);
      osc.type           = "square";
      osc.frequency.value = 320 + slowFactor * 700 + Math.random() * 40;

      const vol = 0.035 + slowFactor * 0.13;
      const dur = 0.018 + slowFactor * 0.07;
      gain.gain.setValueAtTime(vol, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + dur + 0.01);
    },
    [getAudioCtx, reducedMotion]
  );

  /** Low thud on final settle. */
  const playThud = useCallback(() => {
    if (reducedMotion) return;
    const ctx = getAudioCtx();
    if (!ctx) return;
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "triangle";
    osc.frequency.setValueAtTime(100, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(45, ctx.currentTime + 0.15);
    gain.gain.setValueAtTime(0.18, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.2);
  }, [getAudioCtx, reducedMotion]);

  // ── Idle positioning ──────────────────────────────────────────────────────

  const applyIdleOffset = useCallback(
    (randomize: boolean) => {
      if (themes.length === 0) return;
      const pos = randomize
        ? randomIdleOffset(themes)
        : physicsRef.current.position;
      physicsRef.current = {
        position: pos,
        velocity: 0,
        accel: 0,
        pullElapsed: 0,
        kickApplied: false,
        nearMissCrestPos: null,
        nearMissNudged: false,
      };
      setOffset(pos);
    },
    [themes]
  );

  // ── Spin animation loop ───────────────────────────────────────────────────

  const startSpinAnimation = useCallback(
    (startPosition: number) => {
      const cfg    = createConfig();
      const spinId = ++spinIdRef.current;

      physicsRef.current = {
        position: startPosition,
        velocity: 0,
        accel: 0,
        pullElapsed: 0,
        kickApplied: false,
        nearMissCrestPos: null,
        nearMissNudged: false,
      };

      lastAccelRef.current = 0;
      lastTimeRef.current  = performance.now();
      completedRef.current = false;

      setFrameMotion({ shake: 0, rotateX: IDLE_TILT_X, rotateY: 0, rotateZ: 0 });
      setSpinStretch(1);

      const finishSpin = (winner: Theme, finalOffset: number) => {
        completedRef.current = true;
        physicsRef.current = {
          position: finalOffset,
          velocity: 0,
          accel: 0,
          pullElapsed: cfg.pullDuration,
          kickApplied: true,
          nearMissCrestPos: null,
          nearMissNudged: false,
        };
        setOffset(finalOffset);
        setSpinStretch(1);
        setFrameMotion({ shake: 0, rotateX: IDLE_TILT_X, rotateY: 0, rotateZ: 0 });
        setTimeout(() => onSpinComplete(winner), reducedMotion ? 0 : 420);
      };

      const animate = (now: number) => {
        if (completedRef.current || spinId !== spinIdRef.current) return;

        const dt    = clamp((now - lastTimeRef.current) / 1000, 0.001, 0.033);
        lastTimeRef.current = now;

        const state = physicsRef.current;
        const ticks = stepPhysics(state, cfg, dt);

        const speed = Math.abs(state.velocity);
        const accel = state.accel;
        const jerk  = (accel - lastAccelRef.current) / dt;
        lastAccelRef.current = accel;

        // ── Visual state ───────────────────────────────────────────────
        const refSpeed  = cfg.referenceSpeed;
        const speedNorm = clamp(speed / refSpeed, 0, 1);

        const motionDrive = clamp(
          Math.max(speedNorm, Math.abs(accel) / cfg.pullForce),
          0,
          1
        );
        const jerkDrive = clamp(Math.abs(jerk) / 180_000, 0, 1);
        const shakeAmp  = cfg.shakeMax * (motionDrive * 0.6 + jerkDrive * 0.4);
        const shake =
          shakeAmp > 0.35
            ? Math.sin(now * 0.11) * shakeAmp +
              Math.sin(now * 0.27) * shakeAmp * 0.3
            : 0;

        const rotateX = IDLE_TILT_X + speedNorm * 5 + shake * 0.03;
        const rotateY = Math.sin(now * 0.07) * speedNorm * 2.5 + shake * 0.02;
        const rotateZ = shake * 0.05 + jerkDrive * 0.25;

        setOffset(state.position);
        setSpinStretch(1 + speedNorm * 0.055);
        setFrameMotion({ shake, rotateX, rotateY, rotateZ });

        // ── Tick sounds ────────────────────────────────────────────────
        if (ticks > 0) {
          playTick(speed, refSpeed);
        }

        // ── Settle check ───────────────────────────────────────────────
        if (isSettled(state, cfg)) {
          const { snapped } = nearestDetentOffset(state.position);
          // Hard-snap the sub-pixel residual — invisible, ends micro-oscillation
          state.position = snapped;
          const winner = themeAtIndex(themes, centerStripIndex(snapped));
          playThud();
          finishSpin(winner, snapped);
          return;
        }

        rafRef.current = requestAnimationFrame(animate);
      };

      rafRef.current = requestAnimationFrame(animate);
    },
    [themes, playTick, playThud, onSpinComplete, reducedMotion]
  );

  // ── Effects ───────────────────────────────────────────────────────────────

  useEffect(() => {
    if (themes.length === 0) return;
    if (initialPositionRef.current === null) {
      initialPositionRef.current = randomIdleOffset(themes);
      applyIdleOffset(true);
    }
  }, [themes.length, applyIdleOffset]);

  useEffect(() => {
    if (resetToken > 0 && !spinning) {
      completedRef.current = false;
      applyIdleOffset(true);
    }
  }, [resetToken, spinning, applyIdleOffset]);

  useEffect(() => {
    if (spinning && themes.length > 0) {
      const startPos = physicsRef.current.position;
      const id = requestAnimationFrame(() => startSpinAnimation(startPos));
      return () => {
        cancelAnimationFrame(id);
        cancelAnimationFrame(rafRef.current);
      };
    }
    return () => cancelAnimationFrame(rafRef.current);
  }, [spinning, themes.length, startSpinAnimation]);

  // ── Render ────────────────────────────────────────────────────────────────

  if (themes.length === 0) {
    return (
      <div className="relative rounded-2xl p-[2px] bg-gradient-to-br from-gray-700 to-gray-600">
        <div className="bg-gray-950 rounded-xl p-8 text-center">
          <p className="text-gray-500 font-inter">Ei teemoja saatavilla</p>
        </div>
      </div>
    );
  }

  const viewportHeight = ITEM_HEIGHT * VISIBLE_ITEMS;
  const centerIndex    = centerStripIndex(offset);
  const renderStart    = centerIndex - RENDER_BUFFER;
  const renderEnd      = centerIndex + VISIBLE_ITEMS + RENDER_BUFFER;

  // Lateral wobble builds with strip travel, period slightly off ITEM_HEIGHT
  // to avoid exact-integer aliasing
  const lateralWobble = spinning
    ? Math.sin(offset / (ITEM_HEIGHT * 0.9)) * 0.9
    : 0;

  const visibleIndices: number[] = [];
  for (let i = renderStart; i <= renderEnd; i++) visibleIndices.push(i);

  return (
    <div
      className="relative"
      style={{ perspective: PERSPECTIVE, perspectiveOrigin: "50% 42%" }}
    >
      <div
        className={`relative rounded-3xl p-[3px] transition-all duration-700 ${
          spinning
            ? "bg-gradient-to-br from-violet-400 via-pink-500 to-cyan-400 shadow-[0_0_60px_rgba(139,92,246,0.5)]"
            : "bg-gradient-to-br from-violet-600/80 via-purple-600/80 to-indigo-700/80"
        }`}
        style={{
          transform: `translate3d(${frameMotion.shake}px,0,0) rotateX(${frameMotion.rotateX}deg) rotateY(${frameMotion.rotateY}deg) rotateZ(${frameMotion.rotateZ}deg)`,
          transformStyle: "preserve-3d",
          backfaceVisibility: "hidden",
          willChange: spinning ? "transform" : "auto",
        }}
      >
        <div className="bg-gray-950 rounded-3xl">
          <div
            className="relative overflow-hidden"
            style={{ height: viewportHeight, clipPath: "inset(0 round 1.5rem)" }}
          >
            {/* Centre-row highlight window */}
            <div
              className="absolute inset-x-0 z-10 pointer-events-none"
              style={{ top: CENTER_ROW * ITEM_HEIGHT, height: ITEM_HEIGHT }}
            >
              <div
                className={`h-full mx-6 rounded-xl border-2 transition-all duration-500 ${
                  spinning
                    ? "border-violet-400/40 bg-violet-500/[0.07]"
                    : "border-violet-500/20 bg-violet-500/[0.03]"
                }`}
              />
            </div>

            {/* Scrolling strip */}
            <div
              className="absolute inset-0"
              style={{
                transform: `translateX(${lateralWobble}px) scaleY(${spinStretch})`,
                transformOrigin: "50% 50%",
              }}
            >
              {visibleIndices.map((i) => {
                const theme         = themeAtIndex(themes, i);
                const distFromCenter =
                  i * ITEM_HEIGHT - offset - CENTER_ROW * ITEM_HEIGHT;

                // Items far from centre fade out during spin
                const normDist   = Math.abs(distFromCenter) / (ITEM_HEIGHT * 2);
                const itemOpacity = spinning
                  ? clamp(1 - normDist * 0.55, 0.25, 1)
                  : 1;

                return (
                  <div
                    key={i}
                    className="absolute left-0 right-0 flex items-center justify-center gap-3 sm:gap-4 px-8 sm:px-10"
                    style={{
                      top: "50%",
                      height: ITEM_HEIGHT,
                      marginTop: -ITEM_HEIGHT / 2,
                      transform: `translateY(${distFromCenter}px)`,
                      opacity: itemOpacity,
                      willChange: spinning ? "transform" : "auto",
                    }}
                  >
                    <span className="text-2xl sm:text-3xl md:text-4xl shrink-0">
                      {theme.emoji}
                    </span>
                    <span className="font-orbitron font-bold tracking-wide whitespace-nowrap truncate text-xl sm:text-2xl md:text-3xl text-white/90">
                      {theme.name}
                    </span>
                    <span className="text-2xl sm:text-3xl md:text-4xl shrink-0">
                      {theme.emoji}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Top / bottom fade mask */}
            <div
              className="absolute inset-0 z-20 pointer-events-none"
              style={{
                background:
                  "linear-gradient(to bottom, rgba(3,7,18,0.92) 0%, transparent 22%, transparent 78%, rgba(3,7,18,0.92) 100%)",
              }}
            />

            {/* Scanline overlay (spinning only) */}
            {spinning && (
              <div
                className="absolute inset-0 z-20 pointer-events-none opacity-[0.022]"
                style={{
                  background:
                    "repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(139,92,246,0.6) 2px,rgba(139,92,246,0.6) 4px)",
                }}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}