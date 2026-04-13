export default function Loading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0d1b2e]">
      <div className="flex flex-col items-center gap-5 text-center text-white">
        <div className="relative flex h-20 w-20 items-center justify-center rounded-3xl bg-white/10 shadow-[0_10px_30px_rgba(0,0,0,0.25)] ring-1 ring-white/20">
          <div className="absolute inset-0 rounded-3xl border-2 border-cyan-300/60 animate-ping" />
          <span className="text-2xl font-bold tracking-wide">BB</span>
        </div>
        <div className="space-y-1">
          <p className="text-sm font-semibold text-cyan-100">BB Document Control</p>
          <p className="text-xs text-cyan-100/80">Loading...</p>
        </div>
        <div className="h-1.5 w-44 overflow-hidden rounded-full bg-white/15">
          <div className="h-full w-1/2 animate-[pulse_1.2s_ease-in-out_infinite] rounded-full bg-cyan-300" />
        </div>
      </div>
    </div>
  );
}
