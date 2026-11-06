"use strict";
// =====================================================================
// yordam.ts — barcha sahifalar uchun umumiy yordamchi funksiyalar
// =====================================================================
const FAN_BELGI = {
    "Ona tili": "✏️", Matematika: "➕", "O'qish": "📖", "Tabiiy fan": "🌿", "Ingliz tili": "🔤", Boshqa: "📌",
};
const HOLAT = {
    ha: { b: "✅", m: "Bajardi" }, qisman: { b: "⚠️", m: "Qisman" }, yoq: { b: "❌", m: "Bajarmadi" },
};
const DAVOMAT = {
    keldi: { b: "✅", m: "Keldi" }, kechikdi: { b: "⏰", m: "Kechikdi" }, kelmadi: { b: "❌", m: "Kelmadi" },
};
const DARAJALAR = {
    1: { b: "🌟", m: "Mustahkam o'zlashtirdi" }, 2: { b: "👍", m: "O'zlashtirmoqda" }, 3: { b: "💪", m: "Ko'proq mashq kerak" },
};
const OYLAR = ["Yanvar", "Fevral", "Mart", "Aprel", "May", "Iyun", "Iyul", "Avgust", "Sentabr", "Oktabr", "Noyabr", "Dekabr"];
function el(s, ota = document) {
    const e = ota.querySelector(s);
    if (!e)
        throw new Error("Element topilmadi: " + s);
    return e;
}
function xv(m) {
    return String(m ?? "").replace(/[&<>"']/g, (b) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[b]));
}
function som(n) {
    return Math.round(n || 0).toLocaleString("ru-RU").replace(/ /g, " ") + " so'm";
}
function bugun() {
    const d = new Date();
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}
function shuOy() {
    return bugun().slice(0, 7);
}
function sanaMatn(s) {
    const [y, m, d] = s.split("-").map(Number);
    return `${d}-${OYLAR[m - 1]?.toLowerCase() ?? ""}${y !== new Date().getFullYear() ? " " + y : ""}`;
}
function oyMatn(s) {
    const [y, m] = s.split("-").map(Number);
    return `${OYLAR[m - 1] ?? ""} ${y}`;
}
function fanChip(fan) {
    return `<span class="fan" data-fan="${xv(fan)}">${FAN_BELGI[fan] ?? "📌"} ${xv(fan)}</span>`;
}
let xabarTaymer = 0;
function xabar(matn) {
    const t = el("#xabar");
    t.textContent = matn;
    t.classList.add("korin");
    clearTimeout(xabarTaymer);
    xabarTaymer = window.setTimeout(() => t.classList.remove("korin"), 2400);
}
function xotira(kalit, qiymat) {
    try {
        if (qiymat === undefined)
            return localStorage.getItem(kalit);
        if (qiymat === null)
            localStorage.removeItem(kalit);
        else
            localStorage.setItem(kalit, qiymat);
    }
    catch { /* xotira yopiq */ }
    return null;
}
async function soror(yol, sozlama = {}, token) {
    let javob;
    try {
        javob = await fetch(yol, {
            ...sozlama,
            headers: { ...(token ? { authorization: "Bearer " + token } : {}), ...(sozlama.headers || {}) },
        });
    }
    catch {
        throw new Error("Internet aloqasini tekshirib, qayta urinib ko'ring.");
    }
    const j = await javob.json().catch(() => ({}));
    if (!javob.ok) {
        const e = new Error(j.xato || "Xatolik yuz berdi");
        e.status = javob.status;
        throw e;
    }
    return j;
}
function jsonBody(b) {
    return { headers: { "content-type": "application/json" }, body: JSON.stringify(b) };
}
