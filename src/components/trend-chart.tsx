"use client";

import { useState } from "react";
import type { Point } from "@/lib/trend";

const W = 720;
const H = 290;
const PAD = { l: 48, r: 12, t: 12, b: 28 };

const short = (v: number) => (v >= 100_000_000 ? `${(v / 100_000_000).toFixed(1)}억` : v >= 10_000 ? `${Math.round(v / 10_000).toLocaleString("ko-KR")}만` : `${v}`);
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
const won = (v: number) => `${v.toLocaleString("ko-KR")}원`;

// 보기 좋은 눈금 (1·2·5 단위)
function niceMax(v: number) {
  if (v <= 0) return 1;
  const step = 10 ** Math.floor(Math.log10(v / 4));
  const unit = [1, 2, 2.5, 5, 10].map((k) => k * step).find((s) => s * 4 >= v) ?? step * 10;
  return unit * 4;
}

// 최근 기간(파란 선)과 직전 기간(회색 점선)을 같은 순번끼리 겹쳐 그림
export function TrendChart({ cur, prev }: { cur: Point[]; prev: Point[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const n = cur.length;
  const max = niceMax(Math.max(...cur.map((p) => p.v), ...prev.map((p) => p.v)));
  const x = (i: number) => PAD.l + (i * (W - PAD.l - PAD.r)) / Math.max(n - 1, 1);
  const y = (v: number) => PAD.t + (1 - v / max) * (H - PAD.t - PAD.b);
  const line = (p: Point[]) => p.map((q, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(q.v).toFixed(1)}`).join("");
  const area = `${line(cur)}L${x(n - 1)},${y(0)}L${x(0)},${y(0)}Z`;
  const ticks = [0, 1, 2, 3, 4].map((k) => (max / 4) * k);
  const every = Math.ceil(n / 6);
  const h = hover == null ? null : { c: cur[hover], p: prev[hover] };

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full touch-none select-none"
        role="img"
        aria-label={`일별 광고비. 최근 ${n}일 파란 선, 직전 ${n}일 회색 점선`}
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const px = ((e.clientX - r.left) / r.width) * W;
          const i = Math.round(((px - PAD.l) / (W - PAD.l - PAD.r)) * (n - 1));
          setHover(i >= 0 && i < n ? i : null);
        }}
        onPointerLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id="trend-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2f6bff" stopOpacity="0.16" />
            <stop offset="100%" stopColor="#2f6bff" stopOpacity="0" />
          </linearGradient>
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} stroke="#edf1f7" />
            <text x={PAD.l - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="#8a97b0">{short(t)}</text>
          </g>
        ))}
        {cur.map((p, i) =>
          i % every === 0 || i === n - 1 ? (
            <text key={p.d} x={x(i)} y={H - 8} textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"} fontSize="11" fill="#8a97b0">{md(p.d)}</text>
          ) : null,
        )}
        <path d={line(prev)} fill="none" stroke="#b9c4d8" strokeWidth="1.6" strokeDasharray="4 4" />
        <path d={area} fill="url(#trend-fill)" />
        <path d={line(cur)} fill="none" stroke="#2f6bff" strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round" />
        {hover != null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={y(0)} stroke="#cfd9ea" />
            <circle cx={x(hover)} cy={y(prev[hover].v)} r="3.5" fill="#fff" stroke="#b9c4d8" strokeWidth="1.6" />
            <circle cx={x(hover)} cy={y(cur[hover].v)} r="4.5" fill="#fff" stroke="#2f6bff" strokeWidth="2.4" />
          </g>
        )}
        {hover == null && <circle cx={x(n - 1)} cy={y(cur[n - 1].v)} r="4" fill="#2f6bff" />}
      </svg>
      {h && (
        <div
          className="pointer-events-none absolute top-0 rounded-lg border border-[#e4eaf2] bg-white px-3 py-2 text-xs shadow-[0_8px_24px_rgba(20,33,64,.1)]"
          style={{ left: `${(x(hover!) / W) * 100}%`, transform: `translateX(${hover! > n / 2 ? "-105%" : "5%"})` }}
        >
          <p className="font-semibold"><span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-brand" />{md(h.c.d)} {won(h.c.v)}</p>
          <p className="mt-0.5 text-ink-soft"><span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-[#b9c4d8]" />{md(h.p.d)} {won(h.p.v)}</p>
        </div>
      )}
    </div>
  );
}
