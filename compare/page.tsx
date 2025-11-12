"use client";

import { useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
} from "recharts";

const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// KRW → 조원
const toCho = (x?: number | null) =>
  x == null ? null : Number(x) / 1_0000_0000_0000;

export default function Compare() {
  const [codes, setCodes] = useState("005930,000660,003550"); // 기본: 삼성전자, 하이닉스, LG
  const [fsDiv, setFsDiv] = useState<"CFS" | "OFS">("CFS");
  const [chartRows, setChartRows] = useState<any[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  const CANDS = {
    revenue: ["매출액", "수익(매출액)", "영업수익"],
    op: ["영업이익", "영업손실"],
    net: ["당기순이익", "분기순이익", "연결당기순이익"],
    equity: ["자본총계", "자본", "지배기업 소유주지분"],
  };

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const stockList = codes
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);

        const seriesByStock: Record<string, any[]> = {};
        const nameByStock: Record<string, string> = {};

        for (const stock of stockList) {
          const { data: c } = await supa
            .from("companies")
            .select("corp_code,name_kr")
            .eq("stock_code", stock)
            .single();
          if (!c) continue;
          nameByStock[stock] = c.name_kr;

          const { data: fs } = await supa
            .from("filings")
            .select("id,bsns_year")
            .eq("corp_code", c.corp_code)
            .eq("fs_div", fsDiv)
            .eq("reprt_code", "11011")
            .order("bsns_year");

          const years = (fs || []).map((f) => Number(f.bsns_year));
          const list: any[] = [];

          for (const y of years) {
            const { data: f } = await supa
              .from("filings")
              .select("id")
              .eq("corp_code", c.corp_code)
              .eq("fs_div", fsDiv)
              .eq("reprt_code", "11011")
              .eq("bsns_year", y)
              .single();
            if (!f) continue;

            const [{ data: rowsIS }, { data: rowsBS }] = await Promise.all([
              supa
                .from("facts")
                .select("thstrm_amount,line_items(account_nm,sj_div)")
                .eq("filing_id", f.id)
                .eq("line_items.sj_div", "IS")
                .limit(1500),
              supa
                .from("facts")
                .select("thstrm_amount,line_items(account_nm,sj_div)")
                .eq("filing_id", f.id)
                .eq("line_items.sj_div", "BS")
                .limit(1500),
            ]);

            const pick = (list: any[], keys: string[]) => {
              const found = list.find((r) =>
                keys.some((k) => (r.line_items?.account_nm || "").includes(k))
              );
              const v = found?.thstrm_amount;
              return v == null ? null : Number(v);
            };

            const revenue = pick(rowsIS || [], CANDS.revenue);
            const op = pick(rowsIS || [], CANDS.op);
            const net = pick(rowsIS || [], CANDS.net);
            const equity = pick(rowsBS || [], CANDS.equity);
            list.push({ year: y, revenue, op, net, equity });
          }

          // ROE 계산
          for (let i = 0; i < list.length; i++) {
            const eNow = list[i].equity;
            const ePrev = i > 0 ? list[i - 1].equity : undefined;
            const avgE =
              eNow && ePrev ? (eNow + ePrev) / 2 : eNow || undefined;
            const ni = list[i].net;
            list[i].roe = ni && avgE ? ni / avgE : null;
          }

          // 단위 변환
          const formatted = list.map((r) => ({
            year: r.year,
            매출: toCho(r.revenue),
            영업이익: toCho(r.op),
            ROE: r.roe ? r.roe * 100 : null,
          }));
          seriesByStock[stock] = formatted;
        }

        // 연도 병합
        const allYears = Array.from(
          new Set(
            Object.values(seriesByStock).flatMap((v) =>
              v.map((r: any) => r.year)
            )
          )
        ).sort();

        const merged = allYears.map((y) => {
          const row: any = { year: y };
          for (const s of Object.keys(seriesByStock)) {
            const found = seriesByStock[s].find((r) => r.year === y);
            if (found) {
              row[`${s}_매출`] = found.매출;
              row[`${s}_영업이익`] = found.영업이익;
              row[`${s}_ROE`] = found.ROE;
            }
          }
          return row;
        });

        setNames(nameByStock);
        setChartRows(merged);
      } finally {
        setLoading(false);
      }
    })();
  }, [codes, fsDiv]);

  return (
    <main style={{ padding: 24, maxWidth: 1200, margin: "0 auto" }}>
      <h1 style={{ fontSize: 26, fontWeight: 800 }}>업종 비교 (매출·영업이익·ROE)</h1>
      <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
        <input
          value={codes}
          onChange={(e) => setCodes(e.target.value)}
          placeholder="종목코드들 (쉼표로 구분, 예: 005930,000660,003550)"
          style={{ padding: 8, border: "1px solid #ddd", borderRadius: 8, width: 400 }}
        />
        <select
          value={fsDiv}
          onChange={(e) => setFsDiv(e.target.value as any)}
          style={{ padding: 8 }}
        >
          <option value="CFS">CFS(연결)</option>
          <option value="OFS">OFS(개별)</option>
        </select>
      </div>

      {loading && <p>불러오는 중…</p>}

      {/* 차트 */}
      <div style={{ width: "100%", height: 420, marginTop: 16 }}>
        <ResponsiveContainer>
          <LineChart data={chartRows}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="year" />
            <YAxis yAxisId="left" tickFormatter={(v) => `${v}조`} />
            <YAxis
              yAxisId="right"
              orientation="right"
              tickFormatter={(v) => `${v}%`}
            />
            <Tooltip />
            <Legend />
            {/* 종목별 매출 */}
            {Object.keys(names).map((code, i) => (
              <Line
                key={`${code}_매출`}
                yAxisId="left"
                type="monotone"
                dataKey={`${code}_매출`}
                name={`${names[code]} 매출`}
                strokeWidth={2}
              />
            ))}
            {/* 종목별 영업이익 */}
            {Object.keys(names).map((code) => (
              <Line
                key={`${code}_영업이익`}
                yAxisId="left"
                type="monotone"
                dataKey={`${code}_영업이익`}
                name={`${names[code]} 영업이익`}
                strokeDasharray="4 2"
              />
            ))}
            {/* 종목별 ROE */}
            {Object.keys(names).map((code) => (
              <Line
                key={`${code}_ROE`}
                yAxisId="right"
                type="monotone"
                dataKey={`${code}_ROE`}
                name={`${names[code]} ROE(%)`}
                dot
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </main>
  );
}