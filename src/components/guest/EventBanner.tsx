import { eventKind, GRADIENT, MANTRA, type EventKind } from "./eventTheme";

/** Drawn banner for a function: marigolds for Haldi, henna mandala for Mehendi, lanterns for Sangeet and Reception, a mandap for the wedding. */

const petals = [0, 45, 90, 135];
function Flower({ x, y, r, a = "#ffb300", b = "#ff7a00" }: { x: number; y: number; r: number; a?: string; b?: string }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      {petals.map((d) => (
        <ellipse key={d} rx={r} ry={r * 0.42} fill={a} stroke={b} strokeWidth={0.6} transform={`rotate(${d})`} />
      ))}
      <circle r={r * 0.28} fill={b} />
    </g>
  );
}
function Lantern({ x, drop, c = "#ffd166" }: { x: number; drop: number; c?: string }) {
  return (
    <g>
      <line x1={x} y1={0} x2={x} y2={drop} stroke="#f1d27a" strokeWidth={1} />
      <rect x={x - 7} y={drop} width={14} height={22} rx={5} fill={c} stroke="#b8860b" strokeWidth={1} />
      <rect x={x - 3} y={drop - 4} width={6} height={4} fill="#b8860b" />
      <circle cx={x} cy={drop + 11} r={11} fill={c} opacity={0.25} />
    </g>
  );
}
const row = (n: number, w = 400) => Array.from({ length: n }, (_, i) => (i + 0.5) * (w / n));

function Scene({ kind }: { kind: EventKind }) {
  switch (kind) {
    case "haldi":
      return (
        <>
          {row(11).map((x, i) => <Flower key={`t${i}`} x={x} y={10 + (i % 2) * 10} r={13} />)}
          {row(9).map((x, i) => <Flower key={`b${i}`} x={x + 10} y={150 - (i % 2) * 8} r={14} a="#ffc933" b="#e8741a" />)}
          <circle cx={330} cy={62} r={30} fill="#fff4b0" opacity={0.55} />
          <circle cx={330} cy={62} r={18} fill="#ffe066" opacity={0.8} />
        </>
      );
    case "mehendi":
      return (
        <>
          <g transform="translate(320 78)" fill="none" stroke="#d9f2c2" strokeWidth={1.4} opacity={0.85}>
            {[48, 38, 28, 18].map((r) => <circle key={r} r={r} strokeDasharray={r > 30 ? "3 4" : undefined} />)}
            {Array.from({ length: 12 }, (_, i) => <ellipse key={i} rx={9} ry={22} cy={-36} transform={`rotate(${i * 30})`} />)}
          </g>
          {row(10).map((x, i) => <circle key={i} cx={x} cy={148 + (i % 2) * 4} r={3} fill="#d9f2c2" opacity={0.7} />)}
          {row(8).map((x, i) => <path key={i} d={`M${x} 8 q10 14 0 28 q-10 -14 0 -28`} fill="#a8d98a" opacity={0.55} />)}
        </>
      );
    case "sangeet":
      return (
        <>
          {[40, 95, 150, 205, 260, 315, 370].map((x, i) => <Lantern key={x} x={x} drop={14 + (i % 3) * 16} c={i % 2 ? "#ffd166" : "#ff9eb5"} />)}
          {[60, 130, 210, 290, 350].map((x, i) => <text key={x} x={x} y={70 + (i % 2) * 40} fill="#ffe6a8" fontSize={16} opacity={0.8}>♪</text>)}
        </>
      );
    case "wedding":
      return (
        <>
          <path d="M70 160 V60 q0 -34 66 -34 h128 q66 0 66 34 V160" fill="none" stroke="#f1d27a" strokeWidth={3} />
          <path d="M92 160 V70 q0 -26 56 -26 h104 q56 0 56 26 V160" fill="none" stroke="#f1d27a" strokeWidth={1.5} strokeDasharray="4 4" />
          {row(14, 240).map((x, i) => <Flower key={i} x={x + 80} y={30 + Math.abs(7 - i) * 2.2} r={9} />)}
          <path d="M200 150 q-14 -22 0 -42 q14 20 0 42z" fill="#ff7a00" />
          <path d="M200 148 q-7 -12 0 -24 q7 12 0 24z" fill="#ffe066" />
          <rect x={174} y={150} width={52} height={6} rx={3} fill="#c9961a" />
        </>
      );
    case "reception":
      return (
        <>
          {[55, 140, 260, 345].map((x, i) => <Lantern key={x} x={x} drop={10 + (i % 2) * 18} c="#ffd166" />)}
          <path d="M150 160 V90 q0 -50 50 -50 q50 0 50 50 V160" fill="#08283d" stroke="#f1d27a" strokeWidth={2.5} />
          {Array.from({ length: 18 }, (_, i) => <circle key={i} cx={(i * 47) % 400} cy={(i * 31) % 150} r={1.6} fill="#ffe6a8" opacity={0.6} />)}
        </>
      );
    default:
      return <>{row(12).map((x, i) => <Flower key={i} x={x} y={14 + (i % 2) * 8} r={12} />)}</>;
  }
}

export function EventBanner({ name, meaning, className = "" }: { name: string; meaning?: string; className?: string }) {
  const kind = eventKind(name);
  const [c1, c2] = GRADIENT[kind];
  const id = `g-${kind}`;
  return (
    <div className={`relative overflow-hidden rounded-t-2xl ${className}`} data-testid="event-banner" data-kind={kind}>
      <svg viewBox="0 0 400 160" preserveAspectRatio="xMidYMid slice" className="block h-40 w-full" aria-hidden>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={c1} />
            <stop offset="1" stopColor={c2} />
          </linearGradient>
        </defs>
        <rect width="400" height="160" fill={`url(#${id})`} />
        <Scene kind={kind} />
      </svg>
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 via-black/35 to-transparent px-4 pb-3 pt-10 text-center text-white">
        <p className="font-display text-2xl font-bold leading-none tracking-wide">{name}</p>
        <p lang="hi" className="mt-1 text-lg font-semibold text-amber-200" data-testid="mantra">
          {MANTRA[kind]}
        </p>
        {meaning && <p className="text-xs italic text-amber-50/90">{meaning}</p>}
      </div>
    </div>
  );
}
