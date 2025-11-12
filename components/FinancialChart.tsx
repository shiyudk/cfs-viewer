"use client";
import { LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, ComposedChart, Bar } from "recharts";

const trill = (n?:number)=> (n==null?undefined: n/1_000_000_000_000); // 조(兆) 단위
const pct = (n?:number)=> (n==null?undefined: n*100);

export default function FinancialChart({ data }:{ data: {year:number; sales?:number; oi?:number; ni?:number; roe?:number}[] }){
  const d = data.map(r=>({
    year: r.year,
    매출:  trill(r.sales),
    영업이익: trill(r.oi),
    순이익:  trill(r.ni),
    ROE:   pct(r.roe),
  }));
  return (
    <ResponsiveContainer width="100%" height={360}>
      <ComposedChart data={d} margin={{ left: 12, right: 12, top: 12 }}>
        <XAxis dataKey="year" />
        <YAxis yAxisId="left"  tickFormatter={(v)=>`${v}조`} />
        <YAxis yAxisId="right" orientation="right" tickFormatter={(v)=>`${v}%`} />
        <Tooltip formatter={(v:any, n:any)=> n==="ROE" ? `${(v as number).toFixed(1)}%` : `${(v as number).toFixed(2)}조`} />
        <Legend />
        <Bar  yAxisId="left"  dataKey="매출" />
        <Bar  yAxisId="left"  dataKey="영업이익" />
        <Bar  yAxisId="left"  dataKey="순이익" />
        <Line yAxisId="right" type="monotone" dataKey="ROE" dot />
      </ComposedChart>
    </ResponsiveContainer>
  );
}