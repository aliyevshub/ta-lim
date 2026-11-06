// =====================================================================
// bosh.ts — ochiq sahifa: repetitor haqida ma'lumot va darsga yozilish
// =====================================================================

(async () => {
  el("#yil").textContent = String(new Date().getFullYear());

  interface Ommaviy {
    ism?: string; shior?: string; haqida?: string; tajriba?: string; manzil?: string; narxlar?: string; jadval?: string;
    guruhlar: { nomi: string; sinf: number; narx: number; jadval: string }[];
    fanlar: string[];
  }

  try {
    const s = await soror<Ommaviy>("/api/ommaviy");
    if (s.ism) {
      for (const id of ["#b-ism", "#b-ism-qisqa", "#b-ism-past"]) el(id).textContent = s.ism;
      document.title = s.ism + " — boshlang'ich sinf repetitori";
    }
    if (s.shior) el("#b-shior").textContent = s.shior;
    if (s.haqida) el("#b-haqida").textContent = s.haqida;
    el("#b-tajriba").textContent = s.tajriba ? "Tajriba: " + s.tajriba : "";
    el("#b-manzil").textContent = s.manzil ? "📍 " + s.manzil : "";
    el("#b-narxlar").textContent = s.narxlar || "";
    el("#b-jadval").textContent = s.jadval ? "🗓 " + s.jadval : "";
    el("#b-fanlar").innerHTML = s.fanlar.map(fanChip).join("");
    el("#b-guruhlar").innerHTML = s.guruhlar.length
      ? s.guruhlar
          .map(
            (g) => `<div class="karta guruh-karta">
              <span class="izoh">${g.sinf ? g.sinf + "-sinf" : "Maktabgacha"}</span>
              <b>${xv(g.nomi)}</b>
              ${g.narx ? `<span class="narx">${som(g.narx)} / oy</span>` : ""}
              ${g.jadval ? `<span class="izoh">🗓 ${xv(g.jadval)}</span>` : ""}
            </div>`
          )
          .join("")
      : `<p class="izoh">Guruhlar tez orada e'lon qilinadi.</p>`;
  } catch {
    /* ma'lumot yuklanmasa, sahifadagi standart matnlar qoladi */
  }

  const forma = el<HTMLFormElement>("#ariza-forma");
  forma.addEventListener("submit", async (e) => {
    e.preventDefault();
    const d = new FormData(forma);
    const ol = (k: string) => String(d.get(k) ?? "").trim();
    const x = el("#ariza-xato");
    x.hidden = true;
    const tugma = el<HTMLButtonElement>("button[type=submit]", forma);
    tugma.disabled = true;
    tugma.textContent = "Yuborilmoqda…";
    try {
      await soror("/api/ariza", { method: "POST", ...jsonBody({ ism: ol("ism"), tel: ol("tel"), bola: ol("bola"), sinf: ol("sinf"), izoh: ol("izoh"), sayt: ol("sayt") }) });
      forma.reset();
      el("#ariza-ok").hidden = false;
      tugma.hidden = true;
    } catch (err) {
      x.textContent = (err as Error).message;
      x.hidden = false;
    } finally {
      tugma.disabled = false;
      tugma.textContent = "Ariza yuborish";
    }
  });
})();
