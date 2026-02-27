const Index = () => {
  const services = [
    { name: "Proxmox", status: "online" },
    { name: "Docker", status: "online" },
    { name: "Nginx Proxy", status: "online" },
  ];

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background p-6">
      <div className="w-full max-w-lg space-y-8 animate-fade-in-up">
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
              Welcome to my homelab. This domain is a gateway to self-hosted
              services and experiments.
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
            <div
              key={s.name}
              className="flex items-center justify-between rounded-md border border-border bg-card px-4 py-3"
            >
              <span className="font-mono text-sm text-foreground">
                {s.name}
              </span>
              <span className="flex items-center gap-2 font-mono text-xs text-primary">
                <span className="h-2 w-2 rounded-full bg-primary" />
                {s.status}
              </span>
            </div>
          ))}
        </div>

        {/* Footer */}
        <p className="text-center font-mono text-xs text-muted-foreground">
          Powered by curiosity & open source
        </p>
      </div>
    </div>
  );
};

export default Index;
