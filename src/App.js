import { useState, useEffect } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { createClient } from "@supabase/supabase-js";

// ====== Supabase ======
const supabaseUrl = process.env.REACT_APP_SUPABASE_URL;
const supabaseKey = process.env.REACT_APP_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);
const BUCKET = "chart-images";

// ====== DB ======
async function dbLoad() {
  const { data, error } = await supabase.from("chart_studies").select("*");
  if (error) { console.error(error); return []; }
  return data.map(r => r.data);
}
async function dbSave(items) {
  await supabase.from("chart_studies").delete().neq("id", 0);
  if (!items.length) return;
  await supabase.from("chart_studies").insert(items.map(item => ({ id: item.id, data: item })));
}

// ====== Storage ======
async function uploadChart(file, studyId, type) {
  const ext = file.name.split(".").pop();
  const path = `${studyId}/${type}_${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: true });
  if (error) { console.error(error); return null; }
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}
async function deleteChart(url) {
  if (!url) return;
  const path = url.split(`${BUCKET}/`)[1];
  if (path) await supabase.storage.from(BUCKET).remove([path]);
}

// ====== 定数 ======
const MATERIAL_TYPES = [
  "決算上振れ", "業績修正上方", "自社株買い", "テーマ相場",
  "需給・空売り", "株主優待", "M&A・提携", "新製品・サービス", "その他"
];
const MATERIAL_FRESHNESS = ["当日", "1〜3日前", "1週間以内"];
const PULLBACK_TYPES = ["初押し", "2番底", "3番底", "その他"];
const VOLUME_MULT = ["2倍以上", "3倍以上", "5倍以上", "10倍以上"];
const SECTORS = [
  "半導体", "防衛", "インバウンド", "金融", "製薬",
  "エネルギー", "自動車", "商社", "不動産", "IT・SaaS", "その他"
];
const OPTIONS = {
  candle: ["上昇中", "押し目形成中", "下落反発確認", "その他"],
  ema: ["5>20>40", "40>5>20", "その他"],
  volume: ["増加中", "その他"],
  macd: ["右肩上がり0以上", "右肩上がり0以下", "その他"],
  mtm: ["上昇中0以上", "上昇中0以下"],
  rsi: ["40以下", "40以上", "70以上"],
  cci: ["100超え", "0超え", "0以下"],
  dmi: ["30以上", "25以上", "その他"],
};
const LABEL = { candle: "ローソク足", ema: "EMA", volume: "出来高", macd: "MACD", mtm: "MTM", rsi: "RSI", cci: "CCI", dmi: "DMI" };
const RISE_FILTERS = [
  { label: "すべて", min: null },
  { label: "+5%以上", min: 5 },
  { label: "+10%以上", min: 10 },
  { label: "+20%以上", min: 20 },
  { label: "+30%以上", min: 30 },
];

const initialForm = {
  ticker: "", name: "",
  sectors: [], materialTypes: [], materialFreshness: "", materialNote: "",
  prevClose: "", openPrice: "", volumeMult: "", pullbackType: "", pullbackDays: "",
  candle: "", ema: "", volume: "", macd: "", mtm: "", rsi: "", cci: "", dmi: "",
  startPrice: "", highPrice: "",
  days: "", note: "",
  chartDaily: "", chartMin5: "",
  status: "watching",
};

// ====== 計算 ======
function calcGapPct(prevClose, openPrice) {
  const pc = parseFloat(prevClose), op = parseFloat(openPrice);
  if (!pc || !op) return null;
  return (((op - pc) / pc) * 100).toFixed(2);
}
function calcRisePct(startPrice, highPrice) {
  const s = parseFloat(startPrice), h = parseFloat(highPrice);
  if (!s || !h || s >= h) return null;
  return (((h - s) / s) * 100).toFixed(1);
}

// ====== UI部品 ======
function Toast({ msg, onDone }) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { const t = setTimeout(onDone, 2200); return () => clearTimeout(t); }, []);
  return <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-emerald-600 text-white px-5 py-2.5 rounded-xl shadow-lg text-sm font-medium">✅ {msg}</div>;
}
function MultiSelect({ options, selected = [], onChange, colorOn = "bg-indigo-600 text-white border-indigo-500" }) {
  const toggle = v => onChange(selected.includes(v) ? selected.filter(x => x !== v) : [...selected, v]);
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map(o => {
        const on = selected.includes(o);
        return <button key={o} onClick={() => toggle(o)} className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${on ? colorOn : "bg-gray-800 text-gray-400 border-gray-700"}`}>{o}</button>;
      })}
    </div>
  );
}
function ChartUploader({ label, url, onUpload, onDelete, uploading }) {
  return (
    <div>
      <div className="text-xs text-gray-400 mb-1">{label}</div>
      {url ? (
        <div className="relative">
          <img src={url} alt={label} className="w-full rounded-xl object-cover max-h-48 bg-gray-800" />
          <button onClick={onDelete} className="absolute top-2 right-2 bg-rose-700 hover:bg-rose-600 text-white text-xs px-2 py-1 rounded-lg">削除</button>
        </div>
      ) : (
        <label className={`flex flex-col items-center justify-center w-full h-24 border-2 border-dashed rounded-xl cursor-pointer transition-colors ${uploading ? "border-indigo-400 bg-indigo-900/20" : "border-gray-700 hover:border-gray-500 bg-gray-800/50"}`}>
          <span className="text-2xl mb-1">{uploading ? "⏳" : "📷"}</span>
          <span className="text-xs text-gray-400">{uploading ? "アップロード中…" : "タップして画像を選択"}</span>
          <input type="file" accept="image/*" className="hidden" onChange={onUpload} disabled={uploading} />
        </label>
      )}
    </div>
  );
}
function RiseBadge({ pct }) {
  if (pct === null) return <span className="text-xs bg-gray-700 text-gray-400 px-2 py-0.5 rounded-full">観察中</span>;
  const n = parseFloat(pct);
  const color = n >= 20 ? "bg-emerald-500" : n >= 10 ? "bg-emerald-700" : n >= 5 ? "bg-sky-700" : "bg-gray-700";
  return <span className={`text-xs text-white px-2 py-0.5 rounded-full font-bold ${color}`}>+{pct}%</span>;
}
function GapBadge({ pct }) {
  if (!pct) return null;
  const n = parseFloat(pct);
  const color = n > 0 ? "text-emerald-400" : n < 0 ? "text-rose-400" : "text-gray-400";
  return <span className={`text-xs font-bold ${color}`}>{n > 0 ? "+" : ""}{pct}% {n > 0 ? "GU" : n < 0 ? "GD" : ""}</span>;
}

// ====== 詳細モーダル ======
function DetailModal({ study, onClose, onEdit }) {
  const gap = calcGapPct(study.prevClose, study.openPrice);
  const rise = calcRisePct(study.startPrice, study.highPrice);
  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-end justify-center" onClick={onClose}>
      <div className="bg-gray-900 w-full max-w-lg rounded-t-2xl p-5 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xl font-bold">{study.ticker}</span>
            {study.name && <span className="text-gray-400">{study.name}</span>}
            <RiseBadge pct={rise} />
          </div>
          <div className="flex gap-2">
            <button onClick={() => { onClose(); onEdit(study); }} className="text-xs bg-indigo-700 hover:bg-indigo-600 text-white px-3 py-1.5 rounded-lg">編集</button>
            <button onClick={onClose} className="text-xs bg-gray-700 hover:bg-gray-600 text-white px-3 py-1.5 rounded-lg">閉じる</button>
          </div>
        </div>
        <div className="text-xs text-gray-500 mb-3">{study.createdAt}</div>

        {/* セクター・材料 */}
        {study.sectors?.length > 0 && <div className="flex flex-wrap gap-1 mb-2">{study.sectors.map(s => <span key={s} className="text-xs bg-violet-900/50 text-violet-300 px-2 py-0.5 rounded-full">{s}</span>)}</div>}
        {study.materialTypes?.length > 0 && <div className="flex flex-wrap gap-1 mb-2">{study.materialTypes.map(t => <span key={t} className="text-xs bg-yellow-900/50 text-yellow-300 px-2 py-0.5 rounded-full">💡{t}</span>)}</div>}
        {study.materialNote && <div className="text-xs text-yellow-300 bg-yellow-900/30 rounded-lg px-3 py-2 mb-3">📝 {study.materialNote}</div>}

        {/* チャート画像 */}
        {(study.chartDaily || study.chartMin5) && (
          <div className="grid grid-cols-2 gap-2 mb-3">
            {study.chartDaily && <div><div className="text-xs text-gray-500 mb-1">日足</div><img src={study.chartDaily} alt="日足" className="w-full rounded-lg object-cover max-h-40 bg-gray-800 cursor-pointer" onClick={() => window.open(study.chartDaily, "_blank")} /></div>}
            {study.chartMin5 && <div><div className="text-xs text-gray-500 mb-1">5分足</div><img src={study.chartMin5} alt="5分足" className="w-full rounded-lg object-cover max-h-40 bg-gray-800 cursor-pointer" onClick={() => window.open(study.chartMin5, "_blank")} /></div>}
          </div>
        )}

        {/* 寄り・出来高・押し目 */}
        <div className="bg-gray-800 rounded-xl p-3 mb-3 grid grid-cols-2 gap-2 text-xs">
          {gap && <div><span className="text-gray-400">ギャップ: </span><GapBadge pct={gap} /></div>}
          {study.volumeMult && <div><span className="text-gray-400">出来高: </span><span className="text-sky-300">{study.volumeMult}</span></div>}
          {study.pullbackType && <div><span className="text-gray-400">押し目: </span><span className="text-orange-300">{study.pullbackType}{study.pullbackDays ? `(${study.pullbackDays}日)` : ""}</span></div>}
          {study.materialFreshness && <div><span className="text-gray-400">材料: </span><span>{study.materialFreshness}</span></div>}
        </div>

        {/* 指標 */}
        <div className="flex flex-wrap gap-1 mb-3">
          {Object.keys(OPTIONS).map(k => study[k] ? <span key={k} className="text-xs bg-gray-800 px-2 py-0.5 rounded-full text-gray-300">{LABEL[k]}: {study[k]}</span> : null)}
        </div>

        {/* 価格・上昇率 */}
        <div className="bg-gray-800 rounded-xl p-3 mb-3 grid grid-cols-3 gap-2 text-center text-xs">
          <div><div className="text-gray-400 mb-0.5">上昇開始</div><div className="font-bold text-white">{study.startPrice ? `${study.startPrice}円` : "-"}</div></div>
          <div><div className="text-gray-400 mb-0.5">最高値</div><div className="font-bold text-emerald-400">{study.highPrice ? `${study.highPrice}円` : "-"}</div></div>
          <div><div className="text-gray-400 mb-0.5">上昇率</div><div className="font-bold text-emerald-400">{rise ? `+${rise}%` : "-"}</div></div>
        </div>
        {study.days && <div className="text-xs text-gray-400 bg-gray-800 rounded-lg px-3 py-2 mb-3">📅 達成日数: {study.days}日</div>}
        {study.note && <div className="text-xs text-gray-400 bg-gray-800 rounded-lg px-3 py-2">📝 {study.note}</div>}
      </div>
    </div>
  );
}

// ====== 統計ページ ======
function StatsPage({ studies }) {
  const [riseFilter, setRiseFilter] = useState(null);
  const recorded = studies.filter(s => calcRisePct(s.startPrice, s.highPrice) !== null);
  const filtered = riseFilter ? recorded.filter(s => parseFloat(calcRisePct(s.startPrice, s.highPrice)) >= riseFilter) : recorded;

  if (recorded.length === 0) return <div className="text-center text-gray-500 py-20">記録済みのデータがまだありません</div>;

  const avgRise = filtered.length > 0 ? (filtered.reduce((s, x) => s + parseFloat(calcRisePct(x.startPrice, x.highPrice)), 0) / filtered.length).toFixed(1) : "-";

  function heatmap(keyFn, keys) {
    return keys.map(k => {
      const rel = filtered.filter(s => keyFn(s, k));
      if (!rel.length) return null;
      const avg = (rel.reduce((s, x) => s + parseFloat(calcRisePct(x.startPrice, x.highPrice)), 0) / rel.length).toFixed(1);
      return { label: k, count: rel.length, avg: parseFloat(avg) };
    }).filter(Boolean).sort((a, b) => b.avg - a.avg);
  }

  const indicatorMap = Object.keys(OPTIONS).flatMap(key =>
    OPTIONS[key].map(opt => {
      const rel = filtered.filter(s => s[key] === opt);
      if (!rel.length) return null;
      const avg = (rel.reduce((s, x) => s + parseFloat(calcRisePct(x.startPrice, x.highPrice)), 0) / rel.length).toFixed(1);
      return { label: `${LABEL[key]}: ${opt}`, count: rel.length, avg: parseFloat(avg) };
    }).filter(Boolean)
  ).sort((a, b) => b.avg - a.avg);

  const materialMap = heatmap((s, k) => s.materialTypes?.includes(k), MATERIAL_TYPES);
  const sectorMap = heatmap((s, k) => s.sectors?.includes(k), SECTORS);
  const pullbackMap = heatmap((s, k) => s.pullbackType === k, PULLBACK_TYPES);
  const volumeMap = heatmap((s, k) => s.volumeMult === k, VOLUME_MULT);

  const HeatRow = ({ d }) => {
    const color = d.avg >= 20 ? "bg-emerald-500" : d.avg >= 10 ? "bg-emerald-700" : d.avg >= 5 ? "bg-sky-700" : "bg-gray-600";
    const width = Math.min(d.avg / 40 * 100, 100);
    return (
      <div className="flex items-center gap-2">
        <div className="text-xs text-gray-300 w-40 shrink-0 truncate">{d.label}</div>
        <div className="flex-1 h-5 bg-gray-800 rounded-full overflow-hidden">
          <div className={`h-5 ${color} rounded-full flex items-center justify-end pr-2`} style={{ width: `${width}%` }}>
            <span className="text-xs text-white font-bold">+{d.avg}%</span>
          </div>
        </div>
        <div className="text-xs text-gray-400 w-8 text-right shrink-0">{d.count}件</div>
      </div>
    );
  };

  const chartData = [
    { r: "+5%未満", c: 0 }, { r: "+5〜10%", c: 0 }, { r: "+10〜20%", c: 0 }, { r: "+20〜30%", c: 0 }, { r: "+30%以上", c: 0 }
  ];
  recorded.forEach(s => {
    const r = parseFloat(calcRisePct(s.startPrice, s.highPrice));
    if (r < 5) chartData[0].c++;
    else if (r < 10) chartData[1].c++;
    else if (r < 20) chartData[2].c++;
    else if (r < 30) chartData[3].c++;
    else chartData[4].c++;
  });

  return (
    <div className="space-y-5">
      {/* 上昇率フィルター */}
      <div className="bg-gray-900 rounded-2xl p-4">
        <div className="text-xs text-gray-400 mb-2">上昇率フィルター</div>
        <div className="flex flex-wrap gap-1.5">
          {RISE_FILTERS.map(f => (
            <button key={f.label} onClick={() => setRiseFilter(f.min)}
              className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors ${riseFilter === f.min ? "bg-emerald-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* サマリー */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-gray-900 rounded-2xl p-4 text-center"><div className="text-xs text-gray-400 mb-1">対象件数</div><div className="text-xl font-bold text-white">{filtered.length}件</div></div>
        <div className="bg-gray-900 rounded-2xl p-4 text-center"><div className="text-xs text-gray-400 mb-1">平均上昇率</div><div className="text-xl font-bold text-emerald-400">{avgRise !== "-" ? `+${avgRise}%` : "-"}</div></div>
      </div>

      {/* 分布 */}
      <div className="bg-gray-900 rounded-2xl p-4">
        <h3 className="text-sm font-semibold text-indigo-300 mb-3">📊 上昇率の分布</h3>
        <ResponsiveContainer width="100%" height={150}>
          <BarChart data={chartData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
            <XAxis dataKey="r" tick={{ fontSize: 9, fill: "#9ca3af" }} />
            <YAxis tick={{ fontSize: 10, fill: "#9ca3af" }} />
            <Tooltip contentStyle={{ background: "#1f2937", border: "none", borderRadius: "8px", fontSize: "12px" }} />
            <Bar dataKey="c" name="件数" radius={[4, 4, 0, 0]}>
              {chartData.map((d, i) => <Cell key={i} fill={i >= 3 ? "#34d399" : i >= 2 ? "#60a5fa" : i >= 1 ? "#818cf8" : "#6b7280"} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {indicatorMap.length > 0 && <div className="bg-gray-900 rounded-2xl p-4"><h3 className="text-sm font-semibold text-indigo-300 mb-3">📈 指標別平均上昇率</h3><div className="space-y-2">{indicatorMap.map(d => <HeatRow key={d.label} d={d} />)}</div></div>}
      {materialMap.length > 0 && <div className="bg-gray-900 rounded-2xl p-4"><h3 className="text-sm font-semibold text-indigo-300 mb-3">💡 材料タイプ別平均上昇率</h3><div className="space-y-2">{materialMap.map(d => <HeatRow key={d.label} d={d} />)}</div></div>}
      {sectorMap.length > 0 && <div className="bg-gray-900 rounded-2xl p-4"><h3 className="text-sm font-semibold text-indigo-300 mb-3">🏭 セクター別平均上昇率</h3><div className="space-y-2">{sectorMap.map(d => <HeatRow key={d.label} d={d} />)}</div></div>}
      {pullbackMap.length > 0 && <div className="bg-gray-900 rounded-2xl p-4"><h3 className="text-sm font-semibold text-indigo-300 mb-3">📉 押し目タイプ別平均上昇率</h3><div className="space-y-2">{pullbackMap.map(d => <HeatRow key={d.label} d={d} />)}</div></div>}
      {volumeMap.length > 0 && <div className="bg-gray-900 rounded-2xl p-4"><h3 className="text-sm font-semibold text-indigo-300 mb-3">📊 出来高倍率別平均上昇率</h3><div className="space-y-2">{volumeMap.map(d => <HeatRow key={d.label} d={d} />)}</div></div>}
    </div>
  );
}

// ====== メイン ======
export default function App() {
  const [page, setPage] = useState("list");
  const [studies, setStudies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(initialForm);
  const [editId, setEditId] = useState(null);
  const [toast, setToast] = useState(null);
  const [modal, setModal] = useState(null);
  const [listFilter, setListFilter] = useState(null);
  const [uploading, setUploading] = useState({ daily: false, min5: false });

  useEffect(() => {
    dbLoad().then(d => { setStudies(d); setLoading(false); });
  }, []);

  const showToast = msg => setToast(msg);
  const persist = async d => { setStudies([...d]); await dbSave(d); };

  const hfc = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const risePct = calcRisePct(form.startPrice, form.highPrice);
  const gapPct = calcGapPct(form.prevClose, form.openPrice);

  const handleChartUpload = async (e, type) => {
    const file = e.target.files?.[0]; if (!file) return;
    const id = editId || form._tmpId || (() => { const tmp = Date.now(); setForm(f => ({ ...f, _tmpId: tmp })); return tmp; })();
    setUploading(u => ({ ...u, [type]: true }));
    const url = await uploadChart(file, id, type);
    if (url) setForm(f => ({ ...f, [type === "daily" ? "chartDaily" : "chartMin5"]: url }));
    setUploading(u => ({ ...u, [type]: false }));
  };
  const handleChartDelete = async type => {
    const key = type === "daily" ? "chartDaily" : "chartMin5";
    await deleteChart(form[key]);
    setForm(f => ({ ...f, [key]: "" }));
  };

  const handleSave = async () => {
    if (!form.ticker) return;
    const now = new Date().toLocaleDateString("ja-JP");
    const ex = studies.find(s => s.id === editId);
    const rise = calcRisePct(form.startPrice, form.highPrice);
    const status = rise !== null ? "recorded" : "watching";
    const entry = { ...form, id: editId || form._tmpId || Date.now(), createdAt: ex?.createdAt || now, status };
    delete entry._tmpId;
    await persist(editId ? studies.map(s => s.id === editId ? entry : s) : [...studies, entry]);
    setForm(initialForm); setEditId(null);
    showToast(editId ? "更新しました" : "保存しました");
    setPage("list");
  };

  const handleEdit = s => { setForm({ ...s, materialTypes: s.materialTypes || [], sectors: s.sectors || [] }); setEditId(s.id); setPage("input"); };
  const handleDelete = async id => {
    const s = studies.find(x => x.id === id);
    if (s) { await deleteChart(s.chartDaily); await deleteChart(s.chartMin5); }
    await persist(studies.filter(x => x.id !== id));
    showToast("削除しました");
  };

  const watching = studies.filter(s => s.status === "watching").length;
  const filtStudies = listFilter !== null
    ? studies.filter(s => { const r = calcRisePct(s.startPrice, s.highPrice); return r !== null && parseFloat(r) >= listFilter; })
    : studies;

  const NBtn = ({ p, label, badge }) => (
    <button onClick={() => setPage(p)} className={`relative px-3 py-2 rounded-lg text-sm font-medium transition-colors ${page === p ? "bg-indigo-600 text-white" : "bg-gray-800 text-gray-300 hover:bg-gray-700"}`}>
      {label}{badge > 0 && <span className="absolute -top-1 -right-1 bg-sky-500 text-white text-xs w-4 h-4 rounded-full flex items-center justify-center">{badge}</span>}
    </button>
  );
  const FBtn = ({ val, label }) => (
    <button onClick={() => setListFilter(val)} className={`text-xs px-3 py-1 rounded-full font-medium transition-colors ${listFilter === val ? "bg-emerald-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}>{label}</button>
  );

  if (loading) return <div className="min-h-screen bg-gray-950 flex items-center justify-center text-gray-400 text-sm">読み込み中…</div>;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-sans">
      {toast && <Toast msg={toast} onDone={() => setToast(null)} />}
      {modal && <DetailModal study={modal} onClose={() => setModal(null)} onEdit={s => { setModal(null); handleEdit(s); }} />}

      <div className="max-w-4xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-xl font-bold">📚 チャート勉強アプリ</h1>
          <div className="flex gap-1.5">
            <NBtn p="input" label="＋" badge={0} />
            <NBtn p="list" label="一覧" badge={0} />
            <NBtn p="stats" label="統計" badge={watching} />
          </div>
        </div>

        {/* ====== 入力ページ ====== */}
        {page === "input" && (
          <div className="space-y-5">
            {/* 銘柄情報 */}
            <div className="bg-gray-900 rounded-2xl p-5 space-y-4">
              <h2 className="text-base font-semibold text-indigo-300">銘柄情報</h2>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-xs text-gray-400 mb-1 block">コード *</label><input className="w-full bg-gray-800 rounded-lg px-3 py-2 text-sm" value={form.ticker} onChange={e => hfc("ticker", e.target.value)} placeholder="例: 7203" /></div>
                <div><label className="text-xs text-gray-400 mb-1 block">銘柄名</label><input className="w-full bg-gray-800 rounded-lg px-3 py-2 text-sm" value={form.name} onChange={e => hfc("name", e.target.value)} placeholder="例: トヨタ" /></div>
              </div>
              <div>
                <label className="text-xs text-gray-400 mb-2 block">セクター（複数選択可）</label>
                <MultiSelect options={SECTORS} selected={form.sectors} onChange={v => hfc("sectors", v)} colorOn="bg-violet-700 text-white border-violet-500" />
              </div>
            </div>

            {/* チャート画像 */}
            <div className="bg-gray-900 rounded-2xl p-5 space-y-4">
              <h2 className="text-base font-semibold text-indigo-300">📷 チャート画像</h2>
              <ChartUploader label="日足チャート" url={form.chartDaily} uploading={uploading.daily} onUpload={e => handleChartUpload(e, "daily")} onDelete={() => handleChartDelete("daily")} />
              <ChartUploader label="5分足チャート" url={form.chartMin5} uploading={uploading.min5} onUpload={e => handleChartUpload(e, "min5")} onDelete={() => handleChartDelete("min5")} />
            </div>

            {/* 寄り付き */}
            <div className="bg-gray-900 rounded-2xl p-5 space-y-3">
              <h2 className="text-base font-semibold text-indigo-300">🕯 寄り付き情報</h2>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-xs text-gray-400 mb-1 block">前日終値</label><div className="relative"><input type="number" className="w-full bg-gray-800 rounded-lg px-3 py-2 text-sm pr-8" value={form.prevClose} onChange={e => hfc("prevClose", e.target.value)} placeholder="例: 1200" /><span className="absolute right-3 top-2 text-xs text-gray-500">円</span></div></div>
                <div><label className="text-xs text-gray-400 mb-1 block">翌日始値</label><div className="relative"><input type="number" className="w-full bg-gray-800 rounded-lg px-3 py-2 text-sm pr-8" value={form.openPrice} onChange={e => hfc("openPrice", e.target.value)} placeholder="例: 1250" /><span className="absolute right-3 top-2 text-xs text-gray-500">円</span></div></div>
              </div>
              {gapPct !== null && (
                <div className="bg-gray-800 rounded-xl px-4 py-3 flex items-center gap-3">
                  <span className="text-xs text-gray-400">ギャップ：</span>
                  <GapBadge pct={gapPct} />
                  <span className="text-xs text-gray-500">（{(parseFloat(form.openPrice) - parseFloat(form.prevClose)).toFixed(0)}円）</span>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-xs text-gray-400 mb-1 block">出来高倍率</label><select className="w-full bg-gray-800 rounded-lg px-3 py-2 text-sm" value={form.volumeMult} onChange={e => hfc("volumeMult", e.target.value)}><option value="">選択</option>{VOLUME_MULT.map(v => <option key={v} value={v}>{v}</option>)}</select></div>
                <div><label className="text-xs text-gray-400 mb-1 block">材料の新鮮さ</label><select className="w-full bg-gray-800 rounded-lg px-3 py-2 text-sm" value={form.materialFreshness} onChange={e => hfc("materialFreshness", e.target.value)}><option value="">選択</option>{MATERIAL_FRESHNESS.map(v => <option key={v} value={v}>{v}</option>)}</select></div>
              </div>
            </div>

            {/* 押し目 */}
            <div className="bg-gray-900 rounded-2xl p-5 space-y-3">
              <h2 className="text-base font-semibold text-indigo-300">📉 押し目情報</h2>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-xs text-gray-400 mb-1 block">押し目タイプ</label><select className="w-full bg-gray-800 rounded-lg px-3 py-2 text-sm" value={form.pullbackType} onChange={e => hfc("pullbackType", e.target.value)}><option value="">選択</option>{PULLBACK_TYPES.map(v => <option key={v} value={v}>{v}</option>)}</select></div>
                <div><label className="text-xs text-gray-400 mb-1 block">上昇→押し目（日数）</label><div className="relative"><input type="number" className="w-full bg-gray-800 rounded-lg px-3 py-2 text-sm pr-8" value={form.pullbackDays} onChange={e => hfc("pullbackDays", e.target.value)} placeholder="例: 3" /><span className="absolute right-3 top-2 text-xs text-gray-500">日</span></div></div>
              </div>
            </div>

            {/* 材料 */}
            <div className="bg-gray-900 rounded-2xl p-5 space-y-3">
              <h2 className="text-base font-semibold text-indigo-300">💡 材料・テーマ</h2>
              <div>
                <label className="text-xs text-gray-400 mb-2 block">材料タイプ（複数選択可）</label>
                <MultiSelect options={MATERIAL_TYPES} selected={form.materialTypes} onChange={v => hfc("materialTypes", v)} colorOn="bg-yellow-700 text-white border-yellow-500" />
              </div>
              <div><label className="text-xs text-gray-400 mb-1 block">材料メモ（任意）</label><textarea className="w-full bg-gray-800 rounded-lg px-3 py-2 text-sm h-20 resize-none" value={form.materialNote} onChange={e => hfc("materialNote", e.target.value)} placeholder="ニュース内容、イレギュラーな材料など" /></div>
            </div>

            {/* テクニカル指標 */}
            <div className="bg-gray-900 rounded-2xl p-5 space-y-3">
              <h2 className="text-base font-semibold text-indigo-300">テクニカル指標</h2>
              <div className="grid grid-cols-2 gap-3">
                {Object.entries(OPTIONS).map(([key, opts]) => (
                  <div key={key}><label className="text-xs text-gray-400 mb-1 block">{LABEL[key]}</label><select className="w-full bg-gray-800 rounded-lg px-3 py-2 text-sm" value={form[key]} onChange={e => hfc(key, e.target.value)}><option value="">選択</option>{opts.map(o => <option key={o} value={o}>{o}</option>)}</select></div>
                ))}
              </div>
            </div>

            {/* 上昇率 */}
            <div className="bg-gray-900 rounded-2xl p-5 space-y-3">
              <h2 className="text-base font-semibold text-indigo-300">📈 上昇記録 <span className="text-xs text-gray-500 font-normal">（任意・後から入力可）</span></h2>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-xs text-gray-400 mb-1 block">上昇開始価格</label><div className="relative"><input type="number" className="w-full bg-gray-800 rounded-lg px-3 py-2 text-sm pr-8" value={form.startPrice} onChange={e => hfc("startPrice", e.target.value)} placeholder="例: 1000" /><span className="absolute right-3 top-2 text-xs text-gray-500">円</span></div></div>
                <div><label className="text-xs text-gray-400 mb-1 block">最高値</label><div className="relative"><input type="number" className="w-full bg-gray-800 rounded-lg px-3 py-2 text-sm pr-8" value={form.highPrice} onChange={e => hfc("highPrice", e.target.value)} placeholder="例: 1300" /><span className="absolute right-3 top-2 text-xs text-gray-500">円</span></div></div>
              </div>
              {risePct !== null && (
                <div className="bg-emerald-900/30 border border-emerald-700 rounded-xl px-4 py-3 text-center">
                  <span className="text-xs text-gray-400">上昇率：</span>
                  <span className="text-2xl font-bold text-emerald-400 ml-2">+{risePct}%</span>
                </div>
              )}
              <div><label className="text-xs text-gray-400 mb-1 block">達成日数（任意）</label><div className="relative"><input type="number" className="w-full bg-gray-800 rounded-lg px-3 py-2 text-sm pr-8" value={form.days} onChange={e => hfc("days", e.target.value)} placeholder="例: 5" /><span className="absolute right-3 top-2 text-xs text-gray-500">日</span></div></div>
            </div>

            {/* メモ */}
            <div className="bg-gray-900 rounded-2xl p-5"><h2 className="text-base font-semibold text-indigo-300 mb-3">メモ</h2><textarea className="w-full bg-gray-800 rounded-lg px-3 py-2 text-sm h-16 resize-none" value={form.note} onChange={e => hfc("note", e.target.value)} placeholder="気づき・パターンのメモ" /></div>

            <button onClick={handleSave} disabled={!form.ticker} className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white font-semibold py-3 rounded-xl transition-colors">{editId ? "更新する" : "保存する"}</button>
          </div>
        )}

        {/* ====== 一覧ページ ====== */}
        {page === "list" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h2 className="text-base font-semibold">一覧 ({filtStudies.length}件)</h2>
              <div className="flex flex-wrap gap-1.5">
                <FBtn val={null} label="すべて" />
                {RISE_FILTERS.slice(1).map(f => <FBtn key={f.label} val={f.min} label={f.label} />)}
              </div>
            </div>
            {filtStudies.length === 0 && <div className="text-center text-gray-500 py-16">該当するデータがありません</div>}
            <div className="space-y-2">
              {[...filtStudies].reverse().map(s => {
                const rise = calcRisePct(s.startPrice, s.highPrice);
                return (
                  <div key={s.id} className="bg-gray-900 rounded-2xl px-4 py-3 flex items-center justify-between cursor-pointer hover:bg-gray-800 transition-colors" onClick={() => setModal(s)}>
                    <div className="flex items-center gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-white">{s.ticker}</span>
                          {s.name && <span className="text-gray-400 text-sm">{s.name}</span>}
                        </div>
                        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                          {s.sectors?.slice(0, 2).map(sec => <span key={sec} className="text-xs text-violet-400">{sec}</span>)}
                          <span className="text-xs text-gray-600">{s.createdAt}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <RiseBadge pct={rise} />
                      <button onClick={e => { e.stopPropagation(); if (window.confirm(`${s.ticker}を削除しますか？`)) handleDelete(s.id); }} className="text-xs text-gray-600 hover:text-rose-400 px-1">✕</button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ====== 統計ページ ====== */}
        {page === "stats" && <StatsPage studies={studies} />}
      </div>
    </div>
  );
}