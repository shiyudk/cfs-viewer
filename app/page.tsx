"use client";

import { createClient } from "@supabase/supabase-js";
import { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
  Bar,
  Line,
} from "recharts";

/** Supabase (읽기용 anon key 사용) */
const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

/** 숫자 포맷 */
const nf = new Intl.NumberFormat("ko-KR");
const fmt = (v: any) => (v == null ? "-" : nf.format(Number(v)));

/** 보기 좋은 단위(조 원) */
const toCho = (x?: number | null) =>
  x == null ? null : Number(x) / 1_0000_0000_0000; // KRW → 조원(1e12)
const tickCho = (v: number) => `${v}조`;

type Filing = { id: number; bsns_year: number };

export default function Home() {
  const [stock, setStock] = useState("005930"); // 기본: 삼성전자
  const [fsDiv, setFsDiv] = useState<"CFS" | "OFS">("CFS");
  const [sjDiv, setSjDiv] = useState<"IS" | "BS" | "CF">("BS");

  const [corpCode, setCorpCode] = useState<string | null>(null);
  const [corpName, setCorpName] = useState<string>("");

  const [years, setYears] = useState<number[]>([]);
  const [year, setYear] = useState<number | null>(null);

  const [tableRows, setTableRows] = useState<any[]>([]);
  const [chartRows, setChartRows] = useState<
    Array<{ year: number; revenue?: number | null; op?: number | null; net?: number | null; roe?: number | null }>
  >([]);
  const [loading, setLoading] = useState(false);

  /** 계정명 후보 (회사별 표기 다를 수 있어 넉넉히) */
  const CANDS = {
    revenue: ["매출액", "수익(매출액)", "영업수익"],
    op: ["영업이익", "영업손실"],
    net: ["당기순이익", "분기순이익", "연결당기순이익", "당기순손실"],
    equity: ["자본총계", "자본", "지배기업 소유주지분"], // ROE 계산용
  };

  /** 종목코드 → 회사/연도 목록 */
  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const { data: c, error: e1 } = await supa
          .from("companies")
          .select("corp_code,name_kr")
          .eq("stock_code", stock)
          .single();
        if (e1 || !c) {
          setCorpCode(null);
          setYears([]);
          setTableRows([]);
          setChartRows([]);
          setCorpName("");
          return;
        }
        setCorpCode(c.corp_code);
        setCorpName(c.name_kr);

        const { data: fs, error: e2 } = await supa
          .from("filings")
          .select("id,bsns_year")
          .eq("corp_code", c.corp_code)
          .eq("fs_div", fsDiv)
          .eq("reprt_code", "11011") // 연간
          .order("bsns_year", { ascending: false });

        if (e2 || !fs?.length) {
          setYears([]);
          setTableRows([]);
          setChartRows([]);
          return;
        }

        // 최근 연도 우선: 최근 5개만 사용(원하면 늘리세요)
        const ys = [...new Set(fs.map((f: Filing) => Number(f.bsns_year)))].slice(0, 5);
        setYears(ys);
        setYear(ys[0] ?? null);
      } finally {
        setLoading(false);
      }
    })();
  }, [stock, fsDiv]);

  /** 선택된 연도+분류 → 표 데이터 */
  useEffect(() => {
    if (!corpCode || !year) return;
    (async () => {
      setLoading(true);
      try {
        const { data: f } = await supa
          .from("filings")
          .select("id")
          .eq("corp_code", corpCode)
          .eq("fs_div", fsDiv)
          .eq("reprt_code", "11011")
          .eq("bsns_year", year)
          .single();
        if (!f) return;

        const { data } = await supa
          .from("facts")
          .select("thstrm_amount,line_items(account_nm,sj_div)")
          .eq("filing_id", f.id)
          .eq("line_items.sj_div", sjDiv)
          .limit(1000);
        setTableRows(data || []);
      } finally {
        setLoading(false);
      }
    })();
  }, [corpCode, year, fsDiv, sjDiv]);

  /** 그래프용: 최근 연도들 IS + BS 함께 모아 ROE까지 계산 */
  useEffect(() => {
    if (!corpCode || !years.length) return;

    (async () => {
      setLoading(true);
      try {
        const pickAmount = (list: any[], keys: string[]) => {
          const found = list?.find((r) => {
            const nm = r?.line_items?.account_nm || "";
            return keys.some((k) => nm.includes(k));
          });
          const v = found?.thstrm_amount ?? null;
          return v == null ? null : Number(v);
        };

        const ysAsc = years.slice().reverse(); // 오래된 → 최신
        const series: Array<{ year: number; revenue?: number | null; op?: number | null; net?: number | null; equity?: number | null; roe?: number | null }> = [];

        for (const y of ysAsc) {
          const { data: f } = await supa
            .from("filings")
            .select("id")
            .eq("corp_code", corpCode)
            .eq("fs_div", fsDiv)
            .eq("reprt_code", "11011")
            .eq("bsns_year", y)
            .single();
          if (!f) continue;

          // IS & BS 동시에 조회
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

          const revenue = pickAmount(rowsIS || [], CANDS.revenue);
          const op = pickAmount(rowsIS || [], CANDS.op);
          const net = pickAmount(rowsIS || [], CANDS.net);
          const equity = pickAmount(rowsBS || [], CANDS.equity); // 자본총계

          series.push({ year: y, revenue, op, net, equity });
        }

        // ROE = 당기순이익 / 평균자본총계 (전년 데이터 있으면 평균, 없으면 해당 연도 자본)
        for (let i = 0; i < series.length; i++) {
          const eNow = series[i].equity ?? undefined;
          const ePrev = i > 0 ? series[i - 1].equity ?? undefined : undefined;
          const avgE = eNow && ePrev ? (eNow + ePrev) / 2 : eNow || undefined;
          const ni = series[i].net ?? undefined;
          series[i].roe = ni && avgE ? ni / avgE : null;
        }

        // 차트 데이터(조원 + %)
        const chart = series.map((r) => ({
          year: r.year,
          revenue: toCho(r.revenue),
          op: toCho(r.op),
          net: toCho(r.net),
          roe: r.roe != null ? r.roe * 100 : null, // %
        }));

        setChartRows(chart);
      } finally {
        setLoading(false);
      }
    })();
    // years 배열 비교 최적화용
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [corpCode, fsDiv, years.join(",")]);

  const title = useMemo(() => {
    const map = { IS: "손익계산서", BS: "재무상태표", CF: "현금흐름표" } as const;
    return `${corpName || stock} · ${fsDiv} · ${map[sjDiv]} · ${year ?? ""}`;
  }, [corpName, fsDiv, sjDiv, year, stock]);

  return (
    <main style={{ padding: 24, maxWidth: 1200, margin: "0 auto" }}>
      <h1 style={{ fontSize: 28, fontWeight: 800, marginBottom: 8 }}>
        연결 재무제표 뷰어
      </h1>

      {/* 컨트롤 */}
      <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
        <input
          value={stock}
          onChange={(e) => setStock(e.target.value)}
          placeholder="종목코드 (예: 005930)"
          style={{ padding: 8, border: "1px solid #ddd", borderRadius: 8 }}
        />
        <select value={fsDiv} onChange={(e) => setFsDiv(e.target.value as any)} style={{ padding: 8 }}>
          <option value="CFS">CFS(연결)</option>
          <option value="OFS">OFS(개별)</option>
        </select>
        <div>
          {(["IS", "BS", "CF"] as const).map((k) => (
            <button
              key={k}
              onClick={() => setSjDiv(k)}
              style={{
                padding: "8px 12px",
                marginRight: 6,
                borderRadius: 8,
                border: "1px solid #ddd",
                background: sjDiv === k ? "#eef" : "white",
              }}
            >
              {k}
            </button>
          ))}
        </div>
        <select
          value={year ?? ""}
          onChange={(e) => setYear(Number(e.target.value))}
          style={{ padding: 8 }}
        >
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </div>

      <h2 style={{ marginTop: 16 }}>{title}</h2>
      {loading && <p>불러오는 중…</p>}

      {/* 표 */}
      <table style={{ marginTop: 12, width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={{ padding: 12, border: "1px solid #bbb", width: "50%" }}>항목</th>
            <th style={{ padding: 12, border: "1px solid #bbb" }}>당기</th>
          </tr>
        </thead>
        <tbody>
          {tableRows?.map((r, i) => (
            <tr key={i}>
              <td style={{ padding: 12, border: "1px solid #eee" }}>
                {r.line_items?.account_nm}
              </td>
              <td style={{ padding: 12, border: "1px solid #eee", textAlign: "right" }}>
                {fmt(r.thstrm_amount)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* 그래프: 최근 연도 추세 (조원 + ROE %) */}
      <section style={{ marginTop: 28 }}>
        <h3 style={{ fontSize: 20, marginBottom: 8 }}>
          최근 연도 추세 (조 원) — 매출/영업이익/당기순이익 &nbsp;·&nbsp; ROE(%)
        </h3>
        <div style={{ width: "100%", height: 360, border: "1px solid #eee", borderRadius: 8 }}>
          <ResponsiveContainer>
            <ComposedChart data={chartRows}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="year" />
              {/* 좌측: 금액(조 원), 우측: ROE(%) */}
              <YAxis yAxisId="left" tickFormatter={tickCho} />
              <YAxis yAxisId="right" orientation="right" tickFormatter={(v) => `${v}%`} />
              <Tooltip
                formatter={(v: any, name: any) =>
                  name === "ROE" ? `${Number(v).toFixed(1)} %` : `${Number(v).toFixed(2)} 조원`
                }
                labelFormatter={(l) => `${l}년`}
              />
              <Legend />
              {/* 금액(좌측 축) */}
              <Bar  yAxisId="left"  dataKey="revenue" name="매출" />
              <Line yAxisId="left"  type="monotone" dataKey="op"  name="영업이익" />
              <Line yAxisId="left"  type="monotone" dataKey="net" name="당기순이익" />
              {/* ROE(우측 축) */}
              <Line yAxisId="right" type="monotone" dataKey="roe" name="ROE" dot />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </section>
    </main>
  );
}
