// =====================================================================
// otaona.ts — ota-onalar kabineti
// Kod bilan kiriladi. Kodlar shu qurilmada eslab qolinadi (bir nechta
// farzand bo'lishi mumkin).
// =====================================================================

(() => {
  interface Topshiriq { id: number; sana: string; fan: string; turi: string; matn: string; rasmlar: string[]; muddat: string | null; holat: string | null; yulduz: number | null; izoh: string | null }
  interface Malumot {
    ism: string; kod: string; telegram: boolean; botHavola: string | null;
    guruh: { nomi: string; sinf: number; narx: number; jadval: string } | null;
    darslar: { sana: string; fan: string; mavzu: string; izoh: string }[];
    topshiriqlar: Topshiriq[];
    davomat: { sana: string; holat: string }[];
    baholar: { oy: string; fan: string; daraja: number; izoh: string }[];
    tolovlar: { oy: string; summa: number }[];
  }

  const KALIT = "rep-kodlar";
  const kodlar = (): { kod: string; ism: string }[] => {
    try { return JSON.parse(xotira(KALIT) || "[]"); } catch { return []; }
  };
  const kodlarniSaqla = (k: { kod: string; ism: string }[]) => xotira(KALIT, JSON.stringify(k));
  let joriy = "";

  function kodTozala(k: string): string {
    const s = k.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
    return s.length > 4 ? s.slice(0, 4) + "-" + s.slice(4) : s;
  }

  async function yukla(kod: string): Promise<void> {
    const m = await soror<Malumot>("/api/ota-ona?kod=" + encodeURIComponent(kod));
    joriy = m.kod;
    const r = kodlar().filter((x) => x.kod !== m.kod);
    r.unshift({ kod: m.kod, ism: m.ism });
    kodlarniSaqla(r.slice(0, 6));
    chiz(m);
  }

  function bolalarniChiz(): void {
    const r = kodlar();
    const joy = el("#bolalar");
    joy.hidden = r.length < 2;
    joy.innerHTML = r.map((x) => `<button type="button" data-kod="${xv(x.kod)}" class="${x.kod === joriy ? "faol" : ""}">${xv(x.ism)}</button>`).join("");
  }

  function chiz(m: Malumot): void {
    el("#kirish").hidden = true;
    el("#kabinet").hidden = false;
    bolalarniChiz();
    el("#k-ism").textContent = m.ism;
    el("#k-guruh").textContent = m.guruh ? `${m.guruh.sinf ? m.guruh.sinf + "-sinf · " : ""}${m.guruh.nomi}` : "";
    const tg = el<HTMLAnchorElement>("#k-tg");
    tg.hidden = m.telegram || !m.botHavola;
    if (m.botHavola) tg.href = m.botHavola;
    el("#k-tg-ok").hidden = !m.telegram;

    // ---- Xulosa (shu oy) ----
    const oy = shuOy();
    const dav = m.davomat.filter((d) => d.sana.startsWith(oy));
    const keldi = dav.filter((d) => d.holat !== "kelmadi").length;
    const tops = m.topshiriqlar.filter((t) => t.sana.startsWith(oy) && t.holat);
    const bajardi = tops.reduce((s, t) => s + (t.holat === "ha" ? 1 : t.holat === "qisman" ? 0.5 : 0), 0);
    const yulduz = m.topshiriqlar.filter((t) => t.sana.startsWith(oy)).reduce((s, t) => s + (t.yulduz || 0), 0);
    el("#k-xulosa").innerHTML = `
      <div class="karta"><b>${dav.length ? Math.round((keldi / dav.length) * 100) + "%" : "—"}</b><span>Davomat (${OYLAR[Number(oy.slice(5)) - 1]})</span></div>
      <div class="karta"><b>${tops.length ? Math.round((bajardi / tops.length) * 100) + "%" : "—"}</b><span>Vazifalar bajarildi</span></div>
      <div class="karta"><b>⭐ ${yulduz}</b><span>Yulduzchalar</span></div>`;

    // ---- Kundalik: sanalar bo'yicha ----
    const sanalar = [...new Set([...m.darslar.map((d) => d.sana), ...m.topshiriqlar.map((t) => t.sana)])].sort().reverse();
    const davMap = new Map(m.davomat.map((d) => [d.sana, d.holat]));
    el("#tab-kundalik").innerHTML = sanalar.length
      ? sanalar
          .map((s) => {
            const ds = m.darslar.filter((d) => d.sana === s);
            const ts = m.topshiriqlar.filter((t) => t.sana === s);
            const dh = davMap.get(s);
            return `<article class="karta kun">
              <div class="kun-bosh"><h3>${sanaMatn(s)}${s === bugun() ? " · bugun" : ""}</h3>${dh ? `<span class="dav">${DAVOMAT[dh].b} ${DAVOMAT[dh].m}</span>` : ""}</div>
              ${ds.length ? `<h4>O'tilgan mavzular</h4>${ds.map((d) => `<div class="qator"><div class="qator-bosh">${fanChip(d.fan)}</div><p>${xv(d.mavzu)}</p>${d.izoh ? `<p class="izoh-q">${xv(d.izoh)}</p>` : ""}</div>`).join("")}` : ""}
              ${ts.length ? `<h4>Topshiriqlar</h4>${ts.map(topshiriqHTML).join("")}` : ""}
            </article>`;
          })
          .join("")
      : `<div class="bosh-holat">Hozircha yozuvlar yo'q. Darslar boshlangach, shu yerda ko'rinadi.</div>`;

    // ---- Oylik natija ----
    const oylar = [...new Set(m.baholar.map((b) => b.oy))].sort().reverse();
    el("#tab-natija").innerHTML = oylar.length
      ? oylar
          .map((o) => `<article class="karta natija-oy"><h3>${oyMatn(o)}</h3>
            ${m.baholar.filter((b) => b.oy === o).map((b) => `<div class="natija-qator">${fanChip(b.fan)}<div><span class="daraja" data-d="${b.daraja}">${DARAJALAR[b.daraja].b} ${DARAJALAR[b.daraja].m}</span>${b.izoh ? `<div class="izoh-q">${xv(b.izoh)}</div>` : ""}</div></div>`).join("")}
          </article>`)
          .join("")
      : `<div class="bosh-holat">Oylik natijalar har oy oxirida qo'yiladi.</div>`;

    // ---- Davomat ----
    el("#tab-davomat").innerHTML = m.davomat.length
      ? `<div style="overflow-x:auto"><table class="jadval-sodda"><thead><tr><th>Sana</th><th>Holat</th></tr></thead><tbody>
          ${m.davomat.map((d) => `<tr><td>${sanaMatn(d.sana)}</td><td>${DAVOMAT[d.holat].b} ${DAVOMAT[d.holat].m}</td></tr>`).join("")}
        </tbody></table></div>`
      : `<div class="bosh-holat">Davomat hali belgilanmagan.</div>`;

    // ---- To'lovlar ----
    const narx = m.guruh?.narx || 0;
    const tolovOylar = [...new Set([shuOy(), ...m.tolovlar.map((t) => t.oy)])].sort().reverse();
    el("#tab-tolov").innerHTML = narx || m.tolovlar.length
      ? `<div style="overflow-x:auto"><table class="jadval-sodda"><thead><tr><th>Oy</th><th>To'langan</th><th>Holat</th></tr></thead><tbody>
          ${tolovOylar.map((o) => {
            const t = m.tolovlar.find((x) => x.oy === o)?.summa || 0;
            const qoldi = narx - t;
            return `<tr><td>${oyMatn(o)}</td><td>${som(t)}</td><td>${narx && qoldi > 0 ? `<b style="color:var(--qizil)">${som(qoldi)} qoldi</b>` : `<b style="color:var(--yashil)">✅ To'langan</b>`}</td></tr>`;
          }).join("")}
        </tbody></table></div>${narx ? `<p class="izoh">Oylik to'lov: ${som(narx)}</p>` : ""}`
      : `<div class="bosh-holat">To'lov ma'lumotlari yo'q.</div>`;
  }

  function topshiriqHTML(t: Topshiriq): string {
    const h = t.holat ? HOLAT[t.holat] : null;
    return `<div class="qator">
      <div class="qator-bosh">${fanChip(t.fan)}<span class="turi">${t.turi === "uy" ? "🏠 Uy vazifasi" : "➕ Qo'shimcha"}</span>
        <span class="holat ${t.holat || "kutilmoqda"}">${h ? `${h.b} ${h.m}` : "⏳ Tekshirilmagan"}${t.yulduz ? " " + "⭐".repeat(t.yulduz) : ""}</span></div>
      <p>${xv(t.matn)}</p>
      ${t.muddat ? `<p class="izoh">⏰ Muddat: ${sanaMatn(t.muddat)}</p>` : ""}
      ${t.rasmlar.length ? `<div class="rasmlar">${t.rasmlar.map((r) => `<button type="button" data-rasm="${xv(r)}" aria-label="Rasmni kattalashtirish"><img src="${xv(r)}" alt="" loading="lazy"></button>`).join("")}</div>` : ""}
      ${t.izoh ? `<p class="izoh-q">💬 ${xv(t.izoh)}</p>` : ""}
    </div>`;
  }

  // ---------------- Hodisalar ----------------
  const kodInp = el<HTMLInputElement>("#kod");
  kodInp.addEventListener("input", () => (kodInp.value = kodTozala(kodInp.value)));
  el("#kod-forma").addEventListener("submit", async (e) => {
    e.preventDefault();
    const x = el("#kod-xato");
    x.hidden = true;
    const tugma = el<HTMLButtonElement>("#kod-forma button");
    tugma.disabled = true;
    try {
      await yukla(kodInp.value);
    } catch (err) {
      x.textContent = (err as Error).message;
      x.hidden = false;
    } finally {
      tugma.disabled = false;
    }
  });

  document.querySelectorAll<HTMLButtonElement>(".tab").forEach((b) =>
    b.addEventListener("click", () => {
      document.querySelectorAll<HTMLButtonElement>(".tab").forEach((x) => {
        x.classList.toggle("faol", x === b);
        x.setAttribute("aria-selected", String(x === b));
      });
      for (const t of ["kundalik", "natija", "davomat", "tolov"]) el("#tab-" + t).hidden = t !== b.dataset.tab;
    })
  );

  el("#bolalar").addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-kod]");
    if (b) yukla(b.dataset.kod!).catch((err) => xabar(err.message));
  });
  el("#bola-qosh").addEventListener("click", () => {
    el("#kabinet").hidden = true;
    el("#kirish").hidden = false;
    kodInp.value = "";
    kodInp.focus();
  });
  el("#chiqish").addEventListener("click", () => {
    kodlarniSaqla(kodlar().filter((x) => x.kod !== joriy));
    const qolgan = kodlar();
    if (qolgan.length) yukla(qolgan[0].kod).catch(() => location.reload());
    else location.reload();
  });

  const oyna = el<HTMLDialogElement>("#rasm-oyna");
  document.addEventListener("click", (e) => {
    const r = (e.target as HTMLElement).closest<HTMLElement>("[data-rasm]");
    if (r) {
      el<HTMLImageElement>("#rasm-katta").src = r.dataset.rasm!;
      oyna.showModal();
    } else if (e.target === oyna || (e.target as HTMLElement).id === "rasm-katta") oyna.close();
  });

  // Saqlangan kod bilan avtomatik kirish
  const birinchi = kodlar()[0];
  if (birinchi) yukla(birinchi.kod).catch(() => { kodlarniSaqla([]); });
})();
