import { useEffect, useRef } from "react";
import { Server, Container, Shield, ExternalLink } from "lucide-react";

const NetworkBackground = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animationId: number;
    const nodes: { x: number; y: number; vx: number; vy: number }[] = [];
    const nodeCount = 60;
    const maxDist = 200;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener("resize", resize);

    for (let i = 0; i < nodeCount; i++) {
      nodes.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        vx: (Math.random() - 0.5) * 0.4,
        vy: (Math.random() - 0.5) * 0.4,
      });
    }

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Draw connections
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx = nodes[i].x - nodes[j].x;
          const dy = nodes[i].y - nodes[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < maxDist) {
            const opacity = (1 - dist / maxDist) * 0.35;
            ctx.strokeStyle = `hsla(142, 60%, 55%, ${opacity})`;
            ctx.lineWidth = 0.5;
            ctx.beginPath();
            ctx.moveTo(nodes[i].x, nodes[i].y);
            ctx.lineTo(nodes[j].x, nodes[j].y);
            ctx.stroke();
          }
        }
      }

      // Draw & move nodes
      for (const node of nodes) {
        ctx.fillStyle = "hsla(142, 60%, 55%, 0.5)";
        ctx.beginPath();
        ctx.arc(node.x, node.y, 2, 0, Math.PI * 2);
        ctx.fill();

        node.x += node.vx;
        node.y += node.vy;
        if (node.x < 0 || node.x > canvas.width) node.vx *= -1;
        if (node.y < 0 || node.y > canvas.height) node.vy *= -1;
      }

      animationId = requestAnimationFrame(draw);
    };
    draw();

    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none fixed inset-0 z-0"
      aria-hidden="true"
    />
  );
};

const Index = () => {
  const services = [
    { name: "Proxmox", status: "online", icon: Server, url: "#proxmox" },
    { name: "Docker", status: "online", icon: Container, url: "#docker" },
    { name: "OPNsense", status: "online", icon: Shield, url: "#opnsense" },
  ];

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center bg-background p-6">
      <NetworkBackground />
      <div className="relative z-10 w-full max-w-lg space-y-8 animate-fade-in-up">
        {/* Terminal header */}
        <div className="rounded-lg border border-border bg-card animate-pulse-glow">
          <div className="flex items-center gap-2 border-b border-border px-4 py-3">
            <span className="h-3 w-3 rounded-full bg-destructive" />
            <span className="h-3 w-3 rounded-full" style={{ background: "hsl(45, 90%, 55%)" }} />
            <span className="h-3 w-3 rounded-full bg-primary" />
            <span className="ml-2 font-mono text-xs text-muted-foreground">
              jesse@homelab:~
            </span>
          </div>
          <div className="space-y-3 p-6 font-mono text-sm">
            <p className="text-muted-foreground">
              <span className="text-primary">$</span> whoami
            </p>
            <h1 className="text-2xl font-bold text-foreground">
              jessegroenendaal.nl
            </h1>
            <p className="text-muted-foreground">
              <span className="text-primary">$</span> cat /etc/motd
            </p>
            <p className="text-secondary-foreground">
	      No staging environment. All tested in production ;).
	      This domain contains experiments, side quests and the occasional good decision.
            </p>
            <p className="text-muted-foreground">
              <span className="text-primary">$</span> systemctl status
              <span className="animate-blink text-primary">▌</span>
            </p>
          </div>
        </div>

        {/* Services */}
        <div className="space-y-2">
          {services.map((s) => (
            <a
              key={s.name}
              href={s.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex items-center justify-between rounded-md border border-border bg-card px-4 py-3 transition-all duration-200 hover:border-primary/50 hover:bg-primary/5 hover:shadow-[0_0_12px_-4px_hsl(var(--primary)/0.3)]"
            >
              <span className="flex items-center gap-2 font-mono text-sm text-foreground">
                <s.icon className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-primary" />
                {s.name}
              </span>
              <span className="flex items-center gap-2 font-mono text-xs text-primary">
                <span className="h-2 w-2 rounded-full bg-primary" />
                {s.status}
                <ExternalLink className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" />
              </span>
            </a>
          ))}
        </div>

        {/* Footer */}
        <p className="text-center font-mono text-xs text-muted-foreground">
          jessegroenendaal.nl
        </p>
      </div>
    </div>
  );
};

export default Index;
