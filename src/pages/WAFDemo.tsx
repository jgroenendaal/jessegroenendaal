import { useEffect, useRef, useState } from "react";
import { Server, Container, Shield, ExternalLink } from "lucide-react";

// ─── Math utilities ──────────────────────────────────────────────────────────

const clamp     = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const lerp      = (a: number, b: number, t: number)   => a + (b - a) * clamp(t, 0, 1);
const prog      = (s: number, e: number, t: number)   => clamp((t - s) / (e - s), 0, 1);
const easeOut   = (t: number) => 1 - (1 - t) ** 3;
const easeInOut = (t: number) => t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
const sin01     = (t: number, hz = 1) => (Math.sin(t * Math.PI * 2 * hz) + 1) / 2;

// ─── Color system ────────────────────────────────────────────────────────────

type HSL = [number, number, number];

const hsl = ([h, s, l]: HSL, a = 1) =>
  a >= 1 ? `hsl(${h},${s}%,${l}%)` : `hsla(${h},${s}%,${l}%,${+a.toFixed(3)})`;

const C = {
  gate:   [200, 80, 60] as HSL,
  amber:  [ 38, 88, 58] as HSL,
  threat: [  0, 78, 58] as HSL,
  clean:  [142, 58, 52] as HSL,
  dim:    [210, 14, 46] as HSL,
  bg:     [220, 20,  7] as HSL,
};

// ─── Topology ────────────────────────────────────────────────────────────────

const NODES = [
  {
    label: "INTERNET",
    nameParts: ["External", "Traffic"],
    xFrac: 0.055,
    type: "endpoint" as const,
    ruleCount: null,
  },
  {
    label: "INBOUND",
    nameParts: ["Inbound", "Filtering"],
    xFrac: 0.20,
    type: "gate" as const,
    ruleCount: 847,
  },
  {
    label: "ZTNA",
    nameParts: ["Zero Trust", "Net Access"],
    xFrac: 0.38,
    type: "gate" as const,
    ruleCount: 124,
  },
  {
    label: "WAF",
    nameParts: ["Web App", "Firewall"],
    xFrac: 0.57,
    type: "gate" as const,
    ruleCount: 2841,
  },
  {
    label: "SWG",
    nameParts: ["Secure Web", "Gateway"],
    xFrac: 0.75,
    type: "gate" as const,
    ruleCount: 634,
  },
  {
    label: "ORIGIN",
    nameParts: ["Protected", "Origin"],
    xFrac: 0.945,
    type: "endpoint" as const,
    ruleCount: null,
  },
];

const GATES      = NODES.filter(n => n.type === "gate");
const GATE_COUNT = GATES.length;
const BOX_HW     = 0.036;  // box half-width as fraction of W
const BOX_TOP_F  = 0.14;
const BOX_BOT_F  = 0.86;
const START_X    = NODES[0].xFrac;
const DEST_X     = NODES[NODES.length - 1].xFrac;

// ─── Timing ──────────────────────────────────────────────────────────────────

const G_START  = 0.5;
const G_ARRIVE = [1.1, 2.2, 3.4, 4.9] as const;
const G_DEPART = [1.7, 2.9, 4.2, 5.6] as const;
const DEST_T   = 6.5;
const TOTAL    = 6.5;  // animation stops at "access granted" moment → portfolio takes over

// ─── Packet config ───────────────────────────────────────────────────────────

interface PktCfg {
  yFrac:   number;
  type:    "threat" | "clean";
  delay:   number;
  blockAt: number;
}

const PACKETS: PktCfg[] = [
  // ── Hero packets (anchor the story) ───────────────────────────────────────
  { yFrac: 0.42, type: "threat", delay:  0.00, blockAt:  2 },  // WAF blocks
  { yFrac: 0.60, type: "clean",  delay:  0.00, blockAt: -1 },  // passes all
  // ── Mixed stream ──────────────────────────────────────────────────────────
  { yFrac: 0.18, type: "clean",  delay:  0.28, blockAt: -1 },
  { yFrac: 0.26, type: "threat", delay:  0.52, blockAt:  0 },  // INBOUND
  { yFrac: 0.33, type: "clean",  delay: -0.18, blockAt: -1 },
  { yFrac: 0.47, type: "threat", delay:  0.14, blockAt:  1 },  // ZTNA
  { yFrac: 0.53, type: "clean",  delay: -0.28, blockAt: -1 },
  { yFrac: 0.66, type: "threat", delay:  0.72, blockAt:  2 },  // WAF
  { yFrac: 0.74, type: "clean",  delay:  0.38, blockAt: -1 },
  { yFrac: 0.81, type: "threat", delay: -0.12, blockAt:  3 },  // SWG
  { yFrac: 0.22, type: "threat", delay:  1.05, blockAt:  0 },  // INBOUND (late)
  { yFrac: 0.70, type: "clean",  delay:  0.88, blockAt: -1 },
  { yFrac: 0.37, type: "threat", delay: -0.32, blockAt:  1 },  // ZTNA (early)
  { yFrac: 0.56, type: "clean",  delay:  1.22, blockAt: -1 },
  { yFrac: 0.86, type: "threat", delay:  0.58, blockAt:  3 },  // SWG
  { yFrac: 0.14, type: "clean",  delay:  0.76, blockAt: -1 },
  { yFrac: 0.78, type: "threat", delay:  1.40, blockAt:  2 },  // WAF (late)
  { yFrac: 0.44, type: "clean",  delay: -0.38, blockAt: -1 },
];

const HERO_IDX = PACKETS.findIndex(p => p.type === "clean" && p.delay === 0);

// Threat signature shown at the moment each gate fires a block
const GATE_SIG = [
  "IP reputation: AS12345 blocklist",
  "ZTNA: no matching access policy",
  "OWASP CRS: SQLi pattern detected",
  "SWG: malware C2 category match",
] as const;

// ─── Seeded particle burst system ────────────────────────────────────────────

interface Particle {
  vx: number; vy: number;   // velocity fractions
  angle: number;            // spread angle (radians)
  speed: number;            // 0..1 normalised speed
  size:  number;            // radius 1..4
  spin:  number;            // rotation speed
}

// One burst per (packet, gate) pair — pre-computed so RNG is stable
const BURSTS: Map<number, Particle[]> = new Map();
PACKETS.forEach((cfg, idx) => {
  if (cfg.blockAt < 0) return;
  const rng = (seed: number) => {
    let s = seed;
    return () => { s = (s * 16807 + 0) % 2147483647; return (s - 1) / 2147483646; };
  };
  const rand = rng(idx * 31 + cfg.blockAt * 97 + 7);
  const particles: Particle[] = Array.from({ length: 22 }, () => {
    const angle = rand() * Math.PI * 2;
    const speed = 0.35 + rand() * 0.65;
    return { vx: Math.cos(angle), vy: Math.sin(angle), angle, speed, size: 1.2 + rand() * 2.8, spin: (rand() - 0.5) * 8 };
  });
  BURSTS.set(idx, particles);
});

// ─── Stage labels ────────────────────────────────────────────────────────────

interface Stage { at: number; label: string; status: "neutral" | "warning" | "danger" | "success"; }

const STAGES: Stage[] = [
  { at: 0.0, label: "Initializing security pipeline\u2026",          status: "neutral" },
  { at: 0.8, label: "Traffic entering inspection layers\u2026",      status: "neutral" },
  { at: 1.1, label: "Layer 1 \u2014 Inbound filtering\u2026",        status: "neutral" },
  { at: 2.2, label: "Layer 2 \u2014 Zero Trust verification\u2026",  status: "warning" },
  { at: 3.4, label: "Layer 3 \u2014 WAF deep inspection\u2026",      status: "warning" },
  { at: 4.0, label: "Threats detected \u2014 blocking requests",     status: "danger"  },
  { at: 4.3, label: "Clean packets cleared \u2014 proceeding\u2026", status: "success" },
  { at: 4.9, label: "Layer 4 \u2014 Secure Web Gateway\u2026",       status: "neutral" },
  { at: 5.7, label: "All checks passed \u2014 forwarding",           status: "success" },
  { at: 6.5, label: "Access granted \u00b7 jessegroenendaal.nl",     status: "success" },
];

function getStage(t: number): Stage {
  return STAGES.reduce((cur, s) => (t >= s.at ? s : cur), STAGES[0]);
}

// ─── Packet kinematics ───────────────────────────────────────────────────────

function buildWaypoints(blockAt: number): [number, number][] {
  const pts: [number, number][] = [[G_START, START_X]];
  for (let i = 0; i < GATE_COUNT; i++) {
    pts.push([G_ARRIVE[i], GATES[i].xFrac]);
    if (blockAt === i) return pts;
    pts.push([G_DEPART[i], GATES[i].xFrac]);
  }
  pts.push([DEST_T, DEST_X]);
  return pts;
}

const PKT_WP = PACKETS.map(cfg => buildWaypoints(cfg.blockAt));

function packetX(W: number, t: number, cfg: PktCfg, idx: number): number {
  const ta  = t - cfg.delay;
  const pts = PKT_WP[idx];
  if (ta <= pts[0][0]) return W * pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    const [t0, x0] = pts[i - 1];
    const [t1, x1] = pts[i];
    if (ta <= t1) return lerp(W * x0, W * x1, easeInOut(prog(t0, t1, ta)));
  }
  return W * pts[pts.length - 1][1];
}

function pktColor(t: number, cfg: PktCfg): HSL {
  if (cfg.type === "threat") {
    const at      = G_ARRIVE[cfg.blockAt] + cfg.delay;
    const toAmber = easeOut(prog(at - 0.5, at + 0.1, t));
    const toRed   = easeOut(prog(at + 0.1, at + 0.5, t));
    return [
      lerp(lerp(200, 38, toAmber), 0,  toRed),
      lerp(lerp(70,  88, toAmber), 78, toRed),
      lerp(lerp(65,  58, toAmber), 58, toRed),
    ];
  }
  const lastDep = G_DEPART[GATE_COUNT - 1] + cfg.delay;
  const toGreen = easeOut(prog(lastDep - 0.3, lastDep + 0.5, t));
  return [lerp(200, 142, toGreen), lerp(70, 58, toGreen), lerp(65, 52, toGreen)];
}

function pktAlpha(t: number, cfg: PktCfg): number {
  const showA   = easeOut(prog(Math.max(0, G_START + cfg.delay - 0.05), G_START + cfg.delay + 0.5, t));
  const blockT  = cfg.blockAt >= 0 ? G_ARRIVE[cfg.blockAt] + cfg.delay : Infinity;
  const fadeOut = cfg.blockAt >= 0 ? 1 - easeOut(prog(blockT + 0.4, blockT + 1.5, t)) : 1;
  return showA * fadeOut;
}

// ─── Counters ────────────────────────────────────────────────────────────────

function countBlocked(gi: number, t: number): number {
  return PACKETS.filter(cfg => {
    if (cfg.blockAt !== gi) return false;
    return t >= G_ARRIVE[gi] + cfg.delay + 0.15;
  }).length;
}

function countPassed(gi: number, t: number): number {
  return PACKETS.filter(cfg => {
    if (cfg.blockAt >= 0 && cfg.blockAt <= gi) return false;
    return t >= G_DEPART[gi] + cfg.delay;
  }).length;
}

// ─── Drawing helpers ─────────────────────────────────────────────────────────

function glowAt(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: HSL, alpha: number) {
  if (alpha <= 0 || r <= 0) return;
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0,   hsl(color, alpha * 0.55));
  g.addColorStop(0.4, hsl(color, alpha * 0.28));
  g.addColorStop(1,   hsl(color, 0));
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
}

function rrect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

function arrowHead(ctx: CanvasRenderingContext2D, x: number, y: number, size: number) {
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x - size, y - size * 0.55);
  ctx.lineTo(x - size, y + size * 0.55);
  ctx.closePath();
  ctx.fill();
}

// ─── Scene layers ────────────────────────────────────────────────────────────

function drawGrid(ctx: CanvasRenderingContext2D, W: number, H: number, t: number) {
  const a = easeOut(prog(0, 0.8, t)) * 0.05;
  if (a <= 0) return;
  ctx.save();
  ctx.strokeStyle = hsl(C.gate, a);
  ctx.lineWidth = 0.5;
  const sp = 48;
  for (let x = 0; x <= W; x += sp) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  for (let y = 0; y <= H; y += sp) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
  ctx.restore();
}

function drawTracks(ctx: CanvasRenderingContext2D, W: number, H: number, t: number) {
  const a = easeOut(prog(0.3, 1.1, t)) * 0.16;
  if (a <= 0) return;
  ctx.save();
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 10]);
  ctx.lineDashOffset = -(t * 14);
  PACKETS.forEach(cfg => {
    const y      = H * cfg.yFrac;
    const blockT = cfg.blockAt >= 0 ? G_ARRIVE[cfg.blockAt] + cfg.delay : Infinity;
    const dimA   = cfg.blockAt >= 0 ? 1 - easeOut(prog(blockT + 0.1, blockT + 1.0, t)) : 1;
    ctx.strokeStyle = hsl(cfg.type === "threat" ? C.threat : C.gate, a * dimA);
    ctx.beginPath();
    ctx.moveTo(W * START_X + W * BOX_HW, y);
    ctx.lineTo(W * DEST_X - W * BOX_HW, y);
    ctx.stroke();
  });
  ctx.restore();
}

function drawBackbone(ctx: CanvasRenderingContext2D, W: number, H: number, t: number) {
  const a   = easeOut(prog(0.2, 1.0, t)) * 0.35;
  const cy  = H * 0.5;
  const hw  = W * BOX_HW;
  if (a <= 0) return;

  for (let i = 0; i < NODES.length - 1; i++) {
    const x1 = W * NODES[i].xFrac + hw;
    const x2 = W * NODES[i + 1].xFrac - hw;
    if (x2 <= x1) continue;

    ctx.save();
    ctx.globalAlpha = a;
    ctx.strokeStyle = hsl(C.gate);
    ctx.lineWidth   = 1;
    ctx.setLineDash([6, 10]);
    ctx.lineDashOffset = -(t * 11);
    ctx.beginPath(); ctx.moveTo(x1, cy); ctx.lineTo(x2 - 6, cy); ctx.stroke();
    ctx.setLineDash([]);

    // Arrowhead
    ctx.fillStyle = hsl(C.gate);
    arrowHead(ctx, x2, cy, 5);

    // Protocol label above connection (only for first segment)
    if (i === 0) {
      ctx.globalAlpha = a * 0.7;
      ctx.fillStyle = hsl(C.dim);
      ctx.font = `400 7px 'JetBrains Mono', monospace`;
      ctx.textAlign = "center";
      ctx.fillText("HTTPS:443", (x1 + x2) / 2, cy - 9);
    }

    ctx.restore();
  }
}

function drawNodes(ctx: CanvasRenderingContext2D, W: number, H: number, t: number) {
  const top = H * BOX_TOP_F;
  const bot = H * BOX_BOT_F;
  const bh  = bot - top;
  const hw  = W * BOX_HW;
  const cy  = H * 0.5;

  NODES.forEach((node, ni) => {
    const cx     = W * node.xFrac;
    const isGate = node.type === "gate";
    const gi     = isGate ? GATES.indexOf(node as typeof GATES[number]) : -1;

    const a = easeOut(prog(0.2 + ni * 0.08, 0.8 + ni * 0.08, t));
    if (a <= 0) return;

    // Compute gate-specific state
    let scanA = 0, blockFlashA = 0;
    if (isGate) {
      PACKETS.forEach(cfg => {
        if (cfg.blockAt >= 0 && cfg.blockAt < gi) return;
        const arr = G_ARRIVE[gi] + cfg.delay;
        const dep = cfg.blockAt === gi ? arr + 0.6 : G_DEPART[gi] + cfg.delay;
        const s   = easeInOut(prog(arr - 0.1, arr + 0.3, t)) * (1 - easeOut(prog(dep - 0.3, dep, t)));
        scanA = Math.max(scanA, s);
        if (cfg.blockAt === gi) {
          const f = easeOut(prog(arr, arr + 0.06, t)) * (1 - easeOut(prog(arr + 0.06, arr + 0.65, t)));
          blockFlashA = Math.max(blockFlashA, f);
        }
      });
    }

    const blocked = isGate ? countBlocked(gi, t) : 0;
    const passed  = isGate ? countPassed(gi, t)  : 0;

    const stateColor: HSL = blockFlashA > 0.1 ? C.threat : scanA > 0.15 ? C.amber : C.gate;

    ctx.save();

    // ── Box fill ─────────────────────────────────────────────────────────────
    const boxAlpha = a * (0.05 + scanA * 0.03 + blockFlashA * 0.04);
    rrect(ctx, cx - hw, top, hw * 2, bh, 4);
    ctx.fillStyle = hsl(stateColor, boxAlpha);
    ctx.fill();

    // ── Charge-up fill — amber rises from bottom as packets approach ──────────
    if (isGate) {
      const chargeP = easeInOut(prog(G_ARRIVE[gi] - 0.7, G_ARRIVE[gi] + 0.05, t));
      const releaseP = easeOut(prog(G_ARRIVE[gi] + 0.05, G_DEPART[gi], t));
      const chargeV  = chargeP * (1 - releaseP);
      if (chargeV > 0.005) {
        const fillH = bh * chargeV;
        ctx.save();
        const cg = ctx.createLinearGradient(0, bot - fillH, 0, bot);
        cg.addColorStop(0,   hsl(C.amber, 0));
        cg.addColorStop(0.5, hsl(C.amber, chargeV * 0.10));
        cg.addColorStop(1,   hsl(C.amber, chargeV * 0.20));
        ctx.fillStyle = cg;
        ctx.fillRect(cx - hw + 1, bot - fillH, hw * 2 - 2, fillH);
        // Bright leading edge line
        ctx.globalAlpha = chargeV * 0.55;
        ctx.strokeStyle = hsl(C.amber);
        ctx.lineWidth   = 1;
        ctx.beginPath();
        ctx.moveTo(cx - hw + 2, bot - fillH);
        ctx.lineTo(cx + hw - 2, bot - fillH);
        ctx.stroke();
        ctx.restore();
      }
    }

    // ── Box border ───────────────────────────────────────────────────────────
    // Vertical bars (gradient fade at top/bottom)
    const vg = ctx.createLinearGradient(0, top, 0, bot);
    vg.addColorStop(0,    hsl(stateColor, 0));
    vg.addColorStop(0.07, hsl(stateColor, a * 0.8));
    vg.addColorStop(0.93, hsl(stateColor, a * 0.8));
    vg.addColorStop(1,    hsl(stateColor, 0));
    ctx.strokeStyle = vg;
    ctx.lineWidth   = 1.5;
    ctx.beginPath(); ctx.moveTo(cx - hw, top); ctx.lineTo(cx - hw, bot); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx + hw, top); ctx.lineTo(cx + hw, bot); ctx.stroke();

    // Top / bottom cap lines
    ctx.strokeStyle = hsl(stateColor, a * 0.45);
    ctx.lineWidth   = 1;
    ctx.beginPath(); ctx.moveTo(cx - hw + 2, top + 1); ctx.lineTo(cx + hw - 2, top + 1); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx - hw + 2, bot - 1); ctx.lineTo(cx + hw - 2, bot - 1); ctx.stroke();

    // Subtle crossbars
    ctx.strokeStyle = hsl(stateColor, a * 0.09);
    ctx.lineWidth   = 0.5;
    for (let i = 1; i <= 9; i++) {
      const y = top + bh * (i / 10);
      ctx.beginPath(); ctx.moveTo(cx - hw + 2, y); ctx.lineTo(cx + hw - 2, y); ctx.stroke();
    }

    // ── Header label area (absolute px offsets — no bh fractions) ────────────
    // Status dot
    const dotPulse  = scanA > 0.1 ? (0.65 + sin01(t, 2.5) * 0.35) : 1.0;
    const dotColor  = blockFlashA > 0.05 ? C.threat : scanA > 0.1 ? C.amber : C.clean;
    ctx.globalAlpha = a * dotPulse;
    ctx.fillStyle   = hsl(dotColor);
    ctx.beginPath(); ctx.arc(cx + hw - 10, top + 14, 3.5, 0, Math.PI * 2); ctx.fill();

    // Short label
    ctx.globalAlpha = a * 0.92;
    ctx.fillStyle   = hsl(stateColor);
    ctx.font        = `600 9px 'JetBrains Mono', monospace`;
    ctx.textAlign   = "center";
    ctx.fillText(node.label, cx - 4, top + 26);

    // Full name (two lines)
    ctx.globalAlpha = a * 0.42;
    ctx.fillStyle   = hsl(C.dim);
    ctx.font        = `400 7px 'JetBrains Mono', monospace`;
    ctx.fillText(node.nameParts[0], cx, top + 38);
    ctx.fillText(node.nameParts[1], cx, top + 49);

    // Rule count (gate only)
    if (node.ruleCount !== null) {
      ctx.globalAlpha = a * 0.28;
      ctx.fillStyle   = hsl(C.dim);
      ctx.font        = `400 6.5px 'JetBrains Mono', monospace`;
      ctx.fillText(`rules: ${node.ruleCount.toLocaleString()}`, cx, top + 60);
    }

    // Header separator
    ctx.globalAlpha = a * 0.20;
    ctx.strokeStyle = hsl(stateColor);
    ctx.lineWidth   = 0.5;
    ctx.beginPath(); ctx.moveTo(cx - hw + 4, top + 68); ctx.lineTo(cx + hw - 4, top + 68); ctx.stroke();

    // ── Backbone connection port indicator ────────────────────────────────────
    ctx.globalAlpha = a * 0.40;
    ctx.strokeStyle = hsl(stateColor);
    ctx.lineWidth   = 1;
    const portLen = hw * 0.45;
    ctx.beginPath(); ctx.moveTo(cx - portLen, cy); ctx.lineTo(cx + portLen, cy); ctx.stroke();
    // Port dots
    ctx.fillStyle   = hsl(stateColor);
    ctx.globalAlpha = a * 0.65;
    ctx.beginPath(); ctx.arc(cx - hw, cy, 2.5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(cx + hw, cy, 2.5, 0, Math.PI * 2); ctx.fill();

    // ── Per-packet halos (gate only) ─────────────────────────────────────────
    if (isGate) {
      PACKETS.forEach(cfg => {
        const y = H * cfg.yFrac;
        if (cfg.blockAt === gi) {
          const arr = G_ARRIVE[gi] + cfg.delay;
          const bA  = easeOut(prog(arr - 0.1, arr + 0.3, t)) * (1 - easeOut(prog(arr + 0.8, arr + 1.8, t)));
          if (bA > 0) {
            ctx.globalAlpha = 1;
            glowAt(ctx, cx, y, hw * 4, C.threat, bA * 0.35);
          }
        } else if (cfg.type === "clean" && (cfg.blockAt < 0 || cfg.blockAt > gi)) {
          const dep = G_DEPART[gi] + cfg.delay;
          const gA  = easeOut(prog(dep - 0.35, dep, t)) * (1 - easeOut(prog(dep, dep + 0.45, t)));
          if (gA > 0) {
            ctx.globalAlpha = 1;
            glowAt(ctx, cx, y, hw * 3, C.clean, gA * 0.25);
          }
        }
      });
    }

    // ── Blocked / passed counters (gate only, absolute px from bottom) ────────
    if (isGate && (blocked > 0 || passed > 0)) {
      // Footer separator
      ctx.globalAlpha = a * 0.20;
      ctx.strokeStyle = hsl(stateColor);
      ctx.lineWidth   = 0.5;
      ctx.beginPath(); ctx.moveTo(cx - hw + 4, bot - 54); ctx.lineTo(cx + hw - 4, bot - 54); ctx.stroke();

      ctx.font      = `400 7.5px 'JetBrains Mono', monospace`;
      ctx.textAlign = "center";
      if (blocked > 0) {
        ctx.globalAlpha = a * 0.82;
        ctx.fillStyle   = hsl(C.threat);
        ctx.fillText(`\u2715 blocked: ${blocked}`, cx, bot - 36);
      }
      if (passed > 0) {
        ctx.globalAlpha = a * 0.82;
        ctx.fillStyle   = hsl(C.clean);
        ctx.fillText(`\u2713 passed: ${passed}`,  cx, bot - 22);
      }
    }

    // ── Block flash overlay ───────────────────────────────────────────────────
    if (isGate && blockFlashA > 0) {
      ctx.globalAlpha = 1;
      const fg = ctx.createLinearGradient(cx - hw * 5, 0, cx + hw * 5, 0);
      fg.addColorStop(0,   hsl(C.threat, 0));
      fg.addColorStop(0.3, hsl(C.threat, blockFlashA * 0.45));
      fg.addColorStop(0.7, hsl(C.threat, blockFlashA * 0.45));
      fg.addColorStop(1,   hsl(C.threat, 0));
      ctx.fillStyle = fg;
      ctx.fillRect(cx - hw * 5, top, hw * 10, bh);
    }

    ctx.restore();
  });
}

function drawHeartbeat(ctx: CanvasRenderingContext2D, W: number, H: number, t: number) {
  const cy     = H * 0.5;
  const hw     = W * BOX_HW;
  const fadeIn = easeOut(prog(1.0, 2.8, t));
  if (fadeIn <= 0) return;

  NODES.forEach((node, ni) => {
    const cx = W * node.xFrac;

    // Pause heartbeat if this gate is actively scanning or blocking
    if (node.type === "gate") {
      const gi  = GATES.indexOf(node as typeof GATES[number]);
      const arr = G_ARRIVE[gi];
      const dep = G_DEPART[gi];
      if (t >= arr - 0.3 && t <= dep + 0.3) return;
    }

    // Staggered beat: period 2.4s, each node offset by 0.38s
    const phase    = ((t / 2.4 + ni * 0.38) % 1.0);
    // Sharp attack (first 8%), smooth decay (next 40%), silence rest
    const beatA    = phase < 0.08
      ? phase / 0.08
      : phase < 0.48 ? 1 - (phase - 0.08) / 0.40 : 0;
    if (beatA <= 0.01) return;

    const alpha = beatA * 0.45 * fadeIn;
    const ringR = 4 + beatA * 16;

    // Left port ring
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = hsl(C.gate);
    ctx.lineWidth   = 0.8;
    ctx.beginPath(); ctx.arc(cx - hw, cy, ringR, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();

    // Right port ring
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = hsl(C.gate);
    ctx.lineWidth   = 0.8;
    ctx.beginPath(); ctx.arc(cx + hw, cy, ringR, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  });
}

function drawScanBeams(ctx: CanvasRenderingContext2D, W: number, H: number, t: number) {
  const top = H * BOX_TOP_F;
  const rng = H * (BOX_BOT_F - BOX_TOP_F);

  GATES.forEach((gate, gi) => {
    const cx  = W * gate.xFrac;
    const hw  = W * BOX_HW;
    const arr = G_ARRIVE[gi];
    const dep = G_DEPART[gi];
    const a   = easeInOut(prog(arr - 0.1, arr + 0.3, t)) * (1 - easeOut(prog(dep - 0.2, dep, t)));
    if (a <= 0.01) return;

    const sy = top + ((prog(arr, dep, t) * 2.2) % 1.0) * rng;

    ctx.save();
    ctx.globalAlpha = a * 0.80;

    const bg = ctx.createLinearGradient(cx - hw * 0.9, 0, cx + hw * 0.9, 0);
    bg.addColorStop(0,   hsl(C.amber, 0));
    bg.addColorStop(0.15, hsl(C.amber, 0.95));
    bg.addColorStop(0.85, hsl(C.amber, 0.95));
    bg.addColorStop(1,   hsl(C.amber, 0));
    ctx.fillStyle = bg;
    ctx.fillRect(cx - hw * 0.9, sy - 1, hw * 1.8, 2);

    const trail = ctx.createLinearGradient(0, sy - 16, 0, sy);
    trail.addColorStop(0, hsl(C.amber, 0));
    trail.addColorStop(1, hsl(C.amber, 0.09));
    ctx.fillStyle = trail;
    ctx.fillRect(cx - hw * 0.9, sy - 16, hw * 1.8, 16);

    ctx.restore();
  });
}

function drawBlock(ctx: CanvasRenderingContext2D, W: number, H: number, t: number) {
  const top = H * BOX_TOP_F;
  const bot = H * BOX_BOT_F;
  const bh  = bot - top;
  const hw  = W * BOX_HW;

  PACKETS.forEach(cfg => {
    if (cfg.blockAt < 0) return;
    const cx = W * GATES[cfg.blockAt].xFrac;
    const yt = H * cfg.yFrac;
    const at = G_ARRIVE[cfg.blockAt] + cfg.delay;

    // ── Hard red wall: snaps in over 0.07s, elegant fade over 0.55s ──────────
    const wallOn  = easeOut(prog(at, at + 0.07, t));
    const wallOff = 1 - easeOut(prog(at + 0.07, at + 0.60, t));
    const wallA   = wallOn * wallOff;
    if (wallA > 0.005) {
      ctx.save();
      // Full-height solid fill inside box
      ctx.globalAlpha = wallA * 0.72;
      rrect(ctx, cx - hw + 1, top + 1, hw * 2 - 2, bh - 2, 3);
      ctx.fillStyle = hsl(C.threat);
      ctx.fill();
      // Hard bright edge on the impact (left) side
      ctx.globalAlpha = wallA;
      const eg = ctx.createLinearGradient(cx - hw, 0, cx - hw + 6, 0);
      eg.addColorStop(0, hsl(C.threat, 1.0));
      eg.addColorStop(1, hsl(C.threat, 0));
      ctx.fillStyle = eg;
      ctx.fillRect(cx - hw, top, 6, bh);
      ctx.restore();
    }

    // ── Shockwave: horizontal line expanding left from impact ─────────────────
    const shockAge  = prog(at, at + 0.55, t);
    const shockFade = easeOut(prog(at, at + 0.04, t)) * (1 - easeOut(prog(at + 0.04, at + 0.5, t)));
    if (shockFade > 0.005) {
      const dist = shockAge * W * 0.20;
      const sg   = ctx.createLinearGradient(cx - hw - dist, 0, cx - hw, 0);
      sg.addColorStop(0,   hsl(C.threat, 0));
      sg.addColorStop(0.6, hsl(C.threat, shockFade * 0.55));
      sg.addColorStop(1,   hsl(C.threat, shockFade * 0.85));
      ctx.fillStyle = sg;
      ctx.fillRect(cx - hw - dist, yt - 1.5, dist, 3);
    }

    // ── Lingering block line across the track ─────────────────────────────────
    const barrierA = easeOut(prog(at + 0.07, at + 0.25, t))
                   * (1 - easeOut(prog(at + 0.55, at + 1.8, t)));
    if (barrierA > 0) {
      ctx.save();
      ctx.globalAlpha = barrierA * 0.55;
      ctx.strokeStyle = hsl(C.threat);
      ctx.lineWidth   = 1;
      ctx.beginPath(); ctx.moveTo(cx - hw, yt); ctx.lineTo(cx + hw, yt); ctx.stroke();
      ctx.restore();
    }

    // ── "BLOCKED" label ───────────────────────────────────────────────────────
    const labelA = easeOut(prog(at + 0.10, at + 0.30, t))
                 * (1 - easeOut(prog(at + 0.9, at + 1.8, t)));
    if (labelA > 0) {
      ctx.save();
      ctx.globalAlpha = labelA;
      ctx.fillStyle   = hsl(C.threat);
      ctx.font        = `700 8px 'JetBrains Mono', monospace`;
      ctx.textAlign   = "left";
      ctx.fillText("BLOCKED", cx + hw + 6, yt + 3);
      ctx.restore();
    }
  });
}

function drawPackets(ctx: CanvasRenderingContext2D, W: number, H: number, t: number) {
  // Depth sort: packets closer to top of screen are "farther" — draw first (behind)
  const order = PACKETS.map((cfg, idx) => ({ cfg, idx }))
    .sort((a, b) => a.cfg.yFrac - b.cfg.yFrac);

  order.forEach(({ cfg, idx }) => {
    const pa = pktAlpha(t, cfg);
    if (pa < 0.01) return;

    const y   = H * cfg.yFrac;
    const px  = packetX(W, t, cfg, idx);
    const col = pktColor(t, cfg);
    // Depth-based size: packets lower on screen (higher yFrac) appear larger — "closer"
    const depthScale = 0.80 + cfg.yFrac * 0.40;
    const r   = 4.5 * depthScale;

    // Trail
    for (let i = 8; i >= 1; i--) {
      const ppx = packetX(W, Math.max(0, t - i * 0.048), cfg, idx);
      const da  = pa * (1 - i / 8) * 0.40;
      if (da < 0.01) continue;
      ctx.save();
      ctx.globalAlpha = da;
      ctx.fillStyle   = hsl(col);
      ctx.beginPath(); ctx.arc(ppx, y, Math.max(1, r - 1 - i * 0.28), 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }

    glowAt(ctx, px, y, 22 + (r - 4.5) * 5, col, pa * 0.55);

    ctx.save();
    ctx.globalAlpha = pa;
    ctx.fillStyle   = hsl(col);
    ctx.beginPath(); ctx.arc(px, y, r, 0, Math.PI * 2); ctx.fill();

    // Direction tick (small arrow on the front of the packet)
    const speed = px - packetX(W, Math.max(0, t - 0.05), cfg, idx);
    if (speed > 0.5) {
      ctx.strokeStyle = hsl(col);
      ctx.lineWidth   = 1;
      ctx.globalAlpha = pa * 0.55;
      ctx.beginPath();
      ctx.moveTo(px + r + 2, y - 3);
      ctx.lineTo(px + r + 6, y);
      ctx.lineTo(px + r + 2, y + 3);
      ctx.stroke();
    }
    ctx.restore();
  });
}

function drawDestination(ctx: CanvasRenderingContext2D, W: number, H: number, t: number) {
  const dx    = W * DEST_X;
  const pulse = sin01(t, 0.55) * 0.22 + 0.78;
  const hw    = W * BOX_HW;

  PACKETS.forEach(cfg => {
    if (cfg.blockAt >= 0) return;
    const arrT = DEST_T + cfg.delay;
    const dA   = easeOut(prog(arrT - 0.3, arrT + 0.5, t));
    if (dA <= 0) return;
    const y = H * cfg.yFrac;
    glowAt(ctx, dx, y, 32 * pulse, C.clean, dA * 0.35);
    ctx.save();
    ctx.globalAlpha = dA;
    ctx.fillStyle   = hsl(C.clean);
    ctx.beginPath(); ctx.arc(dx, y, 4.5, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  });

  // Domain label
  const hero  = PACKETS.find(p => p.type === "clean" && p.delay === 0)!;
  const textA = easeOut(prog(DEST_T + hero.delay + 0.3, DEST_T + hero.delay + 1.1, t));
  if (textA > 0) {
    const yc = H * hero.yFrac;
    ctx.save();
    ctx.globalAlpha = textA;
    ctx.textAlign   = "center";
    ctx.fillStyle   = hsl(C.clean);
    ctx.font        = `500 11px 'JetBrains Mono', monospace`;
    ctx.fillText("jessegroenendaal.nl", dx, yc - 20);
    ctx.fillStyle   = hsl(C.clean, 0.65);
    ctx.font        = `400 8px 'JetBrains Mono', monospace`;
    ctx.fillText("\u2713 TLS 1.3 \u00b7 secure", dx, yc + 20);
    ctx.restore();
  }
}

// ─── Block particle bursts ───────────────────────────────────────────────────

function drawParticles(ctx: CanvasRenderingContext2D, W: number, H: number, t: number) {
  PACKETS.forEach((cfg, idx) => {
    if (cfg.blockAt < 0) return;
    const particles = BURSTS.get(idx);
    if (!particles) return;

    const at  = G_ARRIVE[cfg.blockAt] + cfg.delay;
    const age = t - at;
    if (age < 0 || age > 1.4) return;

    const ox = W * GATES[cfg.blockAt].xFrac;
    const oy = H * cfg.yFrac;

    particles.forEach(p => {
      const life = easeOut(prog(at + 0.02, at + 1.4, t));
      const fade = 1 - life;
      if (fade <= 0) return;
      const dist = age * p.speed * W * 0.055;
      const px   = ox + p.vx * dist;
      const py   = oy + p.vy * dist;
      const sr   = Math.max(0.3, p.size * (1 - life * 0.7));

      ctx.save();
      ctx.globalAlpha = fade * 0.85;
      ctx.translate(px, py);
      ctx.rotate(p.spin * age);
      // Vary between circle and diamond fragment
      if (p.size > 2.5) {
        ctx.beginPath();
        ctx.moveTo(0, -sr); ctx.lineTo(sr * 0.6, 0);
        ctx.lineTo(0, sr);  ctx.lineTo(-sr * 0.6, 0);
        ctx.closePath();
      } else {
        ctx.beginPath(); ctx.arc(0, 0, sr, 0, Math.PI * 2);
      }
      ctx.fillStyle = hsl(C.threat, 0.9 - life * 0.5);
      ctx.fill();
      ctx.restore();
    });
  });
}

// ─── Threat signature reveal ──────────────────────────────────────────────────

function drawSignatures(ctx: CanvasRenderingContext2D, W: number, H: number, t: number) {
  PACKETS.forEach(cfg => {
    if (cfg.blockAt < 0) return;
    const at  = G_ARRIVE[cfg.blockAt] + cfg.delay;
    const sig = GATE_SIG[cfg.blockAt];
    const a   = easeOut(prog(at + 0.08, at + 0.30, t))
              * (1 - easeOut(prog(at + 0.80, at + 1.60, t)));
    if (a <= 0.01) return;

    const cx = W * GATES[cfg.blockAt].xFrac;
    const yt = H * cfg.yFrac;

    ctx.save();
    ctx.globalAlpha = a;

    // Background pill
    const pad = 5;
    ctx.font = `400 7px 'JetBrains Mono', monospace`;
    const tw  = ctx.measureText(sig).width;
    const px  = cx - tw / 2 - pad;
    const py  = yt - 26;
    const ph  = 14;
    rrect(ctx, px, py, tw + pad * 2, ph, 3);
    ctx.fillStyle = hsl(C.bg, 0.88);
    ctx.fill();
    ctx.strokeStyle = hsl(C.threat, 0.55);
    ctx.lineWidth   = 0.8;
    ctx.stroke();

    // Icon + text
    ctx.fillStyle = hsl(C.threat);
    ctx.textAlign = "center";
    ctx.fillText(`⚑ ${sig}`, cx, py + ph - 3);
    ctx.restore();
  });
}

// ─── Clean gate stamp ─────────────────────────────────────────────────────────

function drawCleanStamps(ctx: CanvasRenderingContext2D, W: number, H: number, t: number) {
  const hw  = W * BOX_HW;

  GATES.forEach((gate, gi) => {
    const cx  = W * gate.xFrac;
    const dep = G_DEPART[gi];

    // Collect the first clean packet departing this gate
    PACKETS.forEach(cfg => {
      if (cfg.type !== "clean") return;
      if (cfg.blockAt >= 0 && cfg.blockAt <= gi) return;
      const depT = dep + cfg.delay;
      const a    = easeOut(prog(depT - 0.05, depT + 0.15, t))
                 * (1 - easeOut(prog(depT + 0.15, depT + 0.65, t)));
      if (a <= 0.01) return;

      const y  = H * cfg.yFrac;
      const r  = 9 * a;

      ctx.save();
      ctx.globalAlpha = a * 0.90;
      // Expanding ring
      ctx.strokeStyle = hsl(C.clean);
      ctx.lineWidth   = 1.5;
      ctx.beginPath(); ctx.arc(cx, y, r, 0, Math.PI * 2); ctx.stroke();
      // Checkmark inside
      ctx.globalAlpha = a * 0.85;
      ctx.fillStyle   = hsl(C.clean);
      ctx.font        = `600 8px 'JetBrains Mono', monospace`;
      ctx.textAlign   = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("✓", cx, y);
      ctx.textBaseline = "alphabetic";
      ctx.restore();
    });
  });
}

// ─── Final stats card ─────────────────────────────────────────────────────────

function drawStats(ctx: CanvasRenderingContext2D, W: number, H: number, t: number) {
  const a = easeOut(prog(STATS_T, STATS_T + 0.9, t));
  if (a <= 0.01) return;

  const blocked = PACKETS.filter(p => p.blockAt >= 0).length;
  const passed  = PACKETS.filter(p => p.blockAt < 0).length;

  const cw = Math.min(W * 0.44, 480);
  const ch = 92;
  const cx = W / 2;
  const cy = H / 2;

  ctx.save();
  ctx.globalAlpha = a;

  // Card background
  rrect(ctx, cx - cw / 2, cy - ch / 2, cw, ch, 8);
  ctx.fillStyle   = hsl([220, 22, 10] as HSL, 0.92);
  ctx.fill();
  ctx.strokeStyle = hsl(C.clean, 0.50);
  ctx.lineWidth   = 1;
  ctx.stroke();

  // Title
  ctx.textAlign  = "center";
  ctx.fillStyle  = hsl(C.clean);
  ctx.font       = `600 11px 'JetBrains Mono', monospace`;
  ctx.fillText("SECURITY PIPELINE COMPLETE", cx, cy - ch / 2 + 20);

  // Separator
  ctx.globalAlpha = a * 0.25;
  ctx.strokeStyle = hsl(C.gate);
  ctx.lineWidth   = 0.5;
  ctx.beginPath(); ctx.moveTo(cx - cw / 2 + 16, cy - ch / 2 + 28); ctx.lineTo(cx + cw / 2 - 16, cy - ch / 2 + 28); ctx.stroke();
  ctx.globalAlpha = a;

  // Stat columns
  const cols = [
    { label: "THREATS BLOCKED", value: String(blocked), color: C.threat },
    { label: "REQUESTS PASSED", value: String(passed),  color: C.clean  },
    { label: "LAYERS ACTIVE",   value: String(GATE_COUNT), color: C.gate },
  ];
  const colW = cw / cols.length;
  cols.forEach((col, i) => {
    const x = cx - cw / 2 + colW * i + colW / 2;
    const yBase = cy + 4;

    ctx.fillStyle = hsl(col.color);
    ctx.font      = `700 22px 'JetBrains Mono', monospace`;
    ctx.fillText(col.value, x, yBase);

    ctx.globalAlpha = a * 0.50;
    ctx.fillStyle   = hsl(C.dim);
    ctx.font        = `400 7px 'JetBrains Mono', monospace`;
    ctx.fillText(col.label, x, yBase + 14);
    ctx.globalAlpha = a;
  });

  // Redirect notice
  const redirectA = easeOut(prog(STATS_T + 1.2, STATS_T + 2.0, t));
  if (redirectA > 0) {
    ctx.globalAlpha = a * redirectA * 0.55;
    ctx.fillStyle   = hsl(C.dim);
    ctx.font        = `400 7.5px 'JetBrains Mono', monospace`;
    ctx.fillText("redirecting to jessegroenendaal.nl…", cx, cy + ch / 2 - 8);
  }

  ctx.restore();
}

// ─── Gate 3D slabs ───────────────────────────────────────────────────────────

function drawSlabs(ctx: CanvasRenderingContext2D, W: number, H: number, t: number) {
  const top = H * BOX_TOP_F;
  const bot = H * BOX_BOT_F;
  const bh  = bot - top;
  const hw  = W * BOX_HW;

  GATES.forEach((gate, gi) => {
    const a = easeOut(prog(0.2 + gi * 0.08, 0.8 + gi * 0.08, t));
    if (a <= 0) return;

    const cx = W * gate.xFrac;

    // Slab depth: base + slam surge on block
    let slabD = 22;
    let wallFlash = 0;
    PACKETS.forEach(cfg => {
      if (cfg.blockAt !== gi) return;
      const at = G_ARRIVE[gi] + cfg.delay;
      const slam = easeOut(prog(at, at + 0.10, t)) * (1 - easeOut(prog(at + 0.10, at + 0.55, t)));
      slabD += slam * 60;
      const wOn  = easeOut(prog(at, at + 0.07, t));
      const wOff = 1 - easeOut(prog(at + 0.07, at + 0.60, t));
      wallFlash = Math.max(wallFlash, wOn * wOff);
    });

    // Oblique depth direction: right + upward (physical appliance facing upper-right)
    const DX =  slabD * 0.78;
    const DY = -slabD * 0.52;

    const faceColor = wallFlash > 0.01 ? C.threat : C.gate;

    // ── Back face outline ─────────────────────────────────────────────────────
    ctx.save();
    ctx.globalAlpha = a * 0.20;
    ctx.strokeStyle = hsl(faceColor);
    ctx.lineWidth   = 1;
    rrect(ctx, cx - hw + DX, top + DY, hw * 2, bh, 4);
    ctx.stroke();
    ctx.restore();

    // ── Top face (trapezoid, front-top → back-top) ────────────────────────────
    ctx.save();
    ctx.globalAlpha = a * (0.18 + wallFlash * 0.30);
    ctx.fillStyle   = hsl(faceColor);
    ctx.beginPath();
    ctx.moveTo(cx - hw,      top);
    ctx.lineTo(cx - hw + DX, top + DY);
    ctx.lineTo(cx + hw + DX, top + DY);
    ctx.lineTo(cx + hw,      top);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = a * 0.28;
    ctx.strokeStyle = hsl(faceColor);
    ctx.lineWidth   = 0.8;
    ctx.stroke();
    ctx.restore();

    // ── Right face (parallelogram, front-right → back-right) ─────────────────
    ctx.save();
    ctx.globalAlpha = a * (0.13 + wallFlash * 0.22);
    ctx.fillStyle   = hsl(faceColor);
    ctx.beginPath();
    ctx.moveTo(cx + hw,      top);
    ctx.lineTo(cx + hw + DX, top + DY);
    ctx.lineTo(cx + hw + DX, bot + DY);
    ctx.lineTo(cx + hw,      bot);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = a * 0.22;
    ctx.strokeStyle = hsl(faceColor);
    ctx.lineWidth   = 0.8;
    ctx.stroke();
    ctx.restore();

    // ── Connecting edge lines ─────────────────────────────────────────────────
    ctx.save();
    ctx.globalAlpha = a * 0.38;
    ctx.strokeStyle = hsl(faceColor);
    ctx.lineWidth   = 1;
    [[cx - hw, top], [cx + hw, top], [cx + hw, bot]].forEach(([fx, fy]) => {
      ctx.beginPath();
      ctx.moveTo(fx, fy);
      ctx.lineTo(fx + DX, fy + DY);
      ctx.stroke();
    });
    ctx.restore();

    // ── Port depth lines (back-face horizontal connectors) ────────────────────
    const cy = H * 0.5;
    ctx.save();
    ctx.globalAlpha = a * 0.22;
    ctx.strokeStyle = hsl(faceColor);
    ctx.lineWidth   = 0.8;
    ctx.setLineDash([3, 6]);
    ctx.beginPath(); ctx.moveTo(cx - hw, cy); ctx.lineTo(cx - hw + DX, cy + DY); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx + hw, cy); ctx.lineTo(cx + hw + DX, cy + DY); ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  });
}

// ─── Mobile (portrait) layout ────────────────────────────────────────────────
// Packets flow top→bottom; gates are horizontal bands across full width.
// Triggered when canvas W < H (portrait orientation).

const MOB_HH        = 0.040;              // gate half-height fraction of H
const MOB_LX_F      = 0.06;              // gate left edge fraction
const MOB_RX_F      = 0.94;              // gate right edge fraction
const MOB_START_Y   = 0.055;
const MOB_DEST_Y    = 0.930;
const MOB_GATE_Y    = [0.24, 0.50, 0.74] as const;  // 3 gates (INBOUND, WAF, SWG)

const MOB_GATE_INFO = [
  { label: "INBOUND", nameParts: ["Inbound","Filtering"],  ruleCount: 847,  sig: GATE_SIG[0] },
  { label: "WAF",     nameParts: ["Web App","Firewall"],   ruleCount: 2841, sig: GATE_SIG[2] },
  { label: "SWG",     nameParts: ["Secure Web","Gateway"], ruleCount: 634,  sig: GATE_SIG[3] },
] as const;

const MOB_GATE_COUNT = MOB_GATE_INFO.length;

interface MobPktCfg { xFrac: number; type: "threat"|"clean"; delay: number; blockAt: number; }

const MOB_PACKETS: MobPktCfg[] = [
  { xFrac: 0.22, type: "threat", delay:  0.00, blockAt:  1 },  // hero threat — WAF
  { xFrac: 0.58, type: "clean",  delay:  0.00, blockAt: -1 },  // hero clean
  { xFrac: 0.38, type: "threat", delay:  0.45, blockAt:  0 },  // INBOUND
  { xFrac: 0.72, type: "clean",  delay: -0.18, blockAt: -1 },
  { xFrac: 0.84, type: "threat", delay:  0.68, blockAt:  2 },  // SWG
  { xFrac: 0.12, type: "clean",  delay:  0.32, blockAt: -1 },
];

const MOB_HERO_IDX = MOB_PACKETS.findIndex(p => p.type === "clean" && p.delay === 0);

const MOB_WP = (() => {
  function buildMobWP(blockAt: number): [number, number][] {
    const pts: [number, number][] = [[G_START, MOB_START_Y]];
    for (let i = 0; i < MOB_GATE_COUNT; i++) {
      pts.push([G_ARRIVE[i], MOB_GATE_Y[i]]);
      if (blockAt === i) return pts;
      pts.push([G_DEPART[i], MOB_GATE_Y[i]]);
    }
    pts.push([DEST_T, MOB_DEST_Y]);
    return pts;
  }
  return MOB_PACKETS.map(cfg => buildMobWP(cfg.blockAt));
})();

function packetMobY(H: number, t: number, cfg: MobPktCfg, idx: number): number {
  const ta = t - cfg.delay;
  const pts = MOB_WP[idx];
  if (ta <= pts[0][0]) return H * pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    const [t0, y0] = pts[i - 1];
    const [t1, y1] = pts[i];
    if (ta <= t1) return lerp(H * y0, H * y1, easeInOut(prog(t0, t1, ta)));
  }
  return H * pts[pts.length - 1][1];
}

function mobPktColor(t: number, cfg: MobPktCfg): HSL {
  if (cfg.type === "threat") {
    const at      = G_ARRIVE[cfg.blockAt] + cfg.delay;
    const toAmber = easeOut(prog(at - 0.5, at + 0.1, t));
    const toRed   = easeOut(prog(at + 0.1, at + 0.5, t));
    return [lerp(lerp(200,38,toAmber),0,toRed), lerp(lerp(70,88,toAmber),78,toRed), lerp(lerp(65,58,toAmber),58,toRed)];
  }
  const lastDep = G_DEPART[MOB_GATE_COUNT - 1] + cfg.delay;
  const toGreen = easeOut(prog(lastDep - 0.3, lastDep + 0.5, t));
  return [lerp(200,142,toGreen), lerp(70,58,toGreen), lerp(65,52,toGreen)];
}

function mobPktAlpha(t: number, cfg: MobPktCfg): number {
  const showA  = easeOut(prog(Math.max(0, G_START + cfg.delay - 0.05), G_START + cfg.delay + 0.5, t));
  const blockT = cfg.blockAt >= 0 ? G_ARRIVE[cfg.blockAt] + cfg.delay : Infinity;
  const fadeOut = cfg.blockAt >= 0 ? 1 - easeOut(prog(blockT + 0.4, blockT + 1.5, t)) : 1;
  return showA * fadeOut;
}

// Pre-seeded particle bursts for mobile impacts
const MOB_BURSTS: Map<number, Particle[]> = new Map();
MOB_PACKETS.forEach((cfg, idx) => {
  if (cfg.blockAt < 0) return;
  const rng = (seed: number) => { let s = seed; return () => { s = (s * 16807) % 2147483647; return (s-1)/2147483646; }; };
  const rand = rng(idx * 31 + cfg.blockAt * 97 + 13);
  MOB_BURSTS.set(idx, Array.from({ length: 20 }, () => {
    const angle = rand() * Math.PI * 2;
    return { vx: Math.cos(angle), vy: Math.sin(angle), angle, speed: 0.3 + rand() * 0.7, size: 1.2 + rand() * 2.8, spin: (rand()-0.5)*8 };
  }));
});

function countMobBlocked(gi: number, t: number) {
  return MOB_PACKETS.filter(c => c.blockAt === gi && t >= G_ARRIVE[gi] + c.delay + 0.15).length;
}
function countMobPassed(gi: number, t: number) {
  return MOB_PACKETS.filter(c => !(c.blockAt >= 0 && c.blockAt <= gi) && t >= G_DEPART[gi] + c.delay).length;
}

function drawMobTracks(ctx: CanvasRenderingContext2D, W: number, H: number, t: number) {
  const a = easeOut(prog(0.3, 1.1, t)) * 0.14;
  if (a <= 0) return;
  ctx.save();
  ctx.lineWidth = 1; ctx.setLineDash([4, 10]); ctx.lineDashOffset = -(t * 14);
  MOB_PACKETS.forEach(cfg => {
    const x      = W * cfg.xFrac;
    const blockT = cfg.blockAt >= 0 ? G_ARRIVE[cfg.blockAt] + cfg.delay : Infinity;
    const dimA   = cfg.blockAt >= 0 ? 1 - easeOut(prog(blockT + 0.1, blockT + 1.0, t)) : 1;
    ctx.strokeStyle = hsl(cfg.type === "threat" ? C.threat : C.gate, a * dimA);
    ctx.beginPath(); ctx.moveTo(x, H * MOB_START_Y); ctx.lineTo(x, H * MOB_DEST_Y); ctx.stroke();
  });
  ctx.setLineDash([]); ctx.restore();
}

function drawMobNodes(ctx: CanvasRenderingContext2D, W: number, H: number, t: number) {
  const lx = W * MOB_LX_F, rx = W * MOB_RX_F, bw = rx - lx, hh = H * MOB_HH;

  // Endpoint bands (INTERNET top, ORIGIN bottom)
  [{ label:"INTERNET", sub:"External Traffic",  yFrac: MOB_START_Y, ni: 0 },
   { label:"ORIGIN",   sub:"Protected Origin",  yFrac: MOB_DEST_Y,  ni: 1 }].forEach(({ label, sub, yFrac, ni }) => {
    const a  = easeOut(prog(0.1 + ni * 0.1, 0.7 + ni * 0.1, t));
    if (a <= 0) return;
    const gy = H * yFrac;
    ctx.save();
    ctx.globalAlpha = a * 0.07; ctx.fillStyle = hsl(C.gate); ctx.fillRect(lx, gy - hh, bw, hh * 2);
    const hg = ctx.createLinearGradient(lx, 0, rx, 0);
    [0, 0.05, 0.95, 1].forEach((s, i) => hg.addColorStop(s, hsl(C.gate, i === 0 || i === 3 ? 0 : a * 0.5)));
    ctx.globalAlpha = 1; ctx.strokeStyle = hg; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(lx, gy - hh); ctx.lineTo(rx, gy - hh); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(lx, gy + hh); ctx.lineTo(rx, gy + hh); ctx.stroke();
    ctx.globalAlpha = a * 0.85; ctx.fillStyle = hsl(C.gate);
    ctx.font = `600 9px 'JetBrains Mono', monospace`; ctx.textAlign = "center";
    ctx.fillText(label, W / 2, gy - 4);
    ctx.globalAlpha = a * 0.40; ctx.fillStyle = hsl(C.dim);
    ctx.font = `400 7px 'JetBrains Mono', monospace`;
    ctx.fillText(sub, W / 2, gy + 8);
    ctx.restore();
  });

  // Gate bands
  MOB_GATE_INFO.forEach((gate, gi) => {
    const a = easeOut(prog(0.2 + gi * 0.08, 0.8 + gi * 0.08, t));
    if (a <= 0) return;
    const gy = H * MOB_GATE_Y[gi];

    let scanA = 0, blockFlashA = 0;
    MOB_PACKETS.forEach(cfg => {
      if (cfg.blockAt >= 0 && cfg.blockAt < gi) return;
      const arr = G_ARRIVE[gi] + cfg.delay, dep = cfg.blockAt === gi ? arr + 0.6 : G_DEPART[gi] + cfg.delay;
      scanA = Math.max(scanA, easeInOut(prog(arr - 0.1, arr + 0.3, t)) * (1 - easeOut(prog(dep - 0.3, dep, t))));
      if (cfg.blockAt === gi) blockFlashA = Math.max(blockFlashA, easeOut(prog(arr, arr + 0.06, t)) * (1 - easeOut(prog(arr + 0.06, arr + 0.65, t))));
    });

    const sc: HSL = blockFlashA > 0.1 ? C.threat : scanA > 0.15 ? C.amber : C.gate;
    const blocked = countMobBlocked(gi, t), passed = countMobPassed(gi, t);
    ctx.save();

    // Fill + charge-up
    ctx.globalAlpha = a * (0.05 + scanA * 0.03 + blockFlashA * 0.04);
    ctx.fillStyle = hsl(sc); ctx.fillRect(lx, gy - hh, bw, hh * 2);
    const chargeP = easeInOut(prog(G_ARRIVE[gi] - 0.7, G_ARRIVE[gi] + 0.05, t));
    const chargeV = chargeP * (1 - easeOut(prog(G_ARRIVE[gi] + 0.05, G_DEPART[gi], t)));
    if (chargeV > 0.005) {
      const fillH = hh * 2 * chargeV;
      const cg = ctx.createLinearGradient(0, gy + hh - fillH, 0, gy + hh);
      cg.addColorStop(0, hsl(C.amber, 0)); cg.addColorStop(0.5, hsl(C.amber, chargeV * 0.10)); cg.addColorStop(1, hsl(C.amber, chargeV * 0.22));
      ctx.globalAlpha = 1; ctx.fillStyle = cg; ctx.fillRect(lx + 1, gy + hh - fillH, bw - 2, fillH);
      ctx.globalAlpha = chargeV * 0.55; ctx.strokeStyle = hsl(C.amber); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(lx + 2, gy + hh - fillH); ctx.lineTo(rx - 2, gy + hh - fillH); ctx.stroke();
    }

    // Borders
    const hg = ctx.createLinearGradient(lx, 0, rx, 0);
    [0, 0.05, 0.95, 1].forEach((s, i) => hg.addColorStop(s, hsl(sc, i===0||i===3 ? 0 : a*0.8)));
    ctx.globalAlpha = 1; ctx.strokeStyle = hg; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(lx, gy - hh); ctx.lineTo(rx, gy - hh); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(lx, gy + hh); ctx.lineTo(rx, gy + hh); ctx.stroke();
    ctx.strokeStyle = hsl(sc, a * 0.45); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(lx+1, gy-hh+2); ctx.lineTo(lx+1, gy+hh-2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(rx-1, gy-hh+2); ctx.lineTo(rx-1, gy+hh-2); ctx.stroke();
    // Crossbars
    ctx.strokeStyle = hsl(sc, a * 0.07); ctx.lineWidth = 0.5;
    for (let i = 1; i <= 7; i++) { const x = lx + bw*(i/8); ctx.beginPath(); ctx.moveTo(x,gy-hh+2); ctx.lineTo(x,gy+hh-2); ctx.stroke(); }

    // Status dot
    const dotC: HSL = blockFlashA > 0.05 ? C.threat : scanA > 0.1 ? C.amber : C.clean;
    ctx.globalAlpha = a * (scanA > 0.1 ? 0.65 + sin01(t, 2.5) * 0.35 : 1);
    ctx.fillStyle = hsl(dotC); ctx.beginPath(); ctx.arc(rx - 10, gy - hh + 10, 3.5, 0, Math.PI*2); ctx.fill();

    // Label
    ctx.globalAlpha = a * 0.92; ctx.fillStyle = hsl(sc);
    ctx.font = `600 9px 'JetBrains Mono', monospace`; ctx.textAlign = "left";
    ctx.fillText(gate.label, lx + 10, gy - 3);
    ctx.globalAlpha = a * 0.38; ctx.fillStyle = hsl(C.dim);
    ctx.font = `400 7px 'JetBrains Mono', monospace`;
    ctx.fillText(gate.nameParts[0] + " " + gate.nameParts[1], lx + 10, gy + 8);
    ctx.globalAlpha = a * 0.25; ctx.textAlign = "center";
    ctx.fillText(`rules: ${gate.ruleCount.toLocaleString()}`, W / 2, gy + 8);

    // Counters
    ctx.font = `400 7.5px 'JetBrains Mono', monospace`; ctx.textAlign = "right";
    if (blocked > 0) { ctx.globalAlpha = a * 0.82; ctx.fillStyle = hsl(C.threat); ctx.fillText(`✕ ${blocked}`, rx - 10, gy - 3); }
    if (passed  > 0) { ctx.globalAlpha = a * 0.82; ctx.fillStyle = hsl(C.clean);  ctx.fillText(`✓ ${passed}`,  rx - 10, gy + 8); }

    // Block flash
    if (blockFlashA > 0) {
      ctx.globalAlpha = 1;
      const fg = ctx.createLinearGradient(0, gy - hh*4, 0, gy + hh*4);
      fg.addColorStop(0, hsl(C.threat,0)); fg.addColorStop(0.3, hsl(C.threat, blockFlashA*0.45));
      fg.addColorStop(0.7, hsl(C.threat, blockFlashA*0.45)); fg.addColorStop(1, hsl(C.threat,0));
      ctx.fillStyle = fg; ctx.fillRect(lx, gy - hh*4, bw, hh*8);
    }
    ctx.restore();
  });
}

function drawMobHeartbeat(ctx: CanvasRenderingContext2D, W: number, H: number, t: number) {
  const fadeIn = easeOut(prog(1.0, 2.8, t));
  if (fadeIn <= 0) return;
  const lx = W * MOB_LX_F, rx = W * MOB_RX_F;
  MOB_GATE_INFO.forEach((_, gi) => {
    const gy = H * MOB_GATE_Y[gi];
    if (t >= G_ARRIVE[gi] - 0.3 && t <= G_DEPART[gi] + 0.3) return;
    const phase = ((t / 2.4 + gi * 0.38) % 1.0);
    const beatA = phase < 0.08 ? phase / 0.08 : phase < 0.48 ? 1-(phase-0.08)/0.40 : 0;
    if (beatA <= 0.01) return;
    const alpha = beatA * 0.45 * fadeIn, ringR = 4 + beatA * 14;
    [[lx, gy], [rx, gy]].forEach(([px, py]) => {
      ctx.save(); ctx.globalAlpha = alpha; ctx.strokeStyle = hsl(C.gate); ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.arc(px, py, ringR, 0, Math.PI*2); ctx.stroke(); ctx.restore();
    });
  });
}

function drawMobScanBeams(ctx: CanvasRenderingContext2D, W: number, H: number, t: number) {
  const lx = W * MOB_LX_F, bw = W * (MOB_RX_F - MOB_LX_F), hh = H * MOB_HH;
  MOB_GATE_INFO.forEach((_, gi) => {
    const gy  = H * MOB_GATE_Y[gi];
    const arr = G_ARRIVE[gi], dep = G_DEPART[gi];
    const a   = easeInOut(prog(arr-0.1, arr+0.3, t)) * (1 - easeOut(prog(dep-0.2, dep, t)));
    if (a <= 0.01) return;
    const sx = lx + ((prog(arr, dep, t) * 2.2) % 1.0) * bw;
    ctx.save(); ctx.globalAlpha = a * 0.80;
    const bg = ctx.createLinearGradient(0, gy - hh*0.85, 0, gy + hh*0.85);
    bg.addColorStop(0, hsl(C.amber,0)); bg.addColorStop(0.15, hsl(C.amber,0.95)); bg.addColorStop(0.85, hsl(C.amber,0.95)); bg.addColorStop(1, hsl(C.amber,0));
    ctx.fillStyle = bg; ctx.fillRect(sx - 1, gy - hh*0.85, 2, hh*1.7);
    const trail = ctx.createLinearGradient(sx-16, 0, sx, 0);
    trail.addColorStop(0, hsl(C.amber,0)); trail.addColorStop(1, hsl(C.amber,0.09));
    ctx.fillStyle = trail; ctx.fillRect(sx-16, gy - hh*0.85, 16, hh*1.7);
    ctx.restore();
  });
}

function drawMobBlock(ctx: CanvasRenderingContext2D, W: number, H: number, t: number) {
  const lx = W * MOB_LX_F, rx = W * MOB_RX_F, hh = H * MOB_HH;
  MOB_PACKETS.forEach(cfg => {
    if (cfg.blockAt < 0) return;
    const gy = H * MOB_GATE_Y[cfg.blockAt], px = W * cfg.xFrac, at = G_ARRIVE[cfg.blockAt] + cfg.delay;
    const wallOn = easeOut(prog(at, at+0.07, t)), wallOff = 1 - easeOut(prog(at+0.07, at+0.60, t));
    const wallA  = wallOn * wallOff;
    if (wallA > 0.005) {
      ctx.save();
      ctx.globalAlpha = wallA * 0.72; ctx.fillStyle = hsl(C.threat); ctx.fillRect(lx+1, gy-hh+1, rx-lx-2, hh*2-2);
      ctx.globalAlpha = wallA;
      const eg = ctx.createLinearGradient(0, gy-hh, 0, gy-hh+6);
      eg.addColorStop(0, hsl(C.threat,1)); eg.addColorStop(1, hsl(C.threat,0));
      ctx.fillStyle = eg; ctx.fillRect(lx, gy-hh, rx-lx, 6);
      ctx.restore();
    }
    // Shockwave upward
    const shockFade = easeOut(prog(at, at+0.04, t)) * (1 - easeOut(prog(at+0.04, at+0.5, t)));
    if (shockFade > 0.005) {
      const dist = prog(at, at+0.55, t) * H * 0.16;
      const sg = ctx.createLinearGradient(0, gy-hh-dist, 0, gy-hh);
      sg.addColorStop(0, hsl(C.threat,0)); sg.addColorStop(0.6, hsl(C.threat,shockFade*0.55)); sg.addColorStop(1, hsl(C.threat,shockFade*0.85));
      ctx.fillStyle = sg; ctx.fillRect(px - 1.5, gy-hh-dist, 3, dist);
    }
    // Lingering barrier
    const barrierA = easeOut(prog(at+0.07, at+0.25, t)) * (1 - easeOut(prog(at+0.55, at+1.8, t)));
    if (barrierA > 0) {
      ctx.save(); ctx.globalAlpha = barrierA*0.55; ctx.strokeStyle = hsl(C.threat); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(px, gy-hh); ctx.lineTo(px, gy+hh); ctx.stroke(); ctx.restore();
    }
    // BLOCKED label
    const labelA = easeOut(prog(at+0.10, at+0.30, t)) * (1 - easeOut(prog(at+0.9, at+1.8, t)));
    if (labelA > 0) {
      ctx.save(); ctx.globalAlpha = labelA; ctx.fillStyle = hsl(C.threat);
      ctx.font = `700 8px 'JetBrains Mono', monospace`; ctx.textAlign = "left";
      ctx.fillText("BLOCKED", Math.min(px + 6, W - 60), gy - hh - 4); ctx.restore();
    }
  });
}

function drawMobPackets(ctx: CanvasRenderingContext2D, W: number, H: number, t: number) {
  const order = MOB_PACKETS.map((cfg, idx) => ({ cfg, idx })).sort((a, b) => a.cfg.xFrac - b.cfg.xFrac);
  order.forEach(({ cfg, idx }) => {
    const pa = mobPktAlpha(t, cfg);
    if (pa < 0.01) return;
    const x  = W * cfg.xFrac, py = packetMobY(H, t, cfg, idx);
    const col = mobPktColor(t, cfg), r = 4.5 * (0.80 + cfg.xFrac * 0.35);
    for (let i = 8; i >= 1; i--) {
      const ppy = packetMobY(H, Math.max(0, t - i*0.048), cfg, idx);
      const da  = pa * (1 - i/8) * 0.40;
      if (da < 0.01) continue;
      ctx.save(); ctx.globalAlpha = da; ctx.fillStyle = hsl(col);
      ctx.beginPath(); ctx.arc(x, ppy, Math.max(1, r-1-i*0.28), 0, Math.PI*2); ctx.fill(); ctx.restore();
    }
    glowAt(ctx, x, py, 22 + (r-4.5)*5, col, pa * 0.55);
    ctx.save(); ctx.globalAlpha = pa; ctx.fillStyle = hsl(col);
    ctx.beginPath(); ctx.arc(x, py, r, 0, Math.PI*2); ctx.fill();
    const spd = py - packetMobY(H, Math.max(0, t-0.05), cfg, idx);
    if (spd > 0.5) {
      ctx.strokeStyle = hsl(col); ctx.lineWidth = 1; ctx.globalAlpha = pa * 0.55;
      ctx.beginPath(); ctx.moveTo(x-3, py+r+2); ctx.lineTo(x, py+r+6); ctx.lineTo(x+3, py+r+2); ctx.stroke();
    }
    ctx.restore();
  });
}

function drawMobDestination(ctx: CanvasRenderingContext2D, W: number, H: number, t: number) {
  const dy = H * MOB_DEST_Y, pulse = sin01(t, 0.55) * 0.22 + 0.78;
  MOB_PACKETS.forEach(cfg => {
    if (cfg.blockAt >= 0) return;
    const dA = easeOut(prog(DEST_T + cfg.delay - 0.3, DEST_T + cfg.delay + 0.5, t));
    if (dA <= 0) return;
    glowAt(ctx, W*cfg.xFrac, dy, 26*pulse, C.clean, dA*0.35);
    ctx.save(); ctx.globalAlpha = dA; ctx.fillStyle = hsl(C.clean);
    ctx.beginPath(); ctx.arc(W*cfg.xFrac, dy, 4.5, 0, Math.PI*2); ctx.fill(); ctx.restore();
  });
  const hero  = MOB_PACKETS[MOB_HERO_IDX];
  const textA = easeOut(prog(DEST_T + hero.delay + 0.3, DEST_T + hero.delay + 1.1, t));
  if (textA > 0) {
    ctx.save(); ctx.globalAlpha = textA; ctx.textAlign = "center";
    ctx.fillStyle = hsl(C.clean); ctx.font = `500 11px 'JetBrains Mono', monospace`;
    ctx.fillText("jessegroenendaal.nl", W/2, dy + 22);
    ctx.fillStyle = hsl(C.clean, 0.65); ctx.font = `400 8px 'JetBrains Mono', monospace`;
    ctx.fillText("\u2713 TLS 1.3 \u00b7 secure", W/2, dy + 36);
    ctx.restore();
  }
}

function drawMobParticles(ctx: CanvasRenderingContext2D, W: number, H: number, t: number) {
  MOB_PACKETS.forEach((cfg, idx) => {
    if (cfg.blockAt < 0) return;
    const particles = MOB_BURSTS.get(idx);
    if (!particles) return;
    const at = G_ARRIVE[cfg.blockAt] + cfg.delay, age = t - at;
    if (age < 0 || age > 1.4) return;
    const ox = W * cfg.xFrac, oy = H * MOB_GATE_Y[cfg.blockAt];
    particles.forEach(p => {
      const life = easeOut(prog(at+0.02, at+1.4, t)), fade = 1 - life;
      if (fade <= 0) return;
      const dist = age * p.speed * W * 0.10, sr = Math.max(0.3, p.size*(1-life*0.7));
      ctx.save(); ctx.globalAlpha = fade*0.85; ctx.translate(ox + p.vx*dist, oy + p.vy*dist); ctx.rotate(p.spin*age);
      ctx.beginPath();
      if (p.size > 2.5) { ctx.moveTo(0,-sr); ctx.lineTo(sr*0.6,0); ctx.lineTo(0,sr); ctx.lineTo(-sr*0.6,0); ctx.closePath(); }
      else ctx.arc(0, 0, sr, 0, Math.PI*2);
      ctx.fillStyle = hsl(C.threat, 0.9 - life*0.5); ctx.fill(); ctx.restore();
    });
  });
}

function drawMobSignatures(ctx: CanvasRenderingContext2D, W: number, H: number, t: number) {
  const hh = H * MOB_HH;
  MOB_PACKETS.forEach(cfg => {
    if (cfg.blockAt < 0) return;
    const at  = G_ARRIVE[cfg.blockAt] + cfg.delay, sig = MOB_GATE_INFO[cfg.blockAt].sig;
    const a   = easeOut(prog(at+0.08, at+0.30, t)) * (1 - easeOut(prog(at+0.80, at+1.60, t)));
    if (a <= 0.01) return;
    const px = W * cfg.xFrac, gy = H * MOB_GATE_Y[cfg.blockAt];
    ctx.save(); ctx.globalAlpha = a;
    ctx.font = `400 7px 'JetBrains Mono', monospace`;
    const tw = ctx.measureText(sig).width, pad = 5;
    const bx = clamp(px - tw/2 - pad, 4, W - tw - pad*2 - 4), by = gy - hh - 22;
    rrect(ctx, bx, by, tw + pad*2, 14, 3);
    ctx.fillStyle = hsl(C.bg, 0.88); ctx.fill();
    ctx.strokeStyle = hsl(C.threat, 0.55); ctx.lineWidth = 0.8; ctx.stroke();
    ctx.fillStyle = hsl(C.threat); ctx.textAlign = "center";
    ctx.fillText(`\u2691 ${sig}`, bx + tw/2 + pad, by + 11);
    ctx.restore();
  });
}

function drawMobCleanStamps(ctx: CanvasRenderingContext2D, W: number, H: number, t: number) {
  MOB_GATE_INFO.forEach((_, gi) => {
    const gy = H * MOB_GATE_Y[gi];
    MOB_PACKETS.forEach(cfg => {
      if (cfg.type !== "clean" || (cfg.blockAt >= 0 && cfg.blockAt <= gi)) return;
      const depT = G_DEPART[gi] + cfg.delay;
      const a    = easeOut(prog(depT-0.05, depT+0.15, t)) * (1 - easeOut(prog(depT+0.15, depT+0.65, t)));
      if (a <= 0.01) return;
      ctx.save(); ctx.globalAlpha = a * 0.90; ctx.strokeStyle = hsl(C.clean); ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(W*cfg.xFrac, gy, 9*a, 0, Math.PI*2); ctx.stroke();
      ctx.globalAlpha = a * 0.85; ctx.fillStyle = hsl(C.clean);
      ctx.font = `600 8px 'JetBrains Mono', monospace`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("\u2713", W*cfg.xFrac, gy); ctx.textBaseline = "alphabetic"; ctx.restore();
    });
  });
}

// ─── Portfolio layer ─────────────────────────────────────────────────────────

const CONTAINER_START = new Date("2026-02-01T14:00:00Z");

const SERVICES = [
  { name: "Proxmox",  Icon: Server,    url: "#proxmox"  },
  { name: "Docker",   Icon: Container, url: "#docker"   },
  { name: "OPNsense", Icon: Shield,    url: "#opnsense" },
] as const;

const MOTD_POOL: [string, string][] = [
  ["No staging environment. All tested in production ;).",       "This domain runs on experiments, side quests, and stubbornness."],
  ["Uptime is just a suggestion.",                               "A very strongly worded one."],
  ["It works on my machine.",                                    "Containerized the machine. Problem solved."],
  ["chmod 777 seemed fine at the time.",                         "We don't talk about that weekend."],
  ["The firewall rules made sense at 2am.",                      "Some of them still do."],
  ["Documentation: somewhere, probably.",                        "The code is self-documenting. Trust me."],
  ["99% of bugs fixed by turning it off and on again.",          "The other 1% got promoted to features."],
  ["Survived: power cuts, bad updates, and one cat.",            "Resilience through selective ignorance."],
  ["kubectl delete pod --all fixed it.",                         "Still unsure what was wrong. Won't investigate."],
  ["Technically not a memory leak.",                             "It's a long-running in-memory collection."],
  ["This cert will expire in 89 days.",                          "As it has for the past three years."],
  ["grep -r 'TODO' . returned 47 results.",                      "Progress."],
  ["The backup job completed successfully.",                     "No one has ever tested restoring from it."],
  ["Deployed on a Friday.",                                      "Felt fine. Still feels fine. Probably fine."],
  ["There are 2 types of sysadmins:",                            "Those who have rm -rf'd /, and those who will."],
  ["Opened port 22 to the world for 'just a minute'.",           "The logs from that minute are still being processed."],
  ["The monitoring alert fired at 3am.",                         "Turns out it was the monitor that was broken."],
  ["LGTM.",                                                      "— me, reviewing my own PR after 45 seconds."],
  ["It's not a bug.",                                            "It's a timeout-based consistency model."],
  ["Added a sleep(1000) to fix the race condition.",             "Architecture review pending."],
  ["Works in prod. Fails in staging.",                           "Staging is the problem. Decommissioned staging."],
  ["Disk full. Deleted some logs.",                              "They were probably not important logs."],
  ["Pushed directly to main.",                                   "Branch protection is for people who make mistakes."],
  ["The container keeps restarting.",                            "restart: always is basically self-healing infrastructure."],
  ["DNS is fine.",                                               "It's always DNS. But right now it's fine."],
  ["Wrote a shell script to fix the shell script.",              "It's scripts all the way down."],
  ["This runs as root.",                                         "The principle of least privilege is a great principle."],
  ["IPv6 is disabled.",                                          "A decision made in 2019 and never revisited."],
  ["The regex is undocumented.",                                 "The regex is also slightly wrong. But only in edge cases."],
  ["Rebooted the server to apply updates.",                      "The uptime counter starts now."],
];

const [MOTD1, MOTD2] = MOTD_POOL[Math.floor(Math.random() * MOTD_POOL.length)];

// Each item: text typed into the terminal (cmd items omit the "$ " prefix)
const TYPING_ITEMS = [
  { id: "cmd1",  text: "whoami",        type: "cmd"  as const, startMs: 400,  charMs: 32 },
  { id: "h1",    text: "jessegroenendaal.nl", type: "h1" as const, startMs: 860, charMs: 28 },
  { id: "cmd2",  text: "cat /etc/motd", type: "cmd"  as const, startMs: 1680, charMs: 30 },
  { id: "motd1", text: MOTD1,           type: "text" as const, startMs: 2380, charMs: 12 },
  { id: "motd2", text: MOTD2,           type: "text" as const, startMs: 2380 + MOTD1.length * 12 + 200, charMs: 12 },
  { id: "cmd3",  text: "systemctl status", type: "cmd" as const, startMs: 2380 + MOTD1.length * 12 + MOTD2.length * 12 + 600, charMs: 30 },
];

function NetworkBg() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    let raf = 0;
    const nodes: { x: number; y: number; vx: number; vy: number }[] = [];
    const resize = () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight; };
    resize();
    window.addEventListener("resize", resize);
    for (let i = 0; i < 60; i++) {
      nodes.push({ x: Math.random() * canvas.width, y: Math.random() * canvas.height,
                   vx: (Math.random() - 0.5) * 0.4, vy: (Math.random() - 0.5) * 0.4 });
    }
    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx = nodes[i].x - nodes[j].x, dy = nodes[i].y - nodes[j].y;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < 200) {
            ctx.strokeStyle = `hsla(142,60%,55%,${(1 - d / 200) * 0.35})`;
            ctx.lineWidth = 0.5;
            ctx.beginPath(); ctx.moveTo(nodes[i].x, nodes[i].y); ctx.lineTo(nodes[j].x, nodes[j].y); ctx.stroke();
          }
        }
      }
      for (const n of nodes) {
        ctx.fillStyle = "hsla(142,60%,55%,0.5)";
        ctx.beginPath(); ctx.arc(n.x, n.y, 2, 0, Math.PI * 2); ctx.fill();
        n.x += n.vx; n.y += n.vy;
        if (n.x < 0 || n.x > canvas.width)  n.vx *= -1;
        if (n.y < 0 || n.y > canvas.height) n.vy *= -1;
      }
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", resize); };
  }, []);
  return <canvas ref={ref} className="pointer-events-none fixed inset-0 z-0" aria-hidden="true" />;
}

function TerminalCard({ skip, uptime }: { skip: boolean; uptime: string }) {
  const [chars,    setChars]    = useState<Record<string, number>>({});
  const [services, setServices] = useState(0);
  const [footer,   setFooter]   = useState(false);
  const [header,   setHeader]   = useState(false);

  useEffect(() => {
    const timers:    ReturnType<typeof setTimeout>[]  = [];
    const intervals: ReturnType<typeof setInterval>[] = [];

    if (skip) {
      setHeader(true);
      const all: Record<string, number> = {};
      TYPING_ITEMS.forEach(({ id, text }) => { all[id] = text.length; });
      setChars(all);
      setServices(SERVICES.length);
      setFooter(true);
      return;
    }

    timers.push(setTimeout(() => setHeader(true), 220));

    TYPING_ITEMS.forEach(({ id, text, startMs, charMs }) => {
      timers.push(setTimeout(() => {
        let i = 0;
        const iv = setInterval(() => {
          i++;
          setChars(prev => ({ ...prev, [id]: i }));
          if (i >= text.length) clearInterval(iv);
        }, charMs);
        intervals.push(iv);
      }, startMs));
    });

    SERVICES.forEach((_, idx) => {
      timers.push(setTimeout(() => setServices(idx + 1), 5100 + idx * 200));
    });
    timers.push(setTimeout(() => setFooter(true), 5750));

    return () => { timers.forEach(clearTimeout); intervals.forEach(clearInterval); };
  }, [skip]);

  const typed = (id: string, text: string) => text.slice(0, chars[id] ?? 0);
  const show  = (id: string) => (chars[id] ?? 0) > 0;
  const done  = (id: string, text: string) => (chars[id] ?? 0) >= text.length;
  const cur   = <span className="animate-blink text-primary">▌</span>;

  return (
    <div className="w-full max-w-lg space-y-8">
      {/* Terminal card */}
      <div className={`rounded-lg border border-border bg-card animate-pulse-glow transition-opacity duration-500 ${header ? "opacity-100" : "opacity-0"}`}>
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <span className="h-3 w-3 rounded-full bg-destructive" />
          <span className="h-3 w-3 rounded-full" style={{ background: "hsl(45,90%,55%)" }} />
          <span className="h-3 w-3 rounded-full bg-primary" />
          <span className="ml-2 font-mono text-xs text-muted-foreground">jesse@homelab:~</span>
        </div>
        <div className="space-y-3 p-6 font-mono text-sm">
          {show("cmd1") && (
            <p className="text-muted-foreground">
              <span className="text-primary">$</span> {typed("cmd1", "whoami")}
              {!done("cmd1", "whoami") && cur}
            </p>
          )}
          {show("h1") && (
            <h1 className="text-2xl font-bold text-foreground">
              {typed("h1", "jessegroenendaal.nl")}
              {!done("h1", "jessegroenendaal.nl") && cur}
            </h1>
          )}
          {show("cmd2") && (
            <p className="text-muted-foreground">
              <span className="text-primary">$</span> {typed("cmd2", "cat /etc/motd")}
              {!done("cmd2", "cat /etc/motd") && cur}
            </p>
          )}
          {show("motd1") && (
            <p className="text-secondary-foreground">
              {typed("motd1", MOTD1)}
              {!show("motd2") && !done("motd1", MOTD1) && cur}
            </p>
          )}
          {show("motd2") && (
            <p className="text-secondary-foreground">
              {typed("motd2", MOTD2)}
              {!done("motd2", MOTD2) && cur}
            </p>
          )}
          {show("cmd3") && (
            <p className="text-muted-foreground">
              <span className="text-primary">$</span> {typed("cmd3", "systemctl status")}
              {/* cursor persists here — this is the active prompt */}
              {cur}
            </p>
          )}
        </div>
      </div>

      {/* Services */}
      <div className="space-y-2">
        {SERVICES.slice(0, services).map((s) => (
          <a key={s.name} href={s.url} target="_blank" rel="noopener noreferrer"
            className="group flex items-center justify-between rounded-md border border-border bg-card px-4 py-3 transition-all duration-200 hover:border-primary/50 hover:bg-primary/5 hover:shadow-[0_0_12px_-4px_hsl(var(--primary)/0.3)] animate-fade-in-up"
          >
            <span className="flex items-center gap-2 font-mono text-sm text-foreground">
              <s.Icon className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-primary" />
              {s.name}
            </span>
            <span className="flex items-center gap-2 font-mono text-xs text-primary">
              <span className="h-2 w-2 rounded-full bg-primary" />
              online
              <ExternalLink className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" />
            </span>
          </a>
        ))}
      </div>

      {/* Footer */}
      {footer && (
        <div className={`space-y-1 transition-opacity duration-700 ${footer ? "opacity-100" : "opacity-0"}`}>
          <p className="text-center font-mono text-xs text-muted-foreground">uptime: {uptime}</p>
          <p className="text-center font-mono text-xs text-muted-foreground">jessegroenendaal.nl</p>
        </div>
      )}
    </div>
  );
}

function PortfolioLayer({ skip }: { skip: boolean }) {
  const [uptime,  setUptime]  = useState("");
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const tick = () => {
      const diff = Date.now() - CONTAINER_START.getTime();
      const d = Math.floor(diff / 86400000);
      const h = Math.floor((diff % 86400000) / 3600000);
      const m = Math.floor((diff % 3600000)  / 60000);
      const s = Math.floor((diff % 60000)    / 1000);
      setUptime(`${d}d ${h}h ${m}m ${s}s`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  // Small delay so the CSS opacity transition fires
  useEffect(() => {
    const t = setTimeout(() => setVisible(true), skip ? 0 : 60);
    return () => clearTimeout(t);
  }, [skip]);

  return (
    <div className={`absolute inset-0 transition-opacity duration-[900ms] ease-out ${visible ? "opacity-100" : "opacity-0"}`}>
      <NetworkBg />
      <div className="relative z-10 flex min-h-screen flex-col items-center justify-center p-6">
        <TerminalCard skip={skip} uptime={uptime} />
      </div>
    </div>
  );
}

// ─── Render loop ─────────────────────────────────────────────────────────────

export default function WAFDemo() {
  const canvasRef   = useRef<HTMLCanvasElement>(null);
  const rafRef      = useRef<number>(0);
  const startRef    = useRef<number>(0);
  const labelRef    = useRef<HTMLParagraphElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const prevStageAt = useRef<number>(-1);
  const camXRef     = useRef<number>(-1);
  const phaseRef    = useRef<"waf" | "portfolio">("waf");

  const [phase,    setPhase]    = useState<"waf" | "portfolio">("waf");
  const [skipAnim, setSkipAnim] = useState(false);
  const skipRef = useRef(false);

  // ESC → skip WAF animation and jump straight to portfolio
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (!skipRef.current) { skipRef.current = true; setSkipAnim(true); }
      if (phaseRef.current === "waf") {
        cancelAnimationFrame(rafRef.current);
        phaseRef.current = "portfolio";
        setPhase("portfolio");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width  = canvas.clientWidth  * dpr;
      canvas.height = canvas.clientHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);
    startRef.current = performance.now();

    const statusCls: Record<Stage["status"], string> = {
      neutral: "text-sky-400",
      warning: "text-amber-400",
      danger:  "text-red-500",
      success: "text-green-400",
    };

    const frame = (now: number) => {
      const t = Math.min((now - startRef.current) / 1000, TOTAL);
      const W = canvas.clientWidth;
      const H = canvas.clientHeight;

      ctx.fillStyle = hsl(C.bg);
      ctx.fillRect(0, 0, W, H);

      const isMob = W < H;  // portrait → mobile layout

      if (isMob) {
        // ── Mobile: packets flow top→bottom, gates are horizontal bands ────────
        let mobJolt = 0;
        MOB_PACKETS.forEach(cfg => {
          if (cfg.blockAt < 0) return;
          const at = G_ARRIVE[cfg.blockAt] + cfg.delay;
          const j  = easeOut(prog(at, at+0.04, t)) * (1 - easeOut(prog(at+0.04, at+0.28, t)));
          mobJolt = Math.max(mobJolt, j);
        });
        const mjX = mobJolt * Math.sin(t * 82) * 4, mjY = mobJolt * -3;
        ctx.save();
        ctx.translate(mjX, mjY);
        drawGrid(ctx, W, H, t);
        drawMobTracks(ctx, W, H, t);
        drawMobNodes(ctx, W, H, t);
        drawMobHeartbeat(ctx, W, H, t);
        drawMobScanBeams(ctx, W, H, t);
        drawMobCleanStamps(ctx, W, H, t);
        drawMobBlock(ctx, W, H, t);
        drawMobParticles(ctx, W, H, t);
        drawMobSignatures(ctx, W, H, t);
        drawMobPackets(ctx, W, H, t);
        drawMobDestination(ctx, W, H, t);
        ctx.restore();
      } else {
        // ── Desktop: packets flow left→right, gates are vertical slabs ─────────
        const heroPx = packetX(W, t, PACKETS[HERO_IDX], HERO_IDX);
        if (camXRef.current < 0) camXRef.current = heroPx;
        camXRef.current = lerp(camXRef.current, heroPx, 0.032);
        const camPan = (camXRef.current - W * 0.5) * -0.10;

        let maxJolt = 0;
        PACKETS.forEach(cfg => {
          if (cfg.blockAt < 0) return;
          const at = G_ARRIVE[cfg.blockAt] + cfg.delay;
          const j  = easeOut(prog(at, at+0.04, t)) * (1 - easeOut(prog(at+0.04, at+0.28, t)));
          maxJolt = Math.max(maxJolt, j);
        });
        const joltX = maxJolt * Math.sin(t * 82) * 6, joltY = maxJolt * -4;

        ctx.save();
        ctx.translate(camPan + joltX, joltY);
        drawGrid(ctx, W, H, t);
        drawTracks(ctx, W, H, t);
        drawBackbone(ctx, W, H, t);
        drawSlabs(ctx, W, H, t);
        drawHeartbeat(ctx, W, H, t);
        drawNodes(ctx, W, H, t);
        drawScanBeams(ctx, W, H, t);
        drawCleanStamps(ctx, W, H, t);
        drawBlock(ctx, W, H, t);
        drawParticles(ctx, W, H, t);
        drawSignatures(ctx, W, H, t);
        drawPackets(ctx, W, H, t);
        drawDestination(ctx, W, H, t);
        ctx.restore();
      }

      const s = getStage(t);
      if (s.at !== prevStageAt.current) {
        prevStageAt.current = s.at;
        if (labelRef.current) {
          labelRef.current.textContent = s.label;
          labelRef.current.className =
            `text-sm font-medium font-mono transition-colors duration-500 ${statusCls[s.status]}`;
        }
      }

      if (progressRef.current) {
        progressRef.current.style.width = `${(t / TOTAL) * 100}%`;
      }

      if (t < TOTAL && phaseRef.current === "waf") {
        rafRef.current = requestAnimationFrame(frame);
      } else if (phaseRef.current === "waf") {
        phaseRef.current = "portfolio";
        setPhase("portfolio");
      }
    };

    rafRef.current = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <div className="relative w-full h-screen bg-background overflow-hidden">

      {/* WAF canvas — fades out when portfolio takes over */}
      <canvas
        ref={canvasRef}
        className={`absolute inset-0 w-full h-full transition-opacity duration-[1400ms] ease-in-out ${
          phase === "portfolio" ? "opacity-0 pointer-events-none" : "opacity-100"
        }`}
      />

      {/* WAF UI overlays — fade faster than the canvas */}
      <div className={`pointer-events-none select-none transition-opacity duration-[700ms] ${
        phase === "portfolio" ? "opacity-0" : "opacity-100"
      }`}>
        <div className="absolute top-6 left-6 space-y-1">
          <p className="text-[10px] tracking-widest uppercase text-muted-foreground font-mono">
            Security pipeline
          </p>
          <p ref={labelRef} className="text-sm font-medium font-mono transition-colors duration-500 text-sky-400">
            Initializing security pipeline&hellip;
          </p>
        </div>
        <div className="absolute top-6 right-6 flex flex-col items-end gap-2">
          <div className="flex items-center gap-2 text-xs font-mono text-muted-foreground">
            <span>Threat</span>
            <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
          </div>
          <div className="flex items-center gap-2 text-xs font-mono text-muted-foreground">
            <span>Clean</span>
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: "hsl(142,58%,52%)" }} />
          </div>
        </div>
        <div className="absolute bottom-0 left-0 right-0 h-px bg-border">
          <div ref={progressRef} className="h-full" style={{ width: "0%", background: "hsl(142,58%,52%)" }} />
        </div>
        <p className="absolute bottom-5 left-1/2 -translate-x-1/2 text-[10px] font-mono text-muted-foreground opacity-30">
          ESC to skip
        </p>
      </div>

      {/* Portfolio layer — mounts when WAF finishes */}
      {phase === "portfolio" && <PortfolioLayer skip={skipAnim} />}

    </div>
  );
}
