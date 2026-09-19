import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  Bell, Menu, Plus, X, Search, ChevronDown, ChevronLeft, ChevronRight,
  ArrowLeftRight, Landmark, TrendingUp, TrendingDown, Receipt,
  Trash2, Grid3x3, PieChart as PieChartIcon, Home as HomeIcon,
  Tag, Check, Star, CreditCard, Lock, Sun, Moon, Image as ImageIcon,
  Repeat, Download, Upload, Bitcoin, Landmark as Bank, CalendarDays,
  BellRing, FileSpreadsheet, Printer, Users, ShieldCheck, Palette, Save,
  Eye, EyeOff, StickyNote, Mic, MicOff, LayoutGrid, LayoutList, ArrowUp, ArrowDown,
  DollarSign, RefreshCw, Sparkles, Type, Target
} from "lucide-react";
import {
  PieChart, Pie, Cell, Sector, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip,
  LineChart, Line, CartesianGrid
} from "recharts";
import * as XLSX from "xlsx";
import { Capacitor, CapacitorHttp } from "@capacitor/core";
import { BiometricAuth, AndroidBiometryStrength } from "@aparajita/capacitor-biometric-auth";
import { RexaNative } from "rexa-native";

/* ---------------------------------------------------------
   Helpers
--------------------------------------------------------- */
const toFaInt = (n) => Math.round(Number(n || 0)).toLocaleString("fa-IR");
const FA_DIGIT_MAP = ["۰", "۱", "۲", "۳", "۴", "۵", "۶", "۷", "۸", "۹"];
const faDigits = (n) => String(n).split("").map((ch) => (/[0-9]/.test(ch) ? FA_DIGIT_MAP[+ch] : ch)).join("");
function jalaliYear(d) {
  try { return parseInt(new Intl.DateTimeFormat("en-US-u-ca-persian", { year: "numeric" }).format(d), 10); }
  catch { return new Date(d).getFullYear(); }
}
function jalaliParts(d) {
  try {
    const parts = new Intl.DateTimeFormat("en-US-u-ca-persian", { year: "numeric", month: "numeric", day: "numeric" }).formatToParts(d);
    return {
      y: +parts.find((p) => p.type === "year").value,
      m: +parts.find((p) => p.type === "month").value,
      day: +parts.find((p) => p.type === "day").value,
    };
  } catch { return { y: d.getFullYear(), m: d.getMonth() + 1, day: d.getDate() }; }
}
function faLongDate(d) {
  try { return new Intl.DateTimeFormat("fa-IR", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(d); }
  catch { return d.toDateString(); }
}
function faMonthYear(d) {
  try { return new Intl.DateTimeFormat("fa-IR", { month: "long", year: "numeric" }).format(d); }
  catch { return ""; }
}
function faTime(d) {
  try { return new Intl.DateTimeFormat("fa-IR", { hour: "2-digit", minute: "2-digit" }).format(d); }
  catch { return ""; }
}
function addMonths(dateStr, n) {
  const d = new Date(dateStr);
  d.setMonth(d.getMonth() + n);
  return d.toISOString().slice(0, 10);
}
function addDays(dateStr, n) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
function daysUntil(dateStr) {
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const d = new Date(dateStr); d.setHours(0, 0, 0, 0);
  return Math.round((d - now) / 86400000);
}
const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
const todayISO = () => new Date().toISOString().slice(0, 10);

function findJalaliMonthStart(jYear, jMonth) {
  // Farvardin 1 (Jalali New Year) falls around March 21 of (jYear + 621) in the Gregorian
  // calendar, and each subsequent Jalali month is ~30 days later. This anchor gets us close
  // enough that a modest search window reliably lands on the true day 1 of the target month.
  const approxNewYear = new Date(Date.UTC(jYear + 621, 2, 21));
  const anchor = new Date(approxNewYear);
  anchor.setUTCDate(anchor.getUTCDate() + (jMonth - 1) * 30);
  for (let delta = -25; delta <= 25; delta++) {
    const d = new Date(anchor); d.setUTCDate(d.getUTCDate() + delta);
    const p = jalaliParts(d);
    if (p.y === jYear && p.m === jMonth && p.day === 1) return d;
  }
  return null;
}
function getJalaliMonthCells(jYear, jMonth) {
  const start = findJalaliMonthStart(jYear, jMonth);
  if (!start) return [];
  const cells = []; let d = new Date(start);
  for (let i = 0; i < 32; i++) {
    const p = jalaliParts(d);
    if (p.y !== jYear || p.m !== jMonth) break;
    cells.push({ date: new Date(d), day: p.day, weekday: (d.getUTCDay() + 1) % 7 });
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return cells;
}

function normalizeDigits(text = "") {
  return String(text)
    .replace(/[۰-۹]/g, (d) => "0123456789"["۰۱۲۳۴۵۶۷۸۹".indexOf(d)])
    .replace(/[٠-٩]/g, (d) => "0123456789"["٠١٢٣٤٥٦٧٨٩".indexOf(d)])
    .replace(/[٬,،]/g, "");
}
function digitsOnly(text = "") {
  return normalizeDigits(text).replace(/[^\d]/g, "");
}
function parseAmountSmart(text = "") {
  const s = normalizeDigits(text).toLowerCase().replace(/\u200c/g, " ");
  const m = s.match(/(\d+(?:\.\d+)?)\s*(میلیارد|میلیون|هزار|تومان|تومن|ریال)?/);
  if (!m) return null;
  let n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  const unit = m[2] || "";
  if (unit === "میلیارد") n *= 1_000_000_000;
  else if (unit === "میلیون") n *= 1_000_000;
  else if (unit === "هزار") n *= 1_000;
  if (/تومان|تومن/.test(unit)) n *= 10;
  return Math.round(n);
}
const AI_CATEGORY_HINTS = [
  { re: /بنزین|سوخت|پمپ/, name: "بنزین" },
  { re: /رستوران|غذا|شام|ناهار|صبحانه|خوراک|بازار|خرید|سوپرمارکت/, name: "خوراک و بازار" },
  { re: /قبض|آب|برق|گاز|اینترنت|شارژ/, name: "قبوض" },
  { re: /تاکسی|اتوبوس|مترو|حمل/, name: "حمل و نقل" },
  { re: /دارو|دکتر|درمان|بیمارستان/, name: "درمان" },
  { re: /حقوق|دستمزد|فیش/, name: "حقوق" },
];
function parseBankSms(text) {
  const source = String(text || "").trim();
  const s = normalizeDigits(source).replace(/\u200c/g, " ");
  let type = "expense";
  const income = /واریز|دریافت|بستانکار|حقوق|اعتبار|credit|deposit|income/i.test(s);
  const expense = /برداشت|خرید|انتقال|پرداخت|هزینه|بدهکار|debit|purchase|expense/i.test(s);
  if (income && !expense) type = "income";
  if (expense) type = "expense";

  const amountPatterns = [
    /(?:مبلغ|amount|برداشت|واریز|خرید|پرداخت)\s*[:：]?\s*([0-9][0-9,٬،]*(?:\.[0-9]+)?)\s*(ریال|تومان|تومن)?/i,
    /([0-9][0-9,٬،]*(?:\.[0-9]+)?)\s*(ریال|تومان|تومن)\b/i,
  ];
  let amount = null;
  let amountConfidence = 0;
  for (const re of amountPatterns) {
    const m = s.match(re);
    if (!m) continue;
    let n = Number(m[1].replace(/[^\d.]/g, ""));
    if (!Number.isFinite(n) || n <= 0) continue;
    const unit = m[2] || "";
    if (/تومان|تومن/.test(unit)) n *= 10;
    amount = Math.round(n);
    amountConfidence = unit ? .95 : .85;
    break;
  }
  if (!amount) {
    amount = parseAmountSmart(s);
    amountConfidence = amount ? .45 : 0;
  }

  const hint = AI_CATEGORY_HINTS.find((h) => h.re.test(source));
  const bankMarker = /بانک|ملت|ملی|صادرات|تجارت|رفاه|پارسیان|سامان|پاسارگاد|کشاورزی|مهر|رسالت|بلوبانک|بلوبانک|card|atm|pos|موجودی|مانده/i.test(source);
  const confidence = Math.min(1, amountConfidence + (bankMarker ? .2 : 0) + ((income || expense) ? .15 : 0));
  return { amount, type, note: source.slice(0, 240), categoryHint: hint?.name, confidence };
}

async function parseTransactionWithAI(text, { apiKey, categories = [], accounts = [], model = "gpt-5.6-luna", endpoint = "https://api.openai.com/v1/responses" } = {}) {
  if (!apiKey) throw new Error("کلید API هوش مصنوعی در تنظیمات وارد نشده است.");
  const categoryNames = categories.map((c) => c.name).join("، ");
  const accountNames = accounts.map((a) => a.name).join("، ");
  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      type: { type: "string", enum: ["expense", "income", "transfer"] },
      amountRial: { type: "integer", minimum: 1 },
      date: { type: "string" },
      categoryName: { type: ["string", "null"] },
      accountName: { type: ["string", "null"] },
      toAccountName: { type: ["string", "null"] },
      description: { type: "string" }
    },
    required: ["type", "amountRial", "date", "categoryName", "accountName", "toAccountName", "description"]
  };
  const payload = {
    model,
    input: [
      {
        role: "developer",
        content: [{
          type: "input_text",
          text: `تو دستیار ثبت حسابداری شخصی فارسی هستی. جمله کاربر را به یک تراکنش تبدیل کن.
مبلغ را همیشه به ریال بده. اگر کاربر تومان/تومن گفت، در 10 ضرب کن.
«امروز» یعنی تاریخ امروز دستگاه: ${todayISO()}.
برای هزینه/درآمد از یکی از دسته‌های موجود استفاده کن؛ اگر هیچ موردی مناسب نبود categoryName را null بده.
حساب را فقط از بین حساب‌های موجود انتخاب کن؛ اگر مشخص نشده accountName را null بده.
خروجی فقط مطابق JSON Schema باشد.
دسته‌ها: ${categoryNames || "ندارد"}
حساب‌ها: ${accountNames || "ندارد"}`
        }]
      },
      {
        role: "user",
        content: [{ type: "input_text", text: String(text).trim() }]
      }
    ],
    text: {
      format: {
        type: "json_schema",
        name: "rexa_transaction",
        strict: true,
        schema
      }
    }
  };
  let data;
  let status;
  if (Capacitor.isNativePlatform()) {
    const response = await CapacitorHttp.post({
      url: endpoint,
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      data: payload,
      connectTimeout: 20000,
      readTimeout: 30000,
      responseType: "json",
    });
    status = response.status;
    data = response.data;
    if (status < 200 || status >= 300) {
      const msg = typeof data === "string" ? data : JSON.stringify(data || "");
      throw new Error(`خطای سرویس هوش مصنوعی (${status})${msg ? `: ${msg.slice(0, 180)}` : ""}`);
    }
  } else {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify(payload)
    });
    status = response.status;
    if (!response.ok) {
      const msg = await response.text().catch(() => "");
      throw new Error(`خطای سرویس هوش مصنوعی (${status})${msg ? `: ${msg.slice(0, 180)}` : ""}`);
    }
    data = await response.json();
  }
  const raw = data.output_text || (data.output || []).flatMap((o) => o.content || []).find((c) => c.type === "output_text")?.text;
  if (!raw) throw new Error("پاسخ ساختاریافته‌ای از هوش مصنوعی دریافت نشد.");
  const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (!parsed.amountRial || !["expense", "income", "transfer"].includes(parsed.type)) throw new Error("اطلاعات تراکنش کامل تشخیص داده نشد.");
  return parsed;
}

// Currency display: base unit stored everywhere internally is always Rial.
// This only affects how numbers are *shown*, so data entry / storage stays consistent.
// usdRialRate = how many Rials one US Dollar costs right now (from the live rates widget,
// or the manual value the user entered in Settings if the live fetch didn't work).
function formatMoney(amount, currency, usdRialRate) {
  const n = Number(amount || 0);
  if (currency === "toman") return `${toFaInt(Math.round(n / 10))} تومان`;
  if (currency === "usd") {
    if (!usdRialRate) return `${toFaInt(n)} ریال`; // no rate yet, fall back to Rial rather than guess
    return `$${(n / usdRialRate).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  }
  return `${toFaInt(n)} ریال`;
}

function resizeImage(file, maxSize = 480) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new window.Image();
      img.onload = () => {
        let w = img.width, h = img.height;
        if (w > h) { if (w > maxSize) { h = h * maxSize / w; w = maxSize; } }
        else { if (h > maxSize) { w = w * maxSize / h; h = maxSize; } }
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", 0.7));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/* ---------------------------------------------------------
   Seed data
--------------------------------------------------------- */
const seedAccounts = () => ([
  { id: uid(), name: "بانک ملت", type: "bank", initial: 5000000 },
  { id: uid(), name: "صندوق نقدی", type: "fund", initial: 800000 },
  { id: uid(), name: "کارت عابر ملت", type: "card", initial: 0 },
]);
const seedCategories = () => ([
  { id: uid(), name: "بنزین", kind: "expense" },
  { id: uid(), name: "خوراک و بازار", kind: "expense" },
  { id: uid(), name: "قبوض", kind: "expense" },
  { id: uid(), name: "حمل و نقل", kind: "expense" },
  { id: uid(), name: "درمان", kind: "expense" },
  { id: uid(), name: "متفرقه", kind: "expense" },
  { id: uid(), name: "حقوق", kind: "income" },
  { id: uid(), name: "درآمد متفرقه", kind: "income" },
]);
const DEFAULT_HOME_SECTIONS = [
  { key: "shortcut", visible: true }, { key: "expense", visible: true }, { key: "income", visible: true },
  { key: "banks", visible: true }, { key: "funds", visible: true }, { key: "balrep", visible: true },
  { key: "budget", visible: true }, { key: "loanchk", visible: true }, { key: "bills", visible: true },
];
const seedSettings = () => ({
  theme: "light", pin: "", sharedFamily: false, themeColor: "purple",
  profile: { name: "alireza shadfar", phone: "", email: "" },
  homeLayout: "cards", homeSections: DEFAULT_HOME_SECTIONS,
  fontScale: 1, calendarMode: "jalali", currency: "rial",
  checkReminderDays: 7, smsNotif: false, smsAutoRead: false, biometricEnabled: false,
  aiProvider: "openai", aiApiKey: "", aiModel: "gpt-5.6-luna", aiEndpoint: "https://api.openai.com/v1/responses", manualUsdRate: "",
});

/* ---------------------------------------------------------
   Theme / palette
   BRAND is intentionally mutable: App() re-assigns its keys from the
   chosen preset on every render, so every component below (which reads
   BRAND.xxx directly at render time) automatically reflects the user's
   color choice without needing a context/hook everywhere.
--------------------------------------------------------- */
const COLOR_PRESETS = {
  purple: { name: "بنفش کلاسیک", header: "#3E1461", mauve: "#A65475", darkgreen: "#1B6B2C", green: "#1E8449", violet: "#6C3FA0", teal: "#4E9AA0", gold: "#A98A3B", crimson: "#B01E4A", orange: "#C56A1F", fab: "#28C76F" },
  ocean: { name: "آبی اقیانوسی", header: "#0B4F6C", mauve: "#3D7EA6", darkgreen: "#0F7173", green: "#14919B", violet: "#145DA0", teal: "#4CC9F0", gold: "#B08968", crimson: "#D64550", orange: "#F2A65A", fab: "#2EC4B6" },
  forest: { name: "سبز جنگلی", header: "#1B4332", mauve: "#40916C", darkgreen: "#2D6A4F", green: "#40916C", violet: "#52796F", teal: "#74C69D", gold: "#B08968", crimson: "#BC4749", orange: "#DDA15E", fab: "#52B788" },
  rose: { name: "گلبهی", header: "#6D2148", mauve: "#B23A5D", darkgreen: "#2D6A4F", green: "#40916C", violet: "#8E3B6C", teal: "#C9738A", gold: "#B08968", crimson: "#C1121F", orange: "#E07A5F", fab: "#F4978E" },
  charcoal: { name: "زغالی تیره", header: "#22223B", mauve: "#4A4E69", darkgreen: "#22577A", green: "#38A3A5", violet: "#4A4E69", teal: "#5C677D", gold: "#9A8C98", crimson: "#C9184A", orange: "#C08552", fab: "#57CC99" },
};
let BRAND = { ...COLOR_PRESETS.purple };
const THEME = {
  light: { bg: "#F1EFF4", card: "#ffffff", text: "#241a30", sub: "#8a8194", border: "#f0eef3", input: "#faf9fb", inputBorder: "#e3e0ea" },
  dark: { bg: "#17131c", card: "#241d2c", text: "#f1eef5", sub: "#a79fb3", border: "#332b3d", input: "#2c2434", inputBorder: "#3d3348" },
};
const FONT = "'Vazirmatn', Tahoma, 'Segoe UI', sans-serif";

// Storage abstraction: uses the Claude-artifact window.storage API when present
// (always true inside claude.ai), and falls back to localStorage automatically
// when this same code runs as a standalone deployed app / APK build.
const hasCloudStorage = typeof window !== "undefined" && window.storage && typeof window.storage.get === "function";
async function loadKey(key, fallback, shared) {
  try {
    if (hasCloudStorage) {
      const res = await window.storage.get(key, !!shared);
      return res && res.value ? JSON.parse(res.value) : fallback;
    }
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}
async function saveKey(key, value, shared) {
  try {
    if (hasCloudStorage) { await window.storage.set(key, JSON.stringify(value), !!shared); }
    else { window.localStorage.setItem(key, JSON.stringify(value)); }
  } catch (e) { console.error("save fail", e); }
}

/* ---------------------------------------------------------
   Small UI atoms (theme aware)
--------------------------------------------------------- */
function useT() { return React.useContext(ThemeCtx); }
const ThemeCtx = React.createContext(THEME.light);

function GaugeCircle({ value, max, color, label }) {
  const t = useT();
  const size = 156, stroke = 10, r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const frac = max > 0 ? Math.min(value / max, 1) : 0;
  const dash = Math.max(frac * c, value > 0 ? 6 : 0);
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
      <div style={{ position: "relative", width: size, height: size }}>
        <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={t.border} strokeWidth={stroke} />
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke}
            strokeDasharray={`${dash} ${c - dash}`} strokeLinecap="round" style={{ transition: "stroke-dasharray .6s" }} />
        </svg>
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: t.text }}>{toFaInt(value)}</div>
          <div style={{ fontSize: 10.5, color: t.sub, marginTop: 2 }}>ریال</div>
        </div>
      </div>
      <div style={{ fontWeight: 700, color, fontSize: 14.5 }}>{label}</div>
    </div>
  );
}

/* ---------------------------------------------------------
   Exploding / stylized pie chart — click a slice to pop it out
   a little and see its label. Recharts doesn't do true 3D, so
   "3D" here means a soft drop-shadow + slightly thicker ring to
   give it some depth rather than a flat chart.
--------------------------------------------------------- */
function renderExplodingSlice(props) {
  const { cx, cy, innerRadius, outerRadius, startAngle, endAngle, fill, payload, isActive } = props;
  const RADIAN = Math.PI / 180;
  const midAngle = (startAngle + endAngle) / 2;
  const offset = isActive ? 14 : 0;
  const ox = Math.cos(-midAngle * RADIAN) * offset;
  const oy = Math.sin(-midAngle * RADIAN) * offset;
  return (
    <g transform={`translate(${ox},${oy})`} style={{ filter: "drop-shadow(0px 3px 4px rgba(0,0,0,0.35))" }}>
      <Sector cx={cx} cy={cy} innerRadius={innerRadius} outerRadius={isActive ? outerRadius + 6 : outerRadius}
        startAngle={startAngle} endAngle={endAngle} fill={fill} stroke="#fff" strokeWidth={2} />
    </g>
  );
}
function ExplodingPie({ data, height = 220, currency, usdRate }) {
  const t = useT();
  const [active, setActive] = useState(null);
  if (!data || data.length === 0) return <EmptyRow text="داده‌ای برای نمایش نیست" />;
  const item = active != null ? data[active] : null;
  return (
    <div>
      <ResponsiveContainer width="100%" height={height}>
        <PieChart>
          <Pie data={data} dataKey="amount" nameKey="name" innerRadius={height * 0.16} outerRadius={height * 0.36}
            paddingAngle={2}
            onClick={(_, i) => setActive(active === i ? null : i)}
            shape={(props) => renderExplodingSlice({ ...props, isActive: active === props.index })}>
            {data.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} cursor="pointer" />)}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div style={{ textAlign: "center", minHeight: 20, fontSize: 13, fontWeight: 700, color: item ? PIE_COLORS[active % PIE_COLORS.length] : t.sub }}>
        {item ? `${item.name} — ${formatMoney(item.amount, currency, usdRate)}` : "برای جزئیات روی هر بخش بزن"}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center", marginTop: 8 }}>
        {data.map((d, i) => (
          <span key={i} onClick={() => setActive(active === i ? null : i)} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: t.sub, cursor: "pointer" }}>
            <span style={{ width: 9, height: 9, borderRadius: "50%", background: PIE_COLORS[i % PIE_COLORS.length] }} />
            {d.name}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------
   Half-circle speedometer gauge — e.g. check collection ratio
--------------------------------------------------------- */
function GaugeSpeedometer({ pct, label, colorFrom = "#B01E4A", colorTo = "#1E8449" }) {
  const t = useT();
  const size = 200, stroke = 16;
  const cx = size / 2, cy = size / 2 + 10, r = size / 2 - stroke;
  const clamped = Math.max(0, Math.min(100, pct));
  const angle = -180 + (clamped / 100) * 180; // -180 (left) .. 0 (right)
  const rad = (angle * Math.PI) / 180;
  const needleX = cx + r * 0.86 * Math.cos(rad);
  const needleY = cy + r * 0.86 * Math.sin(rad);
  const arc = (startDeg, endDeg, color) => {
    const s = (startDeg * Math.PI) / 180, e = (endDeg * Math.PI) / 180;
    const x1 = cx + r * Math.cos(s), y1 = cy + r * Math.sin(s);
    const x2 = cx + r * Math.cos(e), y2 = cy + r * Math.sin(e);
    const large = endDeg - startDeg > 180 ? 1 : 0;
    return <path d={`M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`} stroke={color} strokeWidth={stroke} fill="none" strokeLinecap="round" />;
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      <svg width={size} height={size / 2 + 30}>
        {arc(-180, 0, t.border)}
        {arc(-180, angle, clamped >= 60 ? colorTo : clamped >= 30 ? "#C56A1F" : colorFrom)}
        <line x1={cx} y1={cy} x2={needleX} y2={needleY} stroke={t.text} strokeWidth={3} strokeLinecap="round" />
        <circle cx={cx} cy={cy} r={7} fill={t.text} />
      </svg>
      <div style={{ fontSize: 20, fontWeight: 800, color: t.text, marginTop: -6 }}>{toFaInt(Math.round(clamped))}٪</div>
      <div style={{ fontSize: 12.5, color: t.sub, fontWeight: 600 }}>{label}</div>
    </div>
  );
}

/* ---------------------------------------------------------
   Bank card carousel — swipeable, with a show/hide-balance eye
--------------------------------------------------------- */
function BankCard({ account, balance, hidden, currency, usdRate }) {
  const last4 = account.cardNumberLast4 || account.id.slice(-4).toUpperCase();
  return (
    <div style={{
      minWidth: 300, maxWidth: 300, height: 176, borderRadius: 18, padding: 20, color: "#fff", flexShrink: 0,
      background: `linear-gradient(135deg, ${BRAND.violet}, ${BRAND.header})`,
      boxShadow: "0 6px 16px rgba(0,0,0,0.25)", display: "flex", flexDirection: "column", justifyContent: "space-between",
      scrollSnapAlign: "center", position: "relative", overflow: "hidden"
    }}>
      <div style={{ position: "absolute", top: -40, left: -40, width: 140, height: 140, borderRadius: "50%", background: "rgba(255,255,255,0.08)" }} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", zIndex: 1 }}>
        <div style={{ fontWeight: 800, fontSize: 15 }}>{account.name}</div>
        <div style={{ width: 34, height: 24, borderRadius: 6, background: "linear-gradient(135deg,#f5d98b,#c9a94a)" }} />
      </div>
      <div style={{ fontSize: 17, letterSpacing: 3, fontWeight: 700, zIndex: 1, direction: "ltr", textAlign: "left" }}>
        •••• •••• •••• {last4}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", zIndex: 1 }}>
        <div style={{ fontSize: 11, opacity: 0.8 }}>{account.type === "card" ? "کارت" : "بانک"}</div>
        <div style={{ fontSize: 15, fontWeight: 800 }}>{hidden ? "••••••••" : formatMoney(balance, currency, usdRate)}</div>
      </div>
    </div>
  );
}
function BankCardCarousel({ accounts, accountBalance, currency, usdRate, onAddCard }) {
  const t = useT();
  const [hidden, setHidden] = useState(false);
  const cards = accounts.filter((a) => a.type === "bank" || a.type === "card");
  return (
    <div style={{ marginBottom: 16 }}>
      {cards.length > 0 && (
        <div style={{ display: "flex", justifyContent: "flex-end", padding: "0 4px 6px" }}>
          <button onClick={() => setHidden((v) => !v)} style={{ background: "none", border: "none", color: t.sub, cursor: "pointer", display: "flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 600 }}>
            {hidden ? <EyeOff size={15} /> : <Eye size={15} />} {hidden ? "نمایش موجودی" : "مخفی کردن موجودی"}
          </button>
        </div>
      )}
      <div style={{ display: "flex", gap: 12, overflowX: "auto", scrollSnapType: "x mandatory", paddingBottom: 4, paddingInline: 2 }}>
        {cards.map((a) => <BankCard key={a.id} account={a} balance={accountBalance(a.id)} hidden={hidden} currency={currency} usdRate={usdRate} />)}
        <button onClick={onAddCard} style={{
          minWidth: 300, maxWidth: 300, height: 176, borderRadius: 18, flexShrink: 0, scrollSnapAlign: "center",
          border: `2px dashed ${t.border}`, background: t.card, display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center", gap: 8, cursor: "pointer", color: t.sub
        }}>
          <span style={{ width: 44, height: 44, borderRadius: "50%", background: BRAND.violet, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Plus size={22} />
          </span>
          <span style={{ fontSize: 12.5, fontWeight: 700 }}>افزودن کارت/حساب جدید</span>
        </button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------
   Today box: date + quick note / reminder buttons
--------------------------------------------------------- */
function DateQuickBox({ onNote, onReminder }) {
  const t = useT();
  return (
    <div style={{ background: t.card, borderRadius: 14, padding: "12px 16px", marginBottom: 16, display: "flex", alignItems: "center", justifyContent: "space-between", boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
      <div style={{ color: t.text, fontSize: 13, fontWeight: 700 }}>{faLongDate(new Date())}</div>
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={onNote} style={{ ...quickPillBtn, background: BRAND.violet }}><StickyNote size={13} /> یادداشت</button>
        <button onClick={onReminder} style={{ ...quickPillBtn, background: BRAND.orange }}><BellRing size={13} /> یادآوری</button>
      </div>
    </div>
  );
}
const quickPillBtn = { display: "flex", alignItems: "center", gap: 4, border: "none", color: "#fff", borderRadius: 20, padding: "6px 10px", fontSize: 11.5, fontWeight: 700, cursor: "pointer" };

/* ---------------------------------------------------------
   Income/Expense day widget — day navigation + smile/frown arc
   + an exploding pie of that day's categories
--------------------------------------------------------- */
function SmileFrownArc({ income, expense }) {
  const w = 180, h = 70, cx = w / 2, cy = 8;
  const r = 60;
  if (income === expense) {
    return (
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
        <line x1={cx - r} y1={cy} x2={cx + r} y2={cy} stroke={BRAND.crimson} strokeWidth={6} strokeLinecap="round" />
      </svg>
    );
  }
  const smile = income > expense;
  const path = `M ${cx - r} ${cy} A ${r} ${r} 0 0 ${smile ? 0 : 1} ${cx + r} ${cy}`;
  const color = smile ? BRAND.darkgreen : BRAND.crimson;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      <path d={path + ` L ${cx + r} ${cy} Z`} fill={color} opacity={0.85} />
    </svg>
  );
}
function IncomeExpenseDayWidget({ day, setDay, transactions, catById, currency, usdRate }) {
  const t = useT();
  const dayTx = transactions.filter((tx) => tx.date === day);
  const income = dayTx.filter((tx) => tx.type === "income").reduce((s, tx) => s + tx.amount, 0);
  const expense = dayTx.filter((tx) => tx.type === "expense").reduce((s, tx) => s + tx.amount, 0);
  const net = income - expense;
  const pieData = useMemo(() => {
    const map = {};
    dayTx.filter((tx) => tx.type !== "transfer").forEach((tx) => {
      const name = catById(tx.categoryId)?.name || "—";
      map[name] = (map[name] || 0) + tx.amount;
    });
    return Object.entries(map).map(([name, amount]) => ({ name, amount }));
  }, [dayTx, catById]);
  return (
    <div style={{ background: t.card, borderRadius: 16, padding: 16, marginBottom: 16, boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
        <button onClick={() => setDay(addDays(day, -1))} style={navArrowStyle(t)}><ChevronRight size={16} /></button>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: t.sub }}>{faLongDate(new Date(day))}</div>
        <button onClick={() => setDay(addDays(day, 1))} style={navArrowStyle(t)}><ChevronLeft size={16} /></button>
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 10 }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 11, color: t.sub }}>درآمد</div>
          <div style={{ fontWeight: 800, color: BRAND.darkgreen, fontSize: 14 }}>{formatMoney(income, currency, usdRate)}</div>
        </div>
        <div style={{ textAlign: "center" }}>
          <SmileFrownArc income={income} expense={expense} />
          <div style={{ fontWeight: 800, fontSize: 15, color: net >= 0 ? BRAND.darkgreen : BRAND.crimson, marginTop: -4 }}>{formatMoney(Math.abs(net), currency, usdRate)}</div>
        </div>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 11, color: t.sub }}>هزینه</div>
          <div style={{ fontWeight: 800, color: BRAND.crimson, fontSize: 14 }}>{formatMoney(expense, currency, usdRate)}</div>
        </div>
      </div>
      <div style={{ marginTop: 8 }}>
        <ExplodingPie data={pieData} height={190} currency={currency} usdRate={usdRate} />
      </div>
    </div>
  );
}

function CollapsibleSection({ color, title, open, onToggle, children, badge, onAdd }) {
  const t = useT();
  return (
    <div style={{ borderRadius: 14, overflow: "hidden", marginBottom: 12, boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
      <div onClick={onToggle} style={{
        width: "100%", background: color, border: "none", color: "#fff", padding: "15px 16px",
        display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer", fontFamily: "inherit"
      }}>
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 32, height: 32, borderRadius: "50%", background: "rgba(255,255,255,.18)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <ChevronDown size={17} style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform .2s" }} />
          </span>
          {onAdd && (
            <button onClick={(e) => { e.stopPropagation(); onAdd(); }} style={{
              width: 30, height: 30, borderRadius: "50%", background: "rgba(255,255,255,.22)", border: "none",
              color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer"
            }}>
              <Plus size={16} />
            </button>
          )}
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, fontSize: 15 }}>
          {badge}{title}
        </span>
      </div>
      {open && <div style={{ background: t.card, padding: "6px 14px" }}>{children}</div>}
    </div>
  );
}

function Row({ leftIcon, leftColor = "#eee", title, subtitle, value, valueColor, onClick, chevron = "left", extra }) {
  const t = useT();
  return (
    <div onClick={onClick} style={{
      display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 4px",
      borderBottom: `1px solid ${t.border}`, cursor: onClick ? "pointer" : "default"
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
        {chevron && <ChevronLeft size={16} color={t.sub} style={{ flexShrink: 0, transform: chevron === "left" ? "none" : "rotate(180deg)" }} />}
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14.5, fontWeight: 600, color: t.text }}>{title}</div>
          {subtitle && <div style={{ fontSize: 12, color: t.sub, marginTop: 2 }}>{subtitle}</div>}
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
        {extra}
        {value !== undefined && <span style={{ fontSize: 13.5, fontWeight: 700, color: valueColor || t.text }}>{value}</span>}
        {leftIcon && (
          <span style={{ width: 36, height: 36, borderRadius: 10, background: leftColor, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff" }}>
            {leftIcon}
          </span>
        )}
      </div>
    </div>
  );
}
function EmptyRow({ text }) { const t = useT(); return <div style={{ padding: "16px 4px", textAlign: "center", color: t.sub, fontSize: 13 }}>{text}</div>; }
function AddLink({ text, onClick }) { return <div onClick={onClick} style={{ padding: "10px 4px", color: BRAND.header, fontSize: 13, fontWeight: 700, cursor: "pointer", textAlign: "center" }}>{text}</div>; }
function SectionTitle({ text }) { const t = useT(); return <div style={{ fontWeight: 700, fontSize: 14, color: t.text, margin: "6px 4px 10px" }}>{text}</div>; }
function StatusBadge({ text, color }) { return <span style={{ fontSize: 11, fontWeight: 700, color: "#fff", background: color, padding: "3px 9px", borderRadius: 20 }}>{text}</span>; }

function pillStyle(active) {
  return { flex: 1, padding: "8px 4px", borderRadius: 8, border: `1.5px solid ${active ? BRAND.header : "#ccc4d8"}`, background: active ? BRAND.header : "transparent", color: active ? "#fff" : "inherit", cursor: "pointer", fontWeight: 700, fontSize: 13 };
}
function useStyles() {
  const t = useT();
  return {
    input: { width: "100%", padding: "10px 12px", borderRadius: 9, border: `1.5px solid ${t.inputBorder}`, marginBottom: 10, fontSize: 14, outline: "none", background: t.input, color: t.text },
    primaryBtn: { width: "100%", padding: "11px", borderRadius: 9, border: "none", background: BRAND.fab, color: "#fff", fontWeight: 700, fontSize: 14, cursor: "pointer" },
    label: { display: "block", fontSize: 12.5, color: t.sub, fontWeight: 600, marginBottom: 6 },
    card: { background: t.card, borderRadius: 14, boxShadow: "0 1px 3px rgba(0,0,0,0.08)" },
  };
}

/* ---------------------------------------------------------
   Header + BottomNav
--------------------------------------------------------- */
function Header({ title = "alireza shadfar", onMenu, back, onBack, onMic }) {
  return (
    <div style={{ background: BRAND.header, color: "#fff", padding: "calc(env(safe-area-inset-top, 0px) + 14px) 16px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 20 }}>
      {back ? <button onClick={onBack} style={iconBtn}><ChevronRight size={24} /></button> : <Bell size={22} />}
      <div style={{ fontWeight: 700, fontSize: 17 }}>{title}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        {onMic && <VoiceCaptureButton onResult={onMic} />}
        <button onClick={onMenu} style={iconBtn}><Menu size={22} /></button>
      </div>
    </div>
  );
}
const iconBtn = { background: "none", border: "none", color: "#fff", cursor: "pointer" };

function VoiceCaptureButton({ onResult, disabled = false }) {
  const [listening, setListening] = useState(false);
  const [supported, setSupported] = useState(false);
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const native = await RexaNative.isSpeechAvailable();
        if (active && native?.available) setSupported(true);
      } catch {}
      if (active && (window.SpeechRecognition || window.webkitSpeechRecognition)) setSupported(true);
    })();
    return () => { active = false; };
  }, []);

  async function start() {
    if (disabled || listening) return;
    setListening(true);
    try {
      const native = await RexaNative.startSpeech({ language: "fa-IR" });
      if (native?.text) {
        onResult(native.text);
        setListening(false);
      }
      return;
    } catch (nativeError) {
      // Browser fallback for web preview or devices without the native recognizer.
    }
    const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Rec) {
      setListening(false);
      alert("تشخیص گفتار روی این دستگاه در دسترس نیست.");
      return;
    }
    const rec = new Rec();
    rec.lang = "fa-IR";
    rec.interimResults = false;
    rec.continuous = false;
    rec.maxAlternatives = 3;
    rec.onstart = () => setListening(true);
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    rec.onresult = (e) => {
      const transcript = e.results?.[0]?.[0]?.transcript;
      if (transcript) onResult(transcript);
    };
    try { rec.start(); } catch { setListening(false); }
  }
  return (
    <button onClick={start} disabled={disabled} style={{ ...iconBtn, color: listening ? "#ffd166" : "#fff", opacity: disabled ? .5 : 1 }} title={supported ? "ثبت با صدای فارسی" : "ثبت صوتی"}>
      {listening ? <MicOff size={20} /> : <Mic size={20} />}
    </button>
  );
}
function BottomNav({ active, setActive, onAdd }) {
  const t = useT();
  const items = [
    { key: "operations", label: "عملیات", icon: Grid3x3 },
    { key: "reports", label: "گزارش ها", icon: PieChartIcon },
    { key: "transactions", label: "تراکنش ها", icon: Receipt },
    { key: "checks", label: "چک ها", icon: FileSpreadsheet },
    { key: "home", label: "خانه", icon: HomeIcon },
  ];
  return (
    <div style={{ position: "sticky", bottom: 0, background: t.card, borderTop: `1px solid ${t.border}`, display: "flex", alignItems: "center", justifyContent: "space-around", padding: "8px 4px calc(env(safe-area-inset-bottom, 0px) + 10px)", zIndex: 20 }}>
      {items.slice(0, 2).map((it) => <NavBtn key={it.key} it={it} active={active} setActive={setActive} />)}
      <button onClick={onAdd} style={{ width: 54, height: 54, borderRadius: "50%", background: BRAND.fab, border: `4px solid ${t.card}`, marginTop: -26, boxShadow: "0 3px 10px rgba(0,0,0,0.25)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", cursor: "pointer" }}>
        <Plus size={26} />
      </button>
      {items.slice(2).map((it) => <NavBtn key={it.key} it={it} active={active} setActive={setActive} />)}
    </div>
  );
}
function NavBtn({ it, active, setActive }) {
  const Icon = it.icon; const isActive = active === it.key;
  return (
    <button onClick={() => setActive(it.key)} style={{ background: "none", border: "none", display: "flex", flexDirection: "column", alignItems: "center", gap: 3, color: isActive ? BRAND.header : "#8a8a8a", cursor: "pointer", fontFamily: "inherit" }}>
      <Icon size={22} />
      <span style={{ fontSize: 11, fontWeight: isActive ? 700 : 500 }}>{it.label}</span>
    </button>
  );
}

/* ---------------------------------------------------------
   Lock screen
--------------------------------------------------------- */
function LockScreen({ pin, biometricEnabled, onUnlock }) {
  const [val, setVal] = useState("");
  const [err, setErr] = useState(false);
  const [bioBusy, setBioBusy] = useState(false);

  async function unlockBiometric() {
    setBioBusy(true);
    setErr(false);
    try {
      const result = await BiometricAuth.checkBiometry();
      if (!result?.isAvailable) throw new Error("بیومتریک در این گوشی برای برنامه فعال نیست.");
      await BiometricAuth.authenticate({
        reason: "برای ورود به حسابداری Rexa هویت خود را تأیید کنید.",
        allowDeviceCredential: true,
        androidTitle: "ورود به Rexa",
        androidSubtitle: "اثر انگشت یا روش امنیتی دستگاه",
        androidConfirmationRequired: false,
        androidBiometryStrength: AndroidBiometryStrength.weak,
      });
      onUnlock();
    } catch (e) {
      setErr(e?.message || "احراز هویت ناموفق بود.");
    } finally {
      setBioBusy(false);
    }
  }

  return (
    <div dir="rtl" style={{ minHeight: "100vh", background: BRAND.header, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", fontFamily: FONT, color: "#fff", gap: 18, maxWidth: 480, margin: "0 auto" }}>
      <div style={{ fontSize: 42, fontWeight: 900, letterSpacing: -2, transform: "skew(-8deg)", textShadow: "0 4px 18px rgba(0,0,0,.25)" }}>Rexa</div>
      <Lock size={38} />
      <div style={{ fontWeight: 700, fontSize: 16 }}>حسابدار Rexa قفل است</div>
      {biometricEnabled && (
        <button onClick={unlockBiometric} disabled={bioBusy}
          style={{ background: BRAND.fab, color: "#fff", border: "none", borderRadius: 12, padding: "12px 26px", fontWeight: 800, cursor: "pointer", opacity: bioBusy ? .65 : 1 }}>
          {bioBusy ? "در حال بررسی..." : "ورود با اثر انگشت / قفل دستگاه"}
        </button>
      )}
      {pin && (
        <>
          <input type="password" inputMode="numeric" maxLength={6} value={val}
            onChange={(e) => { setVal(e.target.value.replace(/[^0-9]/g, "")); setErr(false); }}
            placeholder="رمز عبور"
            style={{ width: 180, textAlign: "center", fontSize: 22, letterSpacing: 6, padding: "10px", borderRadius: 10, border: "none", outline: "none" }}
          />
          <button onClick={() => (val === pin ? onUnlock() : setErr(true))}
            style={{ background: "#fff", color: BRAND.header, border: "none", borderRadius: 9, padding: "10px 30px", fontWeight: 700, cursor: "pointer" }}>
            باز کردن با رمز
          </button>
        </>
      )}
      {err && <div style={{ color: "#ffd0d9", fontSize: 12.5, maxWidth: 300, textAlign: "center" }}>{err}</div>}
    </div>
  );
}
/* ===========================================================
   MAIN APP
=========================================================== */
export default function App() {
  const [loaded, setLoaded] = useState(false);
  const [settings, setSettings] = useState(seedSettings());
  const [unlocked, setUnlocked] = useState(false);

  const [accounts, setAccounts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [budgets, setBudgets] = useState([]);
  const [loans, setLoans] = useState([]);
  const [checks, setChecks] = useState([]);
  const [bills, setBills] = useState([]);
  const [assets, setAssets] = useState([]);
  const [recurring, setRecurring] = useState([]);
  const [favorites, setFavorites] = useState({ categories: [], accounts: [] });
  const [members, setMembers] = useState([]);
  const [events, setEvents] = useState([]);
  const [projects, setProjects] = useState([]);
  const [fiscalPeriods, setFiscalPeriods] = useState([]);
  const [notes, setNotes] = useState([]);
  const [reminders, setReminders] = useState([]);

  const [tab, setTab] = useState("home");
  const [subView, setSubView] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [prefillTx, setPrefillTx] = useState(null);
  const [open, setOpen] = useState({});
  const [year, setYear] = useState(jalaliYear(new Date()));
  const [homeDay, setHomeDay] = useState(todayISO());
  const [txFilter, setTxFilter] = useState("all");
  const [txSearch, setTxSearch] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [showNoteModal, setShowNoteModal] = useState(false);
  const [showReminderModal, setShowReminderModal] = useState(false);
  const [showCapture, setShowCapture] = useState(false);
  const [rates, setRates] = useState(null); // { usd: rialsPerUsd, fetchedAt }
  const tapTimesRef = useRef([]);
  const processedSmsIdsRef = useRef(new Set());
  function handleTripleTap() {
    const now = Date.now();
    const recent = [...tapTimesRef.current.filter((tms) => now - tms < 600), now];
    tapTimesRef.current = recent;
    if (recent.length >= 3) {
      tapTimesRef.current = [];
      setShowCapture(true);
    }
  }

  const shared = settings.sharedFamily;

  const reloadAll = useCallback(async (sh) => {
    const [a, c, t, b, ln, ck, bl, as, rc, fv, mb, ev, pj, fp, nt, rm] = await Promise.all([
      loadKey("hs:accounts", null, sh), loadKey("hs:categories", null, sh),
      loadKey("hs:transactions", null, sh), loadKey("hs:budgets", null, sh),
      loadKey("hs:loans", [], sh), loadKey("hs:checks", [], sh),
      loadKey("hs:bills", [], sh), loadKey("hs:assets", [], sh),
      loadKey("hs:recurring", [], sh), loadKey("hs:favorites", { categories: [], accounts: [] }, sh),
      loadKey("hs:members", [], sh), loadKey("hs:events", [], sh),
      loadKey("hs:projects", [], sh), loadKey("hs:fiscalPeriods", [], sh),
      loadKey("hs:notes", [], sh), loadKey("hs:reminders", [], sh),
    ]);
    setAccounts(a || seedAccounts());
    setCategories(c || seedCategories());
    setTransactions(t || []);
    setBudgets(b || []);
    setLoans(ln); setChecks(ck); setBills(bl); setAssets(as); setRecurring(rc); setFavorites(fv);
    setMembers(mb); setEvents(ev); setProjects(pj); setFiscalPeriods(fp);
    setNotes(nt); setReminders(rm);
  }, []);

  useEffect(() => {
    (async () => {
      const s = await loadKey("hs:settings", seedSettings(), false);
      setSettings(s);
      await reloadAll(s.sharedFamily);
      setLoaded(true);
    })();
    // eslint-disable-next-line
  }, []);

  useEffect(() => { if (loaded) saveKey("hs:settings", settings, false); }, [settings, loaded]);
  useEffect(() => {
    if (!loaded || !settings.smsAutoRead) return;
    let listener;
    let active = true;
    (async () => {
      try {
        listener = await RexaNative.addListener("smsReceived", (message) => {
          if (active) handleSmsMessage(message);
        });
        const pending = await RexaNative.getPendingSms();
        for (const message of (pending?.messages || [])) {
          if (!active) break;
          await handleSmsMessage(message);
        }
        const since = Date.now() - 24 * 60 * 60 * 1000;
        const result = await RexaNative.getRecentSms({ limit: 40, since });
        for (const message of (result?.messages || []).reverse()) {
          if (!active) break;
          await handleSmsMessage(message);
        }
      } catch (e) {
        console.warn("Rexa SMS integration unavailable", e);
      }
    })();
    return () => {
      active = false;
      listener?.remove?.();
    };
  }, [loaded, settings.smsAutoRead]);
  useEffect(() => { if (loaded) saveKey("hs:accounts", accounts, shared); }, [accounts, loaded, shared]);
  useEffect(() => { if (loaded) saveKey("hs:categories", categories, shared); }, [categories, loaded, shared]);
  useEffect(() => { if (loaded) saveKey("hs:transactions", transactions, shared); }, [transactions, loaded, shared]);
  useEffect(() => { if (loaded) saveKey("hs:budgets", budgets, shared); }, [budgets, loaded, shared]);
  useEffect(() => { if (loaded) saveKey("hs:loans", loans, shared); }, [loans, loaded, shared]);
  useEffect(() => { if (loaded) saveKey("hs:checks", checks, shared); }, [checks, loaded, shared]);
  useEffect(() => { if (loaded) saveKey("hs:bills", bills, shared); }, [bills, loaded, shared]);
  useEffect(() => { if (loaded) saveKey("hs:assets", assets, shared); }, [assets, loaded, shared]);
  useEffect(() => { if (loaded) saveKey("hs:recurring", recurring, shared); }, [recurring, loaded, shared]);
  useEffect(() => { if (loaded) saveKey("hs:favorites", favorites, shared); }, [favorites, loaded, shared]);
  useEffect(() => { if (loaded) saveKey("hs:members", members, shared); }, [members, loaded, shared]);
  useEffect(() => { if (loaded) saveKey("hs:events", events, shared); }, [events, loaded, shared]);
  useEffect(() => { if (loaded) saveKey("hs:projects", projects, shared); }, [projects, loaded, shared]);
  useEffect(() => { if (loaded) saveKey("hs:fiscalPeriods", fiscalPeriods, shared); }, [fiscalPeriods, loaded, shared]);
  useEffect(() => { if (loaded) saveKey("hs:notes", notes, shared); }, [notes, loaded, shared]);
  useEffect(() => { if (loaded) saveKey("hs:reminders", reminders, shared); }, [reminders, loaded, shared]);

  // process recurring templates once after load
  useEffect(() => {
    if (!loaded) return;
    let changed = false;
    const newTx = [];
    const updated = recurring.map((r) => {
      if (!r.active) return r;
      let next = r.nextDate; let guard = 0; let rr = { ...r };
      while (next <= todayISO() && guard < 24) {
        newTx.push({ id: uid(), type: rr.type, amount: rr.amount, categoryId: rr.categoryId, accountId: rr.accountId, date: next, note: rr.note || "تراکنش تکرارشونده", tags: ["تکرارشونده"], createdAt: new Date().toISOString(), recurringId: rr.id });
        next = rr.interval === "weekly" ? addDays(next, 7) : addMonths(next, 1);
        guard++; changed = true;
      }
      return { ...rr, nextDate: next };
    });
    if (changed) {
      setRecurring(updated);
      setTransactions((prev) => [...newTx, ...prev]);
    }
    // eslint-disable-next-line
  }, [loaded]);

  const toggle = (key) => setOpen((o) => ({ ...o, [key]: !o[key] }));
  const catById = useCallback((id) => categories.find((c) => c.id === id), [categories]);
  const accById = useCallback((id) => accounts.find((a) => a.id === id), [accounts]);

  const accountBalance = useCallback((accId) => {
    const acc = accById(accId); if (!acc) return 0;
    let bal = acc.initial || 0;
    transactions.forEach((t) => {
      if (t.type === "expense" && t.accountId === accId) bal -= t.amount;
      if (t.type === "income" && t.accountId === accId) bal += t.amount;
      if (t.type === "transfer") { if (t.accountId === accId) bal -= t.amount; if (t.toAccountId === accId) bal += t.amount; }
    });
    return bal;
  }, [accounts, transactions, accById]);

  const totalBalance = useMemo(() => accounts.reduce((s, a) => s + accountBalance(a.id), 0), [accounts, accountBalance]);
  const totalAssets = useMemo(() => assets.reduce((s, a) => s + (a.quantity * a.currentPrice || 0), 0), [assets]);

  const yearTx = useMemo(() => transactions.filter((t) => jalaliYear(new Date(t.date)) === year), [transactions, year]);
  const totalIncomeYear = useMemo(() => yearTx.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0), [yearTx]);
  const totalExpenseYear = useMemo(() => yearTx.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0), [yearTx]);
  const gaugeMax = Math.max(totalIncomeYear, totalExpenseYear, 1);

  const expenseByCategory = useMemo(() => {
    const map = {};
    yearTx.filter((t) => t.type === "expense").forEach((t) => { map[t.categoryId] = (map[t.categoryId] || 0) + t.amount; });
    return Object.entries(map).map(([catId, amount]) => ({ catId, amount, name: catById(catId)?.name || "بدون دسته" })).sort((a, b) => b.amount - a.amount);
  }, [yearTx, catById]);
  const incomeByCategory = useMemo(() => {
    const map = {};
    yearTx.filter((t) => t.type === "income").forEach((t) => { map[t.categoryId] = (map[t.categoryId] || 0) + t.amount; });
    return Object.entries(map).map(([catId, amount]) => ({ catId, amount, name: catById(catId)?.name || "بدون دسته" })).sort((a, b) => b.amount - a.amount);
  }, [yearTx, catById]);

  function groupBy(idField, list) {
    const map = {};
    yearTx.filter((tx) => tx.type === "expense" && tx[idField]).forEach((tx) => { map[tx[idField]] = (map[tx[idField]] || 0) + tx.amount; });
    return Object.entries(map).map(([id, amount]) => ({ id, amount, name: list.find((x) => x.id === id)?.name || "—" })).sort((a, b) => b.amount - a.amount);
  }
  const expenseByMember = useMemo(() => groupBy("memberId", members), [yearTx, members]);
  const expenseByEvent = useMemo(() => groupBy("eventId", events), [yearTx, events]);
  const expenseByProject = useMemo(() => groupBy("projectId", projects), [yearTx, projects]);

  // net worth trend: last 8 months
  const netWorthTrend = useMemo(() => {
    const points = [];
    for (let i = 7; i >= 0; i--) {
      const d = new Date(); d.setMonth(d.getMonth() - i);
      const cutoff = d.toISOString().slice(0, 10);
      let bal = accounts.reduce((s, a) => s + (a.initial || 0), 0);
      transactions.forEach((t) => {
        if (t.date > cutoff) return;
        if (t.type === "expense") bal -= t.amount;
        if (t.type === "income") bal += t.amount;
      });
      points.push({ name: faMonthYear(d).split(" ")[0], مانده: bal });
    }
    return points;
  }, [accounts, transactions]);

  function addTransaction(tx) { const id = uid(); setTransactions((p) => [{ ...tx, id, createdAt: new Date().toISOString() }, ...p]); return id; }

  async function registerSmartTransaction(text) {
    const source = String(text || "").trim();
    if (!source) return false;
    try {
      let parsed;
      if (settings.aiApiKey) {
        parsed = await parseTransactionWithAI(source, {
          apiKey: settings.aiApiKey,
          categories,
          accounts,
          model: settings.aiModel || "gpt-5.6-luna",
          endpoint: settings.aiEndpoint || "https://api.openai.com/v1/responses",
        });
      } else {
        parsed = {
          ...parseBankSms(source),
          amountRial: parseAmountSmart(source),
          date: todayISO(),
          categoryName: parseBankSms(source).categoryHint || null,
          accountName: null,
          toAccountName: null,
          description: source,
        };
      }
      const kind = parsed.type;
      if (!parsed.amountRial || !["expense", "income", "transfer"].includes(kind)) return false;

      const findCat = (name, type) => {
        if (!name) return null;
        const exact = categories.find((c) => c.kind === type && c.name.trim() === String(name).trim());
        if (exact) return exact;
        return categories.find((c) => c.kind === type && c.name.includes(String(name).trim()));
      };
      const fallbackCat = categories.find((c) => c.kind === kind) ||
        categories.find((c) => c.name === (kind === "income" ? "درآمد متفرقه" : "متفرقه"));
      const account = accounts.find((a) => parsed.accountName && a.name.trim() === String(parsed.accountName).trim()) || accounts[0];
      const toAccount = accounts.find((a) => parsed.toAccountName && a.name.trim() === String(parsed.toAccountName).trim()) ||
        accounts.find((a) => a.id !== account?.id);
      const category = findCat(parsed.categoryName, kind) || fallbackCat;

      if (!account || !category && kind !== "transfer") {
        openWithPrefill({ type: kind, amount: parsed.amountRial, categoryHint: parsed.categoryName, note: parsed.description || source });
        return null;
      }
      if (kind === "transfer" && (!account || !toAccount || account.id === toAccount.id)) {
        openWithPrefill({ type: kind, amount: parsed.amountRial, note: parsed.description || source });
        return null;
      }

      const txId = addTransaction({
        type: kind,
        amount: Number(parsed.amountRial),
        categoryId: category?.id,
        accountId: account?.id,
        toAccountId: toAccount?.id,
        date: parsed.date || todayISO(),
        note: parsed.description || source,
        tags: ["ثبت هوشمند"],
        smartSource: settings.aiApiKey ? "ai" : "local",
      });
      return txId;
    } catch (e) {
      alert(e?.message || "ثبت هوشمند انجام نشد.");
      return false;
    }
  }

  async function handleSmsMessage(message) {
    if (!settings.smsAutoRead || !message?.body) return;
    const smsId = String(message.id);
    if (processedSmsIdsRef.current.has(smsId)) return;
    const duplicate = transactions.some((tx) => tx.sourceSmsId === smsId);
    if (duplicate) { processedSmsIdsRef.current.add(smsId); return; }
    processedSmsIdsRef.current.add(smsId);
    const parsed = parseBankSms(message.body);
    if (!parsed.amount || parsed.confidence < 0.75) return;
    const source = `پیامک بانکی: ${message.body}`;
    try {
      const txId = await registerSmartTransaction(source);
      if (!txId) { processedSmsIdsRef.current.delete(smsId); return; }
      setTransactions((prev) => prev.map((tx) => tx.id === txId
        ? { ...tx, sourceSmsId: smsId, smsSender: message.address, smsDate: message.date }
        : tx));
    } catch {}
  }
  function addAccount(a) { setAccounts((p) => [...p, { ...a, id: uid() }]); }
  function deleteAccount(id) { setAccounts((p) => p.filter((a) => a.id !== id)); }
  function addCategory(c) { setCategories((p) => [...p, { ...c, id: uid() }]); }
  function deleteCategory(id) { setCategories((p) => p.filter((c) => c.id !== id)); }
  function upsertBudget(categoryId, amount) {
    setBudgets((prev) => prev.find((b) => b.categoryId === categoryId)
      ? prev.map((b) => (b.categoryId === categoryId ? { ...b, amount } : b))
      : [...prev, { id: uid(), categoryId, amount }]);
  }
  function toggleFavorite(kind, id) {
    setFavorites((prev) => {
      const list = prev[kind];
      return { ...prev, [kind]: list.includes(id) ? list.filter((x) => x !== id) : [...list, id] };
    });
  }

  // Live currency rates: best-effort fetch from a free, no-key, CORS-enabled endpoint.
  // Works when the phone has internet; if the fetch fails (offline, endpoint down,
  // or blocked network) we fall back to whatever the user entered manually in Settings.
  async function fetchRates() {
    try {
      const res = await fetch("https://open.er-api.com/v6/latest/USD");
      const data = await res.json();
      const irr = data?.rates?.IRR;
      if (irr) {
        setRates({ usd: irr, fetchedAt: new Date().toISOString(), source: "live" });
        return;
      }
      throw new Error("no IRR rate in response");
    } catch (e) {
      const manual = Number(settings.manualUsdRate);
      if (manual > 0) setRates({ usd: manual, fetchedAt: new Date().toISOString(), source: "manual" });
      else setRates({ usd: null, fetchedAt: new Date().toISOString(), source: "failed" });
    }
  }
  useEffect(() => { if (loaded) fetchRates(); /* eslint-disable-next-line */ }, [loaded]);

  const backupState = { accounts, categories, transactions, budgets, loans, checks, bills, assets, recurring, favorites, settings: { ...settings, aiApiKey: "" }, members, events, projects, fiscalPeriods, notes, reminders };
  function exportBackup() {
    const blob = new Blob([JSON.stringify(backupState, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `hesabdari-backup-${todayISO()}.json`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
  function importBackup(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        if (data.accounts) setAccounts(data.accounts);
        if (data.categories) setCategories(data.categories);
        if (data.transactions) setTransactions(data.transactions);
        if (data.budgets) setBudgets(data.budgets);
        if (data.loans) setLoans(data.loans);
        if (data.checks) setChecks(data.checks);
        if (data.bills) setBills(data.bills);
        if (data.assets) setAssets(data.assets);
        if (data.recurring) setRecurring(data.recurring);
        if (data.favorites) setFavorites(data.favorites);
        if (data.members) setMembers(data.members);
        if (data.events) setEvents(data.events);
        if (data.projects) setProjects(data.projects);
        if (data.fiscalPeriods) setFiscalPeriods(data.fiscalPeriods);
        if (data.notes) setNotes(data.notes);
        if (data.reminders) setReminders(data.reminders);
        if (data.settings) setSettings((s) => ({ ...s, ...data.settings, aiApiKey: data.settings.aiApiKey || s.aiApiKey }));
        alert("بازیابی اطلاعات با موفقیت انجام شد");
      } catch { alert("فایل پشتیبان نامعتبر است"); }
    };
    reader.readAsText(file);
  }
  function exportExcel() {
    const rows = transactions.map((t) => ({
      نوع: t.type === "expense" ? "پرداخت" : t.type === "income" ? "دریافت" : "انتقال",
      مبلغ: t.amount, تاریخ: t.date,
      دسته: catById(t.categoryId)?.name || "", حساب: accById(t.accountId)?.name || "",
      برچسب: (t.tags || []).join("، "), یادداشت: t.note || "",
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "تراکنش‌ها");
    XLSX.writeFile(wb, `transactions-${todayISO()}.xlsx`);
  }

  const t = THEME[settings.theme] || THEME.light;
  Object.assign(BRAND, COLOR_PRESETS[settings.themeColor] || COLOR_PRESETS.purple);

  if (!loaded) {
    return <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: THEME.light.bg, fontFamily: FONT }}>در حال بارگذاری...</div>;
  }
  if (settings.pin && !unlocked) {
    return <LockScreen pin={settings.pin} onUnlock={() => setUnlocked(true)} />;
  }

  function openWithPrefill(data) {
    setPrefillTx(data);
    setShowAdd(true);
  }

  const ctx = {
    accounts, addAccount, deleteAccount, accountBalance,
    categories, addCategory, deleteCategory,
    budgets, upsertBudget, expenseByCategory, incomeByCategory,
    loans, setLoans, checks, setChecks, bills, setBills, assets, setAssets,
    recurring, setRecurring, favorites, toggleFavorite,
    settings, setSettings, exportBackup, importBackup, exportExcel,
    transactions, catById, accById, totalBalance, totalAssets,
    members, setMembers, events, setEvents, projects, setProjects,
    fiscalPeriods, setFiscalPeriods, openWithPrefill,
    notes, setNotes, reminders, setReminders, rates, fetchRates,
  };

  return (
    <ThemeCtx.Provider value={t}>
      <div dir="rtl" onClick={handleTripleTap} style={{ fontFamily: FONT, background: t.bg, color: t.text, minHeight: "100vh", maxWidth: 480, margin: "0 auto", display: "flex", flexDirection: "column", position: "relative", boxShadow: "0 0 30px rgba(0,0,0,0.08)", zoom: settings.fontScale || 1 }}>
        <style>{`
          @import url('https://fonts.googleapis.com/css2?family=Vazirmatn:wght@400;500;600;700;800&display=swap');
          * { box-sizing: border-box; }
          input, select, textarea, button { font-family: inherit; }
          ::-webkit-scrollbar { width: 0; height: 0; }
          @media print { .no-print { display: none !important; } }
        `}</style>

        {subView ? (
          <SubViewRouter subView={subView} onBack={() => setSubView(null)} ctx={ctx} />
        ) : (
          <>
            <Header title={settings.profile?.name || "alireza shadfar"} onMenu={() => setMenuOpen(true)}
              onMic={(transcript) => registerSmartTransaction(transcript)} />
            <div style={{ flex: 1, overflowY: "auto", paddingBottom: 8 }}>
              {tab === "home" && (
                <HomeView
                  year={year} setYear={setYear}
                  totalIncomeYear={totalIncomeYear} totalExpenseYear={totalExpenseYear} gaugeMax={gaugeMax}
                  open={open} toggle={toggle}
                  accounts={accounts} accountBalance={accountBalance}
                  expenseByCategory={expenseByCategory} incomeByCategory={incomeByCategory}
                  budgets={budgets} categories={categories} transactions={yearTx} allTransactions={transactions}
                  bills={bills} loans={loans} checks={checks} assets={assets} totalAssets={totalAssets}
                  openAccounts={() => setSubView("accounts")} openBudgets={() => setSubView("budgets")}
                  openBills={() => setSubView("bills")} openLoans={() => setSubView("loans")}
                  openChecks={() => setSubView("checks")} openAssets={() => setSubView("assets")}
                  homeDay={homeDay} setHomeDay={setHomeDay} catById={catById}
                  settings={settings} setSettings={setSettings} rates={rates} fetchRates={fetchRates}
                  onNote={() => setShowNoteModal(true)} onReminder={() => setShowReminderModal(true)}
                  onAddTransaction={(type) => { setPrefillTx(type ? { type } : null); setShowAdd(true); }}
                />
              )}
              {tab === "transactions" && (
                <TransactionsView
                  transactions={transactions} catById={catById} accById={accById}
                  filter={txFilter} setFilter={setTxFilter} onDelete={deleteTransaction}
                  search={txSearch} setSearch={setTxSearch}
                />
              )}
              {tab === "operations" && <OperationsView setSubView={setSubView} onAdd={() => setShowAdd(true)} />}
              {tab === "checks" && <ChecksManager checks={checks} setChecks={setChecks} />}
              {tab === "reports" && (
                <ReportsView
                  expenseByCategory={expenseByCategory} incomeByCategory={incomeByCategory}
                  totalIncomeYear={totalIncomeYear} totalExpenseYear={totalExpenseYear}
                  accounts={accounts} accountBalance={accountBalance}
                  netWorthTrend={netWorthTrend} exportExcel={exportExcel}
                  expenseByMember={expenseByMember} expenseByEvent={expenseByEvent} expenseByProject={expenseByProject}
                  checks={checks} currency={settings.currency} usdRate={rates?.usd}
                />
              )}
            </div>
            <BottomNav active={tab} setActive={setTab} onAdd={() => setShowQuickAdd(true)} />
          </>
        )}

        {showQuickAdd && (
          <QuickAddSheet
            onClose={() => setShowQuickAdd(false)}
            onPick={(type) => {
              setShowQuickAdd(false);
              if (type === "check") { setTab("checks"); return; }
              setPrefillTx(type === "expense" ? { type: "expense" } : type === "income" ? { type: "income" } : null);
              setShowAdd(true);
            }}
          />
        )}

        {showNoteModal && (
          <SimpleTextModal title="یادداشت جدید" placeholder="یادداشتت رو بنویس..."
            onClose={() => setShowNoteModal(false)}
            onSubmit={(text) => { setNotes((p) => [{ id: uid(), text, date: todayISO(), createdAt: new Date().toISOString() }, ...p]); setShowNoteModal(false); }} />
        )}
        {showReminderModal && (
          <ReminderQuickModal onClose={() => setShowReminderModal(false)}
            onSubmit={(r) => { setReminders((p) => [{ id: uid(), ...r }, ...p]); setShowReminderModal(false); }} />
        )}
        {showCapture && (
          <SmartCaptureOverlay
            onClose={() => setShowCapture(false)}
            onParsed={async (data) => { setShowCapture(false); await registerSmartTransaction(data.text || data.note || ""); }}
          />
        )}

        {showAdd && (
          <AddTransactionSheet
            accounts={accounts} categories={categories} favorites={favorites}
            members={members} events={events} projects={projects}
            initial={prefillTx}
            onClose={() => { setShowAdd(false); setPrefillTx(null); }}
            onSubmit={(tx) => { addTransaction(tx); setShowAdd(false); setPrefillTx(null); }}
          />
        )}
        {menuOpen && <SideMenu onClose={() => setMenuOpen(false)} setSubView={(v) => { setSubView(v); setMenuOpen(false); }} profileName={settings.profile?.name} />}
      </div>
    </ThemeCtx.Provider>
  );
}

/* ---------------------------------------------------------
   Home View
--------------------------------------------------------- */
function HomeView({
  year, setYear, totalIncomeYear, totalExpenseYear, gaugeMax, open, toggle,
  accounts, accountBalance, expenseByCategory, incomeByCategory, budgets, categories,
  transactions, allTransactions, bills, loans, checks, assets, totalAssets,
  openAccounts, openBudgets, openBills, openLoans, openChecks, openAssets,
  homeDay, setHomeDay, catById, settings, setSettings, rates, fetchRates, onNote, onReminder, onAddTransaction
}) {
  const t = useT();
  const banks = accounts.filter((a) => a.type === "bank");
  const funds = accounts.filter((a) => a.type === "fund");
  const cardAccs = accounts.filter((a) => a.type === "card");
  const net = totalIncomeYear - totalExpenseYear;
  const upcomingBills = bills.filter((b) => !b.paid && daysUntil(b.dueDate) <= 5).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const upcomingChecks = checks.filter((c) => c.status === "pending" && daysUntil(c.dueDate) <= (settings.checkReminderDays || 7)).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const currency = settings.currency, usdRate = rates?.usd;
  const layout = settings.homeLayout || "cards";
  const sectionOrder = (settings.homeSections && settings.homeSections.length ? settings.homeSections : DEFAULT_HOME_SECTIONS).filter((s) => s.visible);

  const SECTION_META = {
    shortcut: { color: BRAND.mauve, title: "میانبر تراکنش ها", icon: <ArrowLeftRight size={20} /> },
    expense: { color: BRAND.header, title: "هزینه ها", icon: <TrendingDown size={20} /> },
    income: { color: BRAND.darkgreen, title: "درآمدها", icon: <TrendingUp size={20} /> },
    banks: { color: BRAND.violet, title: "بانک ها و کارت ها", icon: <Landmark size={20} /> },
    funds: { color: BRAND.teal, title: "صندوق ها", icon: <Save size={20} /> },
    balrep: { color: BRAND.gold, title: "گزارش مانده حساب ها", icon: <FileSpreadsheet size={20} /> },
    budget: { color: BRAND.green, title: "بودجه بندی", icon: <Target size={20} /> },
    loanchk: { color: BRAND.orange, title: "وام ها و چک ها", icon: <Bank size={20} /> },
    bills: { color: BRAND.crimson, title: "یادآوری قبض ها", icon: <BellRing size={20} /> },
  };

  function sectionBody(key) {
    switch (key) {
      case "shortcut":
        return allTransactions.slice(0, 5).length === 0 ? <EmptyRow text="هنوز تراکنشی ثبت نشده" /> : allTransactions.slice(0, 5).map((tx) => (
          <Row key={tx.id} title={categories.find((c) => c.id === tx.categoryId)?.name || (tx.type === "transfer" ? "انتقال وجه" : "—")}
            subtitle={faLongDate(new Date(tx.date))} value={formatMoney(tx.amount, currency, usdRate)}
            valueColor={tx.type === "expense" ? BRAND.crimson : tx.type === "income" ? BRAND.darkgreen : BRAND.violet} />
        ));
      case "expense":
        return expenseByCategory.length === 0 ? <EmptyRow text="هزینه‌ای ثبت نشده" /> : expenseByCategory.map((e) => <Row key={e.catId} title={e.name} value={formatMoney(e.amount, currency, usdRate)} valueColor={BRAND.crimson} />);
      case "income":
        return incomeByCategory.length === 0 ? <EmptyRow text="درآمدی ثبت نشده" /> : incomeByCategory.map((e) => <Row key={e.catId} title={e.name} value={formatMoney(e.amount, currency, usdRate)} valueColor={BRAND.darkgreen} />);
      case "banks":
        return (<>
          {[...banks, ...cardAccs].length === 0 && <EmptyRow text="حسابی ثبت نشده" />}
          {[...banks, ...cardAccs].map((a) => (
            <Row key={a.id} title={a.name} subtitle={a.type === "card" ? "کارت" : "بانک"} value={formatMoney(accountBalance(a.id), currency, usdRate)}
              valueColor={accountBalance(a.id) >= 0 ? t.text : BRAND.crimson} />
          ))}
          <AddLink text="+ مدیریت حساب‌ها و کارت‌ها" onClick={openAccounts} />
        </>);
      case "funds":
        return funds.length === 0 ? <EmptyRow text="صندوقی ثبت نشده" /> : funds.map((a) => <Row key={a.id} title={a.name} value={formatMoney(accountBalance(a.id), currency, usdRate)} valueColor={accountBalance(a.id) >= 0 ? t.text : BRAND.crimson} />);
      case "balrep":
        return accounts.map((a) => (
          <Row key={a.id} title={a.name} subtitle={a.type === "bank" ? "بانک" : a.type === "card" ? "کارت" : "صندوق"}
            value={formatMoney(accountBalance(a.id), currency, usdRate)} valueColor={accountBalance(a.id) >= 0 ? BRAND.darkgreen : BRAND.crimson} />
        ));
      case "budget":
        return (<>
          {budgets.length === 0 && <EmptyRow text="بودجه‌ای تعریف نشده" />}
          {budgets.map((b) => {
            const cat = categories.find((c) => c.id === b.categoryId);
            const spent = expenseByCategory.find((e) => e.catId === b.categoryId)?.amount || 0;
            const pct = Math.min(100, Math.round((spent / (b.amount || 1)) * 100));
            return (
              <div key={b.id} style={{ padding: "10px 4px", borderBottom: `1px solid ${t.border}` }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13.5, fontWeight: 600, marginBottom: 6 }}>
                  <span>{cat?.name || "—"}</span>
                  <span style={{ color: pct >= 100 ? BRAND.crimson : t.sub }}>{toFaInt(pct)}٪ — {toFaInt(spent)}/{toFaInt(b.amount)}</span>
                </div>
                <div style={{ height: 7, background: t.border, borderRadius: 4, overflow: "hidden" }}>
                  <div style={{ width: `${pct}%`, height: "100%", background: pct >= 100 ? BRAND.crimson : BRAND.green }} />
                </div>
              </div>
            );
          })}
          <AddLink text="+ مدیریت بودجه‌بندی" onClick={openBudgets} />
        </>);
      case "loanchk":
        return (<>
          {loans.length === 0 && checks.length === 0 && <EmptyRow text="موردی ثبت نشده" />}
          {loans.map((l) => (
            <Row key={l.id} title={l.title} subtitle="وام" value={`${toFaInt(l.principal - (l.paidCount || 0) * l.monthlyPayment)} ریال باقی‌مانده`} valueColor={BRAND.crimson} />
          ))}
          {checks.filter((c) => c.status === "pending").map((c) => (
            <Row key={c.id} title={`${c.payee} (${c.type === "received" ? "دریافتی" : "پرداختی"})`} subtitle={faLongDate(new Date(c.dueDate))} value={formatMoney(c.amount, currency, usdRate)} />
          ))}
          <div style={{ display: "flex", gap: 14, justifyContent: "center", marginTop: 4 }}>
            <AddLink text="+ وام‌ها" onClick={openLoans} />
            <AddLink text="+ چک‌ها" onClick={openChecks} />
            <AddLink text="+ دارایی‌ها" onClick={openAssets} />
          </div>
        </>);
      case "bills":
        return (<>
          {bills.length === 0 && <EmptyRow text="قبضی ثبت نشده" />}
          {bills.map((b) => (
            <Row key={b.id} title={b.title} subtitle={faLongDate(new Date(b.dueDate))}
              value={b.paid ? "پرداخت شده" : `${toFaInt(daysUntil(b.dueDate))} روز`}
              valueColor={b.paid ? BRAND.darkgreen : daysUntil(b.dueDate) < 0 ? BRAND.crimson : BRAND.orange} />
          ))}
          <AddLink text="+ مدیریت قبض‌ها" onClick={openBills} />
        </>);
      default: return null;
    }
  }

  function sectionAddHandler(key) {
    switch (key) {
      case "shortcut": return () => onAddTransaction();
      case "expense": return () => onAddTransaction("expense");
      case "income": return () => onAddTransaction("income");
      case "banks": return openAccounts;
      case "funds": return openAccounts;
      case "budget": return openBudgets;
      case "bills": return openBills;
      default: return undefined;
    }
  }

  return (
    <div style={{ padding: "18px 16px 8px" }}>
      <BankCardCarousel accounts={accounts} accountBalance={accountBalance} currency={currency} usdRate={usdRate} onAddCard={openAccounts} />
      <DateQuickBox onNote={onNote} onReminder={onReminder} />
      <IncomeExpenseDayWidget day={homeDay} setDay={setHomeDay} transactions={allTransactions} catById={catById} currency={currency} usdRate={usdRate} />
      <CurrencyRatesStrip rates={rates} fetchRates={fetchRates} />

      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 14, margin: "18px 0" }}>
        <button onClick={() => setYear((y) => y - 1)} style={navArrowStyle(t)}><ChevronLeft size={16} /></button>
        <div style={{ background: t.card, borderRadius: 20, padding: "6px 18px", fontWeight: 700, color: BRAND.header, boxShadow: "0 1px 3px rgba(0,0,0,0.1)" }}>سال {faDigits(year)}</div>
        <button onClick={() => setYear((y) => y + 1)} style={navArrowStyle(t)}><ChevronRight size={16} /></button>
        <button onClick={() => setSettings((s) => ({ ...s, homeLayout: layout === "cards" ? "icons" : "cards" }))}
          style={{ ...navArrowStyle(t), width: "auto", padding: "0 10px", borderRadius: 16, display: "flex", alignItems: "center", gap: 4, fontSize: 11 }}>
          {layout === "cards" ? <LayoutGrid size={15} /> : <LayoutList size={15} />}
        </button>
      </div>

      <div style={{ textAlign: "center", marginBottom: 12, fontSize: 13, color: net >= 0 ? BRAND.darkgreen : BRAND.crimson, fontWeight: 700 }}>
        مانده سالانه: {toFaInt(Math.abs(net))} ریال {net >= 0 ? "مثبت" : "منفی"}
      </div>
      {totalAssets > 0 && (
        <div style={{ textAlign: "center", marginBottom: 18, fontSize: 12.5, color: BRAND.orange, fontWeight: 700 }}>
          ارزش دارایی‌های دیجیتال/بورس: {toFaInt(totalAssets)} ریال
        </div>
      )}

      {(upcomingBills.length > 0 || upcomingChecks.length > 0) && (
        <div style={{ background: "#fff6ea", border: "1px solid #f0d9a8", borderRadius: 12, padding: 12, marginBottom: 16, display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, color: BRAND.orange, fontWeight: 700, fontSize: 13 }}><BellRing size={16} /> یادآوری‌های نزدیک</div>
          {upcomingBills.map((b) => (
            <div key={b.id} style={{ fontSize: 12.5, color: "#6b4c14" }}>قبض {b.title} — {daysUntil(b.dueDate) < 0 ? "سررسید گذشته" : `${toFaInt(daysUntil(b.dueDate))} روز مانده`}</div>
          ))}
          {upcomingChecks.map((c) => (
            <div key={c.id} style={{ fontSize: 12.5, color: "#6b4c14" }}>چک {c.type === "received" ? "دریافتی" : "پرداختی"} {c.payee} — {daysUntil(c.dueDate) < 0 ? "سررسید گذشته" : `${toFaInt(daysUntil(c.dueDate))} روز مانده`}</div>
          ))}
        </div>
      )}

      {layout === "cards" ? (
        sectionOrder.map(({ key }) => {
          const m = SECTION_META[key];
          if (!m) return null;
          return (
            <CollapsibleSection key={key} color={m.color} title={m.title} open={!!open[key]} onToggle={() => toggle(key)} onAdd={sectionAddHandler(key)}>
              {sectionBody(key)}
            </CollapsibleSection>
          );
        })
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 20 }}>
          {sectionOrder.map(({ key }) => {
            const m = SECTION_META[key];
            if (!m) return null;
            return (
              <button key={key} onClick={() => toggle(key)} style={{
                display: "flex", flexDirection: "column", alignItems: "center", gap: 8, background: t.card, border: "none",
                borderRadius: 14, padding: "16px 6px", cursor: "pointer", boxShadow: "0 1px 3px rgba(0,0,0,0.08)"
              }}>
                <span style={{ width: 44, height: 44, borderRadius: 12, background: m.color, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}>{m.icon}</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: t.text, textAlign: "center" }}>{m.title}</span>
              </button>
            );
          })}
        </div>
      )}
      {layout === "icons" && sectionOrder.map(({ key }) => {
        const m = SECTION_META[key];
        if (!m || !open[key]) return null;
        return (
          <div key={key} style={{ background: t.card, borderRadius: 14, padding: "10px 14px", marginBottom: 14, boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
              <div style={{ fontWeight: 700, color: m.color, fontSize: 13.5 }}>{m.title}</div>
              {sectionAddHandler(key) && (
                <button onClick={sectionAddHandler(key)} style={{ width: 26, height: 26, borderRadius: "50%", background: m.color, border: "none", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
                  <Plus size={14} />
                </button>
              )}
            </div>
            {sectionBody(key)}
          </div>
        );
      })}
    </div>
  );
}
const navArrowStyle = (t) => ({ width: 30, height: 30, borderRadius: "50%", border: "none", background: t.card, color: BRAND.header, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 1px 3px rgba(0,0,0,0.1)", cursor: "pointer" });

function CurrencyRatesStrip({ rates, fetchRates }) {
  const t = useT();
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginBottom: 16, fontSize: 12, color: t.sub }}>
      <DollarSign size={13} />
      {rates?.usd ? (
        <span>هر دلار ≈ {toFaInt(Math.round(rates.usd))} ریال {rates.source === "manual" ? "(دستی)" : ""}</span>
      ) : (
        <span>نرخ ارز در دسترس نیست</span>
      )}
      <button onClick={fetchRates} style={{ background: "none", border: "none", cursor: "pointer", color: t.sub, display: "flex" }}><RefreshCw size={13} /></button>
    </div>
  );
}


/* ---------------------------------------------------------
   Transactions View
--------------------------------------------------------- */
function TransactionsView({ transactions, catById, accById, filter, setFilter, onDelete, search, setSearch }) {
  const t = useT();
  const [preview, setPreview] = useState(null);
  const filtered = transactions.filter((tx) => {
    if (filter !== "all" && tx.type !== filter) return false;
    if (search.trim()) {
      const q = search.trim();
      const hay = `${catById(tx.categoryId)?.name || ""} ${tx.note || ""} ${(tx.tags || []).join(" ")} ${tx.amount}`;
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  const grouped = useMemo(() => {
    const map = {};
    filtered.forEach((tx) => { (map[tx.date] = map[tx.date] || []).push(tx); });
    return Object.entries(map).sort((a, b) => new Date(b[0]) - new Date(a[0]));
  }, [filtered]);
  const tabs = [{ key: "all", label: "همه" }, { key: "expense", label: "پرداخت ها" }, { key: "income", label: "دریافت ها" }, { key: "transfer", label: "انتقال ها" }];

  return (
    <div>
      <div style={{ padding: "10px 14px 0" }}>
        <div style={{ position: "relative" }}>
          <Search size={16} color={t.sub} style={{ position: "absolute", top: 12, right: 12 }} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="جستجو در تراکنش‌ها، برچسب یا یادداشت..."
            style={{ width: "100%", padding: "10px 36px 10px 12px", borderRadius: 10, border: `1.5px solid ${t.inputBorder}`, background: t.input, color: t.text, fontSize: 13.5, outline: "none", marginBottom: 10 }} />
        </div>
      </div>
      <div style={{ display: "flex", background: BRAND.header, padding: "0 8px 12px", gap: 4 }}>
        {tabs.map((tItem) => (
          <button key={tItem.key} onClick={() => setFilter(tItem.key)} style={{ flex: 1, padding: "8px 4px", border: "none", borderRadius: 8, cursor: "pointer", background: filter === tItem.key ? "rgba(255,255,255,0.18)" : "transparent", color: "#fff", fontWeight: filter === tItem.key ? 700 : 500, fontSize: 12.5 }}>{tItem.label}</button>
        ))}
      </div>
      <div style={{ padding: "12px 14px" }}>
        {grouped.length === 0 && <EmptyRow text="تراکنشی یافت نشد" />}
        {grouped.map(([date, txs]) => {
          const dayTotal = txs.reduce((s, tx) => s + (tx.type === "expense" ? -tx.amount : tx.type === "income" ? tx.amount : 0), 0);
          return (
            <div key={date} style={{ marginBottom: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <span style={{ fontSize: 12.5, color: t.sub, fontWeight: 600 }}>{faLongDate(new Date(date))}</span>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: dayTotal >= 0 ? BRAND.darkgreen : BRAND.crimson }}>{dayTotal >= 0 ? "+" : "-"}{toFaInt(Math.abs(dayTotal))} ریال</span>
              </div>
              {txs.map((tx) => {
                const cat = catById(tx.categoryId), acc = accById(tx.accountId), toAcc = accById(tx.toAccountId);
                const color = tx.type === "expense" ? BRAND.crimson : tx.type === "income" ? BRAND.darkgreen : BRAND.violet;
                const Icon = tx.type === "expense" ? TrendingDown : tx.type === "income" ? TrendingUp : ArrowLeftRight;
                return (
                  <div key={tx.id} style={{ background: t.card, borderRadius: 12, padding: 14, marginBottom: 10, boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                      <div style={{ display: "flex", gap: 10 }}>
                        <span style={{ width: 38, height: 38, borderRadius: 10, background: color + "22", color, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><Icon size={18} /></span>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 14 }}>{tx.type === "transfer" ? `انتقال به ${toAcc?.name || "—"}` : (cat?.name || "بدون دسته")}</div>
                          <div style={{ fontSize: 12, color: t.sub, marginTop: 3 }}>{tx.type === "expense" ? "از حساب" : tx.type === "income" ? "به حساب" : "از حساب"}: {acc?.name || "—"}</div>
                          {tx.note && <div style={{ fontSize: 12, color: t.sub, marginTop: 2 }}>{tx.note}</div>}
                          {(tx.tags || []).length > 0 && (
                            <div style={{ display: "flex", gap: 5, marginTop: 5, flexWrap: "wrap" }}>
                              {tx.tags.map((tag, i) => <span key={i} style={{ fontSize: 10.5, background: t.border, color: t.sub, padding: "2px 8px", borderRadius: 20 }}>{tag}</span>)}
                            </div>
                          )}
                          {tx.photo && <img src={tx.photo} onClick={() => setPreview(tx.photo)} style={{ width: 44, height: 44, borderRadius: 8, objectFit: "cover", marginTop: 6, cursor: "pointer" }} />}
                        </div>
                      </div>
                      <div style={{ textAlign: "left" }}>
                        <div style={{ fontWeight: 800, color, fontSize: 14.5 }}>{toFaInt(tx.amount)}</div>
                        <button onClick={() => onDelete(tx.id)} style={{ background: "none", border: "none", color: t.sub, cursor: "pointer", marginTop: 6 }}><Trash2 size={15} /></button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
      {preview && (
        <div onClick={() => setPreview(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 70, maxWidth: 480, margin: "0 auto" }}>
          <img src={preview} style={{ maxWidth: "88%", maxHeight: "70%", borderRadius: 10 }} />
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------
   Operations View
--------------------------------------------------------- */
function OperationsView({ setSubView, onAdd }) {
  const st = useStyles();
  const items = [
    { title: "حساب‌ها و کارت‌ها", icon: <Landmark size={17} />, color: BRAND.violet, key: "accounts" },
    { title: "دسته‌بندی‌ها و برچسب‌ها", icon: <Tag size={17} />, color: BRAND.mauve, key: "categories" },
    { title: "بودجه‌بندی", icon: <Save size={17} />, color: BRAND.green, key: "budgets" },
    { title: "تراکنش‌های تکرارشونده", icon: <Repeat size={17} />, color: BRAND.teal, key: "recurring" },
    { title: "چک‌ها", icon: <FileSpreadsheet size={17} />, color: BRAND.gold, key: "checks" },
    { title: "وام و اقساط", icon: <Bank size={17} />, color: BRAND.crimson, key: "loans" },
    { title: "یادآوری قبض‌ها", icon: <BellRing size={17} />, color: BRAND.orange, key: "bills" },
    { title: "دارایی‌ها (ارز دیجیتال / بورس)", icon: <Bitcoin size={17} />, color: "#7a5cff", key: "assets" },
    { title: "اعضای منزل، رویداد و پروژه", icon: <Users size={17} />, color: BRAND.violet, key: "tags" },
    { title: "دوره مالی", icon: <CalendarDays size={17} />, color: BRAND.darkgreen, key: "periods" },
    { title: "پیامک بانکی (افزودن نیمه‌خودکار)", icon: <BellRing size={17} />, color: "#666", key: "sms" },
    { title: "تقویم شمسی", icon: <CalendarDays size={17} />, color: BRAND.header, key: "calendar" },
    { title: "اطلاعات کاربری", icon: <Users size={17} />, color: "#444", key: "profile" },
    { title: "تنظیمات و پشتیبان‌گیری", icon: <ShieldCheck size={17} />, color: "#555", key: "settings" },
  ];
  return (
    <div style={{ padding: "10px 16px" }}>
      <div style={{ ...st.card, padding: "4px 12px" }}>
        {items.map((it) => <Row key={it.key} title={it.title} leftIcon={it.icon} leftColor={it.color} onClick={() => setSubView(it.key)} />)}
        <Row title="ثبت تراکنش جدید" leftIcon={<Plus size={17} />} leftColor={BRAND.fab} onClick={onAdd} />
      </div>
    </div>
  );
}

/* ---------------------------------------------------------
   Reports View
--------------------------------------------------------- */
const PIE_COLORS = ["#B01E4A", "#6C3FA0", "#4E9AA0", "#A98A3B", "#3E1461", "#1E8449", "#A65475", "#555"];
function ReportsView({ expenseByCategory, incomeByCategory, totalIncomeYear, totalExpenseYear, accounts, accountBalance, netWorthTrend, exportExcel, expenseByMember, expenseByEvent, expenseByProject, checks = [], currency, usdRate }) {
  const st = useStyles();
  const [period, setPeriod] = useState("year");
  const profit = totalIncomeYear - totalExpenseYear;
  const incomeExpensePie = [
    { name: "درآمد", amount: totalIncomeYear },
    { name: "هزینه", amount: totalExpenseYear },
  ].filter((d) => d.amount > 0);

  const checkStats = useMemo(() => {
    const pending = checks.filter((c) => c.status === "pending").length;
    const cashed = checks.filter((c) => c.status === "cashed").length;
    const bounced = checks.filter((c) => c.status === "bounced").length;
    const resolved = cashed + bounced;
    const pct = resolved > 0 ? (cashed / resolved) * 100 : 0;
    return { pending, cashed, bounced, pct };
  }, [checks]);

  return (
    <div style={{ padding: "16px" }}>
      <div className="no-print" style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <button onClick={exportExcel} style={{ ...st.primaryBtn, background: BRAND.green, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}><FileSpreadsheet size={16} /> خروجی Excel</button>
        <button onClick={() => window.print()} style={{ ...st.primaryBtn, background: "#555", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}><Printer size={16} /> چاپ / PDF</button>
      </div>

      <div className="no-print" style={{ display: "flex", gap: 6, marginBottom: 18, background: "#f1eef4", borderRadius: 10, padding: 4 }}>
        {[{ k: "day", l: "روزانه" }, { k: "week", l: "هفتگی" }, { k: "month", l: "ماهیانه" }, { k: "year", l: "سالیانه" }].map((p) => (
          <button key={p.k} onClick={() => setPeriod(p.k)} style={{ flex: 1, padding: "7px 4px", borderRadius: 7, border: "none", cursor: "pointer", background: period === p.k ? BRAND.header : "transparent", color: period === p.k ? "#fff" : "#3E1461", fontWeight: 700, fontSize: 12 }}>{p.l}</button>
        ))}
      </div>
      {period !== "year" && (
        <div style={{ fontSize: 11.5, color: "#8a8194", marginBottom: 14, textAlign: "center" }}>
          توجه: نمودارهای زیر همچنان بر اساس سال انتخابی در صفحه‌ی خانه محاسبه شده‌اند؛ فیلتر {period === "day" ? "روزانه" : period === "week" ? "هفتگی" : "ماهیانه"} روی نمای «روند دارایی خالص» و ویجت خانه اعمال می‌شود.
        </div>
      )}

      <SectionTitle text="سود و زیان سالانه" />
      <div style={{ ...st.card, padding: 14, marginBottom: 18 }}>
        <Row title="مجموع درآمد" value={formatMoney(totalIncomeYear, currency, usdRate)} valueColor={BRAND.darkgreen} chevron={null} />
        <Row title="مجموع هزینه" value={formatMoney(totalExpenseYear, currency, usdRate)} valueColor={BRAND.crimson} chevron={null} />
        <Row title="سود / زیان خالص" value={formatMoney(Math.abs(profit), currency, usdRate)} valueColor={profit >= 0 ? BRAND.darkgreen : BRAND.crimson} chevron={null} />
      </div>

      <SectionTitle text="روند دارایی خالص (۸ ماه اخیر)" />
      <div style={{ ...st.card, padding: 12, marginBottom: 18 }}>
        <ResponsiveContainer width="100%" height={180}>
          <LineChart data={netWorthTrend}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="name" tick={{ fontFamily: FONT, fontSize: 11 }} />
            <YAxis tick={{ fontFamily: FONT, fontSize: 10 }} width={44} />
            <Tooltip formatter={(v) => toFaInt(v)} contentStyle={{ fontFamily: FONT, direction: "rtl" }} />
            <Line type="monotone" dataKey="مانده" stroke={BRAND.violet} strokeWidth={2.5} dot={{ r: 3 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <SectionTitle text="درآمد و هزینه" />
      <div style={{ ...st.card, padding: 12, marginBottom: 18 }}>
        <ExplodingPie data={incomeExpensePie} currency={currency} usdRate={usdRate} />
      </div>

      <SectionTitle text="توزیع هزینه‌ها بر اساس دسته" />
      <div style={{ ...st.card, padding: 12, marginBottom: 18 }}>
        <ExplodingPie data={expenseByCategory.map((e) => ({ name: e.name, amount: e.amount }))} currency={currency} usdRate={usdRate} />
      </div>

      <SectionTitle text="گزارش چک‌ها" />
      <div style={{ ...st.card, padding: 14, marginBottom: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-around", marginBottom: 10 }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: BRAND.gold }}>{toFaInt(checkStats.pending)}</div>
            <div style={{ fontSize: 11.5, color: "#8a8194" }}>در جریان وصول</div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: BRAND.darkgreen }}>{toFaInt(checkStats.cashed)}</div>
            <div style={{ fontSize: 11.5, color: "#8a8194" }}>وصول شده</div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: BRAND.crimson }}>{toFaInt(checkStats.bounced)}</div>
            <div style={{ fontSize: 11.5, color: "#8a8194" }}>برگشت خورده</div>
          </div>
        </div>
        {(checkStats.cashed + checkStats.bounced) > 0 && (
          <div style={{ display: "flex", justifyContent: "center" }}>
            <GaugeSpeedometer pct={checkStats.pct} label="نسبت چک‌های وصول‌شده به کل تسویه‌شده‌ها" />
          </div>
        )}
        {checks.length === 0 && <EmptyRow text="چکی ثبت نشده" />}
      </div>

      <SectionTitle text="گزارش مانده حساب‌ها" />
      <div style={{ ...st.card, padding: "4px 12px", marginBottom: expenseByMember?.length || expenseByEvent?.length || expenseByProject?.length ? 18 : 0 }}>
        {accounts.map((a) => <Row key={a.id} title={a.name} subtitle={a.type === "bank" ? "بانک" : a.type === "card" ? "کارت" : "صندوق"} value={formatMoney(accountBalance(a.id), currency, usdRate)} valueColor={accountBalance(a.id) >= 0 ? BRAND.darkgreen : BRAND.crimson} chevron={null} />)}
      </div>

      {expenseByMember?.length > 0 && (
        <>
          <SectionTitle text="گزارش هزینه به‌تفکیک اعضای خانواده" />
          <div style={{ ...st.card, padding: "4px 12px", marginBottom: 18 }}>
            {expenseByMember.map((m) => <Row key={m.id} title={m.name} value={formatMoney(m.amount, currency, usdRate)} valueColor={BRAND.crimson} chevron={null} />)}
          </div>
        </>
      )}
      {expenseByEvent?.length > 0 && (
        <>
          <SectionTitle text="گزارش هزینه به‌تفکیک رویداد" />
          <div style={{ ...st.card, padding: "4px 12px", marginBottom: 18 }}>
            {expenseByEvent.map((m) => <Row key={m.id} title={m.name} value={formatMoney(m.amount, currency, usdRate)} valueColor={BRAND.crimson} chevron={null} />)}
          </div>
        </>
      )}
      {expenseByProject?.length > 0 && (
        <>
          <SectionTitle text="گزارش هزینه به‌تفکیک پروژه" />
          <div style={{ ...st.card, padding: "4px 12px" }}>
            {expenseByProject.map((m) => <Row key={m.id} title={m.name} value={formatMoney(m.amount, currency, usdRate)} valueColor={BRAND.crimson} chevron={null} />)}
          </div>
        </>
      )}
    </div>
  );
}

/* ---------------------------------------------------------
   SubView Router
--------------------------------------------------------- */
function SubViewRouter({ subView, onBack, ctx }) {
  const titles = { accounts: "حساب‌ها و کارت‌ها", categories: "دسته‌بندی‌ها و برچسب‌ها", budgets: "بودجه‌بندی", recurring: "تراکنش‌های تکرارشونده", checks: "چک‌ها", loans: "وام و اقساط", bills: "یادآوری قبض‌ها", assets: "دارایی‌ها", calendar: "تقویم شمسی", settings: "تنظیمات", profile: "اطلاعات کاربری", tags: "اعضا، رویداد و پروژه", periods: "دوره مالی", sms: "پیامک بانکی" };
  return (
    <>
      <Header title={titles[subView]} back onBack={onBack} />
      <div style={{ flex: 1, overflowY: "auto", padding: "16px", paddingBottom: 40 }}>
        {subView === "accounts" && <AccountsManager {...ctx} />}
        {subView === "categories" && <CategoriesManager {...ctx} />}
        {subView === "budgets" && <BudgetsManager {...ctx} />}
        {subView === "recurring" && <RecurringManager {...ctx} />}
        {subView === "checks" && <ChecksManager {...ctx} />}
        {subView === "loans" && <LoansManager {...ctx} />}
        {subView === "bills" && <BillsManager {...ctx} />}
        {subView === "assets" && <AssetsManager {...ctx} />}
        {subView === "calendar" && <CalendarViewSub {...ctx} />}
        {subView === "settings" && <SettingsView {...ctx} />}
        {subView === "profile" && <SettingsView {...ctx} />}
        {subView === "tags" && <MembersEventsProjectsManager {...ctx} />}
        {subView === "periods" && <FiscalPeriodsManager {...ctx} />}
        {subView === "sms" && <BankSmsManager {...ctx} onBack={onBack} />}
      </div>
    </>
  );
}

/* ---------------------------------------------------------
   Accounts / Categories / Budgets Managers
--------------------------------------------------------- */
function AccountsManager({ accounts, addAccount, deleteAccount, accountBalance, favorites, toggleFavorite }) {
  const st = useStyles();
  const [name, setName] = useState(""); const [type, setType] = useState("bank"); const [initial, setInitial] = useState("");
  const [last4, setLast4] = useState("");
  return (
    <div>
      <div style={{ ...st.card, padding: 14, marginBottom: 16 }}>
        <div style={{ fontWeight: 700, marginBottom: 10, fontSize: 14 }}>افزودن حساب / کارت جدید</div>
        <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
          <button onClick={() => setType("bank")} style={pillStyle(type === "bank")}>بانک</button>
          <button onClick={() => setType("fund")} style={pillStyle(type === "fund")}>صندوق</button>
          <button onClick={() => setType("card")} style={pillStyle(type === "card")}>کارت</button>
        </div>
        <input placeholder="نام حساب" value={name} onChange={(e) => setName(e.target.value)} style={st.input} />
        <input placeholder="موجودی اولیه (ریال)" value={initial} onChange={(e) => setInitial(e.target.value.replace(/[^0-9]/g, ""))} style={st.input} inputMode="numeric" />
        {(type === "bank" || type === "card") && (
          <input placeholder="۴ رقم آخر شماره کارت (اختیاری)" value={last4} onChange={(e) => setLast4(e.target.value.replace(/[^0-9]/g, "").slice(0, 4))} style={st.input} inputMode="numeric" />
        )}
        <button onClick={() => { if (!name.trim()) return; addAccount({ name: name.trim(), type, initial: Number(initial || 0), cardNumberLast4: last4 || undefined }); setName(""); setInitial(""); setLast4(""); }} style={st.primaryBtn}>افزودن</button>
      </div>
      <div style={{ ...st.card, padding: "4px 12px" }}>
        {accounts.length === 0 && <EmptyRow text="حسابی ثبت نشده" />}
        {accounts.map((a) => (
          <Row key={a.id} title={a.name} subtitle={`${a.type === "bank" ? "بانک" : a.type === "card" ? "کارت" : "صندوق"} · موجودی: ${toFaInt(accountBalance(a.id))} ریال`}
            extra={<button onClick={() => toggleFavorite("accounts", a.id)} style={{ background: "none", border: "none", cursor: "pointer" }}><Star size={16} fill={favorites.accounts.includes(a.id) ? "#f5b301" : "none"} color="#f5b301" /></button>}
            leftIcon={<Trash2 size={15} />} leftColor={BRAND.crimson} onClick={() => deleteAccount(a.id)} chevron={null} />
        ))}
      </div>
    </div>
  );
}

function CategoriesManager({ categories, addCategory, deleteCategory, favorites, toggleFavorite }) {
  const st = useStyles();
  const [name, setName] = useState(""); const [kind, setKind] = useState("expense");
  const expense = categories.filter((c) => c.kind === "expense"); const income = categories.filter((c) => c.kind === "income");
  return (
    <div>
      <div style={{ ...st.card, padding: 14, marginBottom: 16 }}>
        <div style={{ fontWeight: 700, marginBottom: 10, fontSize: 14 }}>افزودن دسته‌بندی</div>
        <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
          <button onClick={() => setKind("expense")} style={pillStyle(kind === "expense")}>هزینه</button>
          <button onClick={() => setKind("income")} style={pillStyle(kind === "income")}>درآمد</button>
        </div>
        <input placeholder="نام دسته" value={name} onChange={(e) => setName(e.target.value)} style={st.input} />
        <button onClick={() => { if (!name.trim()) return; addCategory({ name: name.trim(), kind }); setName(""); }} style={st.primaryBtn}>افزودن</button>
      </div>
      <SectionTitle text="دسته‌های هزینه" />
      <div style={{ ...st.card, padding: "4px 12px", marginBottom: 16 }}>
        {expense.length === 0 && <EmptyRow text="دسته‌ای ثبت نشده" />}
        {expense.map((c) => <CatRow key={c.id} c={c} onDelete={deleteCategory} fav={favorites.categories.includes(c.id)} onFav={() => toggleFavorite("categories", c.id)} />)}
      </div>
      <SectionTitle text="دسته‌های درآمد" />
      <div style={{ ...st.card, padding: "4px 12px" }}>
        {income.length === 0 && <EmptyRow text="دسته‌ای ثبت نشده" />}
        {income.map((c) => <CatRow key={c.id} c={c} onDelete={deleteCategory} fav={favorites.categories.includes(c.id)} onFav={() => toggleFavorite("categories", c.id)} />)}
      </div>
    </div>
  );
}
function CatRow({ c, onDelete, fav, onFav }) {
  const t = useT();
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 4px", borderBottom: `1px solid ${t.border}` }}>
      <span style={{ fontSize: 14, fontWeight: 600 }}>{c.name}</span>
      <div style={{ display: "flex", gap: 10 }}>
        <button onClick={onFav} style={{ background: "none", border: "none", cursor: "pointer" }}><Star size={16} fill={fav ? "#f5b301" : "none"} color="#f5b301" /></button>
        <button onClick={() => onDelete(c.id)} style={{ background: "none", border: "none", color: BRAND.crimson, cursor: "pointer" }}><Trash2 size={16} /></button>
      </div>
    </div>
  );
}

function BudgetsManager({ categories, budgets, upsertBudget }) {
  const st = useStyles();
  const expenseCats = categories.filter((c) => c.kind === "expense");
  return (
    <div style={{ ...st.card, padding: "8px 12px" }}>
      {expenseCats.length === 0 && <EmptyRow text="ابتدا یک دسته هزینه بسازید" />}
      {expenseCats.map((c) => {
        const b = budgets.find((bb) => bb.categoryId === c.id);
        return (
          <div key={c.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 4px", borderBottom: "1px solid #f0eef3", gap: 10 }}>
            <span style={{ fontSize: 13.5, fontWeight: 600, flexShrink: 0 }}>{c.name}</span>
            <input placeholder="بودجه ماهانه" defaultValue={b ? b.amount : ""} onBlur={(e) => upsertBudget(c.id, Number(e.target.value.replace(/[^0-9]/g, "") || 0))} inputMode="numeric" style={{ ...st.input, margin: 0, width: 150, textAlign: "left" }} />
          </div>
        );
      })}
    </div>
  );
}

/* ---------------------------------------------------------
   Recurring Manager
--------------------------------------------------------- */
function RecurringManager({ recurring, setRecurring, categories, accounts }) {
  const st = useStyles();
  const [form, setForm] = useState({ type: "expense", amount: "", categoryId: "", accountId: accounts[0]?.id || "", interval: "monthly", startDate: todayISO(), note: "" });
  function add() {
    if (!form.amount || !form.categoryId || !form.accountId) return;
    setRecurring((p) => [...p, { id: uid(), ...form, amount: Number(form.amount), nextDate: form.startDate, active: true }]);
    setForm({ ...form, amount: "", note: "" });
  }
  return (
    <div>
      <div style={{ ...st.card, padding: 14, marginBottom: 16 }}>
        <div style={{ fontWeight: 700, marginBottom: 10, fontSize: 14 }}>افزودن تراکنش تکرارشونده (مثل حقوق یا اجاره)</div>
        <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
          <button onClick={() => setForm({ ...form, type: "expense", categoryId: "" })} style={pillStyle(form.type === "expense")}>هزینه</button>
          <button onClick={() => setForm({ ...form, type: "income", categoryId: "" })} style={pillStyle(form.type === "income")}>درآمد</button>
        </div>
        <input placeholder="مبلغ" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value.replace(/[^0-9]/g, "") })} style={st.input} inputMode="numeric" />
        <select value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })} style={st.input}>
          <option value="">دسته را انتخاب کنید</option>
          {categories.filter((c) => c.kind === form.type).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={form.accountId} onChange={(e) => setForm({ ...form, accountId: e.target.value })} style={st.input}>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
          <button onClick={() => setForm({ ...form, interval: "monthly" })} style={pillStyle(form.interval === "monthly")}>ماهانه</button>
          <button onClick={() => setForm({ ...form, interval: "weekly" })} style={pillStyle(form.interval === "weekly")}>هفتگی</button>
        </div>
        <label style={st.label}>تاریخ شروع</label>
        <JalaliDateInput value={form.startDate} onChange={(v) => setForm({ ...form, startDate: v })} style={st.input} />
        <input placeholder="یادداشت (اختیاری)" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} style={st.input} />
        <button onClick={add} style={st.primaryBtn}>افزودن</button>
      </div>
      <div style={{ ...st.card, padding: "4px 12px" }}>
        {recurring.length === 0 && <EmptyRow text="موردی ثبت نشده" />}
        {recurring.map((r) => (
          <Row key={r.id} title={categories.find((c) => c.id === r.categoryId)?.name || "—"}
            subtitle={`${r.interval === "monthly" ? "ماهانه" : "هفتگی"} · تراکنش بعدی: ${faLongDate(new Date(r.nextDate))}`}
            value={`${toFaInt(r.amount)} ریال`}
            extra={<button onClick={() => setRecurring((p) => p.map((x) => x.id === r.id ? { ...x, active: !x.active } : x))} style={{ background: "none", border: "none", cursor: "pointer", color: r.active ? BRAND.green : "#aaa", fontSize: 11, fontWeight: 700 }}>{r.active ? "فعال" : "غیرفعال"}</button>}
            leftIcon={<Trash2 size={15} />} leftColor={BRAND.crimson} onClick={() => setRecurring((p) => p.filter((x) => x.id !== r.id))} chevron={null} />
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------
   Checks Manager
--------------------------------------------------------- */
function ChecksManager({ checks, setChecks }) {
  const st = useStyles();
  const [form, setForm] = useState({ type: "received", payee: "", amount: "", dueDate: todayISO(), note: "" });
  function add() {
    if (!form.payee || !form.amount) return;
    setChecks((p) => [{ id: uid(), ...form, amount: Number(form.amount), status: "pending" }, ...p]);
    setForm({ ...form, payee: "", amount: "", note: "" });
  }
  const statusColor = { pending: BRAND.gold, cashed: BRAND.darkgreen, bounced: BRAND.crimson };
  const statusLabel = { pending: "در انتظار", cashed: "نقد شده", bounced: "برگشتی" };
  const sorted = [...checks].sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const dueSoon = sorted.filter((c) => c.status === "pending" && daysUntil(c.dueDate) <= 7);
  return (
    <div>
      {dueSoon.length > 0 && (
        <div style={{ background: "#fff6ea", border: "1px solid #f0d9a8", borderRadius: 10, padding: 12, marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, color: BRAND.orange, fontWeight: 700, fontSize: 13, marginBottom: 6 }}><BellRing size={16} /> یادآوری سررسید چک‌ها</div>
          {dueSoon.map((c) => (
            <div key={c.id} style={{ fontSize: 12.5, color: "#6b4c14" }}>
              {c.payee} — {toFaInt(c.amount)} ریال — {daysUntil(c.dueDate) < 0 ? "سررسید گذشته" : daysUntil(c.dueDate) === 0 ? "امروز سررسید است" : `${toFaInt(daysUntil(c.dueDate))} روز مانده`}
            </div>
          ))}
        </div>
      )}
      <div style={{ ...st.card, padding: 14, marginBottom: 16 }}>
        <div style={{ fontWeight: 700, marginBottom: 10, fontSize: 14 }}>ثبت چک جدید</div>
        <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
          <button onClick={() => setForm({ ...form, type: "received" })} style={pillStyle(form.type === "received")}>دریافتی</button>
          <button onClick={() => setForm({ ...form, type: "paid" })} style={pillStyle(form.type === "paid")}>پرداختی</button>
        </div>
        <input placeholder="نام طرف حساب" value={form.payee} onChange={(e) => setForm({ ...form, payee: e.target.value })} style={st.input} />
        <input placeholder="مبلغ" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value.replace(/[^0-9]/g, "") })} style={st.input} inputMode="numeric" />
        <label style={st.label}>تاریخ سررسید</label>
        <JalaliDateInput value={form.dueDate} onChange={(v) => setForm({ ...form, dueDate: v })} style={st.input} />
        <input placeholder="یادداشت (اختیاری)" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} style={st.input} />
        <button onClick={add} style={st.primaryBtn}>ثبت چک</button>
      </div>
      <div style={{ ...st.card, padding: "4px 12px" }}>
        {checks.length === 0 && <EmptyRow text="چکی ثبت نشده" />}
        {sorted.map((c) => {
          const d = daysUntil(c.dueDate);
          const urgent = c.status === "pending" && d <= 7;
          return (
          <div key={c.id} style={{ padding: "12px 4px", borderBottom: "1px solid #f0eef3" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <span style={{ fontWeight: 700, fontSize: 14 }}>{c.payee} ({c.type === "received" ? "دریافتی" : "پرداختی"})</span>
              <span style={{ fontWeight: 700 }}>{toFaInt(c.amount)} ریال</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 12, color: urgent ? (d < 0 ? BRAND.crimson : BRAND.orange) : "#8a8194", fontWeight: urgent ? 700 : 400 }}>
                سررسید: {faLongDate(new Date(c.dueDate))}{c.status === "pending" ? ` (${d < 0 ? "گذشته" : d === 0 ? "امروز" : `${toFaInt(d)} روز مانده`})` : ""}
              </span>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <StatusBadge text={statusLabel[c.status]} color={statusColor[c.status]} />
                <select value={c.status} onChange={(e) => setChecks((p) => p.map((x) => x.id === c.id ? { ...x, status: e.target.value } : x))} style={{ fontSize: 11, borderRadius: 6, border: "1px solid #ddd" }}>
                  <option value="pending">در انتظار</option><option value="cashed">نقد شده</option><option value="bounced">برگشتی</option>
                </select>
                <button onClick={() => setChecks((p) => p.filter((x) => x.id !== c.id))} style={{ background: "none", border: "none", color: BRAND.crimson, cursor: "pointer" }}><Trash2 size={15} /></button>
              </div>
            </div>
          </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------
   Loans Manager
--------------------------------------------------------- */
function LoansManager({ loans, setLoans }) {
  const st = useStyles();
  const [form, setForm] = useState({ title: "", principal: "", installments: "", monthlyPayment: "", startDate: todayISO() });
  function add() {
    if (!form.title || !form.principal || !form.installments || !form.monthlyPayment) return;
    setLoans((p) => [...p, { id: uid(), title: form.title, principal: Number(form.principal), installments: Number(form.installments), monthlyPayment: Number(form.monthlyPayment), startDate: form.startDate, paidCount: 0 }]);
    setForm({ title: "", principal: "", installments: "", monthlyPayment: "", startDate: todayISO() });
  }
  return (
    <div>
      <div style={{ ...st.card, padding: 14, marginBottom: 16 }}>
        <div style={{ fontWeight: 700, marginBottom: 10, fontSize: 14 }}>ثبت وام جدید</div>
        <input placeholder="عنوان وام (مثلا وام خودرو)" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} style={st.input} />
        <input placeholder="مبلغ اصل وام" value={form.principal} onChange={(e) => setForm({ ...form, principal: e.target.value.replace(/[^0-9]/g, "") })} style={st.input} inputMode="numeric" />
        <input placeholder="تعداد اقساط" value={form.installments} onChange={(e) => setForm({ ...form, installments: e.target.value.replace(/[^0-9]/g, "") })} style={st.input} inputMode="numeric" />
        <input placeholder="مبلغ هر قسط" value={form.monthlyPayment} onChange={(e) => setForm({ ...form, monthlyPayment: e.target.value.replace(/[^0-9]/g, "") })} style={st.input} inputMode="numeric" />
        <label style={st.label}>تاریخ شروع</label>
        <JalaliDateInput value={form.startDate} onChange={(v) => setForm({ ...form, startDate: v })} style={st.input} />
        <button onClick={add} style={st.primaryBtn}>ثبت وام</button>
      </div>
      <div style={{ ...st.card, padding: "4px 12px" }}>
        {loans.length === 0 && <EmptyRow text="وامی ثبت نشده" />}
        {loans.map((l) => {
          const remaining = l.principal - l.paidCount * l.monthlyPayment;
          const nextDue = addMonths(l.startDate, l.paidCount);
          return (
            <div key={l.id} style={{ padding: "12px 4px", borderBottom: "1px solid #f0eef3" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                <span style={{ fontWeight: 700, fontSize: 14 }}>{l.title}</span>
                <button onClick={() => setLoans((p) => p.filter((x) => x.id !== l.id))} style={{ background: "none", border: "none", color: BRAND.crimson, cursor: "pointer" }}><Trash2 size={15} /></button>
              </div>
              <div style={{ fontSize: 12.5, color: "#8a8194", marginBottom: 4 }}>قسط {toFaInt(l.paidCount)} از {toFaInt(l.installments)} پرداخت شده — سررسید بعدی: {l.paidCount < l.installments ? faLongDate(new Date(nextDue)) : "تسویه شده"}</div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontWeight: 700, color: remaining > 0 ? BRAND.crimson : BRAND.darkgreen }}>باقی‌مانده: {toFaInt(Math.max(remaining, 0))} ریال</span>
                {l.paidCount < l.installments && (
                  <button onClick={() => setLoans((p) => p.map((x) => x.id === l.id ? { ...x, paidCount: x.paidCount + 1 } : x))} style={{ background: BRAND.green, color: "#fff", border: "none", borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>ثبت پرداخت قسط</button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------
   Bills Manager
--------------------------------------------------------- */
const BILL_CATS = ["آب", "برق", "گاز", "اینترنت", "تلفن", "سایر"];
function BillsManager({ bills, setBills }) {
  const st = useStyles();
  const [form, setForm] = useState({ title: "آب", amount: "", dueDate: todayISO(), recurringMonthly: true });
  function add() {
    setBills((p) => [...p, { id: uid(), title: form.title, amount: Number(form.amount || 0), dueDate: form.dueDate, recurringMonthly: form.recurringMonthly, paid: false }]);
    setForm({ ...form, amount: "" });
  }
  function markPaid(b) {
    setBills((prev) => prev.map((x) => x.id === b.id ? (x.recurringMonthly ? { ...x, dueDate: addMonths(x.dueDate, 1), paid: false } : { ...x, paid: true }) : x));
  }
  return (
    <div>
      <div style={{ ...st.card, padding: 14, marginBottom: 16 }}>
        <div style={{ fontWeight: 700, marginBottom: 10, fontSize: 14 }}>افزودن قبض</div>
        <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
          {BILL_CATS.map((c) => <button key={c} onClick={() => setForm({ ...form, title: c })} style={{ ...pillStyle(form.title === c), flex: "none", padding: "7px 12px" }}>{c}</button>)}
        </div>
        <input placeholder="مبلغ (اختیاری)" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value.replace(/[^0-9]/g, "") })} style={st.input} inputMode="numeric" />
        <label style={st.label}>تاریخ سررسید</label>
        <JalaliDateInput value={form.dueDate} onChange={(v) => setForm({ ...form, dueDate: v })} style={st.input} />
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginBottom: 12 }}>
          <input type="checkbox" checked={form.recurringMonthly} onChange={(e) => setForm({ ...form, recurringMonthly: e.target.checked })} /> یادآوری ماهانه تکرار شود
        </label>
        <button onClick={add} style={st.primaryBtn}>افزودن قبض</button>
      </div>
      <div style={{ ...st.card, padding: "4px 12px" }}>
        {bills.length === 0 && <EmptyRow text="قبضی ثبت نشده" />}
        {bills.sort((a, b) => a.dueDate.localeCompare(b.dueDate)).map((b) => {
          const d = daysUntil(b.dueDate);
          return (
            <div key={b.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 4px", borderBottom: "1px solid #f0eef3" }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{b.title}{b.amount ? ` — ${toFaInt(b.amount)} ریال` : ""}</div>
                <div style={{ fontSize: 12, color: b.paid ? BRAND.darkgreen : d < 0 ? BRAND.crimson : "#8a8194" }}>
                  {faLongDate(new Date(b.dueDate))} · {b.paid ? "پرداخت شده" : d < 0 ? "سررسید گذشته" : `${toFaInt(d)} روز مانده`}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                {!b.paid && <button onClick={() => markPaid(b)} style={{ background: BRAND.green, color: "#fff", border: "none", borderRadius: 8, padding: "6px 10px", fontSize: 11.5, fontWeight: 700, cursor: "pointer" }}>ثبت پرداخت</button>}
                <button onClick={() => setBills((p) => p.filter((x) => x.id !== b.id))} style={{ background: "none", border: "none", color: BRAND.crimson, cursor: "pointer" }}><Trash2 size={15} /></button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------
   Assets Manager
--------------------------------------------------------- */
function AssetsManager({ assets, setAssets }) {
  const st = useStyles();
  const [form, setForm] = useState({ kind: "crypto", symbol: "", quantity: "", avgPrice: "", currentPrice: "" });
  const total = assets.reduce((s, a) => s + a.quantity * a.currentPrice, 0);
  function add() {
    if (!form.symbol || !form.quantity) return;
    setAssets((p) => [...p, { id: uid(), kind: form.kind, symbol: form.symbol, quantity: Number(form.quantity), avgPrice: Number(form.avgPrice || 0), currentPrice: Number(form.currentPrice || form.avgPrice || 0) }]);
    setForm({ ...form, symbol: "", quantity: "", avgPrice: "", currentPrice: "" });
  }
  return (
    <div>
      <div style={{ background: "#fff6ea", border: "1px solid #f0d9a8", borderRadius: 10, padding: 10, marginBottom: 14, fontSize: 12, color: "#6b4c14" }}>
        قیمت لحظه‌ای به‌صورت خودکار دریافت نمی‌شود؛ قیمت فعلی را خودتان وارد یا ویرایش کنید.
      </div>
      <div style={{ ...st.card, padding: 14, marginBottom: 16 }}>
        <div style={{ fontWeight: 700, marginBottom: 10, fontSize: 14 }}>افزودن دارایی</div>
        <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
          <button onClick={() => setForm({ ...form, kind: "crypto" })} style={pillStyle(form.kind === "crypto")}>ارز دیجیتال</button>
          <button onClick={() => setForm({ ...form, kind: "stock" })} style={pillStyle(form.kind === "stock")}>بورس</button>
        </div>
        <input placeholder="نماد (مثلا BTC یا فولاد)" value={form.symbol} onChange={(e) => setForm({ ...form, symbol: e.target.value })} style={st.input} />
        <input placeholder="تعداد / مقدار" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} style={st.input} inputMode="decimal" />
        <input placeholder="قیمت خرید (ریال)" value={form.avgPrice} onChange={(e) => setForm({ ...form, avgPrice: e.target.value.replace(/[^0-9]/g, "") })} style={st.input} inputMode="numeric" />
        <input placeholder="قیمت فعلی (ریال)" value={form.currentPrice} onChange={(e) => setForm({ ...form, currentPrice: e.target.value.replace(/[^0-9]/g, "") })} style={st.input} inputMode="numeric" />
        <button onClick={add} style={st.primaryBtn}>افزودن دارایی</button>
      </div>
      <SectionTitle text={`ارزش کل: ${toFaInt(total)} ریال`} />
      <div style={{ ...st.card, padding: "4px 12px" }}>
        {assets.length === 0 && <EmptyRow text="دارایی‌ای ثبت نشده" />}
        {assets.map((a) => (
          <div key={a.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 4px", borderBottom: "1px solid #f0eef3" }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14 }}>{a.symbol} <span style={{ fontSize: 11, color: "#8a8194" }}>({a.kind === "crypto" ? "ارز دیجیتال" : "بورس"})</span></div>
              <div style={{ fontSize: 12, color: "#8a8194" }}>تعداد: {a.quantity} · ارزش: {toFaInt(a.quantity * a.currentPrice)} ریال</div>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input defaultValue={a.currentPrice} onBlur={(e) => setAssets((p) => p.map((x) => x.id === a.id ? { ...x, currentPrice: Number(e.target.value.replace(/[^0-9]/g, "") || 0) } : x))} style={{ ...st.input, margin: 0, width: 100, textAlign: "left" }} inputMode="numeric" />
              <button onClick={() => setAssets((p) => p.filter((x) => x.id !== a.id))} style={{ background: "none", border: "none", color: BRAND.crimson, cursor: "pointer" }}><Trash2 size={15} /></button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------
   Members / Events / Projects Manager (تگ‌گذاری اعضای خانواده، رویداد و پروژه)
--------------------------------------------------------- */
function MembersEventsProjectsManager({ members, setMembers, events, setEvents, projects, setProjects }) {
  const st = useStyles();
  const [tab, setTab] = useState("members");
  const [name, setName] = useState("");
  const map = {
    members: { list: members, setList: setMembers, label: "عضو خانواده", color: BRAND.violet },
    events: { list: events, setList: setEvents, label: "رویداد", color: BRAND.teal },
    projects: { list: projects, setList: setProjects, label: "پروژه", color: BRAND.gold },
  };
  const cur = map[tab];
  function add() {
    if (!name.trim()) return;
    cur.setList((p) => [...p, { id: uid(), name: name.trim() }]);
    setName("");
  }
  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <button onClick={() => setTab("members")} style={pillStyle(tab === "members")}>اعضای خانواده</button>
        <button onClick={() => setTab("events")} style={pillStyle(tab === "events")}>رویدادها</button>
        <button onClick={() => setTab("projects")} style={pillStyle(tab === "projects")}>پروژه‌ها</button>
      </div>
      <div style={{ ...st.card, padding: 14, marginBottom: 16 }}>
        <div style={{ fontWeight: 700, marginBottom: 10, fontSize: 14 }}>افزودن {cur.label}</div>
        <input placeholder={`نام ${cur.label}`} value={name} onChange={(e) => setName(e.target.value)} style={st.input} />
        <button onClick={add} style={st.primaryBtn}>افزودن</button>
      </div>
      <div style={{ ...st.card, padding: "4px 12px" }}>
        {cur.list.length === 0 && <EmptyRow text={`${cur.label}ی ثبت نشده`} />}
        {cur.list.map((m) => (
          <Row key={m.id} title={m.name} leftIcon={<Trash2 size={15} />} leftColor={BRAND.crimson}
            onClick={() => cur.setList((p) => p.filter((x) => x.id !== m.id))} chevron={null} />
        ))}
      </div>
      <div style={{ fontSize: 12, color: "#8a8194", marginTop: 12 }}>
        این موارد را می‌توانید هنگام ثبت تراکنش (بخش «بیشتر») به هر پرداخت یا دریافت نسبت دهید تا در گزارش‌ها به‌تفکیک عضو، رویداد یا پروژه ببینید.
      </div>
    </div>
  );
}

/* ---------------------------------------------------------
   Fiscal Periods Manager (دوره مالی)
--------------------------------------------------------- */
function FiscalPeriodsManager({ fiscalPeriods, setFiscalPeriods }) {
  const st = useStyles();
  const [form, setForm] = useState({ title: "", startDate: todayISO(), endDate: todayISO() });
  function add() {
    if (!form.title) return;
    setFiscalPeriods((p) => [...p, { id: uid(), ...form }]);
    setForm({ title: "", startDate: todayISO(), endDate: todayISO() });
  }
  return (
    <div>
      <div style={{ ...st.card, padding: 14, marginBottom: 16 }}>
        <div style={{ fontWeight: 700, marginBottom: 10, fontSize: 14 }}>تعریف دوره مالی جدید</div>
        <div style={{ fontSize: 12, color: "#8a8194", marginBottom: 10 }}>مثلا «سال مالی ۱۴۰۴» یا «فصل بهار». در گزارش‌ها می‌توانید بر اساس این بازه فیلتر کنید.</div>
        <input placeholder="عنوان دوره" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} style={st.input} />
        <label style={st.label}>تاریخ شروع</label>
        <JalaliDateInput value={form.startDate} onChange={(v) => setForm({ ...form, startDate: v })} style={st.input} />
        <label style={st.label}>تاریخ پایان</label>
        <JalaliDateInput value={form.endDate} onChange={(v) => setForm({ ...form, endDate: v })} style={st.input} />
        <button onClick={add} style={st.primaryBtn}>افزودن دوره</button>
      </div>
      <div style={{ ...st.card, padding: "4px 12px" }}>
        {fiscalPeriods.length === 0 && <EmptyRow text="دوره‌ای ثبت نشده" />}
        {fiscalPeriods.map((p) => (
          <Row key={p.id} title={p.title} subtitle={`${faLongDate(new Date(p.startDate))} تا ${faLongDate(new Date(p.endDate))}`}
            leftIcon={<Trash2 size={15} />} leftColor={BRAND.crimson}
            onClick={() => setFiscalPeriods((prev) => prev.filter((x) => x.id !== p.id))} chevron={null} />
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------
   Bank SMS quick-add (پیامک بانکی)
--------------------------------------------------------- */
function BankSmsManager({ openWithPrefill, onBack }) {
  const st = useStyles();
  const [text, setText] = useState("");
  const parsed = text.trim() ? parseBankSms(text) : null;
  return (
    <div>
      <div style={{ background: "#fff6ea", border: "1px solid #f0d9a8", borderRadius: 10, padding: 12, marginBottom: 16, fontSize: 12.5, color: "#6b4c14" }}>
        خواندن خودکار پیامک‌های بانکی در این محیط (مرورگر / پیش‌نمایش) امکان‌پذیر نیست، چون دسترسی به پیامک‌های گوشی نیازمند مجوز واقعی اندروید است. اما می‌توانید متن پیامک بانک را اینجا Paste کنید تا مبلغ و نوع تراکنش به‌طور خودکار تشخیص داده شود و فرم ثبت تراکنش از قبل پر شود.
        اگر بعداً این برنامه به‌صورت اپلیکیشن اندروید (APK) ساخته شود، افزودن خواندن واقعی پیامک با یک افزونه Capacitor امکان‌پذیر خواهد بود.
      </div>
      <div style={{ ...st.card, padding: 14, marginBottom: 16 }}>
        <div style={{ fontWeight: 700, marginBottom: 10, fontSize: 14 }}>متن پیامک بانکی را وارد کنید</div>
        <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="مثلا: از حساب شما مبلغ 250,000 ریال بابت خرید کسر شد..." rows={4}
          style={{ ...st.input, resize: "vertical", fontFamily: "inherit" }} />
        {parsed && (
          <div style={{ fontSize: 12.5, marginBottom: 10, color: "#8a8194" }}>
            تشخیص داده شده: {parsed.amount ? `${toFaInt(parsed.amount)} ریال` : "مبلغی یافت نشد"} — نوع: {parsed.type === "income" ? "دریافت" : "پرداخت"}
          </div>
        )}
        <button
          disabled={!parsed || !parsed.amount}
          onClick={() => { openWithPrefill({ amount: parsed.amount, type: parsed.type, note: parsed.note }); onBack(); }}
          style={{ ...st.primaryBtn, opacity: parsed && parsed.amount ? 1 : 0.5 }}>
          ادامه و تکمیل ثبت تراکنش
        </button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------
   Calendar View
--------------------------------------------------------- */
/* ---------------------------------------------------------
   Jalali date picker — replaces native <input type="date">,
   which always shows the Gregorian calendar regardless of the
   phone's language. This renders a Persian-calendar popup instead.
--------------------------------------------------------- */
function JalaliDateInput({ value, onChange, style }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const d = value ? new Date(value) : new Date();
  const [viewY, setViewY] = useState(jalaliYear(d));
  const [viewM, setViewM] = useState(jalaliParts(d).m);
  const cells = useMemo(() => getJalaliMonthCells(viewY, viewM), [viewY, viewM]);
  function prevMonth() { if (viewM === 1) { setViewM(12); setViewY((y) => y - 1); } else setViewM((m) => m - 1); }
  function nextMonth() { if (viewM === 12) { setViewM(1); setViewY((y) => y + 1); } else setViewM((m) => m + 1); }
  const weekDays = ["ش", "ی", "د", "س", "چ", "پ", "ج"];
  return (
    <div style={{ position: "relative", marginBottom: 10 }}>
      <button type="button" onClick={() => setOpen((v) => !v)} style={{ ...style, margin: 0, textAlign: "right", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span>{value ? faLongDate(new Date(value)) : "انتخاب تاریخ"}</span>
        <CalendarDays size={15} />
      </button>
      {open && (
        <div onClick={(e) => e.stopPropagation()} style={{ position: "absolute", zIndex: 40, top: "100%", marginTop: 6, right: 0, background: t.card, borderRadius: 12, padding: 12, boxShadow: "0 6px 20px rgba(0,0,0,0.25)", width: 260 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <button type="button" onClick={prevMonth} style={navArrowStyle(t)}><ChevronLeft size={14} /></button>
            <div style={{ fontWeight: 700, fontSize: 13 }}>{cells[0] ? faMonthYear(cells[0].date) : ""}</div>
            <button type="button" onClick={nextMonth} style={navArrowStyle(t)}><ChevronRight size={14} /></button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 4 }}>
            {weekDays.map((w) => <div key={w} style={{ textAlign: "center", fontSize: 10, color: t.sub, fontWeight: 700 }}>{w}</div>)}
            {cells[0] && Array.from({ length: cells[0].weekday }).map((_, i) => <div key={"b" + i} />)}
            {cells.map((c) => {
              const iso = c.date.toISOString().slice(0, 10);
              const selected = value === iso;
              return (
                <button type="button" key={c.day} onClick={() => { onChange(iso); setOpen(false); }} style={{
                  aspectRatio: "1", border: "none", borderRadius: 7, cursor: "pointer", fontSize: 11,
                  background: selected ? BRAND.header : "transparent", color: selected ? "#fff" : t.text
                }}>{toFaInt(c.day)}</button>
              );
            })}
          </div>
          <button type="button" onClick={() => { onChange(todayISO()); setOpen(false); }} style={{ marginTop: 8, width: "100%", background: "none", border: "none", color: BRAND.header, fontWeight: 700, fontSize: 12, cursor: "pointer" }}>امروز</button>
        </div>
      )}
    </div>
  );
}

function CalendarViewSub({ transactions, catById }) {
  const t = useT();
  const now = new Date();
  const [jy, setJy] = useState(jalaliYear(now));
  const [jm, setJm] = useState(jalaliParts(now).m);
  const [selDay, setSelDay] = useState(null);
  const cells = useMemo(() => getJalaliMonthCells(jy, jm), [jy, jm]);
  const dayTx = (d) => transactions.filter((tx) => tx.date === d.date.toISOString().slice(0, 10));
  function prevMonth() { if (jm === 1) { setJm(12); setJy((y) => y - 1); } else setJm((m) => m - 1); setSelDay(null); }
  function nextMonth() { if (jm === 12) { setJm(1); setJy((y) => y + 1); } else setJm((m) => m + 1); setSelDay(null); }
  const weekDays = ["ش", "ی", "د", "س", "چ", "پ", "ج"];
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 14, marginBottom: 16 }}>
        <button onClick={prevMonth} style={navArrowStyle(t)}><ChevronLeft size={16} /></button>
        <div style={{ fontWeight: 700 }}>{cells[0] ? faMonthYear(cells[0].date) : ""}</div>
        <button onClick={nextMonth} style={navArrowStyle(t)}><ChevronRight size={16} /></button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 6, marginBottom: 8 }}>
        {weekDays.map((w) => <div key={w} style={{ textAlign: "center", fontSize: 11, fontWeight: 700, color: t.sub }}>{w}</div>)}
        {cells[0] && Array.from({ length: cells[0].weekday }).map((_, i) => <div key={"b" + i} />)}
        {cells.map((c) => {
          const txs = dayTx(c);
          const isSel = selDay && selDay.day === c.day;
          return (
            <button key={c.day} onClick={() => setSelDay(c)} style={{
              aspectRatio: "1", borderRadius: 9, border: "none", cursor: "pointer",
              background: isSel ? BRAND.header : t.card, color: isSel ? "#fff" : t.text,
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", position: "relative", fontSize: 13, fontWeight: 600
            }}>
              {toFaInt(c.day)}
              {txs.length > 0 && <span style={{ width: 5, height: 5, borderRadius: "50%", background: isSel ? "#fff" : BRAND.crimson, position: "absolute", bottom: 5 }} />}
            </button>
          );
        })}
      </div>
      {selDay && (
        <div style={{ marginTop: 16 }}>
          <SectionTitle text={faLongDate(selDay.date)} />
          {dayTx(selDay).length === 0 && <EmptyRow text="تراکنشی در این روز نیست" />}
          {dayTx(selDay).map((tx) => (
            <Row key={tx.id} title={catById(tx.categoryId)?.name || (tx.type === "transfer" ? "انتقال" : "—")} value={`${toFaInt(tx.amount)} ریال`}
              valueColor={tx.type === "expense" ? BRAND.crimson : tx.type === "income" ? BRAND.darkgreen : BRAND.violet} chevron={null} />
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------
   Settings View
--------------------------------------------------------- */
function SettingsView({ settings, setSettings, exportBackup, importBackup }) {
  const st = useStyles();
  const t = useT();
  const fileRef = useRef();
  const [pinInput, setPinInput] = useState("");
  const [profile, setProfile] = useState(settings.profile || { name: "", phone: "", email: "" });
  return (
    <div>
      <SectionTitle text="اطلاعات کاربری" />
      <div style={{ ...st.card, padding: 14, marginBottom: 18 }}>
        <input placeholder="نام و نام خانوادگی" value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} style={st.input} />
        <input placeholder="شماره تماس" value={profile.phone} onChange={(e) => setProfile({ ...profile, phone: e.target.value })} style={st.input} />
        <input placeholder="ایمیل (اختیاری)" value={profile.email} onChange={(e) => setProfile({ ...profile, email: e.target.value })} style={st.input} />
        <button onClick={() => setSettings((s) => ({ ...s, profile }))} style={st.primaryBtn}>ذخیره اطلاعات کاربری</button>
      </div>

      <SectionTitle text="رنگ‌بندی برنامه" />
      <div style={{ ...st.card, padding: 14, marginBottom: 18 }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {Object.entries(COLOR_PRESETS).map(([key, p]) => (
            <button key={key} onClick={() => setSettings((s) => ({ ...s, themeColor: key }))}
              style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, background: "none", border: "none", cursor: "pointer" }}>
              <span style={{
                width: 42, height: 42, borderRadius: "50%", background: p.header,
                border: settings.themeColor === key ? `3px solid ${p.fab}` : "3px solid transparent",
                boxShadow: settings.themeColor === key ? "0 0 0 2px #fff, 0 0 0 3px " + p.header : "none",
                display: "flex", alignItems: "center", justifyContent: "center"
              }}>
                {settings.themeColor === key && <Check size={18} color="#fff" />}
              </span>
              <span style={{ fontSize: 10.5, color: t.text }}>{p.name}</span>
            </button>
          ))}
        </div>
      </div>

      <SectionTitle text="ظاهر برنامه" />
      <div style={{ ...st.card, padding: "4px 12px", marginBottom: 18 }}>
        <Row title="تم روشن / تاریک" leftIcon={settings.theme === "dark" ? <Moon size={16} /> : <Sun size={16} />} leftColor={BRAND.header}
          extra={<button onClick={() => setSettings((s) => ({ ...s, theme: s.theme === "dark" ? "light" : "dark" }))} style={{ background: BRAND.green, color: "#fff", border: "none", borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>{settings.theme === "dark" ? "روشن کن" : "تاریک کن"}</button>}
          chevron={null} />
      </div>

      <SectionTitle text="اندازه فونت" />
      <div style={{ ...st.card, padding: 14, marginBottom: 18 }}>
        <div style={{ display: "flex", gap: 8 }}>
          {[{ v: 0.9, l: "کوچک" }, { v: 1, l: "معمولی" }, { v: 1.15, l: "بزرگ" }, { v: 1.3, l: "خیلی بزرگ" }].map((o) => (
            <button key={o.v} onClick={() => setSettings((s) => ({ ...s, fontScale: o.v }))} style={pillStyle(settings.fontScale === o.v)}>{o.l}</button>
          ))}
        </div>
      </div>

      <SectionTitle text="تقویم و واحد پول" />
      <div style={{ ...st.card, padding: 14, marginBottom: 18 }}>
        <div style={{ fontSize: 12, color: "#8a8194", marginBottom: 8 }}>تقویم</div>
        <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
          <button onClick={() => setSettings((s) => ({ ...s, calendarMode: "jalali" }))} style={pillStyle(settings.calendarMode !== "gregorian")}>شمسی</button>
          <button onClick={() => setSettings((s) => ({ ...s, calendarMode: "gregorian" }))} style={pillStyle(settings.calendarMode === "gregorian")}>میلادی</button>
        </div>
        <div style={{ fontSize: 11.5, color: "#8a8194", marginBottom: 14 }}>در این نسخه فقط قالب تاریخ تغییر می‌کند؛ متن رابط کاربری همچنان فارسی می‌ماند.</div>
        <div style={{ fontSize: 12, color: "#8a8194", marginBottom: 8 }}>واحد نمایش پول</div>
        <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
          <button onClick={() => setSettings((s) => ({ ...s, currency: "rial" }))} style={pillStyle(settings.currency === "rial")}>ریال</button>
          <button onClick={() => setSettings((s) => ({ ...s, currency: "toman" }))} style={pillStyle(settings.currency === "toman")}>تومان</button>
          <button onClick={() => setSettings((s) => ({ ...s, currency: "usd" }))} style={pillStyle(settings.currency === "usd")}>دلار</button>
        </div>
        {settings.currency === "usd" && (
          <>
            <div style={{ fontSize: 11.5, color: "#8a8194", marginBottom: 8 }}>اگر نرخ آنلاین در دسترس نبود، نرخ هر دلار به ریال را خودتان وارد کنید:</div>
            <input placeholder="مثلا 600000" value={settings.manualUsdRate} onChange={(e) => setSettings((s) => ({ ...s, manualUsdRate: e.target.value.replace(/[^0-9]/g, "") }))} style={st.input} inputMode="numeric" />
          </>
        )}
      </div>

      <SectionTitle text="یادآوری‌ها و اعلان‌ها" />
      <div style={{ ...st.card, padding: 14, marginBottom: 18 }}>
        <label style={st.label}>هشدار سررسید چک چند روز قبل؟</label>
        <input value={settings.checkReminderDays} onChange={(e) => setSettings((s) => ({ ...s, checkReminderDays: Number(e.target.value.replace(/[^0-9]/g, "") || 0) }))} style={st.input} inputMode="numeric" />
        <Row title="خواندن خودکار پیامک بانکی" leftIcon={<Bell size={16} />} leftColor={BRAND.orange}
          extra={<button onClick={async () => {
            try {
              const p = await RexaNative.requestSmsPermissions();
              if (p?.sms === "granted") setSettings((s) => ({ ...s, smsNotif: true, smsAutoRead: true }));
              else alert("مجوز خواندن پیامک داده نشد.");
            } catch {
              alert("این قابلیت فقط در APK اندروید Rexa فعال است.");
            }
          }} style={{ background: settings.smsAutoRead ? BRAND.green : "#aaa", color: "#fff", border: "none", borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
            {settings.smsAutoRead ? "فعال" : "فعال‌سازی"}
          </button>}
          chevron={null} />
        <div style={{ fontSize: 11.5, color: "#8a8194", marginTop: 6 }}>
          بعد از اجازه کاربر، پیامک‌های دریافتی در Android دریافت و برای تشخیص تراکنش بررسی می‌شوند. این قابلیت برای APK مستقیم مناسب است؛ انتشار Google Play به‌دلیل محدودیت‌های دسترسی SMS نیاز به بررسی سیاست‌های Play دارد.
        </div>
      </div>

      <SectionTitle text="هوش مصنوعی (اختیاری)" />
      <div style={{ ...st.card, padding: 14, marginBottom: 18 }}>
        <div style={{ fontSize: 11.5, color: "#8a8194", marginBottom: 10 }}>
          برای ثبت مستقیم جمله‌هایی مثل «امروز ۳۵۰ تومن برای شام دادم»، Rexa از OpenAI Responses API و خروجی ساختاریافته استفاده می‌کند. کلید API روی دستگاه ذخیره می‌شود؛ برای نسخه عمومی بهتر است بعداً آن را پشت یک Backend امن قرار دهیم.
        </div>
        <input type="password" placeholder="OpenAI API Key" value={settings.aiApiKey} onChange={(e) => setSettings((s) => ({ ...s, aiApiKey: e.target.value.trim() }))} style={st.input} autoComplete="off" />
        <input placeholder="مدل" value={settings.aiModel || "gpt-5.6-luna"} onChange={(e) => setSettings((s) => ({ ...s, aiModel: e.target.value.trim() || "gpt-5.6-luna" }))} style={st.input} />
        <div style={{ fontSize: 10.5, color: "#8a8194", marginTop: 4 }}>بدون کلید هم ثبت محلی فعال است؛ برای درک طبیعی جمله‌ها و ثبت مستقیم، کلید API لازم است.</div>
      </div>

      <SectionTitle text="امنیت" />
      <div style={{ ...st.card, padding: 14, marginBottom: 18 }}>
        <div style={{ fontSize: 12.5, color: "#8a8194", marginBottom: 10 }}>قفل دستگاه اندروید از BiometricPrompt استفاده می‌کند؛ روی گوشی سازگار، اثر انگشت/بیومتریک واقعی نمایش داده می‌شود و در صورت اجازه کاربر، PIN دستگاه نیز fallback است.</div>
        <button onClick={async () => {
          try {
            const info = await BiometricAuth.checkBiometry();
            if (!info?.isAvailable) { alert("بیومتریک برای استفاده در برنامه در این گوشی آماده نیست. ابتدا اثر انگشت یا روش بیومتریک را در تنظیمات گوشی ثبت کنید."); return; }
            await BiometricAuth.authenticate({
              reason: "فعال‌سازی قفل امن Rexa",
              allowDeviceCredential: true,
              androidTitle: "فعال‌سازی قفل Rexa",
              androidSubtitle: "هویت خود را با اثر انگشت یا قفل دستگاه تأیید کنید",
              androidConfirmationRequired: false,
              androidBiometryStrength: AndroidBiometryStrength.weak,
            });
            setSettings((s) => ({ ...s, biometricEnabled: true }));
            alert("قفل بیومتریک Rexa فعال شد.");
          } catch (e) {
            alert(e?.message || "فعال‌سازی بیومتریک انجام نشد.");
          }
        }} style={st.primaryBtn}>{settings.biometricEnabled ? "بیومتریک فعال است" : "فعال‌سازی اثر انگشت"}</button>
        <input placeholder="رمز عددی جدید (خالی = بدون قفل)" value={pinInput} onChange={(e) => setPinInput(e.target.value.replace(/[^0-9]/g, "").slice(0, 6))} style={st.input} inputMode="numeric" />
        <button onClick={() => setSettings((s) => ({ ...s, pin: pinInput }))} style={st.primaryBtn}>{pinInput ? "تنظیم رمز" : "حذف رمز"}</button>
      </div>

      <SectionTitle text="حساب مشترک خانوادگی" />
      <div style={{ ...st.card, padding: 14, marginBottom: 18 }}>
        <div style={{ fontSize: 12.5, color: "#8a8194", marginBottom: 10 }}>
          با روشن‌کردن این گزینه، اطلاعات مالی (حساب‌ها، تراکنش‌ها، بودجه و...) به‌صورت مشترک ذخیره می‌شود و هر کسی که به همین برنامه دسترسی داشته باشد آن را می‌بیند. این حالت جایگزین ورود واقعی چند کاربره نیست، صرفاً یک دفتر مشترک است.
        </div>
        <Row title="فعال‌سازی حساب مشترک" leftIcon={<Users size={16} />} leftColor={BRAND.violet}
          extra={<button onClick={() => setSettings((s) => ({ ...s, sharedFamily: !s.sharedFamily }))} style={{ background: settings.sharedFamily ? BRAND.crimson : BRAND.green, color: "#fff", border: "none", borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>{settings.sharedFamily ? "غیرفعال کن" : "فعال کن"}</button>}
          chevron={null} />
      </div>

      <SectionTitle text="پشتیبان‌گیری و بازیابی" />
      <div style={{ ...st.card, padding: 14, marginBottom: 18 }}>
        <button onClick={exportBackup} style={{ ...st.primaryBtn, background: BRAND.header, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, marginBottom: 10 }}><Download size={16} /> دریافت فایل پشتیبان</button>
        <input ref={fileRef} type="file" accept="application/json" style={{ display: "none" }} onChange={(e) => e.target.files[0] && importBackup(e.target.files[0])} />
        <button onClick={() => fileRef.current.click()} style={{ ...st.primaryBtn, background: BRAND.gold, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}><Upload size={16} /> بازیابی از فایل پشتیبان</button>
      </div>

      <SectionTitle text="درباره همگام‌سازی با Google Drive" />
      <div style={{ ...st.card, padding: 14, marginBottom: 18, fontSize: 12.5, color: "#8a8194" }}>
        اتصال مستقیم به Google Drive نیازمند ورود واقعی به حساب گوگل است که در این محیط در دسترس نیست. برای انتقال اطلاعات بین دستگاه‌ها از «دریافت فایل پشتیبان» استفاده کنید و همان فایل را در Drive خودتان نگه دارید یا در دستگاه دیگر «بازیابی» کنید.
      </div>

      <SectionTitle text="شخصی‌سازی نمای صفحه اول" />
      <div style={{ ...st.card, padding: "8px 12px", marginBottom: 18 }}>
        <div style={{ fontSize: 11.5, color: "#8a8194", padding: "6px 4px 10px" }}>هر بخش را می‌توانید نمایش/مخفی کنید یا با فلش‌ها ترتیبش را عوض کنید.</div>
        {(settings.homeSections || DEFAULT_HOME_SECTIONS).map((sec, i, arr) => {
          const meta = HOME_SECTION_LABELS[sec.key] || sec.key;
          function move(dir) {
            const idx = i + dir;
            if (idx < 0 || idx >= arr.length) return;
            const copy = [...arr];
            [copy[i], copy[idx]] = [copy[idx], copy[i]];
            setSettings((s) => ({ ...s, homeSections: copy }));
          }
          return (
            <div key={sec.key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 4px", borderBottom: "1px solid #f0eef3" }}>
              <span style={{ fontSize: 13, fontWeight: 600, opacity: sec.visible ? 1 : 0.4 }}>{meta}</span>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <button onClick={() => move(-1)} style={miniBtn}><ArrowUp size={13} /></button>
                <button onClick={() => move(1)} style={miniBtn}><ArrowDown size={13} /></button>
                <button onClick={() => setSettings((s) => ({ ...s, homeSections: arr.map((x) => x.key === sec.key ? { ...x, visible: !x.visible } : x) }))}
                  style={{ ...miniBtn, background: sec.visible ? BRAND.green : "#aaa", color: "#fff" }}>
                  {sec.visible ? <Eye size={13} /> : <EyeOff size={13} />}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <SectionTitle text="آموزش" />
      <div style={{ ...st.card, padding: 14, marginBottom: 18, fontSize: 13, lineHeight: 2, color: t.text }}>
        <div>• برای ثبت سریع تراکنش، دکمه‌ی سبز + پایین صفحه را بزن.</div>
        <div>• سه‌بار پشت‌سرهم روی هر جای صفحه بزن تا کادر «ثبت سریع» باز شود؛ هرچی تایپ کنی خودش تشخیص می‌ده هزینه بوده یا درآمد.</div>
        <div>• آیکون میکروفون بالای صفحه برای ثبت با صدا است (اگر گوشی‌ات پشتیبانی کند).</div>
        <div>• روی کارت‌های بانکی بالای صفحه چپ‌وراست بکش تا همه‌ی حساب‌هایت را ببینی.</div>
        <div>• از «شخصی‌سازی نمای صفحه اول» بالاتر همین صفحه، می‌توانی ترتیب و نمایش بخش‌های خانه را عوض کنی.</div>
      </div>

      <SectionTitle text="ارسال برنامه به دیگران" />
      <div style={{ ...st.card, padding: 14 }}>
        <button
          onClick={async () => {
            const text = "برنامه حسابداری Rexa رو امتحان کن!";
            if (navigator.share) { try { await navigator.share({ title: "Rexa", text }); } catch {} }
            else { try { await navigator.clipboard.writeText(text); alert("متن معرفی کپی شد."); } catch { alert(text); } }
          }}
          style={{ ...st.primaryBtn, background: BRAND.violet, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
          <Users size={16} /> اشتراک‌گذاری برنامه
        </button>
      </div>
    </div>
  );
}
const miniBtn = { width: 26, height: 26, borderRadius: 7, border: "none", background: "#eee", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" };
const HOME_SECTION_LABELS = {
  shortcut: "میانبر تراکنش‌ها", expense: "هزینه‌ها", income: "درآمدها", banks: "بانک‌ها و کارت‌ها",
  funds: "صندوق‌ها", balrep: "گزارش مانده حساب‌ها", budget: "بودجه‌بندی", loanchk: "وام‌ها و چک‌ها", bills: "یادآوری قبض‌ها",
};

/* ---------------------------------------------------------
   Add Transaction Sheet
--------------------------------------------------------- */
/* ---------------------------------------------------------
   Quick-add action sheet (opened from the center + button)
--------------------------------------------------------- */
function QuickAddSheet({ onClose, onPick }) {
  const st = useStyles();
  const options = [
    { key: "expense", label: "ثبت هزینه", icon: <TrendingDown size={20} />, color: BRAND.crimson },
    { key: "income", label: "ثبت درآمد", icon: <TrendingUp size={20} />, color: BRAND.darkgreen },
    { key: "transfer", label: "میانبر تراکنش", icon: <ArrowLeftRight size={20} />, color: BRAND.violet },
    { key: "check", label: "ثبت چک", icon: <FileSpreadsheet size={20} />, color: BRAND.gold },
  ];
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "flex-end", zIndex: 55, maxWidth: 480, margin: "0 auto" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", width: "100%", borderRadius: "18px 18px 0 0", padding: "20px 18px calc(env(safe-area-inset-bottom, 0px) + 20px)" }}>
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 16, textAlign: "center" }}>چی می‌خوای ثبت کنی؟</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 }}>
          {options.map((o) => (
            <button key={o.key} onClick={() => onPick(o.key)} style={{
              display: "flex", flexDirection: "column", alignItems: "center", gap: 8, padding: "18px 8px",
              borderRadius: 14, border: "none", background: "#f7f5fa", cursor: "pointer"
            }}>
              <span style={{ width: 44, height: 44, borderRadius: 12, background: o.color, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}>{o.icon}</span>
              <span style={{ fontSize: 12.5, fontWeight: 700, color: "#241a30" }}>{o.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------
   Simple text modal (used for the quick "یادداشت" note capture)
--------------------------------------------------------- */
function SimpleTextModal({ title, placeholder, onClose, onSubmit }) {
  const st = useStyles();
  const [text, setText] = useState("");
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "flex-end", zIndex: 55, maxWidth: 480, margin: "0 auto" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", width: "100%", borderRadius: "18px 18px 0 0", padding: "20px 18px calc(env(safe-area-inset-bottom, 0px) + 20px)" }}>
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 12 }}>{title}</div>
        <textarea autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} rows={4}
          style={{ ...st.input, resize: "vertical", fontFamily: "inherit" }} />
        <button disabled={!text.trim()} onClick={() => onSubmit(text.trim())} style={{ ...st.primaryBtn, opacity: text.trim() ? 1 : 0.5 }}>ذخیره</button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------
   Reminder quick modal
--------------------------------------------------------- */
function ReminderQuickModal({ onClose, onSubmit }) {
  const st = useStyles();
  const [text, setText] = useState("");
  const [date, setDate] = useState(todayISO());
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "flex-end", zIndex: 55, maxWidth: 480, margin: "0 auto" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", width: "100%", borderRadius: "18px 18px 0 0", padding: "20px 18px calc(env(safe-area-inset-bottom, 0px) + 20px)" }}>
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 12 }}>یادآوری جدید</div>
        <input autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="مثلا: تماس با بانک" style={st.input} />
        <label style={st.label}>تاریخ</label>
        <JalaliDateInput value={date} onChange={(v) => setDate(v)} style={st.input} />
        <button disabled={!text.trim()} onClick={() => onSubmit({ text: text.trim(), date, done: false })} style={{ ...st.primaryBtn, opacity: text.trim() ? 1 : 0.5 }}>ذخیره یادآوری</button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------
   Smart capture overlay — opened by triple-tap anywhere on the
   screen. Semi-transparent so the page behind stays visible.
   Text is parsed locally (same engine as the SMS/voice parser).
--------------------------------------------------------- */
function SmartCaptureOverlay({ onClose, onParsed }) {
  const st = useStyles();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const parsed = text.trim() ? parseBankSms(text) : null;
  async function submit() {
    if (!parsed?.amount) return;
    setBusy(true);
    try { await onParsed({ ...parsed, text }); }
    finally { setBusy(false); }
  }
  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(20,10,30,0.4)", backdropFilter: "blur(2px)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 90
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: "88%", maxWidth: 380, background: "rgba(255,255,255,0.96)", borderRadius: 18, padding: 18,
        boxShadow: "0 8px 30px rgba(0,0,0,0.3)"
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, fontWeight: 700, fontSize: 14, marginBottom: 10, color: BRAND.header }}>
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}><Sparkles size={17} /> ثبت سریع هوشمند</span>
          <VoiceCaptureButton onResult={(v) => setText(v)} disabled={busy} />
        </div>
        <textarea autoFocus value={text} onChange={(e) => setText(e.target.value)} rows={3}
          placeholder="مثلاً: امروز ۳۵۰ تومن برای شام دادم"
          style={{ ...st.input, resize: "vertical", fontFamily: "inherit", background: "rgba(255,255,255,0.7)" }} />
        {parsed && (
          <div style={{ fontSize: 12, color: "#6a6275", marginBottom: 10 }}>
            تشخیص اولیه: {parsed.amount ? `${toFaInt(parsed.amount)} ریال` : "مبلغی پیدا نشد"} — {parsed.type === "income" ? "دریافت" : "پرداخت"}{parsed.categoryHint ? ` — ${parsed.categoryHint}` : ""}
          </div>
        )}
        <button disabled={!parsed?.amount || busy} onClick={submit}
          style={{ ...st.primaryBtn, opacity: parsed?.amount && !busy ? 1 : 0.5 }}>
          {busy ? "در حال ثبت..." : "ثبت مستقیم"}
        </button>
      </div>
    </div>
  );
}
function AddTransactionSheet({ accounts, categories, favorites, members = [], events = [], projects = [], initial, onClose, onSubmit }) {
  const st = useStyles();
  const [type, setType] = useState(initial?.type || "expense");
  const [amount, setAmount] = useState(initial?.amount ? String(initial.amount) : "");
  const [categoryId, setCategoryId] = useState(() => {
    if (initial?.categoryHint) {
      const match = categories.find((c) => c.name === initial.categoryHint && c.kind === (initial.type || "expense"));
      if (match) return match.id;
    }
    return "";
  });
  const [accountId, setAccountId] = useState(accounts[0]?.id || "");
  const [toAccountId, setToAccountId] = useState(accounts[1]?.id || accounts[0]?.id || "");
  const [date, setDate] = useState(todayISO());
  const [note, setNote] = useState(initial?.note || "");
  const [tagsInput, setTagsInput] = useState("");
  const [photo, setPhoto] = useState(null);
  const [showMore, setShowMore] = useState(false);
  const [memberId, setMemberId] = useState("");
  const [eventId, setEventId] = useState("");
  const [projectId, setProjectId] = useState("");

  const filteredCats = categories.filter((c) => c.kind === type);
  const favCats = filteredCats.filter((c) => favorites.categories.includes(c.id));
  const canSubmit = amount && Number(amount) > 0 && accountId && (type === "transfer" ? toAccountId && toAccountId !== accountId : categoryId);

  async function handlePhoto(e) {
    const f = e.target.files[0];
    if (!f) return;
    const dataUrl = await resizeImage(f);
    setPhoto(dataUrl);
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "flex-end", zIndex: 50, maxWidth: 480, margin: "0 auto" }}>
      <div style={{ background: "#fff", width: "100%", borderRadius: "18px 18px 0 0", padding: "18px 18px 26px", maxHeight: "88vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "#8a8194" }}><X size={22} /></button>
          <div style={{ fontWeight: 700, fontSize: 16 }}>ثبت تراکنش جدید</div>
          <div style={{ width: 22 }} />
        </div>

        <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
          {[{ k: "expense", l: "پرداخت", c: BRAND.crimson }, { k: "income", l: "دریافت", c: BRAND.darkgreen }, { k: "transfer", l: "انتقال", c: BRAND.violet }].map((o) => (
            <button key={o.k} onClick={() => { setType(o.k); setCategoryId(""); }} style={{ flex: 1, padding: "10px 4px", borderRadius: 9, border: `1.5px solid ${type === o.k ? o.c : "#e3e0ea"}`, background: type === o.k ? o.c : "#fff", color: type === o.k ? "#fff" : "#241a30", fontWeight: 700, cursor: "pointer", fontSize: 13.5 }}>{o.l}</button>
          ))}
        </div>

        {favCats.length > 0 && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
            {favCats.map((c) => (
              <button key={c.id} onClick={() => setCategoryId(c.id)} style={{ display: "flex", alignItems: "center", gap: 4, background: categoryId === c.id ? BRAND.header : "#f1eef4", color: categoryId === c.id ? "#fff" : "#3E1461", border: "none", borderRadius: 20, padding: "6px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                <Star size={11} fill="#f5b301" color="#f5b301" /> {c.name}
              </button>
            ))}
          </div>
        )}

        <label style={st.label}>مبلغ (ریال)</label>
        <input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ""))} placeholder="0" inputMode="numeric" style={st.input} />

        {type !== "transfer" ? (
          <>
            <label style={st.label}>دسته‌بندی</label>
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} style={st.input}>
              <option value="">انتخاب کنید</option>
              {filteredCats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <label style={st.label}>{type === "expense" ? "از حساب" : "به حساب"}</label>
            <select value={accountId} onChange={(e) => setAccountId(e.target.value)} style={st.input}>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </>
        ) : (
          <>
            <label style={st.label}>از حساب</label>
            <select value={accountId} onChange={(e) => setAccountId(e.target.value)} style={st.input}>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            <label style={st.label}>به حساب</label>
            <select value={toAccountId} onChange={(e) => setToAccountId(e.target.value)} style={st.input}>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </>
        )}

        <label style={st.label}>تاریخ</label>
        <JalaliDateInput value={date} onChange={(v) => setDate(v)} style={st.input} />

        <label style={st.label}>برچسب‌ها (با کاما جدا کنید)</label>
        <input value={tagsInput} onChange={(e) => setTagsInput(e.target.value)} placeholder="مثلا: سفر, ضروری" style={st.input} />

        <label style={st.label}>یادداشت (اختیاری)</label>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="توضیحات..." style={st.input} />

        <label style={st.label}>پیوست عکس (اختیاری)</label>
        <label style={{ display: "flex", alignItems: "center", gap: 8, border: "1.5px dashed #d8d2e0", borderRadius: 9, padding: "10px 12px", cursor: "pointer", marginBottom: 12, fontSize: 13, color: "#8a8194" }}>
          <ImageIcon size={16} /> {photo ? "عکس انتخاب شد ✓" : "افزودن عکس رسید"}
          <input type="file" accept="image/*" onChange={handlePhoto} style={{ display: "none" }} />
        </label>
        {photo && <img src={photo} style={{ width: 60, height: 60, borderRadius: 8, objectFit: "cover", marginBottom: 12 }} />}

        {(members.length > 0 || events.length > 0 || projects.length > 0) && (
          <div style={{ marginBottom: 12 }}>
            <button onClick={() => setShowMore((v) => !v)} style={{ background: "none", border: "none", color: BRAND.header, fontWeight: 700, fontSize: 12.5, cursor: "pointer", padding: 0, marginBottom: showMore ? 10 : 0 }}>
              {showMore ? "بستن جزئیات بیشتر ▲" : "افزودن عضو / رویداد / پروژه ▼"}
            </button>
            {showMore && (
              <>
                {members.length > 0 && (<>
                  <label style={st.label}>عضو خانواده</label>
                  <select value={memberId} onChange={(e) => setMemberId(e.target.value)} style={st.input}>
                    <option value="">— بدون عضو —</option>
                    {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                </>)}
                {events.length > 0 && (<>
                  <label style={st.label}>رویداد</label>
                  <select value={eventId} onChange={(e) => setEventId(e.target.value)} style={st.input}>
                    <option value="">— بدون رویداد —</option>
                    {events.map((ev) => <option key={ev.id} value={ev.id}>{ev.name}</option>)}
                  </select>
                </>)}
                {projects.length > 0 && (<>
                  <label style={st.label}>پروژه</label>
                  <select value={projectId} onChange={(e) => setProjectId(e.target.value)} style={st.input}>
                    <option value="">— بدون پروژه —</option>
                    {projects.map((pr) => <option key={pr.id} value={pr.id}>{pr.name}</option>)}
                  </select>
                </>)}
              </>
            )}
          </div>
        )}

        <button disabled={!canSubmit}
          onClick={() => onSubmit({
            type, amount: Number(amount), categoryId, accountId,
            toAccountId: type === "transfer" ? toAccountId : undefined,
            date, note, photo: photo || undefined,
            tags: tagsInput.split(",").map((s) => s.trim()).filter(Boolean),
            memberId: memberId || undefined, eventId: eventId || undefined, projectId: projectId || undefined,
          })}
          style={{ ...st.primaryBtn, opacity: canSubmit ? 1 : 0.5, marginTop: 6 }}>
          <span style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}><Check size={17} /> ثبت تراکنش</span>
        </button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------
   Side menu
--------------------------------------------------------- */
function SideMenu({ onClose, setSubView, profileName }) {
  const items = [
    { label: "ویرایش اطلاعات کاربری", key: "profile" },
    { label: "تنظیمات و پشتیبان‌گیری", key: "settings" },
    { label: "اعضای منزل، رویداد و پروژه", key: "tags" },
    { label: "دوره مالی", key: "periods" },
    { label: "پیامک بانکی", key: "sms" },
    { label: "تقویم شمسی", key: "calendar" },
    { label: "دارایی‌ها", key: "assets" },
    { label: "چک‌ها", key: "checks" },
    { label: "وام و اقساط", key: "loans" },
    { label: "یادآوری قبض‌ها", key: "bills" },
  ];
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 60, maxWidth: 480, margin: "0 auto" }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ position: "absolute", top: 0, left: 0, width: "82%", height: "100%", background: "#fff", boxShadow: "3px 0 12px rgba(0,0,0,0.2)", overflowY: "auto" }}>
        <div style={{ background: BRAND.header, color: "#fff", padding: "18px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#fff", cursor: "pointer" }}><X size={22} /></button>
          <div style={{ fontWeight: 700 }}>{profileName || "alireza shadfar"}</div>
        </div>
        <div style={{ padding: "8px 16px" }}>
          {items.map((it) => (
            <div key={it.key} onClick={() => setSubView(it.key)} style={{ padding: "13px 4px", borderBottom: "1px solid #f0eef3", fontSize: 14, fontWeight: 600, color: "#241a30", cursor: "pointer" }}>{it.label}</div>
          ))}
        </div>
      </div>
    </div>
  );
}
