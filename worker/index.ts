// =====================================================================
// worker/index.ts — SERVER (Cloudflare Worker)
// ---------------------------------------------------------------------
// Boshlang'ich sinf repetitori uchun tizim.
//
//   Hamma uchun:
//     GET  /api/ommaviy            — ochiq sahifa ma'lumotlari
//     POST /api/ariza              — darsga yozilish arizasi (botga ham yuboriladi)
//     GET  /api/ota-ona?kod=...    — ota-ona: farzandining ma'lumotlari
//     GET  /api/rasm/:id           — yuklangan rasm
//     POST /api/tg/webhook         — Telegram bot xabarlari
//   Repetitor (login + parol → vaqtinchalik token):
//     POST /api/kirish, POST /api/chiqish
//     /api/admin/...               — guruhlar, o'quvchilar, kunlik jurnal,
//                                    topshiriqlar, davomat, to'lovlar,
//                                    oylik baholar, arizalar, sozlamalar, bot
//
// Xavfsizlik: parol taxmin qilishdan himoya (5 xato → 15 daqiqa blok),
// token 12 soat amal qiladi (bazada faqat xeshi saqlanadi), xavfsizlik
// sarlavhalari, so'rovlar soni cheklangan, barcha SQL parametrli.
// =====================================================================

interface Env {
  DB: any;
  ASSETS: { fetch(req: Request): Promise<Response> };
  ADMIN_LOGIN?: string;
  ADMIN_PAROL?: string;
  TELEGRAM_TOKEN?: string;
  TELEGRAM_API?: string; // faqat sinov uchun
}

const FANLAR = ["Ona tili", "Matematika", "O'qish", "Tabiiy fan", "Ingliz tili", "Boshqa"];
const TOKEN_MUDDAT = 12 * 3600_000;
const MAX_RASM = 1_500_000;

// ---------------------------------------------------------------------
// YORDAMCHILAR
// ---------------------------------------------------------------------

const XAVFSIZLIK: Record<string, string> = {
  "content-security-policy":
    "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
    "font-src https://fonts.gstatic.com; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
  "strict-transport-security": "max-age=31536000; includeSubDomains",
};

function sarlavhaQosh(r: Response): Response {
  const yangi = new Response(r.body, r);
  for (const [k, v] of Object.entries(XAVFSIZLIK)) yangi.headers.set(k, v);
  return yangi;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}
const xato = (matn: string, status = 400) => json({ xato: matn }, status);

const qisqa = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);
const butun = (v: unknown) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? n : NaN;
};
const sanaTogri = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
const oyTogri = (s: string) => /^\d{4}-\d{2}$/.test(s);
const h = (m: string) => String(m).replace(/[&<>]/g, (b) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[b]!));
const OYLAR = ["Yanvar", "Fevral", "Mart", "Aprel", "May", "Iyun", "Iyul", "Avgust", "Sentabr", "Oktabr", "Noyabr", "Dekabr"];
const oyNomi = (oy: string) => `${OYLAR[Number(oy.slice(5)) - 1]} ${oy.slice(0, 4)}`;
const somMatn = (n: number) => Math.round(n).toLocaleString("ru-RU").replace(/ /g, " ") + " so'm";

function tasodifiy(bayt: number): string {
  return [...crypto.getRandomValues(new Uint8Array(bayt))].map((b) => b.toString(16).padStart(2, "0")).join("");
}
// Ota-ona kodi: o'qish oson, chalkash harflarsiz (0/O, 1/I yo'q)
function otaOnaKodi(): string {
  const a = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const r = crypto.getRandomValues(new Uint8Array(8));
  const s = [...r].map((b) => a[b % a.length]).join("");
  return s.slice(0, 4) + "-" + s.slice(4);
}
async function xesh(matn: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(matn));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function tengmi(a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([xesh(a), xesh(b)]);
  let f = 0;
  for (let i = 0; i < x.length; i++) f |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return f === 0;
}

// ---------------------------------------------------------------------
// BAZA
// ---------------------------------------------------------------------

let tayyor = false;
async function jadvallar(db: any): Promise<void> {
  if (tayyor) return;
  const q = (s: string) => db.prepare(s);
  await db.batch([
    q(`CREATE TABLE IF NOT EXISTS sozlamalar (kalit TEXT PRIMARY KEY, qiymat TEXT NOT NULL)`),
    q(`CREATE TABLE IF NOT EXISTS sessiyalar (xesh TEXT PRIMARY KEY, muddat INTEGER NOT NULL)`),
    q(`CREATE TABLE IF NOT EXISTS urinishlar (ip TEXT NOT NULL, turi TEXT NOT NULL, vaqt INTEGER NOT NULL)`),
    q(`CREATE TABLE IF NOT EXISTS guruhlar (
        id INTEGER PRIMARY KEY AUTOINCREMENT, nomi TEXT NOT NULL, sinf INTEGER NOT NULL,
        narx INTEGER NOT NULL DEFAULT 0, jadval TEXT NOT NULL DEFAULT '')`),
    q(`CREATE TABLE IF NOT EXISTS oquvchilar (
        id INTEGER PRIMARY KEY AUTOINCREMENT, ism TEXT NOT NULL, guruh_id INTEGER NOT NULL,
        kod TEXT NOT NULL UNIQUE, tg_chat TEXT, faol INTEGER NOT NULL DEFAULT 1,
        yaratilgan TEXT NOT NULL DEFAULT (date('now')))`),
    q(`CREATE TABLE IF NOT EXISTS darslar (
        id INTEGER PRIMARY KEY AUTOINCREMENT, guruh_id INTEGER NOT NULL, sana TEXT NOT NULL,
        fan TEXT NOT NULL, mavzu TEXT NOT NULL, izoh TEXT NOT NULL DEFAULT '')`),
    q(`CREATE TABLE IF NOT EXISTS topshiriqlar (
        id INTEGER PRIMARY KEY AUTOINCREMENT, guruh_id INTEGER NOT NULL, sana TEXT NOT NULL,
        fan TEXT NOT NULL, turi TEXT NOT NULL, matn TEXT NOT NULL, rasmlar TEXT NOT NULL DEFAULT '[]',
        muddat TEXT)`),
    q(`CREATE TABLE IF NOT EXISTS bajarish (
        topshiriq_id INTEGER NOT NULL, oquvchi_id INTEGER NOT NULL, holat TEXT NOT NULL,
        yulduz INTEGER NOT NULL DEFAULT 0, izoh TEXT NOT NULL DEFAULT '',
        PRIMARY KEY (topshiriq_id, oquvchi_id))`),
    q(`CREATE TABLE IF NOT EXISTS davomat (
        oquvchi_id INTEGER NOT NULL, sana TEXT NOT NULL, holat TEXT NOT NULL,
        PRIMARY KEY (oquvchi_id, sana))`),
    q(`CREATE TABLE IF NOT EXISTS tolovlar (
        id INTEGER PRIMARY KEY AUTOINCREMENT, oquvchi_id INTEGER NOT NULL, oy TEXT NOT NULL,
        summa INTEGER NOT NULL, sana TEXT NOT NULL DEFAULT (date('now')), izoh TEXT NOT NULL DEFAULT '')`),
    q(`CREATE TABLE IF NOT EXISTS baholar (
        oquvchi_id INTEGER NOT NULL, oy TEXT NOT NULL, fan TEXT NOT NULL, daraja INTEGER NOT NULL,
        izoh TEXT NOT NULL DEFAULT '', PRIMARY KEY (oquvchi_id, oy, fan))`),
    q(`CREATE TABLE IF NOT EXISTS arizalar (
        id INTEGER PRIMARY KEY AUTOINCREMENT, ism TEXT NOT NULL, bola TEXT NOT NULL, sinf TEXT NOT NULL,
        tel TEXT NOT NULL, izoh TEXT NOT NULL DEFAULT '', vaqt TEXT NOT NULL DEFAULT (datetime('now')))`),
    q(`CREATE TABLE IF NOT EXISTS rasmlar (id TEXT PRIMARY KEY, turi TEXT NOT NULL, malumot BLOB NOT NULL)`),
  ]);
  // Yangi ustunlar (eski bazaga qo'shiladi; bor bo'lsa xato e'tiborsiz qoldiriladi)
  for (const ustun of ["familiya TEXT NOT NULL DEFAULT ''", "ota_ona TEXT NOT NULL DEFAULT ''", "tel TEXT NOT NULL DEFAULT ''"]) {
    try { await db.prepare(`ALTER TABLE oquvchilar ADD COLUMN ${ustun}`).run(); } catch { /* allaqachon bor */ }
  }
  tayyor = true;
}

// O'quvchi ma'lumotlarini tekshirish
function oquvchiTekshir(b: any): { ism: string; familiya: string; ota_ona: string; tel: string; guruh: number } | string {
  const ism = qisqa(b?.ism, 60), familiya = qisqa(b?.familiya, 60), ota_ona = qisqa(b?.ota_ona, 80), tel = qisqa(b?.tel, 30);
  if (ism.length < 2) return "O'quvchi ismini kiriting";
  if (tel && !/^[+\d][\d\s()\-]{6,20}$/.test(tel)) return "Telefon raqamni to'g'ri kiriting";
  return { ism, familiya, ota_ona, tel, guruh: butun(b?.guruh_id) };
}

async function sozlama(db: any, k: string): Promise<string | null> {
  const r = await db.prepare("SELECT qiymat FROM sozlamalar WHERE kalit = ?").bind(k).first();
  return r ? r.qiymat : null;
}
async function sozlamaYoz(db: any, k: string, v: string): Promise<void> {
  await db.prepare("INSERT INTO sozlamalar (kalit, qiymat) VALUES (?, ?) ON CONFLICT(kalit) DO UPDATE SET qiymat = excluded.qiymat").bind(k, v).run();
}

// Bitta IP dan so'rovlarni cheklash (turi bo'yicha)
async function urinishlarSoni(db: any, ip: string, turi: string, daqiqa: number): Promise<number> {
  const r = await db.prepare("SELECT COUNT(*) AS n FROM urinishlar WHERE ip = ? AND turi = ? AND vaqt > ?").bind(ip, turi, Date.now() - daqiqa * 60_000).first();
  return r?.n ?? 0;
}
async function urinishYoz(db: any, ip: string, turi: string): Promise<void> {
  await db.prepare("DELETE FROM urinishlar WHERE vaqt < ?").bind(Date.now() - 24 * 3600_000).run();
  await db.prepare("INSERT INTO urinishlar (ip, turi, vaqt) VALUES (?, ?, ?)").bind(ip, turi, Date.now()).run();
}
const ipOl = (req: Request) => req.headers.get("cf-connecting-ip") || "nomalum";

// ---------------------------------------------------------------------
// TELEGRAM
// ---------------------------------------------------------------------

let tgManzil = "https://api.telegram.org";
async function tg(token: string, usul: string, malumot: unknown = {}): Promise<any> {
  const r = await fetch(`${tgManzil}/bot${token}/${usul}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(malumot),
  });
  const j: any = await r.json().catch(() => ({}));
  if (!j.ok) throw new Error(j.description || "Telegram javob bermadi");
  return j.result;
}
async function yubor(env: Env, chat: string | null, matn: string): Promise<boolean> {
  if (!env.TELEGRAM_TOKEN || !chat) return false;
  try {
    await tg(env.TELEGRAM_TOKEN, "sendMessage", { chat_id: Number(chat), text: matn, parse_mode: "HTML", disable_web_page_preview: true });
    return true;
  } catch (e) {
    console.error(e);
    return false;
  }
}

const HOLAT_BELGI: Record<string, string> = { ha: "✅ bajardi", qisman: "⚠️ qisman bajardi", yoq: "❌ bajarmadi" };
const DAVOMAT_BELGI: Record<string, string> = { keldi: "✅ keldi", kechikdi: "⏰ kechikdi", kelmadi: "❌ kelmadi" };
const DARAJA: Record<number, string> = { 1: "🌟 Mustahkam o'zlashtirdi", 2: "👍 O'zlashtirmoqda", 3: "💪 Ko'proq mashq kerak" };

// ---------------------------------------------------------------------
// OTA-ONA UCHUN MA'LUMOTLAR
// ---------------------------------------------------------------------

async function otaOnaMalumoti(db: any, o: any) {
  const guruh = await db.prepare("SELECT id, nomi, sinf, narx, jadval FROM guruhlar WHERE id = ?").bind(o.guruh_id).first();
  const chegara = new Date(Date.now() - 45 * 86400_000).toISOString().slice(0, 10);
  const [darslar, topshiriqlar, davomat, baholar, tolovlar] = await Promise.all([
    db.prepare("SELECT sana, fan, mavzu, izoh FROM darslar WHERE guruh_id = ? AND sana >= ? ORDER BY sana DESC, id DESC LIMIT 100").bind(o.guruh_id, chegara).all(),
    db.prepare(`SELECT t.id, t.sana, t.fan, t.turi, t.matn, t.rasmlar, t.muddat, b.holat, b.yulduz, b.izoh
                FROM topshiriqlar t LEFT JOIN bajarish b ON b.topshiriq_id = t.id AND b.oquvchi_id = ?
                WHERE t.guruh_id = ? AND t.sana >= ? ORDER BY t.sana DESC, t.id DESC LIMIT 100`).bind(o.id, o.guruh_id, chegara).all(),
    db.prepare("SELECT sana, holat FROM davomat WHERE oquvchi_id = ? AND sana >= ? ORDER BY sana DESC").bind(o.id, chegara).all(),
    db.prepare("SELECT oy, fan, daraja, izoh FROM baholar WHERE oquvchi_id = ? ORDER BY oy DESC").bind(o.id).all(),
    db.prepare("SELECT oy, SUM(summa) AS summa FROM tolovlar WHERE oquvchi_id = ? GROUP BY oy ORDER BY oy DESC LIMIT 12").bind(o.id).all(),
  ]);
  return {
    ism: [o.ism, o.familiya].filter(Boolean).join(" "),
    guruh,
    telegram: !!o.tg_chat,
    darslar: darslar.results,
    topshiriqlar: topshiriqlar.results.map((t: any) => ({ ...t, rasmlar: JSON.parse(t.rasmlar) })),
    davomat: davomat.results,
    baholar: baholar.results,
    tolovlar: tolovlar.results,
  };
}

// ---------------------------------------------------------------------
// REPETITOR (ADMIN) SO'ROVLARI
// ---------------------------------------------------------------------

async function admin(req: Request, env: Env, yol: string, url: URL): Promise<Response> {
  const db = env.DB;
  const usul = req.method;
  const b: any = usul === "GET" || usul === "DELETE" ? null : await req.json().catch(() => ({}));

  // ---------- Holat ----------
  if (yol === "/holat" && usul === "GET") {
    const n = async (s: string) => (await db.prepare(s).first())?.n ?? 0;
    const bot = env.TELEGRAM_TOKEN ? await tg(env.TELEGRAM_TOKEN, "getMe").then((r: any) => r.username).catch(() => null) : null;
    return json({
      fanlar: FANLAR,
      oquvchilar: await n("SELECT COUNT(*) AS n FROM oquvchilar WHERE faol = 1"),
      guruhlar: await n("SELECT COUNT(*) AS n FROM guruhlar"),
      arizalar: await n("SELECT COUNT(*) AS n FROM arizalar"),
      token: !!env.TELEGRAM_TOKEN,
      bot,
      repetitorChat: await sozlama(db, "tg_repetitor_nomi"),
    });
  }

  // ---------- Sozlamalar (ochiq sahifa) ----------
  if (yol === "/sozlamalar") {
    if (usul === "GET") return json(JSON.parse((await sozlama(db, "sahifa")) || "{}"));
    if (usul === "PUT") {
      const s = {
        ism: qisqa(b.ism, 80), shior: qisqa(b.shior, 160), haqida: qisqa(b.haqida, 1500),
        tajriba: qisqa(b.tajriba, 60), manzil: qisqa(b.manzil, 160), narxlar: qisqa(b.narxlar, 800),
        jadval: qisqa(b.jadval, 600),
      };
      await sozlamaYoz(db, "sahifa", JSON.stringify(s));
      return json(s);
    }
  }

  // ---------- Guruhlar ----------
  if (yol === "/guruhlar" && usul === "GET") {
    const { results } = await db.prepare(
      `SELECT g.*, (SELECT COUNT(*) FROM oquvchilar o WHERE o.guruh_id = g.id AND o.faol = 1) AS soni FROM guruhlar g ORDER BY g.sinf, g.nomi`
    ).all();
    return json(results);
  }
  if (yol === "/guruhlar" && usul === "POST") {
    const nomi = qisqa(b.nomi, 60), sinf = butun(b.sinf), narx = butun(b.narx || 0);
    if (nomi.length < 1) return xato("Guruh nomini kiriting");
    if (!(sinf >= 0 && sinf <= 4)) return xato("Sinf 0–4 oralig'ida bo'lsin (0 — maktabgacha)");
    if (!(narx >= 0 && narx <= 100_000_000)) return xato("Narx noto'g'ri");
    const r = await db.prepare("INSERT INTO guruhlar (nomi, sinf, narx, jadval) VALUES (?, ?, ?, ?) RETURNING *").bind(nomi, sinf, narx, qisqa(b.jadval, 200)).first();
    return json(r, 201);
  }
  let m = yol.match(/^\/guruhlar\/(\d+)$/);
  if (m) {
    const id = Number(m[1]);
    if (usul === "PUT") {
      const nomi = qisqa(b.nomi, 60), sinf = butun(b.sinf), narx = butun(b.narx || 0);
      if (nomi.length < 1 || !(sinf >= 0 && sinf <= 4) || !(narx >= 0)) return xato("Ma'lumot noto'g'ri");
      await db.prepare("UPDATE guruhlar SET nomi=?, sinf=?, narx=?, jadval=? WHERE id=?").bind(nomi, sinf, narx, qisqa(b.jadval, 200), id).run();
      return json({ ok: true });
    }
    if (usul === "DELETE") {
      const n = (await db.prepare("SELECT COUNT(*) AS n FROM oquvchilar WHERE guruh_id = ?").bind(id).first())?.n ?? 0;
      if (n > 0) return xato("Avval guruhdagi o'quvchilarni boshqa guruhga o'tkazing yoki o'chiring");
      await db.batch([
        db.prepare("DELETE FROM bajarish WHERE topshiriq_id IN (SELECT id FROM topshiriqlar WHERE guruh_id = ?)").bind(id),
        db.prepare("DELETE FROM topshiriqlar WHERE guruh_id = ?").bind(id),
        db.prepare("DELETE FROM darslar WHERE guruh_id = ?").bind(id),
        db.prepare("DELETE FROM guruhlar WHERE id = ?").bind(id),
      ]);
      return json({ ok: true });
    }
  }

  // ---------- O'quvchilar ----------
  if (yol === "/oquvchilar" && usul === "GET") {
    const { results } = await db.prepare(
      `SELECT o.id, o.ism, o.familiya, o.ota_ona, o.tel, o.guruh_id, o.kod, o.faol, o.yaratilgan, (o.tg_chat IS NOT NULL) AS telegram, g.nomi AS guruh
       FROM oquvchilar o LEFT JOIN guruhlar g ON g.id = o.guruh_id ORDER BY o.faol DESC, g.sinf, o.familiya, o.ism`
    ).all();
    return json(results);
  }
  if (yol === "/oquvchilar" && usul === "POST") {
    const t = oquvchiTekshir(b);
    if (typeof t === "string") return xato(t);
    if (!(await db.prepare("SELECT id FROM guruhlar WHERE id = ?").bind(t.guruh).first())) return xato("Guruhni tanlang");
    for (let i = 0; i < 5; i++) {
      try {
        const r = await db.prepare("INSERT INTO oquvchilar (ism, familiya, ota_ona, tel, guruh_id, kod) VALUES (?, ?, ?, ?, ?, ?) RETURNING *")
          .bind(t.ism, t.familiya, t.ota_ona, t.tel, t.guruh, otaOnaKodi()).first();
        return json(r, 201);
      } catch { /* kod takrorlansa, qayta urinamiz */ }
    }
    return xato("Qayta urinib ko'ring", 500);
  }
  m = yol.match(/^\/oquvchilar\/(\d+)(\/yangi-kod)?$/);
  if (m) {
    const id = Number(m[1]);
    if (m[2] && usul === "POST") {
      const kod = otaOnaKodi();
      await db.prepare("UPDATE oquvchilar SET kod = ?, tg_chat = NULL WHERE id = ?").bind(kod, id).run();
      return json({ kod });
    }
    if (usul === "PUT") {
      const t = oquvchiTekshir(b);
      if (typeof t === "string") return xato(t);
      if (!(await db.prepare("SELECT id FROM guruhlar WHERE id = ?").bind(t.guruh).first())) return xato("Guruhni tanlang");
      await db.prepare("UPDATE oquvchilar SET ism=?, familiya=?, ota_ona=?, tel=?, guruh_id=?, faol=? WHERE id=?")
        .bind(t.ism, t.familiya, t.ota_ona, t.tel, t.guruh, b.faol ? 1 : 0, id).run();
      return json({ ok: true });
    }
    if (usul === "DELETE") {
      await db.batch(["bajarish", "davomat", "tolovlar", "baholar"].map((t) => db.prepare(`DELETE FROM ${t} WHERE oquvchi_id = ?`).bind(id))
        .concat([db.prepare("DELETE FROM oquvchilar WHERE id = ?").bind(id)]));
      return json({ ok: true });
    }
  }

  // ---------- Kunlik jurnal ----------
  if (yol === "/kun" && usul === "GET") {
    const guruh = butun(url.searchParams.get("guruh")), sana = String(url.searchParams.get("sana") || "");
    if (!sanaTogri(sana)) return xato("Sana noto'g'ri");
    const [oquvchilar, darslar, topshiriqlar, davomat, bajarish] = await Promise.all([
      db.prepare("SELECT id, ism, (tg_chat IS NOT NULL) AS telegram FROM oquvchilar WHERE guruh_id = ? AND faol = 1 ORDER BY ism").bind(guruh).all(),
      db.prepare("SELECT * FROM darslar WHERE guruh_id = ? AND sana = ? ORDER BY id").bind(guruh, sana).all(),
      db.prepare("SELECT * FROM topshiriqlar WHERE guruh_id = ? AND sana = ? ORDER BY id").bind(guruh, sana).all(),
      db.prepare("SELECT d.oquvchi_id, d.holat FROM davomat d JOIN oquvchilar o ON o.id = d.oquvchi_id WHERE o.guruh_id = ? AND d.sana = ?").bind(guruh, sana).all(),
      db.prepare("SELECT b.* FROM bajarish b JOIN topshiriqlar t ON t.id = b.topshiriq_id WHERE t.guruh_id = ? AND t.sana = ?").bind(guruh, sana).all(),
    ]);
    return json({
      oquvchilar: oquvchilar.results,
      darslar: darslar.results,
      topshiriqlar: topshiriqlar.results.map((t: any) => ({ ...t, rasmlar: JSON.parse(t.rasmlar) })),
      davomat: davomat.results,
      bajarish: bajarish.results,
    });
  }

  if (yol === "/dars" && usul === "POST") {
    const guruh = butun(b.guruh_id), sana = String(b.sana || ""), fan = qisqa(b.fan, 40), mavzu = qisqa(b.mavzu, 200);
    if (!sanaTogri(sana) || !FANLAR.includes(fan) || mavzu.length < 2) return xato("Fan va mavzuni kiriting");
    const r = await db.prepare("INSERT INTO darslar (guruh_id, sana, fan, mavzu, izoh) VALUES (?, ?, ?, ?, ?) RETURNING *").bind(guruh, sana, fan, mavzu, qisqa(b.izoh, 500)).first();
    return json(r, 201);
  }
  m = yol.match(/^\/dars\/(\d+)$/);
  if (m && usul === "DELETE") {
    await db.prepare("DELETE FROM darslar WHERE id = ?").bind(Number(m[1])).run();
    return json({ ok: true });
  }

  if (yol === "/topshiriq" && usul === "POST") {
    const guruh = butun(b.guruh_id), sana = String(b.sana || ""), fan = qisqa(b.fan, 40), matn = qisqa(b.matn, 1500);
    const turi = b.turi === "qoshimcha" ? "qoshimcha" : "uy";
    const muddat = b.muddat && sanaTogri(String(b.muddat)) ? String(b.muddat) : null;
    const rasmlar = Array.isArray(b.rasmlar) ? b.rasmlar.map(String).filter((r: string) => /^\/api\/rasm\/[a-f0-9]{32}$/.test(r)).slice(0, 6) : [];
    if (!sanaTogri(sana) || !FANLAR.includes(fan) || matn.length < 2) return xato("Fan va topshiriq matnini kiriting");
    const g = await db.prepare("SELECT nomi FROM guruhlar WHERE id = ?").bind(guruh).first();
    if (!g) return xato("Guruh topilmadi");
    const r = await db.prepare("INSERT INTO topshiriqlar (guruh_id, sana, fan, turi, matn, rasmlar, muddat) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *")
      .bind(guruh, sana, fan, turi, matn, JSON.stringify(rasmlar), muddat).first();
    let yuborildi = 0;
    if (b.xabar) {
      const { results } = await db.prepare("SELECT ism, tg_chat FROM oquvchilar WHERE guruh_id = ? AND faol = 1 AND tg_chat IS NOT NULL").bind(guruh).all();
      for (const o of results) {
        const ok = await yubor(env, o.tg_chat, [
          `📝 <b>${turi === "uy" ? "Yangi uy vazifasi" : "Qo'shimcha topshiriq"}</b> — ${h(o.ism)}`,
          `${h(fan)}: ${h(matn)}`,
          ...(muddat ? [`⏰ Muddat: ${muddat}`] : []),
        ].join("\n"));
        if (ok) yuborildi++;
      }
    }
    return json({ ...r, rasmlar, yuborildi }, 201);
  }
  m = yol.match(/^\/topshiriq\/(\d+)$/);
  if (m && usul === "DELETE") {
    const id = Number(m[1]);
    await db.batch([db.prepare("DELETE FROM bajarish WHERE topshiriq_id = ?").bind(id), db.prepare("DELETE FROM topshiriqlar WHERE id = ?").bind(id)]);
    return json({ ok: true });
  }

  if (yol === "/bajarish" && usul === "PUT") {
    const t = butun(b.topshiriq_id), o = butun(b.oquvchi_id);
    if (b.holat === null || b.holat === "") {
      await db.prepare("DELETE FROM bajarish WHERE topshiriq_id = ? AND oquvchi_id = ?").bind(t, o).run();
      return json({ ok: true });
    }
    if (!["ha", "qisman", "yoq"].includes(b.holat)) return xato("Holat noto'g'ri");
    const yulduz = Math.max(0, Math.min(3, butun(b.yulduz) || 0));
    await db.prepare(`INSERT INTO bajarish (topshiriq_id, oquvchi_id, holat, yulduz, izoh) VALUES (?, ?, ?, ?, ?)
                      ON CONFLICT(topshiriq_id, oquvchi_id) DO UPDATE SET holat=excluded.holat, yulduz=excluded.yulduz, izoh=excluded.izoh`)
      .bind(t, o, b.holat, yulduz, qisqa(b.izoh, 300)).run();
    return json({ ok: true });
  }

  if (yol === "/davomat" && usul === "PUT") {
    const o = butun(b.oquvchi_id), sana = String(b.sana || "");
    if (!sanaTogri(sana)) return xato("Sana noto'g'ri");
    if (!b.holat) {
      await db.prepare("DELETE FROM davomat WHERE oquvchi_id = ? AND sana = ?").bind(o, sana).run();
      return json({ ok: true });
    }
    if (!["keldi", "kelmadi", "kechikdi"].includes(b.holat)) return xato("Holat noto'g'ri");
    await db.prepare("INSERT INTO davomat (oquvchi_id, sana, holat) VALUES (?, ?, ?) ON CONFLICT(oquvchi_id, sana) DO UPDATE SET holat=excluded.holat").bind(o, sana, b.holat).run();
    return json({ ok: true });
  }

  // Kunlik hisobotni ota-onalarga yuborish
  if (yol === "/hisobot" && usul === "POST") {
    const guruh = butun(b.guruh_id), sana = String(b.sana || "");
    if (!sanaTogri(sana)) return xato("Sana noto'g'ri");
    if (!env.TELEGRAM_TOKEN) return xato("Telegram bot sozlanmagan");
    const darslar = (await db.prepare("SELECT fan, mavzu FROM darslar WHERE guruh_id = ? AND sana = ?").bind(guruh, sana).all()).results;
    const topsh = (await db.prepare("SELECT id, fan, turi, matn, muddat FROM topshiriqlar WHERE guruh_id = ? AND sana = ?").bind(guruh, sana).all()).results;
    const { results: oquvchilar } = await db.prepare("SELECT id, ism, tg_chat FROM oquvchilar WHERE guruh_id = ? AND faol = 1 AND tg_chat IS NOT NULL").bind(guruh).all();
    let yuborildi = 0;
    for (const o of oquvchilar) {
      const dav = await db.prepare("SELECT holat FROM davomat WHERE oquvchi_id = ? AND sana = ?").bind(o.id, sana).first();
      const baj = (await db.prepare("SELECT topshiriq_id, holat, yulduz, izoh FROM bajarish WHERE oquvchi_id = ?").bind(o.id).all()).results;
      const bajMap = new Map(baj.map((x: any) => [x.topshiriq_id, x]));
      const qatorlar = [
        `📒 <b>Kunlik hisobot — ${h(o.ism)}</b>`,
        `📅 ${sana}${dav ? " · " + DAVOMAT_BELGI[dav.holat] : ""}`,
      ];
      if (darslar.length) qatorlar.push("", "<b>Bugun o'tildi:</b>", ...darslar.map((d: any) => `• ${h(d.fan)}: ${h(d.mavzu)}`));
      if (topsh.length) {
        qatorlar.push("", "<b>Topshiriqlar:</b>");
        for (const t of topsh) {
          const x: any = bajMap.get(t.id);
          qatorlar.push(`• ${h(t.fan)} (${t.turi === "uy" ? "uy vazifasi" : "qo'shimcha"}): ${h(t.matn)}` +
            (x ? `\n   ${HOLAT_BELGI[x.holat]}${x.yulduz ? " " + "⭐".repeat(x.yulduz) : ""}${x.izoh ? " — " + h(x.izoh) : ""}` : "") +
            (t.muddat ? `\n   ⏰ Muddat: ${t.muddat}` : ""));
        }
      }
      if (await yubor(env, o.tg_chat, qatorlar.join("\n"))) yuborildi++;
    }
    return json({ yuborildi, jami: oquvchilar.length });
  }

  // ---------- To'lovlar ----------
  if (yol === "/tolovlar" && usul === "GET") {
    const oy = String(url.searchParams.get("oy") || "");
    if (!oyTogri(oy)) return xato("Oy noto'g'ri");
    const { results } = await db.prepare(
      `SELECT o.id, o.ism, g.nomi AS guruh, g.narx, (o.tg_chat IS NOT NULL) AS telegram,
              COALESCE((SELECT SUM(summa) FROM tolovlar t WHERE t.oquvchi_id = o.id AND t.oy = ?), 0) AS tolangan
       FROM oquvchilar o JOIN guruhlar g ON g.id = o.guruh_id WHERE o.faol = 1 ORDER BY g.sinf, g.nomi, o.ism`
    ).bind(oy).all();
    const tarix = (await db.prepare(
      "SELECT t.id, t.oquvchi_id, t.summa, t.sana, t.izoh FROM tolovlar t WHERE t.oy = ? ORDER BY t.id DESC"
    ).bind(oy).all()).results;
    return json({ royxat: results, tarix });
  }
  if (yol === "/tolov" && usul === "POST") {
    const o = butun(b.oquvchi_id), oy = String(b.oy || ""), summa = butun(b.summa);
    if (!oyTogri(oy) || !(summa > 0 && summa <= 100_000_000)) return xato("Summani to'g'ri kiriting");
    const r = await db.prepare("INSERT INTO tolovlar (oquvchi_id, oy, summa, izoh) VALUES (?, ?, ?, ?) RETURNING *").bind(o, oy, summa, qisqa(b.izoh, 200)).first();
    return json(r, 201);
  }
  m = yol.match(/^\/tolov\/(\d+)$/);
  if (m && usul === "DELETE") {
    await db.prepare("DELETE FROM tolovlar WHERE id = ?").bind(Number(m[1])).run();
    return json({ ok: true });
  }
  if (yol === "/tolov-eslatma" && usul === "POST") {
    const oy = String(b.oy || "");
    if (!oyTogri(oy)) return xato("Oy noto'g'ri");
    const ids: number[] = Array.isArray(b.oquvchilar) ? b.oquvchilar.map(butun).filter((x: number) => x > 0).slice(0, 200) : [];
    let yuborildi = 0;
    for (const id of ids) {
      const o = await db.prepare(
        `SELECT o.ism, o.tg_chat, g.narx, COALESCE((SELECT SUM(summa) FROM tolovlar t WHERE t.oquvchi_id = o.id AND t.oy = ?), 0) AS tolangan
         FROM oquvchilar o JOIN guruhlar g ON g.id = o.guruh_id WHERE o.id = ?`
      ).bind(oy, id).first();
      if (!o || !o.tg_chat || o.tolangan >= o.narx) continue;
      if (await yubor(env, o.tg_chat, `💳 <b>To'lov eslatmasi — ${h(o.ism)}</b>\n${oyNomi(oy)} uchun to'lov: ${somMatn(o.narx - o.tolangan)}\nRahmat!`)) yuborildi++;
    }
    return json({ yuborildi });
  }

  // ---------- Oylik baholar ----------
  if (yol === "/baholar" && usul === "GET") {
    const guruh = butun(url.searchParams.get("guruh")), oy = String(url.searchParams.get("oy") || "");
    if (!oyTogri(oy)) return xato("Oy noto'g'ri");
    const oquvchilar = (await db.prepare("SELECT id, ism FROM oquvchilar WHERE guruh_id = ? AND faol = 1 ORDER BY ism").bind(guruh).all()).results;
    const baholar = (await db.prepare("SELECT b.* FROM baholar b JOIN oquvchilar o ON o.id = b.oquvchi_id WHERE o.guruh_id = ? AND b.oy = ?").bind(guruh, oy).all()).results;
    return json({ oquvchilar, baholar, fanlar: FANLAR });
  }
  if (yol === "/baho" && usul === "PUT") {
    const o = butun(b.oquvchi_id), oy = String(b.oy || ""), fan = qisqa(b.fan, 40), daraja = butun(b.daraja);
    if (!oyTogri(oy) || !FANLAR.includes(fan)) return xato("Ma'lumot noto'g'ri");
    if (!daraja) {
      await db.prepare("DELETE FROM baholar WHERE oquvchi_id = ? AND oy = ? AND fan = ?").bind(o, oy, fan).run();
      return json({ ok: true });
    }
    if (![1, 2, 3].includes(daraja)) return xato("Daraja noto'g'ri");
    await db.prepare(`INSERT INTO baholar (oquvchi_id, oy, fan, daraja, izoh) VALUES (?, ?, ?, ?, ?)
                      ON CONFLICT(oquvchi_id, oy, fan) DO UPDATE SET daraja=excluded.daraja, izoh=excluded.izoh`)
      .bind(o, oy, fan, daraja, qisqa(b.izoh, 300)).run();
    return json({ ok: true });
  }
  if (yol === "/baholar-yubor" && usul === "POST") {
    const guruh = butun(b.guruh_id), oy = String(b.oy || "");
    if (!oyTogri(oy)) return xato("Oy noto'g'ri");
    const { results } = await db.prepare("SELECT id, ism, tg_chat FROM oquvchilar WHERE guruh_id = ? AND faol = 1 AND tg_chat IS NOT NULL").bind(guruh).all();
    let yuborildi = 0;
    for (const o of results) {
      const bh = (await db.prepare("SELECT fan, daraja, izoh FROM baholar WHERE oquvchi_id = ? AND oy = ?").bind(o.id, oy).all()).results;
      if (!bh.length) continue;
      const matn = [`📊 <b>${oyNomi(oy)} — oylik natija</b>`, `👧 ${h(o.ism)}`, "", ...bh.map((x: any) => `• ${h(x.fan)}: ${DARAJA[x.daraja]}${x.izoh ? "\n   " + h(x.izoh) : ""}`)].join("\n");
      if (await yubor(env, o.tg_chat, matn)) yuborildi++;
    }
    return json({ yuborildi });
  }

  // ---------- Arizalar ----------
  if (yol === "/arizalar" && usul === "GET") {
    return json((await db.prepare("SELECT * FROM arizalar ORDER BY id DESC LIMIT 200").all()).results);
  }
  m = yol.match(/^\/arizalar\/(\d+)$/);
  if (m && usul === "DELETE") {
    await db.prepare("DELETE FROM arizalar WHERE id = ?").bind(Number(m[1])).run();
    return json({ ok: true });
  }

  // ---------- Telegram bot ----------
  if (yol === "/bot/ulash" && usul === "POST") {
    if (!env.TELEGRAM_TOKEN) return xato("TELEGRAM_TOKEN sozlanmagan");
    const me = await tg(env.TELEGRAM_TOKEN, "getMe");
    let sir = await sozlama(db, "tg_sir");
    if (!sir) { sir = tasodifiy(24); await sozlamaYoz(db, "tg_sir", sir); }
    await tg(env.TELEGRAM_TOKEN, "setWebhook", { url: `${url.origin}/api/tg/webhook`, secret_token: sir, allowed_updates: ["message"] });
    const kod = "r_" + tasodifiy(8);
    await sozlamaYoz(db, "tg_rep_kod", kod);
    return json({ havola: `https://t.me/${me.username}?start=${kod}`, bot: me.username });
  }
  if (yol === "/bot/sinov" && usul === "POST") {
    const ok = await yubor(env, await sozlama(db, "tg_repetitor"), "🔔 <b>Sinov xabari</b>\nBot to'g'ri ishlayapti.");
    return ok ? json({ ok: true }) : xato("Bot hali ulanmagan");
  }

  return xato("Topilmadi", 404);
}

// ---------------------------------------------------------------------
// ASOSIY YO'NALTIRISH
// ---------------------------------------------------------------------

async function api(req: Request, env: Env, url: URL): Promise<Response> {
  const yol = url.pathname;
  const usul = req.method;
  if (!env.DB) return xato("Ma'lumotlar bazasi ulanmagan", 503);
  const db = env.DB;
  await jadvallar(db);
  const ip = ipOl(req);

  // ---- Ochiq sahifa ma'lumotlari ----
  if (yol === "/api/ommaviy" && usul === "GET") {
    const s = JSON.parse((await sozlama(db, "sahifa")) || "{}");
    const guruhlar = (await db.prepare("SELECT nomi, sinf, narx, jadval FROM guruhlar ORDER BY sinf, nomi").all()).results;
    return new Response(JSON.stringify({ ...s, guruhlar, fanlar: FANLAR.filter((f) => f !== "Boshqa") }), {
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=60" },
    });
  }

  // ---- Darsga yozilish arizasi ----
  if (yol === "/api/ariza" && usul === "POST") {
    const b: any = await req.json().catch(() => ({}));
    if (b?.sayt) return json({ ok: true }); // robotlar uchun yashirin maydon
    if ((await urinishlarSoni(db, ip, "ariza", 30)) >= 4) return xato("Juda ko'p ariza yuborildi. Birozdan keyin urinib ko'ring.", 429);
    const ism = qisqa(b.ism, 60), bola = qisqa(b.bola, 60), sinf = qisqa(b.sinf, 20), tel = qisqa(b.tel, 30), izoh = qisqa(b.izoh, 500);
    if (ism.length < 2 || bola.length < 2) return xato("Ismingiz va farzandingiz ismini kiriting");
    if (!/^[+\d][\d\s()\-]{6,20}$/.test(tel)) return xato("Telefon raqamni to'g'ri kiriting");
    await urinishYoz(db, ip, "ariza");
    await db.prepare("INSERT INTO arizalar (ism, bola, sinf, tel, izoh) VALUES (?, ?, ?, ?, ?)").bind(ism, bola, sinf, tel, izoh).run();
    await yubor(env, await sozlama(db, "tg_repetitor"), [
      "🆕 <b>Darsga yozilish arizasi</b>", "",
      `👤 Ota-ona: ${h(ism)}`, `👧 Farzand: ${h(bola)}${sinf ? ", " + h(sinf) : ""}`, `📞 ${h(tel)}`,
      ...(izoh ? [`📝 ${h(izoh)}`] : []),
    ].join("\n"));
    return json({ ok: true });
  }

  // ---- Ota-ona ----
  if (yol === "/api/ota-ona" && usul === "GET") {
    if ((await urinishlarSoni(db, ip, "kod-xato", 15)) >= 10) return xato("Juda ko'p noto'g'ri urinish. 15 daqiqadan keyin qayta urinib ko'ring.", 429);
    const kod = String(url.searchParams.get("kod") || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    const formatli = kod.length === 8 ? kod.slice(0, 4) + "-" + kod.slice(4) : "";
    const o = formatli ? await db.prepare("SELECT * FROM oquvchilar WHERE kod = ? AND faol = 1").bind(formatli).first() : null;
    if (!o) {
      await urinishYoz(db, ip, "kod-xato");
      return xato("Kod noto'g'ri. Uni repetitordan so'rang.", 404);
    }
    const malumot = await otaOnaMalumoti(db, o);
    let botHavola: string | null = null;
    if (!o.tg_chat && env.TELEGRAM_TOKEN) {
      const me = await tg(env.TELEGRAM_TOKEN, "getMe").catch(() => null);
      if (me) botHavola = `https://t.me/${me.username}?start=p_${formatli.replace("-", "")}`;
    }
    return json({ ...malumot, kod: formatli, botHavola });
  }

  // ---- Rasm ----
  let m = yol.match(/^\/api\/rasm\/([a-f0-9]{32})$/);
  if (m && usul === "GET") {
    const r = await db.prepare("SELECT turi, malumot FROM rasmlar WHERE id = ?").bind(m[1]).first();
    if (!r) return xato("Rasm topilmadi", 404);
    return new Response(new Uint8Array(r.malumot), { headers: { "content-type": r.turi, "cache-control": "public, max-age=31536000, immutable" } });
  }

  // ---- Telegram webhook ----
  if (yol === "/api/tg/webhook" && usul === "POST") {
    const sir = await sozlama(db, "tg_sir");
    if (!sir || req.headers.get("x-telegram-bot-api-secret-token") !== sir) return xato("Ruxsat yo'q", 403);
    const u: any = await req.json().catch(() => ({}));
    const msg = u?.message;
    const matn: string = msg?.text || "";
    const chat = msg?.chat?.id;
    if (!chat) return json({ ok: true });
    const mm = matn.match(/^\/start\s+(\S+)/);
    if (mm) {
      const p = mm[1];
      const repKod = await sozlama(db, "tg_rep_kod");
      if (repKod && p === repKod) {
        const c = msg.chat;
        await sozlamaYoz(db, "tg_repetitor", String(chat));
        await sozlamaYoz(db, "tg_repetitor_nomi", c.username ? "@" + c.username : [c.first_name, c.last_name].filter(Boolean).join(" "));
        await db.prepare("DELETE FROM sozlamalar WHERE kalit = 'tg_rep_kod'").run();
        await yubor(env, String(chat), "✅ Bot ulandi! Endi darsga yozilish arizalari shu yerga keladi.");
        return json({ ok: true });
      }
      const pm = p.match(/^p_([A-Z0-9]{8})$/);
      if (pm) {
        const kod = pm[1].slice(0, 4) + "-" + pm[1].slice(4);
        const o = await db.prepare("SELECT id, ism FROM oquvchilar WHERE kod = ? AND faol = 1").bind(kod).first();
        if (o) {
          await db.prepare("UPDATE oquvchilar SET tg_chat = ? WHERE id = ?").bind(String(chat), o.id).run();
          await yubor(env, String(chat), `✅ Ulandi! Endi <b>${h(o.ism)}</b> bo'yicha kunlik hisobotlar, yangi vazifalar va oylik natijalar shu yerga keladi.`);
          return json({ ok: true });
        }
      }
    }
    await yubor(env, String(chat), "Assalomu alaykum! Ulanish uchun saytdagi «Telegram'ga ulash» tugmasidan foydalaning.");
    return json({ ok: true });
  }

  // ---- Kirish (repetitor) ----
  if (yol === "/api/kirish" && usul === "POST") {
    if (!env.ADMIN_LOGIN || !env.ADMIN_PAROL) return xato("Login va parol hali sozlanmagan (Cloudflare → Settings → ADMIN_LOGIN, ADMIN_PAROL)", 503);
    if ((await urinishlarSoni(db, ip, "kirish-xato", 15)) >= 5)
      return xato("Juda ko'p noto'g'ri urinish. 15 daqiqadan keyin qayta urinib ko'ring.", 429);
    const b: any = await req.json().catch(() => ({}));
    const [l, p] = await Promise.all([tengmi(qisqa(b.login, 100), env.ADMIN_LOGIN.trim()), tengmi(String(b.parol ?? ""), env.ADMIN_PAROL)]);
    if (!l || !p) {
      await urinishYoz(db, ip, "kirish-xato");
      await new Promise((r) => setTimeout(r, 500));
      return xato("Login yoki parol noto'g'ri", 401);
    }
    const token = tasodifiy(32);
    await db.prepare("DELETE FROM sessiyalar WHERE muddat < ?").bind(Date.now()).run();
    await db.prepare("INSERT INTO sessiyalar (xesh, muddat) VALUES (?, ?)").bind(await xesh(token), Date.now() + TOKEN_MUDDAT).run();
    return json({ token });
  }

  // ---- Repetitor: token tekshiruvi ----
  if (yol.startsWith("/api/admin/") || yol === "/api/chiqish") {
    const s = req.headers.get("authorization") ?? "";
    const token = s.startsWith("Bearer ") ? s.slice(7) : "";
    const ses = token ? await db.prepare("SELECT muddat FROM sessiyalar WHERE xesh = ?").bind(await xesh(token)).first() : null;
    if (!ses || ses.muddat < Date.now()) return xato("Qayta kiring", 401);
    if (yol === "/api/chiqish") {
      await db.prepare("DELETE FROM sessiyalar WHERE xesh = ?").bind(await xesh(token)).run();
      return json({ ok: true });
    }
    if (yol === "/api/admin/rasm" && usul === "POST") {
      const turi = (req.headers.get("content-type") ?? "").split(";")[0].trim();
      if (!["image/webp", "image/jpeg", "image/png"].includes(turi)) return xato("Faqat rasm (WebP, JPEG, PNG)");
      const malumot = await req.arrayBuffer();
      if (malumot.byteLength < 100 || malumot.byteLength > MAX_RASM) return xato("Rasm hajmi 1.5 MB dan oshmasin");
      const id = tasodifiy(16);
      await db.prepare("INSERT INTO rasmlar (id, turi, malumot) VALUES (?, ?, ?)").bind(id, turi, malumot).run();
      return json({ url: `/api/rasm/${id}` }, 201);
    }
    return admin(req, env, yol.slice("/api/admin".length), url);
  }

  return xato("Topilmadi", 404);
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (env.TELEGRAM_API) tgManzil = env.TELEGRAM_API;
    let javob: Response;
    if (url.pathname.startsWith("/api/")) {
      try {
        javob = await api(req, env, url);
      } catch (e) {
        console.error(e);
        javob = xato("Serverda xatolik yuz berdi", 500);
      }
    } else {
      javob = await env.ASSETS.fetch(req);
    }
    return sarlavhaQosh(javob);
  },
};
