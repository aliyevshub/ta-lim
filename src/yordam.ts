// =====================================================================
// yordam.ts — barcha sahifalar uchun umumiy yordamchi funksiyalar
// =====================================================================

const FAN_BELGI: Record<string, string> = {
  "Ona tili": "✏️", Matematika: "➕", "O'qish": "📖", "Tabiiy fan": "🌿", "Ingliz tili": "🔤", Boshqa: "📌",
};
const HOLAT: Record<string, { b: string; m: string }> = {
  ha: { b: "✅", m: "Bajardi" }, qisman: { b: "⚠️", m: "Qisman" }, yoq: { b: "❌", m: "Bajarmadi" },
};
const DAVOMAT: Record<string, { b: string; m: string }> = {
  keldi: { b: "✅", m: "Keldi" }, kechikdi: { b: "⏰", m: "Kechikdi" }, kelmadi: { b: "❌", m: "Kelmadi" },
};
const DARAJALAR: Record<number, { b: string; m: string }> = {
  1: { b: "🌟", m: "Mustahkam o'zlashtirdi" }, 2: { b: "👍", m: "O'zlashtirmoqda" }, 3: { b: "💪", m: "Ko'proq mashq kerak" },
};
const OYLAR = ["Yanvar", "Fevral", "Mart", "Aprel", "May", "Iyun", "Iyul", "Avgust", "Sentabr", "Oktabr", "Noyabr", "Dekabr"];

function el<T extends HTMLElement = HTMLElement>(s: string, ota: ParentNode = document): T {
  const e = ota.querySelector<T>(s);
  if (!e) throw new Error("Element topilmadi: " + s);
  return e;
}
function xv(m: unknown): string {
  return String(m ?? "").replace(/[&<>"']/g, (b) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[b]!));
}
function som(n: number): string {
  return Math.round(n || 0).toLocaleString("ru-RU").replace(/ /g, " ") + " so'm";
}
function bugun(): string {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}
function shuOy(): string {
  return bugun().slice(0, 7);
}
function sanaMatn(s: string): string {
  const [y, m, d] = s.split("-").map(Number);
  return `${d}-${OYLAR[m - 1]?.toLowerCase() ?? ""}${y !== new Date().getFullYear() ? " " + y : ""}`;
}
function oyMatn(s: string): string {
  const [y, m] = s.split("-").map(Number);
  return `${OYLAR[m - 1] ?? ""} ${y}`;
}
function fanChip(fan: string): string {
  return `<span class="fan" data-fan="${xv(fan)}">${FAN_BELGI[fan] ?? "📌"} ${xv(fan)}</span>`;
}

let xabarTaymer = 0;
function xabar(matn: string): void {
  const t = el("#xabar");
  t.textContent = matn;
  t.classList.add("korin");
  clearTimeout(xabarTaymer);
  xabarTaymer = window.setTimeout(() => t.classList.remove("korin"), 2400);
}

function xotira(kalit: string, qiymat?: string | null): string | null {
  try {
    if (qiymat === undefined) return localStorage.getItem(kalit);
    if (qiymat === null) localStorage.removeItem(kalit);
    else localStorage.setItem(kalit, qiymat);
  } catch { /* xotira yopiq */ }
  return null;
}

async function soror<T>(yol: string, sozlama: RequestInit = {}, token?: string): Promise<T> {
  let javob: Response;
  try {
    javob = await fetch(yol, {
      ...sozlama,
      headers: { ...(token ? { authorization: "Bearer " + token } : {}), ...(sozlama.headers || {}) },
    });
  } catch {
    throw new Error("Internet aloqasini tekshirib, qayta urinib ko'ring.");
  }
  const j = await javob.json().catch(() => ({}));
  if (!javob.ok) {
    const e = new Error((j as { xato?: string }).xato || "Xatolik yuz berdi") as Error & { status?: number };
    e.status = javob.status;
    throw e;
  }
  return j as T;
}
function jsonBody(b: unknown): RequestInit {
  return { headers: { "content-type": "application/json" }, body: JSON.stringify(b) };
}
