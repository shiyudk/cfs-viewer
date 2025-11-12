import { supa } from "./supa";

// 한국어 계정명 매핑(필요하면 추가)
const ACC = {
  SALES: ["매출액", "매출", "영업수익"],
  OI:    ["영업이익"],
  NI:    ["당기순이익", "지배기업 소유주지분 순이익", "분기순이익"],
  EQUITY:["자본총계","자본","지배기업 소유주지분"]
};

function pick(list: any[], keys: string[]) {
  return list.find(r => keys.some(k => (r.line_items?.account_nm || "").includes(k)));
}

// 년도 리스트 가져오기
async function getYears(corp_code: string, fsDiv: "CFS"|"OFS") {
  const { data } = await supa.from("filings")
    .select("bsns_year").eq("corp_code", corp_code)
    .eq("fs_div", fsDiv).eq("reprt_code","11011")
    .order("bsns_year");
  return [...new Set((data||[]).map(d=>Number(d.bsns_year)))]; // 오름차순
}

export type FinRow = { year:number; sales?:number; oi?:number; ni?:number; equity?:number; roe?:number };

export async function getSeriesByStock(
  stock_code: string,
  fsDiv: "CFS"|"OFS" = "CFS"
): Promise<{ corp_code:string; name_kr:string; rows: FinRow[] }> {

  // 1) 종목 → 회사
  const { data: c } = await supa.from("companies")
    .select("corp_code,name_kr").eq("stock_code", stock_code).single();
  if (!c) throw new Error("회사 없음");

  const years = await getYears(c.corp_code, fsDiv);
  const rows: FinRow[] = [];

  for (const y of years) {
    // 2) 해당 연도 filing id
    const { data: f } = await supa.from("filings")
      .select("id").eq("corp_code", c.corp_code)
      .eq("fs_div", fsDiv).eq("reprt_code","11011")
      .eq("bsns_year", y).single();
    if (!f) continue;

    // 3) IS/BS 가져와서 골라 담기
    const { data: is } = await supa.from("facts")
      .select("thstrm_amount,line_items(account_nm,sj_div)")
      .eq("filing_id", f.id).eq("line_items.sj_div","IS").limit(9999);
    const { data: bs } = await supa.from("facts")
      .select("thstrm_amount,line_items(account_nm,sj_div)")
      .eq("filing_id", f.id).eq("line_items.sj_div","BS").limit(9999);

    const sales  = Number(pick(is||[], ACC.SALES)?.thstrm_amount ?? NaN);
    const oi     = Number(pick(is||[], ACC.OI   )?.thstrm_amount ?? NaN);
    const ni     = Number(pick(is||[], ACC.NI   )?.thstrm_amount ?? NaN);
    const equity = Number(pick(bs||[], ACC.EQUITY)?.thstrm_amount ?? NaN);

    rows.push({ year:y, sales, oi, ni, equity });
  }

  // 4) ROE = 당기순이익 / 평균자본총계
  for (let i=0;i<rows.length;i++){
    const eNow = rows[i].equity;
    const ePrev= i>0 ? rows[i-1].equity : undefined;
    const avgE = (eNow && ePrev) ? (eNow+ePrev)/2 : eNow || undefined;
    rows[i].roe = (rows[i].ni && avgE) ? rows[i].ni/avgE : undefined;
  }

  return { corp_code: c.corp_code, name_kr: c.name_kr, rows };
}

// 여러 종목 비교용
export async function getMultiSeries(stock_codes: string[], fsDiv:"CFS"|"OFS"="CFS"){
  const out: Record<string,{name:string; rows:FinRow[]}> = {};
  for (const sc of stock_codes) {
    try {
      const { name_kr, rows } = await getSeriesByStock(sc, fsDiv);
      out[sc] = { name: name_kr, rows };
    } catch {}
  }
  return out;
}