import { useState, useEffect } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  ScatterChart, Scatter, CartesianGrid, ReferenceLine, Cell
} from "recharts";
import { createClient } from "@supabase/supabase-js";

// ====== Supabase ======
const supabaseUrl = process.env.REACT_APP_SUPABASE_URL;
const supabaseKey = process.env.REACT_APP_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);
const BUCKET = "chart-images";

// ====== DB ======
async function dbLoad(table) {
  const { data, error } = await supabase.from(table).select("*");
  if (error) { console.error(error); return []; }
  return data.map(r => r.data);
}
async function dbSave(table, items) {
  await supabase.from(table).delete().neq("id", 0);
  if (!items.length) return;
  await supabase.from(table).insert(items.map(item => ({ id: item.id, data: item })));
}
async function dbLoadSettings() {
  const { data } = await supabase.from("settings").select("*").eq("id", 1).single();
  return data?.data || null;
}
async function dbSaveSettings(val) {
  await supabase.from("settings").upsert({ id: 1, data: val });
}
async function dbLoadHistory() {
  const { data } = await supabase.from("capital_history").select("*").order("id");
  if (!data) return [];
  return data.map(r => r.data);
}
async function dbSaveHistory(items) {
  await supabase.from("capital_history").delete().neq("id", 0);
  if (!items.length) return;
  await supabase.from("capital_history").insert(items.map(item => ({ id: item.id, data: item })));
}

// ====== Storage ======
async function uploadChart(file, analysisId, type) {
  const ext = file.name.split(".").pop();
  const path = `${analysisId}/${type}_${Date.now()}.${ext}`;
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
const DEFAULT_SETTINGS = { capital: 300000, maxPositions: 3, riskPct: 2, investPct: 33 };

const ENTRY_CHECKS = [
  { id: "ema", label: "EMA帯の上・上向き", desc: "価格がEMA帯より上にある", required: true },
  { id: "dkw", label: "DKW UPライン上抜け", desc: "DKWの下線が上線を上抜け確認", required: true },
  { id: "volume", label: "出来高 前日比2倍以上", desc: "再浮上時の出来高急増", required: true },
  { id: "macd", label: "MACD上向き", desc: "MACDがゼロ線上か右肩上がり", required: false },
  { id: "rsi", label: "RSI 50以上", desc: "トレンド継続の確認", required: false },
  { id: "candle", label: "陽線確認", desc: "再浮上の陽線が出ている", required: false },
  { id: "weekly", label: "週足トレンド一致", desc: "週足も上昇トレンド中", required: false },
  { id: "noUpShadow", label: "上ヒゲが少ない陽線", desc: "売り圧力が弱い確認", required: false },
  { id: "prevLow", label: "前日安値を割っていない", desc: "サポート維持の確認", required: false },
  { id: "shallow", label: "押し目が浅い（5%以内）", desc: "強いトレンドの押し目", required: false },
];

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

const initialForm = {
  ticker: "", name: "",
  // テクニカル
  candle: "", ema: "", volume: "", macd: "", mtm: "", rsi: "", cci: "", dmi: "",
  // 新規テクニカル
  prevClose: "", openPrice: "", volumeMult: "", pullbackType: "", pullbackDays: "",
  // 材料
  materialTypes: [], materialFreshness: "", materialNote: "",
  // セクター
  sectors: [],
  // 価格
  price: "", stopLoss: "", takeProfit: "", winRate: "", shares: "",
  // チェック・メモ
  checks: {}, note: "",
  // チャート画像URL
  chartDaily: "", chartMin5: "",
};

// ====== 計算 ======
function calcGapPct(prevClose, openPrice) {
  const pc = parseFloat(prevClose), op = parseFloat(openPrice);
  if (!pc || !op) return null;
  return (((op - pc) / pc) * 100).toFixed(2);
}
function getMaxRisk(s) { return Math.round(s.capital * s.riskPct / 100); }
function getMaxInvest(s) { return Math.round(s.capital * s.investPct / 100); }
function calcSizing(price, stopLoss, shares, settings) {
  const p = parseFloat(price), sl = parseFloat(stopLoss), sh = parseFloat(shares);
  if (!p || !sl || p <= sl) return null;
  const maxRisk = getMaxRisk(settings), maxInvest = getMaxInvest(settings);
  const lossPerShare = p - sl;
  const recShares = Math.max(Math.floor(maxRisk / lossPerShare / 100), 1) * 100;
  const recInvest = recShares * p, recRisk = Math.round(recShares * lossPerShare);
  const fixedInvest = 100 * p, fixedRisk = Math.round(100 * lossPerShare);
  const maxLossWidth = Math.floor(maxRisk / 100), recSL = Math.ceil(p - maxRisk / 100);
  const customInvest = !isNaN(sh) && sh > 0 ? sh * p : null;
  const customRisk = !isNaN(sh) && sh > 0 ? Math.round(sh * lossPerShare) : null;
  return {
    lossPerShare: lossPerShare.toFixed(1), recShares, recInvest, recRisk, fixedInvest, fixedRisk,
    maxLossWidth, recSL, customInvest, customRisk, maxRisk, maxInvest,
    recOk: recRisk <= maxRisk, fixedRiskOk: fixedRisk <= maxRisk, fixedInvestOk: fixedInvest <= maxInvest
  };
}
function calcPlanMetrics(price, stopLoss, takeProfit, winRate) {
  const p = parseFloat(price), sl = parseFloat(stopLoss), tp = parseFloat(takeProfit), wr = parseFloat(winRate);
  if (!p || !sl || !tp || isNaN(wr)) return null;
  const loss = p - sl, profit = tp - p;
  if (loss <= 0) return null;
  return { loss: loss.toFixed(1), profit: profit.toFixed(1), rr: (profit / loss).toFixed(2), ev: ((profit * (wr / 100)) - (loss * (1 - wr / 100))).toFixed(1) };
}
function calcActualRR(entry, stopLoss, exit) {
  const e = parseFloat(entry), sl = parseFloat(stopLoss), ex = parseFloat(exit);
  if (!e || !sl || !ex) return null;
  const risk = e - sl; if (risk <= 0) return null;
  return ((ex - e) / risk).toFixed(2);
}
function calcEntryScore(checks) {
  if (!checks) return { score: 0, total: ENTRY_CHECKS.length, requiredOk: false };
  const score = ENTRY_CHECKS.filter(c => checks[c.id]).length;
  const requiredOk = ENTRY_CHECKS.filter(c => c.required).every(c => checks[c.id]);
  return { score, total: ENTRY_CHECKS.length, requiredOk };
}

// ====== UI部品 ======
const EVBadge = ({ val }) => {
  if (val === undefined || val === null || val === "") return <span className="text-gray-400">-</span>;
  const n = parseFloat(val);
  return <span className={`font-bold ${n > 0 ? "text-emerald-400" : n < 0 ? "text-rose-400" : "text-gray-300"}`}>{n > 0 ? "+" : ""}{Number(n).toLocaleString()}</span>;
};
const RRBadge = ({ val, plan }) => {
  if (!val) return <span className="text-gray-400">-</span>;
  const color = !plan ? "text-sky-300" : parseFloat(val) >= parseFloat(plan) ? "text-emerald-400" : "text-rose-400";
  return <span className={`font-bold ${color}`}>1:{val}</span>;
};
const ScoreDot = ({ label, value }) => {
  const pos = { candle: ["上昇中", "押し目形成中", "下落反発確認"], ema: ["5>20>40"], volume: ["増加中"], macd: ["右肩上がり0以上", "右肩上がり0以下"], mtm: ["上昇中0以上", "上昇中0以下"], rsi: ["40以下", "40以上"], cci: ["100超え", "0超え"], dmi: ["30以上", "25以上"] };
  return <span className={`inline-block w-2 h-2 rounded-full mr-1 ${pos[label]?.includes(value) ? "bg-emerald-400" : "bg-gray-500"}`} />;
};
function EntryScoreBadge({ checks }) {
  const { score, total, requiredOk } = calcEntryScore(checks);
  const pct = score / total;
  const color = !requiredOk ? "bg-rose-600" : pct >= 0.8 ? "bg-emerald-600" : pct >= 0.6 ? "bg-yellow-600" : "bg-orange-600";
  const label = !requiredOk ? "必須未達" : pct >= 0.8 ? "強い" : pct >= 0.6 ? "普通" : "弱い";
  return <span className={`text-xs px-2 py-0.5 rounded-full text-white font-medium ${color}`}>{label} {score}/{total}</span>;
}
function GapBadge({ pct }) {
  if (pct === null) return null;
  const n = parseFloat(pct);
  const color = n > 0 ? "text-emerald-400" : n < 0 ? "text-rose-400" : "text-gray-400";
  const label = n > 0 ? "ギャップアップ" : n < 0 ? "ギャップダウン" : "変わらず";
  return <span className={`text-xs font-bold ${color}`}>{n > 0 ? "+" : ""}{pct}% {label}</span>;
}
function MultiSelect({ options, selected = [], onChange, colorMap }) {
  const toggle = v => onChange(selected.includes(v) ? selected.filter(x => x !== v) : [...selected, v]);
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map(o => {
        const on = selected.includes(o);
        const cls = colorMap?.(o, on) || (on ? "bg-indigo-600 text-white border-indigo-500" : "bg-gray-800 text-gray-400 border-gray-700");
        return <button key={o} onClick={() => toggle(o)} className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${cls}`}>{o}</button>;
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
function Toast({ msg, onDone }) {
  useEffect(() => { const t = setTimeout(onDone, 2200); return () => clearTimeout(t); }, []);
  return <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-emerald-600 text-white px-5 py-2.5 rounded-xl shadow-lg text-sm font-medium">✅ {msg}</div>;
}

// ====== 設定ページ ======
function SettingsPage({ settings, onSettingsChange, trades, onTradesChange, showToast }) {
  const [localCap, setLocalCap] = useState(String(settings.capital));
  const [localS, setLocalS] = useState({ ...settings });
  const [history, setHistory] = useState([]);
  useEffect(() => { dbLoadHistory().then(setHistory); }, []);
  useEffect(() => { setLocalCap(String(settings.capital)); setLocalS({ ...settings }); }, [settings]);
  const previewMaxRisk = getMaxRisk({ ...localS, capital: parseFloat(localCap) || settings.capital });
  const previewMaxInvest = getMaxInvest({ ...localS, capital: parseFloat(localCap) || settings.capital });
  const handleSave = async () => {
    const cap = parseFloat(localCap); if (!cap || cap <= 0) return;
    const next = { ...localS, capital: cap };
    onSettingsChange(next); await dbSaveSettings(next); showToast("設定を保存しました");
  };
  const handleReflect = async (trade) => {
    const pnl = parseFloat(trade.actualPnL); if (isNaN(pnl)) return;
    const newCap = Math.round(settings.capital + pnl);
    const next = { ...settings, capital: newCap };
    const entry = { id: Date.now(), date: new Date().toLocaleDateString("ja-JP"), ticker: trade.ticker, pnl, before: settings.capital, after: newCap, tradeId: trade.id };
    const newHistory = [...history, entry];
    onSettingsChange(next); await dbSaveSettings(next);
    setHistory(newHistory); await dbSaveHistory(newHistory);
    const upd = trades.map(t => t.id === trade.id ? { ...t, capitalReflected: true } : t);
    onTradesChange(upd); await dbSave("trades_v2", upd);
    setLocalCap(String(newCap)); setLocalS(next);
    showToast(`軍資金を更新しました（${pnl >= 0 ? "+" : ""}${pnl.toLocaleString()}円）`);
  };
  const handleUndoReflect = async (h) => {
    const newCap = h.before; const next = { ...settings, capital: newCap };
    const newHist = history.filter(x => x.id !== h.id);
    onSettingsChange(next); await dbSaveSettings(next);
    setHistory(newHist); await dbSaveHistory(newHist);
    const upd = trades.map(t => t.id === h.tradeId ? { ...t, capitalReflected: false } : t);
    onTradesChange(upd); await dbSave("trades_v2", upd);
    setLocalCap(String(newCap)); setLocalS(next);
    showToast("軍資金の反映を取り消しました");
  };
  const reflectable = trades.filter(t => t.closed && t.actualPnL != null && !t.capitalReflected);
  return (
    <div className="space-y-5">
      <div className="bg-gradient-to-br from-indigo-900/50 to-gray-900 rounded-2xl p-5 border border-indigo-700">
        <div className="text-xs text-indigo-300 mb-1">現在の軍資金</div>
        <div className="text-3xl font-bold text-white mb-3">{settings.capital.toLocaleString()}<span className="text-lg text-gray-400 ml-1">円</span></div>
        <div className="grid grid-cols-2 gap-3 text-center">
          <div className="bg-gray-800/60 rounded-xl p-3"><div className="text-xs text-gray-400 mb-1">最大リスク/取引</div><div className="text-lg font-bold text-rose-400">{getMaxRisk(settings).toLocaleString()}円</div><div className="text-xs text-gray-500">資金の{settings.riskPct}%</div></div>
          <div className="bg-gray-800/60 rounded-xl p-3"><div className="text-xs text-gray-400 mb-1">1銘柄上限</div><div className="text-lg font-bold text-sky-400">{getMaxInvest(settings).toLocaleString()}円</div><div className="text-xs text-gray-500">資金の{settings.investPct}%</div></div>
        </div>
      </div>
      <div className="bg-gray-900 rounded-2xl p-5 space-y-4">
        <h2 className="text-base font-semibold text-indigo-300">⚙️ 設定編集</h2>
        <div><label className="text-xs text-gray-400 mb-1 block">軍資金</label><div className="relative"><input type="number" className="w-full bg-gray-800 rounded-lg px-3 py-2 text-sm pr-8" value={localCap} onChange={e => setLocalCap(e.target.value)} /><span className="absolute right-3 top-2 text-xs text-gray-500">円</span></div></div>
        <div><label className="text-xs text-gray-400 mb-1 block">最大同時保有銘柄数</label><input type="number" className="w-full bg-gray-800 rounded-lg px-3 py-2 text-sm" value={localS.maxPositions} onChange={e => setLocalS(s => ({ ...s, maxPositions: parseInt(e.target.value) || 1 }))} /></div>
        <div>
          <div className="flex justify-between mb-1"><label className="text-xs text-gray-400">1取引の最大リスク</label><span className="text-xs text-rose-400 font-bold">{previewMaxRisk.toLocaleString()}円</span></div>
          <div className="flex items-center gap-3"><input type="range" min="0.5" max="5" step="0.5" className="flex-1 accent-rose-500" value={localS.riskPct} onChange={e => setLocalS(s => ({ ...s, riskPct: parseFloat(e.target.value) }))} /><span className="text-sm font-bold text-rose-400 w-10 text-right">{localS.riskPct}%</span></div>
        </div>
        <div>
          <div className="flex justify-between mb-1"><label className="text-xs text-gray-400">1銘柄あたり最大投資額</label><span className="text-xs text-sky-400 font-bold">{previewMaxInvest.toLocaleString()}円</span></div>
          <div className="flex items-center gap-3"><input type="range" min="10" max="100" step="1" className="flex-1 accent-sky-500" value={localS.investPct} onChange={e => setLocalS(s => ({ ...s, investPct: parseInt(e.target.value) }))} /><span className="text-sm font-bold text-sky-400 w-10 text-right">{localS.investPct}%</span></div>
        </div>
        <button onClick={handleSave} className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-semibold py-2.5 rounded-xl">設定を保存</button>
      </div>
      {reflectable.length > 0 && (
        <div className="bg-gray-900 rounded-2xl p-5">
          <h2 className="text-base font-semibold text-indigo-300 mb-3">💰 軍資金に反映する</h2>
          <div className="space-y-2">
            {reflectable.map(t => {
              const pnl = parseFloat(t.actualPnL);
              return (
                <div key={t.id} className="flex items-center justify-between bg-gray-800 rounded-xl px-3 py-2.5">
                  <div><div className="text-sm font-medium">{t.ticker}{t.name && <span className="text-gray-400 text-xs ml-1">{t.name}</span>}</div><div className="text-xs text-gray-500">{t.createdAt}</div></div>
                  <div className="flex items-center gap-3">
                    <span className={`text-sm font-bold ${pnl >= 0 ? "text-emerald-400" : "text-rose-400"}`}>{pnl >= 0 ? "+" : ""}{pnl.toLocaleString()}円</span>
                    <button onClick={() => handleReflect(t)} className="text-xs bg-indigo-700 hover:bg-indigo-600 text-white px-3 py-1.5 rounded-lg font-medium">反映</button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {history.length > 0 && (
        <div className="bg-gray-900 rounded-2xl p-5">
          <h2 className="text-base font-semibold text-indigo-300 mb-3">📜 軍資金の変動履歴</h2>
          <div className="space-y-2">
            {[...history].reverse().map(h => (
              <div key={h.id} className="bg-gray-800 rounded-xl px-3 py-2.5">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2"><span className="text-sm font-medium">{h.ticker}</span><span className={`text-sm font-bold ${h.pnl >= 0 ? "text-emerald-400" : "text-rose-400"}`}>{h.pnl >= 0 ? "+" : ""}{h.pnl.toLocaleString()}円</span></div>
                  <button onClick={() => handleUndoReflect(h)} className="text-xs bg-yellow-800 hover:bg-yellow-700 text-yellow-200 px-2 py-1 rounded-lg">取消</button>
                </div>
                <div className="flex items-center justify-between text-xs text-gray-400"><span>{h.date}</span><span>{h.before.toLocaleString()} → <span className="text-white font-medium">{h.after.toLocaleString()}円</span></span></div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ====== 統計ページ ======
function StatsPage({ trades, analyses }) {
  const closed = trades.filter(t => t.closed && t.actualRR != null);
  const total = closed.length;
  const wins = closed.filter(t => parseFloat(t.actualRR) > 0).length;
  const winRate = total > 0 ? ((wins / total) * 100).toFixed(1) : "-";
  const avgRR = total > 0 ? (closed.reduce((s, t) => s + parseFloat(t.actualRR || 0), 0) / total).toFixed(2) : "-";
  const totalPnL = closed.reduce((s, t) => s + parseFloat(t.actualPnL || 0), 0).toFixed(0);
  const achList = closed.filter(t => t.planRR);
  const avgAchieve = achList.length > 0 ? (achList.reduce((s, t) => s + (parseFloat(t.actualRR) / parseFloat(t.planRR)) * 100, 0) / achList.length).toFixed(1) : "-";

  // 指標別勝率
  const heatmap = Object.keys(OPTIONS).flatMap(key => OPTIONS[key].map(opt => {
    const ids = analyses.filter(a => a[key] === opt).map(a => a.id);
    const rel = closed.filter(t => ids.includes(t.analysisId));
    if (!rel.length) return null;
    const w = rel.filter(t => parseFloat(t.actualRR) > 0).length;
    return { label: `${LABEL[key]}: ${opt}`, count: rel.length, winRate: ((w / rel.length) * 100).toFixed(0) };
  }).filter(Boolean)).sort((a, b) => parseFloat(b.winRate) - parseFloat(a.winRate));

  // 材料タイプ別勝率
  const materialHeatmap = MATERIAL_TYPES.map(mt => {
    const ids = analyses.filter(a => a.materialTypes?.includes(mt)).map(a => a.id);
    const rel = closed.filter(t => ids.includes(t.analysisId));
    if (!rel.length) return null;
    const w = rel.filter(t => parseFloat(t.actualRR) > 0).length;
    return { label: mt, count: rel.length, winRate: ((w / rel.length) * 100).toFixed(0) };
  }).filter(Boolean).sort((a, b) => parseFloat(b.winRate) - parseFloat(a.winRate));

  // セクター別勝率
  const sectorHeatmap = SECTORS.map(s => {
    const ids = analyses.filter(a => a.sectors?.includes(s)).map(a => a.id);
    const rel = closed.filter(t => ids.includes(t.analysisId));
    if (!rel.length) return null;
    const w = rel.filter(t => parseFloat(t.actualRR) > 0).length;
    return { label: s, count: rel.length, winRate: ((w / rel.length) * 100).toFixed(0) };
  }).filter(Boolean).sort((a, b) => parseFloat(b.winRate) - parseFloat(a.winRate));

  // 押し目タイプ別勝率
  const pullbackHeatmap = PULLBACK_TYPES.map(pt => {
    const ids = analyses.filter(a => a.pullbackType === pt).map(a => a.id);
    const rel = closed.filter(t => ids.includes(t.analysisId));
    if (!rel.length) return null;
    const w = rel.filter(t => parseFloat(t.actualRR) > 0).length;
    return { label: pt, count: rel.length, winRate: ((w / rel.length) * 100).toFixed(0) };
  }).filter(Boolean);

  // エントリースコア別
  const scoreData = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(s => {
    const rel = closed.filter(t => { const a = analyses.find(x => x.id === t.analysisId); return a && calcEntryScore(a.checks).score === s; });
    if (!rel.length) return null;
    const w = rel.filter(t => parseFloat(t.actualRR) > 0).length;
    return { score: `${s}点`, winRate: parseFloat(((w / rel.length) * 100).toFixed(1)), count: rel.length };
  }).filter(Boolean);

  const rrDist = [{ r: "0-50%", c: 0 }, { r: "50-80%", c: 0 }, { r: "80-100%", c: 0 }, { r: "100-120%", c: 0 }, { r: "120%+", c: 0 }];
  closed.filter(t => t.planRR).forEach(t => {
    const r = (parseFloat(t.actualRR) / parseFloat(t.planRR)) * 100;
    if (r < 50) rrDist[0].c++; else if (r < 80) rrDist[1].c++; else if (r < 100) rrDist[2].c++; else if (r < 120) rrDist[3].c++; else rrDist[4].c++;
  });

  const HeatmapRow = ({ d }) => {
    const wr = parseFloat(d.winRate);
    const bg = wr >= 70 ? "bg-emerald-500" : wr >= 50 ? "bg-yellow-500" : "bg-rose-500";
    return (
      <div className="flex items-center gap-2">
        <div className="text-xs text-gray-300 w-36 shrink-0 truncate">{d.label}</div>
        <div className="flex-1 h-5 bg-gray-800 rounded-full overflow-hidden">
          <div className={`h-5 ${bg} rounded-full flex items-center justify-end pr-2`} style={{ width: `${wr}%` }}>
            <span className="text-xs text-white font-bold">{d.winRate}%</span>
          </div>
        </div>
        <div className="text-xs text-gray-400 w-8 text-right shrink-0">{d.count}件</div>
      </div>
    );
  };

  if (total === 0) return <div className="text-center text-gray-500 py-20">クローズした取引がまだありません</div>;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3">
        {[["総取引数", `${total}件`, "text-white"], ["実績勝率", `${winRate}%`, parseFloat(winRate) >= 50 ? "text-emerald-400" : "text-rose-400"], ["平均RR", `1:${avgRR}`, "text-sky-300"], ["総損益", `${parseInt(totalPnL) >= 0 ? "+" : ""}${parseInt(totalPnL).toLocaleString()}円`, parseInt(totalPnL) >= 0 ? "text-emerald-400" : "text-rose-400"]].map(([l, v, c]) => (
          <div key={l} className="bg-gray-900 rounded-2xl p-4 text-center"><div className="text-xs text-gray-400 mb-1">{l}</div><div className={`text-xl font-bold ${c}`}>{v}</div></div>
        ))}
      </div>
      {avgAchieve !== "-" && <div className="bg-gray-900 rounded-2xl p-4 text-center"><div className="text-xs text-gray-400 mb-1">計画RR平均達成率</div><div className={`text-2xl font-bold ${parseFloat(avgAchieve) >= 100 ? "text-emerald-400" : "text-yellow-400"}`}>{avgAchieve}%</div></div>}
      {scoreData.length > 0 && (
        <div className="bg-gray-900 rounded-2xl p-4">
          <h3 className="text-sm font-semibold text-indigo-300 mb-1">🎯 エントリースコア別勝率</h3>
          <div className="text-xs text-gray-500 mb-3">何点以上から勝率が上がるか</div>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={scoreData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
              <XAxis dataKey="score" tick={{ fontSize: 10, fill: "#9ca3af" }} /><YAxis tick={{ fontSize: 10, fill: "#9ca3af" }} domain={[0, 100]} />
              <Tooltip contentStyle={{ background: "#1f2937", border: "none", borderRadius: "8px", fontSize: "12px" }} formatter={v => [`${v}%`, "勝率"]} />
              <Bar dataKey="winRate" radius={[4, 4, 0, 0]}>{scoreData.map((d, i) => <Cell key={i} fill={d.winRate >= 60 ? "#34d399" : d.winRate >= 50 ? "#fbbf24" : "#f87171"} />)}</Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
      {heatmap.length > 0 && (
        <div className="bg-gray-900 rounded-2xl p-4">
          <h3 className="text-sm font-semibold text-indigo-300 mb-3">📊 指標別勝率</h3>
          <div className="space-y-2">{heatmap.map(d => <HeatmapRow key={d.label} d={d} />)}</div>
        </div>
      )}
      {materialHeatmap.length > 0 && (
        <div className="bg-gray-900 rounded-2xl p-4">
          <h3 className="text-sm font-semibold text-indigo-300 mb-3">💡 材料タイプ別勝率</h3>
          <div className="space-y-2">{materialHeatmap.map(d => <HeatmapRow key={d.label} d={d} />)}</div>
        </div>
      )}
      {sectorHeatmap.length > 0 && (
        <div className="bg-gray-900 rounded-2xl p-4">
          <h3 className="text-sm font-semibold text-indigo-300 mb-3">🏭 セクター別勝率</h3>
          <div className="space-y-2">{sectorHeatmap.map(d => <HeatmapRow key={d.label} d={d} />)}</div>
        </div>
      )}
      {pullbackHeatmap.length > 0 && (
        <div className="bg-gray-900 rounded-2xl p-4">
          <h3 className="text-sm font-semibold text-indigo-300 mb-3">📉 押し目タイプ別勝率</h3>
          <div className="space-y-2">{pullbackHeatmap.map(d => <HeatmapRow key={d.label} d={d} />)}</div>
        </div>
      )}
      <div className="bg-gray-900 rounded-2xl p-4">
        <h3 className="text-sm font-semibold text-indigo-300 mb-1">📈 計画RR達成率の分布</h3>
        <div className="text-xs text-gray-500 mb-3">左に偏るほど早期利確傾向</div>
        <ResponsiveContainer width="100%" height={150}>
          <BarChart data={rrDist} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
            <XAxis dataKey="r" tick={{ fontSize: 9, fill: "#9ca3af" }} /><YAxis tick={{ fontSize: 10, fill: "#9ca3af" }} />
            <Tooltip contentStyle={{ background: "#1f2937", border: "none", borderRadius: "8px", fontSize: "12px" }} />
            <Bar dataKey="c" name="件数" radius={[4, 4, 0, 0]}>{rrDist.map((d, i) => <Cell key={i} fill={i < 2 ? "#f87171" : i === 2 ? "#fbbf24" : "#34d399"} />)}</Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ====== メイン ======
export default function App() {
  const [page, setPage] = useState("analysis");
  const [analyses, setAnalyses] = useState([]);
  const [trades, setTrades] = useState([]);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(initialForm);
  const [editId, setEditId] = useState(null);
  const [tradeInputs, setTradeInputs] = useState({});
  const [toast, setToast] = useState(null);
  const [tradeFilter, setTradeFilter] = useState("all");
  const [analysisFilter, setAnalysisFilter] = useState("all");
  const [uploading, setUploading] = useState({ daily: false, min5: false });

  useEffect(() => {
    (async () => {
      const [a, t, s] = await Promise.all([dbLoad("analyses_v2"), dbLoad("trades_v2"), dbLoadSettings()]);
      setAnalyses(a); setTrades(t); if (s) setSettings(s); setLoading(false);
    })();
  }, []);

  const showToast = msg => setToast(msg);
  const persistAnalyses = async d => { setAnalyses([...d]); await dbSave("analyses_v2", d); };
  const persistTrades = async d => { setTrades([...d]); await dbSave("trades_v2", d); };

  const hfc = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const hcc = id => setForm(f => ({ ...f, checks: { ...f.checks, [id]: !f.checks?.[id] } }));
  const metrics = calcPlanMetrics(form.price, form.stopLoss, form.takeProfit, form.winRate);
  const sizing = calcSizing(form.price, form.stopLoss, form.shares, settings);
  const entryScore = calcEntryScore(form.checks);
  const gapPct = calcGapPct(form.prevClose, form.openPrice);

  const handleChartUpload = async (e, type) => {
    const file = e.target.files?.[0]; if (!file) return;
    const id = editId || form._tmpId || (() => { const tmp = Date.now(); setForm(f => ({ ...f, _tmpId: tmp })); return tmp; })();
    setUploading(u => ({ ...u, [type]: true }));
    const url = await uploadChart(file, id, type);
    if (url) setForm(f => ({ ...f, [type === "daily" ? "chartDaily" : "chartMin5"]: url }));
    setUploading(u => ({ ...u, [type]: false }));
  };
  const handleChartDelete = async (type) => {
    const key = type === "daily" ? "chartDaily" : "chartMin5";
    await deleteChart(form[key]);
    setForm(f => ({ ...f, [key]: "" }));
  };

  const handleSave = async () => {
    if (!form.ticker || !form.price) return;
    const now = new Date().toLocaleDateString("ja-JP");
    const ex = analyses.find(a => a.id === editId);
    const entry = { ...form, id: editId || form._tmpId || Date.now(), createdAt: ex?.createdAt || now, tradeFlag: ex?.tradeFlag || false };
    delete entry._tmpId;
    await persistAnalyses(editId ? analyses.map(a => a.id === editId ? entry : a) : [...analyses, entry]);
    setForm(initialForm); setEditId(null);
    showToast(editId ? "分析を更新しました" : "分析を保存しました");
    setPage("analysis");
  };

  const handleTradeFlag = async id => {
    const a = analyses.find(x => x.id === id); if (!a) return;
    await persistAnalyses(analyses.map(x => x.id === id ? { ...x, tradeFlag: true } : x));
    await persistTrades([...trades, { id: Date.now(), analysisId: id, ticker: a.ticker, name: a.name, planPrice: a.price, planSL: a.stopLoss, planTP: a.takeProfit, winRate: a.winRate, materialNote: a.materialNote, materialTypes: a.materialTypes, createdAt: new Date().toLocaleDateString("ja-JP"), actualEntry: "", exitPrice: "", shares: "", result: "", closed: false, capitalReflected: false }]);
    showToast("売買ページへ転記しました");
  };
  const handleUndoTradeFlag = async id => {
    const t = trades.find(t => t.analysisId === id && !t.closed);
    if (t) await persistTrades(trades.filter(x => x.id !== t.id));
    await persistAnalyses(analyses.map(x => x.id === id ? { ...x, tradeFlag: false } : x));
    showToast("転記を取り消しました");
  };
  const handleUndoClose = async id => {
    await persistTrades(trades.map(t => t.id === id ? { ...t, closed: false, actualRR: undefined, planRR: undefined, actualPnL: undefined, capitalReflected: false } : t));
    showToast("クローズを取り消しました");
  };
  const handleEdit = a => { setForm({ ...a, checks: a.checks || {}, materialTypes: a.materialTypes || [], sectors: a.sectors || [] }); setEditId(a.id); setPage("input"); };
  const handleDelete = async id => {
    const a = analyses.find(x => x.id === id);
    if (a) { await deleteChart(a.chartDaily); await deleteChart(a.chartMin5); }
    await persistAnalyses(analyses.filter(a => a.id !== id));
    showToast("削除しました");
  };
  const updateTrade = (id, k, v) => setTradeInputs(t => ({ ...t, [id]: { ...(t[id] || {}), [k]: v } }));
  const closeTrade = async id => {
    const inp = tradeInputs[id] || {};
    const updated = trades.map(t => {
      if (t.id !== id) return t;
      const ae = inp.actualEntry || t.actualEntry, ex = inp.exitPrice || t.exitPrice, sh = inp.shares || t.shares;
      const planM = calcPlanMetrics(t.planPrice, t.planSL, t.planTP, t.winRate);
      const actualRR = calcActualRR(ae, t.planSL, ex);
      const shN = parseFloat(sh), aeN = parseFloat(ae), exN = parseFloat(ex);
      const actualPnL = (!isNaN(shN) && !isNaN(aeN) && !isNaN(exN)) ? ((exN - aeN) * shN).toFixed(0) : null;
      return { ...t, actualEntry: ae, exitPrice: ex, shares: sh, result: inp.result || t.result, planRR: planM?.rr, actualRR, actualPnL, closed: true, capitalReflected: false };
    });
    await persistTrades(updated); showToast("取引をクローズしました");
  };

  const openTrades = trades.filter(t => !t.closed).length;
  const unreflected = trades.filter(t => t.closed && t.actualPnL != null && !t.capitalReflected).length;
  const filtTrades = trades.filter(t => tradeFilter === "all" ? true : tradeFilter === "open" ? !t.closed : t.closed);
  const filtAnalyses = analyses.filter(a => analysisFilter === "all" ? true : analysisFilter === "flagged" ? a.tradeFlag : !a.tradeFlag);

  const NBtn = ({ p, label, badge }) => (<button onClick={() => setPage(p)} className={`relative px-3 py-2 rounded-lg text-sm font-medium transition-colors ${page === p ? "bg-indigo-600 text-white" : "bg-gray-800 text-gray-300 hover:bg-gray-700"}`}>{label}{badge > 0 && <span className="absolute -top-1 -right-1 bg-rose-500 text-white text-xs w-4 h-4 rounded-full flex items-center justify-center">{badge}</span>}</button>);
  const FBtn = ({ val, cur, set, label }) => (<button onClick={() => set(val)} className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${cur === val ? "bg-indigo-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}>{label}</button>);

  if (loading) return <div className="min-h-screen bg-gray-950 flex items-center justify-center text-gray-400 text-sm">読み込み中…</div>;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-sans">
      {toast && <Toast msg={toast} onDone={() => setToast(null)} />}
      <div className="max-w-4xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-xl font-bold">📈 株分析アプリ v2</h1>
          <div className="flex gap-1.5">
            <NBtn p="input" label="＋" badge={0} />
            <NBtn p="analysis" label="分析" badge={0} />
            <NBtn p="trades" label="売買" badge={openTrades} />
            <NBtn p="stats" label="統計" badge={0} />
            <NBtn p="settings" label="設定" badge={unreflected} />
          </div>
        </div>

        {page === "input" && (
          <div className="space-y-5">
            {/* 銘柄情報 */}
            <div className="bg-gray-900 rounded-2xl p-5 space-y-4">
              <h2 className="text-base font-semibold text-indigo-300">銘柄情報</h2>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-xs text-gray-400 mb-1 block">ティッカー *</label><input className="w-full bg-gray-800 rounded-lg px-3 py-2 text-sm" value={form.ticker} onChange={e => hfc("ticker", e.target.value)} placeholder="例: 7203" /></div>
                <div><label className="text-xs text-gray-400 mb-1 block">銘柄名</label><input className="w-full bg-gray-800 rounded-lg px-3 py-2 text-sm" value={form.name} onChange={e => hfc("name", e.target.value)} placeholder="例: トヨタ" /></div>
              </div>
              {/* セクター */}
              <div>
                <label className="text-xs text-gray-400 mb-2 block">セクター（複数選択可）</label>
                <MultiSelect options={SECTORS} selected={form.sectors} onChange={v => hfc("sectors", v)}
                  colorMap={(o, on) => on ? "bg-violet-700 text-white border-violet-500" : "bg-gray-800 text-gray-400 border-gray-700"} />
              </div>
            </div>

            {/* チャート画像 */}
            <div className="bg-gray-900 rounded-2xl p-5 space-y-4">
              <h2 className="text-base font-semibold text-indigo-300">📷 チャート画像</h2>
              <ChartUploader label="日足チャート" url={form.chartDaily} uploading={uploading.daily}
                onUpload={e => handleChartUpload(e, "daily")} onDelete={() => handleChartDelete("daily")} />
              <ChartUploader label="5分足チャート" url={form.chartMin5} uploading={uploading.min5}
                onUpload={e => handleChartUpload(e, "min5")} onDelete={() => handleChartDelete("min5")} />
            </div>

            {/* 寄り付き情報 */}
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
                  <span className="text-xs text-gray-500">（{parseFloat(form.openPrice) - parseFloat(form.prevClose) > 0 ? "+" : ""}{(parseFloat(form.openPrice) - parseFloat(form.prevClose)).toFixed(0)}円）</span>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">出来高倍率（前日比）</label>
                  <select className="w-full bg-gray-800 rounded-lg px-3 py-2 text-sm" value={form.volumeMult} onChange={e => hfc("volumeMult", e.target.value)}>
                    <option value="">選択</option>{VOLUME_MULT.map(v => <option key={v} value={v}>{v}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">材料の新鮮さ</label>
                  <select className="w-full bg-gray-800 rounded-lg px-3 py-2 text-sm" value={form.materialFreshness} onChange={e => hfc("materialFreshness", e.target.value)}>
                    <option value="">選択</option>{MATERIAL_FRESHNESS.map(v => <option key={v} value={v}>{v}</option>)}
                  </select>
                </div>
              </div>
            </div>

            {/* 押し目情報 */}
            <div className="bg-gray-900 rounded-2xl p-5 space-y-3">
              <h2 className="text-base font-semibold text-indigo-300">📉 押し目情報</h2>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">押し目タイプ</label>
                  <select className="w-full bg-gray-800 rounded-lg px-3 py-2 text-sm" value={form.pullbackType} onChange={e => hfc("pullbackType", e.target.value)}>
                    <option value="">選択</option>{PULLBACK_TYPES.map(v => <option key={v} value={v}>{v}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">上昇→押し目（日数）</label>
                  <div className="relative"><input type="number" className="w-full bg-gray-800 rounded-lg px-3 py-2 text-sm pr-8" value={form.pullbackDays} onChange={e => hfc("pullbackDays", e.target.value)} placeholder="例: 3" /><span className="absolute right-3 top-2 text-xs text-gray-500">日</span></div>
                </div>
              </div>
            </div>

            {/* 材料 */}
            <div className="bg-gray-900 rounded-2xl p-5 space-y-3">
              <h2 className="text-base font-semibold text-indigo-300">💡 材料・テーマ</h2>
              <div>
                <label className="text-xs text-gray-400 mb-2 block">材料タイプ（複数選択可）</label>
                <MultiSelect options={MATERIAL_TYPES} selected={form.materialTypes} onChange={v => hfc("materialTypes", v)}
                  colorMap={(o, on) => on ? "bg-yellow-700 text-white border-yellow-500" : "bg-gray-800 text-gray-400 border-gray-700"} />
              </div>
              <div>
                <label className="text-xs text-gray-400 mb-1 block">材料メモ（任意）</label>
                <textarea className="w-full bg-gray-800 rounded-lg px-3 py-2 text-sm h-20 resize-none" value={form.materialNote} onChange={e => hfc("materialNote", e.target.value)} placeholder="ニュース内容、イレギュラーな材料など自由に" />
              </div>
            </div>

            {/* エントリーチェック */}
            <div className="bg-gray-900 rounded-2xl p-5">
              <div className="flex items-center justify-between mb-3"><h2 className="text-base font-semibold text-indigo-300">✅ エントリーチェック</h2><EntryScoreBadge checks={form.checks} /></div>
              <div className="space-y-2">
                {ENTRY_CHECKS.map(c => {
                  const checked = form.checks?.[c.id] || false;
                  return (
                    <button key={c.id} onClick={() => hcc(c.id)} className={`w-full flex items-center gap-3 p-3 rounded-xl text-left transition-colors ${checked ? "bg-emerald-900/40 border border-emerald-700" : "bg-gray-800 border border-gray-700"}`}>
                      <div className={`w-5 h-5 rounded flex items-center justify-center shrink-0 ${checked ? "bg-emerald-500" : "bg-gray-600"}`}>{checked && <span className="text-white text-xs font-bold">✓</span>}</div>
                      <div className="flex-1 min-w-0"><div className="flex items-center gap-2"><span className="text-sm font-medium">{c.label}</span>{c.required && <span className="text-xs text-rose-400">必須</span>}</div><div className="text-xs text-gray-400">{c.desc}</div></div>
                    </button>
                  );
                })}
              </div>
              <div className="mt-3">
                <div className="flex justify-between text-xs text-gray-400 mb-1"><span>エントリー強度</span><span>{entryScore.score}/{entryScore.total}</span></div>
                <div className="h-2 bg-gray-800 rounded-full"><div className={`h-2 rounded-full transition-all ${!entryScore.requiredOk ? "bg-rose-500" : entryScore.score >= 8 ? "bg-emerald-500" : entryScore.score >= 5 ? "bg-yellow-500" : "bg-orange-500"}`} style={{ width: `${(entryScore.score / entryScore.total) * 100}%` }} /></div>
                {!entryScore.requiredOk && <div className="text-xs text-rose-400 mt-1">⚠️ 必須項目が未チェックです</div>}
                {entryScore.requiredOk && entryScore.score >= 7 && <div className="text-xs text-emerald-400 mt-1">🟢 エントリー推奨</div>}
                {entryScore.requiredOk && entryScore.score < 7 && <div className="text-xs text-yellow-400 mt-1">🟡 条件が弱め、慎重に</div>}
              </div>
            </div>

            {/* テクニカル指標 */}
            <div className="bg-gray-900 rounded-2xl p-5 space-y-3">
              <h2 className="text-base font-semibold text-indigo-300">テクニカル指標</h2>
              <div className="grid grid-cols-2 gap-3">
                {Object.entries(OPTIONS).map(([key, opts]) => (<div key={key}><label className="text-xs text-gray-400 mb-1 block">{LABEL[key]}</label><select className="w-full bg-gray-800 rounded-lg px-3 py-2 text-sm" value={form[key]} onChange={e => hfc(key, e.target.value)}><option value="">選択</option>{opts.map(o => <option key={o} value={o}>{o}</option>)}</select></div>))}
              </div>
            </div>

            {/* 価格設定 */}
            <div className="bg-gray-900 rounded-2xl p-5 space-y-3">
              <h2 className="text-base font-semibold text-indigo-300">価格設定</h2>
              <div className="text-xs text-gray-500 bg-gray-800 rounded-lg px-3 py-2">軍資金 {settings.capital.toLocaleString()}円 ／ 最大リスク {getMaxRisk(settings).toLocaleString()}円 ／ 1銘柄上限 {getMaxInvest(settings).toLocaleString()}円</div>
              <div className="grid grid-cols-2 gap-3">
                {[["price", "現価格 *", "円"], ["stopLoss", "損切りライン", "円"], ["takeProfit", "利確ライン", "円"], ["winRate", "勝率", "%"]].map(([k, l, u]) => (<div key={k}><label className="text-xs text-gray-400 mb-1 block">{l}</label><div className="relative"><input type="number" className="w-full bg-gray-800 rounded-lg px-3 py-2 text-sm pr-8" value={form[k]} onChange={e => hfc(k, e.target.value)} /><span className="absolute right-3 top-2 text-xs text-gray-500">{u}</span></div></div>))}
              </div>
              <div><label className="text-xs text-gray-400 mb-1 block">株数（任意）</label><div className="relative"><input type="number" className="w-full bg-gray-800 rounded-lg px-3 py-2 text-sm pr-10" value={form.shares} onChange={e => hfc("shares", e.target.value)} placeholder="例: 100" /><span className="absolute right-3 top-2 text-xs text-gray-500">株</span></div></div>
              {metrics && (<div className="bg-gray-800 rounded-xl p-4 grid grid-cols-4 gap-2 text-center"><div><div className="text-xs text-gray-400 mb-1">損幅</div><div className="text-sm text-rose-400 font-bold">-{metrics.loss}円</div></div><div><div className="text-xs text-gray-400 mb-1">利幅</div><div className="text-sm text-emerald-400 font-bold">+{metrics.profit}円</div></div><div><div className="text-xs text-gray-400 mb-1">RR比</div><div className="text-sm font-bold text-sky-300">1:{metrics.rr}</div></div><div><div className="text-xs text-gray-400 mb-1">期待値</div><div className="text-sm"><EVBadge val={metrics.ev} />円</div></div></div>)}
              {sizing && (() => {
                const { recOk, fixedRiskOk, fixedInvestOk } = sizing;
                return (<div className="space-y-2"><div className="text-xs text-indigo-300 font-semibold">📐 ポジションサイジング</div><div className={`rounded-xl p-3 ${recOk ? "bg-emerald-900/30 border border-emerald-700" : "bg-rose-900/20 border border-rose-700"}`}><div className="flex items-center justify-between mb-2"><span className="text-xs font-semibold">推奨株数</span><span className={`text-xs px-2 py-0.5 rounded-full ${recOk ? "bg-emerald-800 text-emerald-200" : "bg-rose-800 text-rose-200"}`}>{recOk ? "✅ 基準内" : "⚠️ 要調整"}</span></div><div className="grid grid-cols-3 gap-2 text-center text-xs"><div><div className="text-gray-400 mb-0.5">株数</div><div className="font-bold text-white text-base">{sizing.recShares}株</div></div><div><div className="text-gray-400 mb-0.5">投資額</div><div className={`font-bold ${sizing.recInvest > sizing.maxInvest ? "text-yellow-400" : "text-white"}`}>{sizing.recInvest.toLocaleString()}円</div></div><div><div className="text-gray-400 mb-0.5">リスク額</div><div className={`font-bold ${sizing.recRisk > sizing.maxRisk ? "text-rose-400" : "text-emerald-400"}`}>{sizing.recRisk.toLocaleString()}円</div></div></div></div><div className={`rounded-xl p-3 ${fixedRiskOk && fixedInvestOk ? "bg-gray-800" : "bg-yellow-900/20 border border-yellow-700"}`}><div className="flex items-center justify-between mb-2"><span className="text-xs font-semibold">100株固定</span><span className={`text-xs px-2 py-0.5 rounded-full ${fixedRiskOk && fixedInvestOk ? "bg-gray-700 text-gray-300" : "bg-yellow-800 text-yellow-200"}`}>{fixedRiskOk && fixedInvestOk ? "基準内" : "⚠️ 要確認"}</span></div><div className="grid grid-cols-3 gap-2 text-center text-xs"><div><div className="text-gray-400 mb-0.5">投資額</div><div className={`font-bold ${!fixedInvestOk ? "text-yellow-400" : "text-white"}`}>{sizing.fixedInvest.toLocaleString()}円</div></div><div><div className="text-gray-400 mb-0.5">リスク額</div><div className={`font-bold ${!fixedRiskOk ? "text-rose-400" : "text-white"}`}>{sizing.fixedRisk.toLocaleString()}円</div></div><div><div className="text-gray-400 mb-0.5">最大損切幅</div><div className="font-bold text-yellow-300">-{sizing.maxLossWidth}円</div></div></div></div>{sizing.customInvest && (<div className="bg-gray-800 rounded-xl p-3"><div className="text-xs font-semibold mb-2">入力株数 ({form.shares}株)</div><div className="grid grid-cols-2 gap-2 text-center text-xs"><div><div className="text-gray-400 mb-0.5">投資額</div><div className={`font-bold ${sizing.customInvest > sizing.maxInvest ? "text-yellow-400" : "text-white"}`}>{sizing.customInvest.toLocaleString()}円</div></div><div><div className="text-gray-400 mb-0.5">リスク額</div><div className={`font-bold ${sizing.customRisk > sizing.maxRisk ? "text-rose-400" : "text-emerald-400"}`}>{sizing.customRisk.toLocaleString()}円</div></div></div></div>)}</div>);
              })()}
            </div>

            {/* メモ */}
            <div className="bg-gray-900 rounded-2xl p-5"><h2 className="text-base font-semibold text-indigo-300 mb-3">メモ</h2><textarea className="w-full bg-gray-800 rounded-lg px-3 py-2 text-sm h-16 resize-none" value={form.note} onChange={e => hfc("note", e.target.value)} placeholder="自由メモ" /></div>
            <button onClick={handleSave} disabled={!form.ticker || !form.price} className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white font-semibold py-3 rounded-xl transition-colors">{editId ? "更新する" : "分析を保存する"}</button>
          </div>
        )}

        {page === "analysis" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between"><h2 className="text-base font-semibold">分析一覧 ({filtAnalyses.length}件)</h2><div className="flex gap-1.5"><FBtn val="all" cur={analysisFilter} set={setAnalysisFilter} label="すべて" /><FBtn val="unflagged" cur={analysisFilter} set={setAnalysisFilter} label="未転記" /><FBtn val="flagged" cur={analysisFilter} set={setAnalysisFilter} label="転記済" /></div></div>
            {filtAnalyses.length === 0 && <div className="text-center text-gray-500 py-16">該当する分析がありません</div>}
            {[...filtAnalyses].reverse().map(a => {
              const m = calcPlanMetrics(a.price, a.stopLoss, a.takeProfit, a.winRate);
              const gap = calcGapPct(a.prevClose, a.openPrice);
              return (
                <div key={a.id} className={`bg-gray-900 rounded-2xl p-4 border ${a.tradeFlag ? "border-emerald-700" : "border-gray-800"}`}>
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap"><span className="font-bold text-white text-lg">{a.ticker}</span>{a.name && <span className="text-gray-400 text-sm">{a.name}</span>}{a.checks && <EntryScoreBadge checks={a.checks} />}{a.tradeFlag && <span className="text-xs bg-emerald-900 text-emerald-300 px-2 py-0.5 rounded-full">転記済</span>}</div>
                      <div className="text-xs text-gray-500 mt-0.5">{a.createdAt}</div>
                    </div>
                    <div className="flex gap-1.5 flex-wrap justify-end">
                      <button onClick={() => handleEdit(a)} className="text-xs bg-gray-800 hover:bg-gray-700 px-2 py-1 rounded-lg">編集</button>
                      {!a.tradeFlag ? <button onClick={() => handleTradeFlag(a.id)} className="text-xs bg-indigo-800 hover:bg-indigo-700 px-2 py-1 rounded-lg text-indigo-200">売買転記</button> : <button onClick={() => handleUndoTradeFlag(a.id)} className="text-xs bg-yellow-800 hover:bg-yellow-700 px-2 py-1 rounded-lg text-yellow-200">転記取消</button>}
                      <button onClick={() => handleDelete(a.id)} className="text-xs bg-rose-900 hover:bg-rose-800 px-2 py-1 rounded-lg text-rose-300">削除</button>
                    </div>
                  </div>
                  {/* セクタータグ */}
                  {a.sectors?.length > 0 && <div className="flex flex-wrap gap-1 mb-2">{a.sectors.map(s => <span key={s} className="text-xs bg-violet-900/50 text-violet-300 px-2 py-0.5 rounded-full">{s}</span>)}</div>}
                  {/* 材料タイプ */}
                  {a.materialTypes?.length > 0 && <div className="flex flex-wrap gap-1 mb-2">{a.materialTypes.map(t => <span key={t} className="text-xs bg-yellow-900/50 text-yellow-300 px-2 py-0.5 rounded-full">💡{t}</span>)}</div>}
                  {/* ギャップ・出来高 */}
                  {(gap || a.volumeMult || a.pullbackType) && (
                    <div className="flex flex-wrap gap-2 mb-2 text-xs">
                      {gap && <GapBadge pct={gap} />}
                      {a.volumeMult && <span className="text-sky-300">📊 出来高{a.volumeMult}</span>}
                      {a.pullbackType && <span className="text-orange-300">📉 {a.pullbackType}{a.pullbackDays ? ` (${a.pullbackDays}日)` : ""}</span>}
                      {a.materialFreshness && <span className="text-gray-400">🕐 {a.materialFreshness}</span>}
                    </div>
                  )}
                  {/* チャート画像 */}
                  {(a.chartDaily || a.chartMin5) && (
                    <div className="grid grid-cols-2 gap-2 mb-3">
                      {a.chartDaily && <div><div className="text-xs text-gray-500 mb-1">日足</div><img src={a.chartDaily} alt="日足" className="w-full rounded-lg object-cover max-h-32 bg-gray-800 cursor-pointer" onClick={() => window.open(a.chartDaily, "_blank")} /></div>}
                      {a.chartMin5 && <div><div className="text-xs text-gray-500 mb-1">5分足</div><img src={a.chartMin5} alt="5分足" className="w-full rounded-lg object-cover max-h-32 bg-gray-800 cursor-pointer" onClick={() => window.open(a.chartMin5, "_blank")} /></div>}
                    </div>
                  )}
                  {/* エントリーチェック */}
                  {a.checks && Object.values(a.checks).some(Boolean) && (<div className="flex flex-wrap gap-1 mb-2">{ENTRY_CHECKS.filter(c => a.checks[c.id]).map(c => (<span key={c.id} className="text-xs bg-emerald-900/40 text-emerald-300 px-2 py-0.5 rounded-full">✓ {c.label}</span>))}</div>)}
                  <div className="flex flex-wrap gap-1 mb-3">{Object.keys(OPTIONS).map(k => a[k] ? (<span key={k} className="text-xs bg-gray-800 px-2 py-0.5 rounded-full text-gray-300"><ScoreDot label={k} value={a[k]} />{LABEL[k]}: {a[k]}</span>) : null)}</div>
                  {a.materialNote && <div className="text-xs text-yellow-300 bg-yellow-900/30 rounded-lg px-3 py-2 mb-3">📝 {a.materialNote}</div>}
                  <div className="grid grid-cols-4 gap-2 text-center bg-gray-800 rounded-xl p-3">
                    <div><div className="text-xs text-gray-400">現価格</div><div className="text-sm font-bold">{a.price}円</div></div>
                    <div><div className="text-xs text-gray-400">損切り</div><div className="text-sm text-rose-400">{a.stopLoss || "-"}円</div></div>
                    <div><div className="text-xs text-gray-400">利確</div><div className="text-sm text-emerald-400">{a.takeProfit || "-"}円</div></div>
                    <div><div className="text-xs text-gray-400">RR</div><div className="text-sm font-bold text-sky-300">{m ? `1:${m.rr}` : "-"}</div></div>
                  </div>
                  {m && <div className="grid grid-cols-2 gap-2 text-center mt-2"><div className="bg-gray-800 rounded-lg p-2"><div className="text-xs text-gray-400">勝率</div><div className="text-sm">{a.winRate}%</div></div><div className="bg-gray-800 rounded-lg p-2"><div className="text-xs text-gray-400">期待値</div><div className="text-sm"><EVBadge val={m.ev} />円</div></div></div>}
                  {a.note && <div className="text-xs text-gray-400 mt-2 bg-gray-800 rounded-lg px-3 py-2">📝 {a.note}</div>}
                </div>
              );
            })}
          </div>
        )}

        {page === "trades" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between"><h2 className="text-base font-semibold">売買管理 ({filtTrades.length}件)</h2><div className="flex gap-1.5"><FBtn val="all" cur={tradeFilter} set={setTradeFilter} label="すべて" /><FBtn val="open" cur={tradeFilter} set={setTradeFilter} label="オープン" /><FBtn val="closed" cur={tradeFilter} set={setTradeFilter} label="クローズ" /></div></div>
            {filtTrades.length === 0 && <div className="text-center text-gray-500 py-16">該当する取引がありません</div>}
            {[...filtTrades].reverse().map(t => {
              const inp = tradeInputs[t.id] || {};
              const ae = inp.actualEntry ?? t.actualEntry, ex = inp.exitPrice ?? t.exitPrice, sh = inp.shares ?? t.shares;
              const planM = calcPlanMetrics(t.planPrice, t.planSL, t.planTP, t.winRate);
              const previewRR = calcActualRR(ae, t.planSL, ex);
              const shN = parseFloat(sh), aeN = parseFloat(ae), exN = parseFloat(ex);
              const previewPnL = (!isNaN(shN) && !isNaN(aeN) && !isNaN(exN)) ? ((exN - aeN) * shN).toFixed(0) : null;
              const planPnLPreview = (!isNaN(shN) && planM) ? (parseFloat(planM.profit) * shN).toFixed(0) : null;
              const analysis = analyses.find(a => a.id === t.analysisId);
              return (
                <div key={t.id} className={`bg-gray-900 rounded-2xl p-4 border ${t.closed ? "border-gray-700" : "border-indigo-700"}`}>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-lg">{t.ticker}</span>{t.name && <span className="text-gray-400 text-sm">{t.name}</span>}
                      {analysis?.checks && <EntryScoreBadge checks={analysis.checks} />}
                      <span className={`text-xs px-2 py-0.5 rounded-full ${t.closed ? "bg-gray-700 text-gray-300" : "bg-indigo-900 text-indigo-300"}`}>{t.closed ? "クローズ" : "オープン"}</span>
                      {t.capitalReflected && <span className="text-xs bg-emerald-900/50 text-emerald-400 px-2 py-0.5 rounded-full">軍資金反映済</span>}
                    </div>
                    <div className="flex items-center gap-2">
                      {t.closed && <button onClick={() => handleUndoClose(t.id)} className="text-xs bg-yellow-800 hover:bg-yellow-700 px-2 py-1 rounded-lg text-yellow-200">取消</button>}
                      <div className="text-xs text-gray-500">{t.createdAt}</div>
                    </div>
                  </div>
                  {t.materialTypes?.length > 0 && <div className="flex flex-wrap gap-1 mb-2">{t.materialTypes.map(mt => <span key={mt} className="text-xs bg-yellow-900/50 text-yellow-300 px-2 py-0.5 rounded-full">💡{mt}</span>)}</div>}
                  {t.materialNote && <div className="text-xs text-yellow-300 bg-yellow-900/30 rounded-lg px-3 py-2 mb-3">📝 {t.materialNote}</div>}
                  <div className="bg-gray-800 rounded-xl p-3 mb-3">
                    <div className="text-xs text-indigo-300 font-semibold mb-2">📋 計画</div>
                    <div className="grid grid-cols-4 gap-2 text-center text-xs"><div><div className="text-gray-400 mb-0.5">エントリー</div><div>{t.planPrice}円</div></div><div><div className="text-gray-400 mb-0.5">損切り</div><div className="text-rose-400">{t.planSL}円</div></div><div><div className="text-gray-400 mb-0.5">利確</div><div className="text-emerald-400">{t.planTP}円</div></div><div><div className="text-gray-400 mb-0.5">計画RR</div><div className="text-sky-300 font-bold">{planM ? `1:${planM.rr}` : "-"}</div></div></div>
                    {planM && <div className="grid grid-cols-2 gap-2 text-center text-xs mt-2"><div><span className="text-gray-400">期待値: </span><EVBadge val={planM.ev} /><span className="text-gray-400">円</span></div>{planPnLPreview && <div><span className="text-gray-400">計画損益: </span><span className="text-emerald-400">+{planPnLPreview}円</span></div>}</div>}
                  </div>
                  <div className="bg-gray-800 rounded-xl p-3 mb-3">
                    <div className="text-xs text-emerald-300 font-semibold mb-2">💰 実績</div>
                    {t.closed ? (
                      <>
                        <div className="grid grid-cols-3 gap-2 text-center text-xs mb-2"><div><div className="text-gray-400 mb-0.5">エントリー</div><div>{t.actualEntry}円</div></div><div><div className="text-gray-400 mb-0.5">約定価格</div><div>{t.exitPrice}円</div></div><div><div className="text-gray-400 mb-0.5">株数</div><div>{t.shares}株</div></div></div>
                        <div className="grid grid-cols-2 gap-2 text-center text-xs"><div className="bg-gray-700 rounded-lg p-2"><div className="text-gray-400 mb-0.5">実績RR</div><RRBadge val={t.actualRR} plan={t.planRR} /></div><div className="bg-gray-700 rounded-lg p-2"><div className="text-gray-400 mb-0.5">実際損益</div><EVBadge val={t.actualPnL} /><span className="text-gray-400">円</span></div></div>
                      </>
                    ) : (
                      <div className="space-y-2">
                        <div className="grid grid-cols-3 gap-2">{[["actualEntry", "エントリー"], ["exitPrice", "約定価格"], ["shares", "株数"]].map(([k, l]) => (<div key={k}><div className="text-xs text-gray-500 mb-0.5">{l}</div><input type="number" className="w-full bg-gray-700 rounded-lg px-2 py-1.5 text-xs" value={inp[k] || ""} onChange={e => updateTrade(t.id, k, e.target.value)} placeholder={k === "shares" ? "株" : "円"} /></div>))}</div>
                        {(previewRR || previewPnL) && (<div className="grid grid-cols-2 gap-2 text-center text-xs">{previewRR && <div className="bg-gray-700 rounded-lg p-2"><div className="text-gray-400 mb-0.5">実績RR（予）</div><RRBadge val={previewRR} plan={planM?.rr} /></div>}{previewPnL && <div className="bg-gray-700 rounded-lg p-2"><div className="text-gray-400 mb-0.5">損益（予）</div><EVBadge val={previewPnL} /><span className="text-gray-400">円</span></div>}</div>)}
                      </div>
                    )}
                  </div>
                  {!t.closed && (
                    <div className="space-y-2">
                      <input className="w-full bg-gray-800 rounded-lg px-3 py-2 text-xs" value={inp.result || ""} onChange={e => updateTrade(t.id, "result", e.target.value)} placeholder="結果・振り返りメモ" />
                      <button onClick={() => closeTrade(t.id)} className="w-full bg-emerald-700 hover:bg-emerald-600 text-white text-sm font-semibold py-2.5 rounded-xl transition-colors">✅ 取引をクローズ</button>
                    </div>
                  )}
                  {t.closed && t.result && <div className="text-xs text-gray-300 bg-gray-800 rounded-lg px-3 py-2 mt-2">📝 {t.result}</div>}
                </div>
              );
            })}
          </div>
        )}

        {page === "stats" && <StatsPage trades={trades} analyses={analyses} />}
        {page === "settings" && <SettingsPage settings={settings} onSettingsChange={setSettings} trades={trades} onTradesChange={persistTrades} showToast={showToast} />}
      </div>
    </div>
  );
}