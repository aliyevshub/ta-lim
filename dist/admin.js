"use strict";
// =====================================================================
// admin.ts — repetitor paneli
// Bo'limlar: kunlik jurnal, o'quvchilar va guruhlar, to'lovlar,
// oylik baholar, arizalar, sozlamalar (ochiq sahifa va Telegram bot).
// =====================================================================
(() => {
    const KALIT = "rep-admin-token";
    let token = "";
    try {
        token = sessionStorage.getItem(KALIT) || "";
    }
    catch { /* yopiq */ }
    let fanlar = [];
    let guruhlar = [];
    let oquvchilar = [];
    let kun = null;
    async function api(yol, sozlama = {}) {
        try {
            return await soror(yol, sozlama, token);
        }
        catch (e) {
            if (e.status === 401)
                chiqishEkrani();
            throw e;
        }
    }
    const put = (yol, b) => api(yol, { method: "PUT", ...jsonBody(b) });
    const post = (yol, b) => api(yol, { method: "POST", ...jsonBody(b) });
    const del = (yol) => api(yol, { method: "DELETE" });
    function chiqishEkrani() {
        token = "";
        try {
            sessionStorage.removeItem(KALIT);
        }
        catch { /* yopiq */ }
        el("#panel").hidden = true;
        el("#kirish").hidden = false;
    }
    function oynaYop(e) {
        const b = e.target.closest("[data-yop]");
        if (b)
            b.closest("dialog")?.close();
    }
    document.addEventListener("click", oynaYop);
    // ================= KIRISH =================
    el("#kirish-forma").addEventListener("submit", async (e) => {
        e.preventDefault();
        const x = el("#kirish-xato");
        x.hidden = true;
        const t = el("#kirish-tugma");
        t.disabled = true;
        try {
            const r = await soror("/api/kirish", {
                method: "POST",
                ...jsonBody({ login: el("#login").value, parol: el("#parol").value }),
            });
            token = r.token;
            try {
                sessionStorage.setItem(KALIT, token);
            }
            catch { /* yopiq */ }
            el("#parol").value = "";
            await boshlash();
        }
        catch (err) {
            x.textContent = err.message;
            x.hidden = false;
        }
        finally {
            t.disabled = false;
        }
    });
    el("#chiqish").addEventListener("click", async () => {
        await api("/api/chiqish", { method: "POST" }).catch(() => { });
        chiqishEkrani();
    });
    async function boshlash() {
        const h = await api("/api/admin/holat");
        fanlar = h.fanlar;
        el("#kirish").hidden = true;
        el("#panel").hidden = false;
        const s = el("#ariza-soni");
        s.textContent = String(h.arizalar);
        s.hidden = !h.arizalar;
        const fanOpt = fanlar.map((f) => `<option>${xv(f)}</option>`).join("");
        el("#d-fan").innerHTML = fanOpt;
        el("#t-fan").innerHTML = fanOpt;
        el("#j-sana").value = bugun();
        el("#p-oy").value = shuOy();
        el("#b-oy").value = shuOy();
        await guruhlarniYukla();
        await jurnalniYukla();
    }
    // ================= TABLAR =================
    const yuklovchi = {
        jurnal: () => jurnalniYukla(),
        oquvchilar: () => oquvchilarniYukla(),
        tolovlar: () => tolovlarniYukla(),
        baholar: () => baholarniYukla(),
        arizalar: () => arizalarniYukla(),
        sozlamalar: () => sozlamalarniYukla(),
    };
    document.querySelectorAll(".a-tab").forEach((b) => b.addEventListener("click", () => {
        document.querySelectorAll(".a-tab").forEach((x) => x.classList.toggle("faol", x === b));
        for (const k of Object.keys(yuklovchi))
            el("#t-" + k).hidden = k !== b.dataset.tab;
        yuklovchi[b.dataset.tab]().catch((e) => xabar(e.message));
    }));
    // ================= GURUHLAR =================
    async function guruhlarniYukla() {
        guruhlar = await api("/api/admin/guruhlar");
        const opt = guruhlar.map((g) => `<option value="${g.id}">${xv(g.nomi)}</option>`).join("");
        const filtr = el("#o-filtr-guruh"), fOldin = filtr.value;
        filtr.innerHTML = `<option value="">Barcha guruhlar</option>` + opt;
        filtr.value = fOldin;
        for (const id of ["#j-guruh", "#b-guruh", "#ou-guruh"]) {
            const s = el(id);
            const oldin = s.value;
            s.innerHTML = opt;
            if (guruhlar.some((g) => String(g.id) === oldin))
                s.value = oldin;
        }
        el("#g-royxat").innerHTML = guruhlar.length
            ? guruhlar.map((g) => `<button type="button" class="g-karta" data-g="${g.id}">
          <span class="izoh">${g.sinf ? g.sinf + "-sinf" : "Maktabgacha"} · ${g.soni ?? 0} o'quvchi</span>
          <b>${xv(g.nomi)}</b>
          <span class="izoh">${g.narx ? som(g.narx) + " / oy" : "Narx ko'rsatilmagan"}${g.jadval ? " · " + xv(g.jadval) : ""}</span>
        </button>`).join("")
            : `<div class="bosh-holat">Hali guruh yo'q. «+ Guruh» tugmasini bosing.</div>`;
    }
    let tahrirGuruh = null;
    function guruhOyna(g) {
        tahrirGuruh = g;
        el("#g-sarlavha").textContent = g ? "Guruhni tahrirlash" : "Yangi guruh";
        el("#g-nomi").value = g?.nomi ?? "";
        el("#g-sinf").value = String(g?.sinf ?? 1);
        el("#g-narx").value = g?.narx ? String(g.narx) : "";
        el("#g-jadval").value = g?.jadval ?? "";
        el("#g-ochir").hidden = !g;
        el("#g-xato").hidden = true;
        el("#guruh-oyna").showModal();
    }
    el("#g-yangi").addEventListener("click", () => guruhOyna(null));
    el("#g-royxat").addEventListener("click", (e) => {
        const b = e.target.closest("[data-g]");
        if (b)
            guruhOyna(guruhlar.find((g) => g.id === Number(b.dataset.g)) || null);
    });
    el("#guruh-forma").addEventListener("submit", async (e) => {
        e.preventDefault();
        const b = {
            nomi: el("#g-nomi").value, sinf: el("#g-sinf").value,
            narx: el("#g-narx").value || 0, jadval: el("#g-jadval").value,
        };
        try {
            if (tahrirGuruh)
                await put(`/api/admin/guruhlar/${tahrirGuruh.id}`, b);
            else
                await post("/api/admin/guruhlar", b);
            el("#guruh-oyna").close();
            xabar("Saqlandi ✓");
            await guruhlarniYukla();
            await oquvchilarniYukla();
        }
        catch (err) {
            el("#g-xato").textContent = err.message;
            el("#g-xato").hidden = false;
        }
    });
    el("#g-ochir").addEventListener("click", async () => {
        if (!tahrirGuruh || !confirm(`"${tahrirGuruh.nomi}" guruhi o'chirilsinmi?`))
            return;
        try {
            await del(`/api/admin/guruhlar/${tahrirGuruh.id}`);
            el("#guruh-oyna").close();
            await guruhlarniYukla();
        }
        catch (err) {
            el("#g-xato").textContent = err.message;
            el("#g-xato").hidden = false;
        }
    });
    // ================= O'QUVCHILAR =================
    async function oquvchilarniYukla() {
        await guruhlarniYukla();
        oquvchilar = await api("/api/admin/oquvchilar");
        oquvchilarJadvali();
    }
    function oquvchilarJadvali() {
        const q = el("#o-qidir").value.trim().toLowerCase();
        const g = el("#o-filtr-guruh").value;
        const royxat = oquvchilar.filter((o) => (!g || String(o.guruh_id) === g) &&
            (!q || [o.ism, o.familiya, o.ota_ona, o.tel, o.kod].join(" ").toLowerCase().includes(q)));
        const faol = oquvchilar.filter((o) => o.faol).length;
        el("#o-sanoq").textContent = oquvchilar.length ? `· ${faol} ta faol` : "";
        const telHref = (t) => "tel:" + t.replace(/[^\d+]/g, "");
        el("#o-jadval").innerHTML = oquvchilar.length
            ? `<thead><tr><th>№</th><th>Familiya, ism</th><th>Ota-onasi</th><th>Telefon</th><th>Guruh</th><th>Kod</th><th title="Telegram">🔔</th></tr></thead><tbody>${royxat.map((o, i) => `<tr class="${o.faol ? "" : "nofaol"}" data-o="${o.id}" tabindex="0">
            <td class="raqam">${i + 1}</td>
            <td class="ism-k"><b>${xv([o.familiya, o.ism].filter(Boolean).join(" "))}</b>${o.faol ? "" : "<span>nofaol</span>"}</td>
            <td>${xv(o.ota_ona) || "—"}</td>
            <td>${o.tel ? `<a class="tel" href="${xv(telHref(o.tel))}" data-tel>${xv(o.tel)}</a>` : "—"}</td>
            <td>${xv(o.guruh)}</td>
            <td class="kod">${xv(o.kod)}</td>
            <td title="${o.telegram ? "Telegram ulangan" : "Telegram ulanmagan"}">${o.telegram ? "🔔" : "🔕"}</td>
          </tr>`).join("") || `<tr><td colspan="7">Hech narsa topilmadi</td></tr>`}</tbody>`
            : `<tbody><tr><td>Hali o'quvchi yo'q. «+ O'quvchi» tugmasini bosing.</td></tr></tbody>`;
    }
    el("#o-qidir").addEventListener("input", oquvchilarJadvali);
    el("#o-filtr-guruh").addEventListener("change", oquvchilarJadvali);
    let tahrirOquvchi = null;
    function oquvchiOyna(o) {
        if (!o && !guruhlar.length)
            return xabar("Avval guruh qo'shing");
        tahrirOquvchi = o;
        el("#ou-sarlavha").textContent = o ? "O'quvchini tahrirlash" : "Yangi o'quvchi";
        el("#ou-ism").value = o?.ism ?? "";
        el("#ou-familiya").value = o?.familiya ?? "";
        el("#ou-ota-ona").value = o?.ota_ona ?? "";
        el("#ou-tel").value = o?.tel ?? "";
        const fg = el("#o-filtr-guruh").value;
        el("#ou-guruh").value = String(o?.guruh_id ?? (fg || guruhlar[0]?.id));
        el("#ou-faol").checked = o ? !!o.faol : true;
        el("#ou-faol-q").hidden = !o;
        el("#ou-kod-blok").hidden = !o;
        el("#ou-ochir").hidden = !o;
        el("#ou-kod").textContent = o?.kod ?? "";
        el("#ou-xato").hidden = true;
        el("#oquvchi-oyna").showModal();
        el("#ou-ism").focus();
    }
    el("#o-yangi").addEventListener("click", () => oquvchiOyna(null));
    const jadvalOch = (e) => {
        if (e.target.closest("[data-tel]"))
            return; // telefon havolasi — qo'ng'iroq
        const r = e.target.closest("[data-o]");
        const o = r && oquvchilar.find((x) => x.id === Number(r.dataset.o));
        if (o)
            oquvchiOyna(o);
    };
    el("#o-jadval").addEventListener("click", jadvalOch);
    el("#o-jadval").addEventListener("keydown", (e) => { if (e.key === "Enter")
        jadvalOch(e); });
    el("#oquvchi-forma").addEventListener("submit", async (e) => {
        e.preventDefault();
        const malumot = {
            ism: el("#ou-ism").value, familiya: el("#ou-familiya").value,
            ota_ona: el("#ou-ota-ona").value, tel: el("#ou-tel").value,
            guruh_id: el("#ou-guruh").value, faol: el("#ou-faol").checked,
        };
        try {
            if (tahrirOquvchi) {
                await put(`/api/admin/oquvchilar/${tahrirOquvchi.id}`, malumot);
                xabar("Saqlandi ✓");
            }
            else {
                const r = await post("/api/admin/oquvchilar", malumot);
                xabar(`Qo'shildi ✓ Ota-ona kodi: ${r.kod}`);
            }
            el("#oquvchi-oyna").close();
            await oquvchilarniYukla();
        }
        catch (err) {
            el("#ou-xato").textContent = err.message;
            el("#ou-xato").hidden = false;
        }
    });
    el("#ou-nusxa").addEventListener("click", async () => {
        const kod = el("#ou-kod").textContent || "";
        try {
            await navigator.clipboard.writeText(kod);
            xabar("Nusxalandi ✓");
        }
        catch {
            xabar("Kod: " + kod);
        }
    });
    el("#ou-yangi-kod").addEventListener("click", async () => {
        if (!tahrirOquvchi || !confirm("Yangi kod yaratilsinmi? Eski kod ishlamay qoladi va Telegram ulanishi uziladi."))
            return;
        const r = await api(`/api/admin/oquvchilar/${tahrirOquvchi.id}/yangi-kod`, { method: "POST" });
        el("#ou-kod").textContent = r.kod;
        await oquvchilarniYukla();
    });
    el("#ou-ochir").addEventListener("click", async () => {
        if (!tahrirOquvchi || !confirm(`"${tahrirOquvchi.ism}" va uning barcha ma'lumotlari o'chirilsinmi?`))
            return;
        await del(`/api/admin/oquvchilar/${tahrirOquvchi.id}`);
        el("#oquvchi-oyna").close();
        await oquvchilarniYukla();
    });
    // ================= KUNLIK JURNAL =================
    const jGuruh = () => Number(el("#j-guruh").value);
    const jSana = () => el("#j-sana").value || bugun();
    async function jurnalniYukla() {
        const bosh = !guruhlar.length;
        el("#j-bosh").hidden = !bosh;
        el("#j-ichi").hidden = bosh;
        if (bosh)
            return;
        kun = await api(`/api/admin/kun?guruh=${jGuruh()}&sana=${jSana()}`);
        jurnalniChiz();
    }
    function tanlov(nomlar, joriy, attr) {
        return `<span class="tanlov">${Object.entries(nomlar).map(([k, v]) => `<button type="button" class="${joriy === k ? "faol" : ""}" ${attr}="${k}" title="${v.m}" aria-label="${v.m}" aria-pressed="${joriy === k}">${v.b}</button>`).join("")}</span>`;
    }
    function jurnalniChiz() {
        if (!kun)
            return;
        const k = kun;
        const dav = new Map(k.davomat.map((d) => [d.oquvchi_id, d.holat]));
        el("#j-davomat").innerHTML = k.oquvchilar.length
            ? k.oquvchilar.map((o) => `<div class="dav-qator" data-oq="${o.id}"><b>${xv(o.ism)}</b>${tanlov(DAVOMAT, dav.get(o.id), "data-dav")}</div>`).join("")
            : `<p class="izoh">Bu guruhda faol o'quvchi yo'q.</p>`;
        el("#j-darslar").innerHTML = k.darslar.map((d) => `<div class="r-qator"><div>${fanChip(d.fan)}<p>${xv(d.mavzu)}</p></div><button class="ochir" type="button" data-dars-ochir="${d.id}" aria-label="O'chirish">✕</button></div>`).join("")
            || `<p class="izoh">Hali mavzu qo'shilmagan.</p>`;
        const baj = new Map(k.bajarish.map((b) => [`${b.topshiriq_id}-${b.oquvchi_id}`, b]));
        el("#j-topshiriqlar").innerHTML = k.topshiriqlar.map((t) => `
      <article class="topshiriq" data-top="${t.id}">
        <div class="top-bosh">
          <div>${fanChip(t.fan)} <span class="izoh">${t.turi === "uy" ? "🏠 Uy vazifasi" : "➕ Qo'shimcha"}${t.muddat ? " · ⏰ " + sanaMatn(t.muddat) : ""}</span><p>${xv(t.matn)}</p></div>
          <button class="tugma kichik xavf" type="button" data-top-ochir="${t.id}">O'chirish</button>
        </div>
        ${t.rasmlar.length ? `<div class="top-rasmlar">${t.rasmlar.map((r) => `<img src="${xv(r)}" alt="" loading="lazy">`).join("")}</div>` : ""}
        <div class="baj-royxat">${k.oquvchilar.map((o) => {
            const b = baj.get(`${t.id}-${o.id}`);
            return `<div class="baj-qator" data-oq="${o.id}">
            <b>${xv(o.ism)}</b>
            ${tanlov(HOLAT, b?.holat, "data-baj")}
            <button type="button" class="yulduz" data-yulduz title="Yulduzcha (0–3)" ${b ? "" : "disabled"}>${b?.yulduz ? "⭐".repeat(b.yulduz) : "☆"}</button>
            ${b ? `<div class="baj-izoh"><input data-baj-izoh value="${xv(b.izoh)}" placeholder="Izoh (ixtiyoriy): Barakalla! / Yozuvga e'tibor bering" maxlength="300"></div>` : ""}
          </div>`;
        }).join("")}</div>
      </article>`).join("") || `<p class="izoh">Hali topshiriq berilmagan.</p>`;
    }
    el("#j-guruh").addEventListener("change", () => jurnalniYukla().catch((e) => xabar(e.message)));
    el("#j-sana").addEventListener("change", () => jurnalniYukla().catch((e) => xabar(e.message)));
    el("#j-davomat").addEventListener("click", async (e) => {
        const b = e.target.closest("[data-dav]");
        const q = b?.closest("[data-oq]");
        if (!b || !q || !kun)
            return;
        const oq = Number(q.dataset.oq);
        const eski = kun.davomat.find((d) => d.oquvchi_id === oq);
        const yangi = eski?.holat === b.dataset.dav ? "" : b.dataset.dav;
        await put("/api/admin/davomat", { oquvchi_id: oq, sana: jSana(), holat: yangi });
        kun.davomat = kun.davomat.filter((d) => d.oquvchi_id !== oq);
        if (yangi)
            kun.davomat.push({ oquvchi_id: oq, holat: yangi });
        jurnalniChiz();
    });
    el("#j-hamma-keldi").addEventListener("click", async () => {
        if (!kun)
            return;
        for (const o of kun.oquvchilar)
            if (!kun.davomat.some((d) => d.oquvchi_id === o.id)) {
                await put("/api/admin/davomat", { oquvchi_id: o.id, sana: jSana(), holat: "keldi" });
                kun.davomat.push({ oquvchi_id: o.id, holat: "keldi" });
            }
        jurnalniChiz();
        xabar("Belgilandi ✓");
    });
    el("#dars-forma").addEventListener("submit", async (e) => {
        e.preventDefault();
        try {
            await post("/api/admin/dars", { guruh_id: jGuruh(), sana: jSana(), fan: el("#d-fan").value, mavzu: el("#d-mavzu").value });
            el("#d-mavzu").value = "";
            await jurnalniYukla();
        }
        catch (err) {
            xabar(err.message);
        }
    });
    el("#j-darslar").addEventListener("click", async (e) => {
        const b = e.target.closest("[data-dars-ochir]");
        if (!b)
            return;
        await del(`/api/admin/dars/${b.dataset.darsOchir}`);
        await jurnalniYukla();
    });
    // Bajarilishi, yulduzcha, izoh
    async function bajarishSaqla(tid, oid, o) {
        if (!kun)
            return;
        const eski = kun.bajarish.find((b) => b.topshiriq_id === tid && b.oquvchi_id === oid);
        const yangi = { topshiriq_id: tid, oquvchi_id: oid, holat: eski?.holat ?? "", yulduz: eski?.yulduz ?? 0, izoh: eski?.izoh ?? "", ...o };
        await put("/api/admin/bajarish", yangi);
        kun.bajarish = kun.bajarish.filter((b) => !(b.topshiriq_id === tid && b.oquvchi_id === oid));
        if (yangi.holat)
            kun.bajarish.push(yangi);
    }
    el("#j-topshiriqlar").addEventListener("click", async (e) => {
        const t = e.target;
        const top = t.closest("[data-top]");
        const oq = t.closest("[data-oq]");
        const ochir = t.closest("[data-top-ochir]");
        if (ochir) {
            if (!confirm("Topshiriq o'chirilsinmi?"))
                return;
            await del(`/api/admin/topshiriq/${ochir.dataset.topOchir}`);
            return jurnalniYukla();
        }
        if (!top || !oq || !kun)
            return;
        const tid = Number(top.dataset.top), oid = Number(oq.dataset.oq);
        const eski = kun.bajarish.find((b) => b.topshiriq_id === tid && b.oquvchi_id === oid);
        const bj = t.closest("[data-baj]");
        try {
            if (bj) {
                const holat = eski?.holat === bj.dataset.baj ? "" : bj.dataset.baj;
                await bajarishSaqla(tid, oid, { holat, ...(holat ? {} : { yulduz: 0, izoh: "" }) });
                jurnalniChiz();
            }
            else if (t.closest("[data-yulduz]") && eski) {
                await bajarishSaqla(tid, oid, { yulduz: ((eski.yulduz || 0) + 1) % 4 });
                jurnalniChiz();
            }
        }
        catch (err) {
            xabar(err.message);
        }
    });
    el("#j-topshiriqlar").addEventListener("change", async (e) => {
        const inp = e.target;
        if (!inp.matches("[data-baj-izoh]"))
            return;
        const tid = Number(inp.closest("[data-top]").dataset.top), oid = Number(inp.closest("[data-oq]").dataset.oq);
        await bajarishSaqla(tid, oid, { izoh: inp.value }).then(() => xabar("Izoh saqlandi ✓"), (err) => xabar(err.message));
    });
    el("#j-hisobot").addEventListener("click", async () => {
        if (!confirm(`${sanaMatn(jSana())} uchun kunlik hisobot Telegram'ga ulangan ota-onalarga yuborilsinmi?`))
            return;
        try {
            const r = await post("/api/admin/hisobot", { guruh_id: jGuruh(), sana: jSana() });
            xabar(r.jami ? `Yuborildi: ${r.yuborildi} / ${r.jami} ota-ona` : "Bu guruhda Telegram'ga ulangan ota-ona yo'q");
        }
        catch (err) {
            xabar(err.message);
        }
    });
    // ---- Topshiriq qo'shish ----
    let tRasmlar = [];
    let yuklanmoqda = 0;
    function tRasmlarniChiz() {
        el("#t-rasmlar").innerHTML = tRasmlar.map((r, i) => `<div class="t-rasm"><img src="${xv(r)}" alt=""><button type="button" data-t-rasm="${i}" aria-label="Olib tashlash">✕</button></div>`).join("");
    }
    el("#t-yangi").addEventListener("click", () => {
        el("#t-matn").value = "";
        el("#t-muddat").value = "";
        tRasmlar = [];
        tRasmlarniChiz();
        el("#t-xato").hidden = true;
        el("#topshiriq-oyna").showModal();
    });
    el("#t-rasmlar").addEventListener("click", (e) => {
        const b = e.target.closest("[data-t-rasm]");
        if (b) {
            tRasmlar.splice(Number(b.dataset.tRasm), 1);
            tRasmlarniChiz();
        }
    });
    async function rasmTayyorla(f) {
        const bm = await createImageBitmap(f);
        const k = Math.min(1, 1400 / Math.max(bm.width, bm.height));
        const c = document.createElement("canvas");
        c.width = Math.round(bm.width * k);
        c.height = Math.round(bm.height * k);
        c.getContext("2d").drawImage(bm, 0, 0, c.width, c.height);
        for (const [turi, q] of [["image/webp", 0.82], ["image/jpeg", 0.85]]) {
            const b = await new Promise((r) => c.toBlob(r, turi, q));
            if (b && b.type === turi)
                return b;
        }
        throw new Error("Rasmni o'qib bo'lmadi");
    }
    el("#t-rasm").addEventListener("change", async (e) => {
        const inp = e.target;
        for (const f of Array.from(inp.files || []).slice(0, 6 - tRasmlar.length)) {
            yuklanmoqda++;
            try {
                const b = await rasmTayyorla(f);
                const r = await api("/api/admin/rasm", { method: "POST", headers: { "content-type": b.type }, body: b });
                tRasmlar.push(r.url);
                tRasmlarniChiz();
            }
            catch (err) {
                xabar(err.message);
            }
            finally {
                yuklanmoqda--;
            }
        }
        inp.value = "";
    });
    el("#topshiriq-forma").addEventListener("submit", async (e) => {
        e.preventDefault();
        const x = el("#t-xato");
        if (yuklanmoqda) {
            x.textContent = "Rasmlar yuklanishini kuting…";
            x.hidden = false;
            return;
        }
        const t = el("#t-saqla");
        t.disabled = true;
        try {
            const r = await post("/api/admin/topshiriq", {
                guruh_id: jGuruh(), sana: jSana(), fan: el("#t-fan").value, turi: el("#t-turi").value,
                matn: el("#t-matn").value, muddat: el("#t-muddat").value || null,
                rasmlar: tRasmlar, xabar: el("#t-xabar").checked,
            });
            el("#topshiriq-oyna").close();
            xabar(r.yuborildi ? `Saqlandi ✓ ${r.yuborildi} ota-onaga xabar ketdi` : "Saqlandi ✓");
            await jurnalniYukla();
        }
        catch (err) {
            x.textContent = err.message;
            x.hidden = false;
        }
        finally {
            t.disabled = false;
        }
    });
    let tolovlar = [];
    const pOy = () => el("#p-oy").value || shuOy();
    async function tolovlarniYukla() {
        const r = await api(`/api/admin/tolovlar?oy=${pOy()}`);
        tolovlar = r.royxat;
        const jami = tolovlar.reduce((s, o) => s + o.tolangan, 0);
        const qarz = tolovlar.reduce((s, o) => s + Math.max(0, o.narx - o.tolangan), 0);
        el("#p-jami").innerHTML = `<span>Tushum: ${oyMatn(pOy())}</span>${som(jami)}<span>Qarz: <b class="qarz">${som(qarz)}</b></span>`;
        el("#p-jadval").innerHTML = `<thead><tr><th>O'quvchi</th><th>Guruh</th><th>Oylik</th><th>To'langan</th><th>Holat</th><th></th></tr></thead><tbody>${tolovlar.map((o) => {
            const q = o.narx - o.tolangan;
            return `<tr><td><b>${xv(o.ism)}</b></td><td>${xv(o.guruh)}</td><td>${som(o.narx)}</td><td>${som(o.tolangan)}</td>
          <td>${q > 0 ? `<span class="qarz">${som(q)} qoldi</span>` : `<span class="ok">✅ To'langan</span>`}</td>
          <td><button class="tugma kichik" type="button" data-tolov="${o.id}">+ To'lov</button></td></tr>`;
        }).join("") || `<tr><td colspan="6">Faol o'quvchi yo'q</td></tr>`}</tbody>`;
        const ism = new Map(tolovlar.map((o) => [o.id, o.ism]));
        el("#p-tarix").innerHTML = r.tarix.map((t) => `<div class="r-qator"><div><p><b>${xv(ism.get(t.oquvchi_id) || "—")}</b> · ${som(t.summa)}</p><span class="izoh">${sanaMatn(t.sana)}${t.izoh ? " · " + xv(t.izoh) : ""}</span></div><button class="ochir" type="button" data-tolov-ochir="${t.id}" aria-label="O'chirish">✕</button></div>`).join("")
            || `<p class="izoh">Bu oyda to'lov kiritilmagan.</p>`;
    }
    el("#p-oy").addEventListener("change", () => tolovlarniYukla().catch((e) => xabar(e.message)));
    let tolovOquvchi = null;
    el("#p-jadval").addEventListener("click", (e) => {
        const b = e.target.closest("[data-tolov]");
        tolovOquvchi = (b && tolovlar.find((o) => o.id === Number(b.dataset.tolov))) || null;
        if (!tolovOquvchi)
            return;
        el("#tl-sarlavha").textContent = `${tolovOquvchi.ism} — ${oyMatn(pOy())}`;
        el("#tl-summa").value = String(Math.max(0, tolovOquvchi.narx - tolovOquvchi.tolangan) || "");
        el("#tl-izoh").value = "";
        el("#tl-xato").hidden = true;
        el("#tolov-oyna").showModal();
    });
    el("#tolov-forma").addEventListener("submit", async (e) => {
        e.preventDefault();
        if (!tolovOquvchi)
            return;
        try {
            await post("/api/admin/tolov", { oquvchi_id: tolovOquvchi.id, oy: pOy(), summa: el("#tl-summa").value, izoh: el("#tl-izoh").value });
            el("#tolov-oyna").close();
            xabar("To'lov saqlandi ✓");
            await tolovlarniYukla();
        }
        catch (err) {
            el("#tl-xato").textContent = err.message;
            el("#tl-xato").hidden = false;
        }
    });
    el("#p-tarix").addEventListener("click", async (e) => {
        const b = e.target.closest("[data-tolov-ochir]");
        if (!b || !confirm("To'lov o'chirilsinmi?"))
            return;
        await del(`/api/admin/tolov/${b.dataset.tolovOchir}`);
        await tolovlarniYukla();
    });
    el("#p-eslatma").addEventListener("click", async () => {
        const qarzdor = tolovlar.filter((o) => o.narx > o.tolangan && o.telegram);
        if (!qarzdor.length)
            return xabar("Telegram'ga ulangan qarzdor yo'q");
        if (!confirm(`${qarzdor.length} ta ota-onaga to'lov eslatmasi yuborilsinmi?`))
            return;
        const r = await post("/api/admin/tolov-eslatma", { oy: pOy(), oquvchilar: qarzdor.map((o) => o.id) });
        xabar(`Yuborildi: ${r.yuborildi}`);
    });
    // ================= OYLIK BAHOLAR =================
    const bGuruh = () => Number(el("#b-guruh").value);
    const bOy = () => el("#b-oy").value || shuOy();
    async function baholarniYukla() {
        if (!guruhlar.length)
            await guruhlarniYukla();
        if (!guruhlar.length) {
            el("#b-jadval").innerHTML = `<tbody><tr><td>Avval guruh qo'shing</td></tr></tbody>`;
            return;
        }
        const r = await api(`/api/admin/baholar?guruh=${bGuruh()}&oy=${bOy()}`);
        const fs = r.fanlar.filter((f) => f !== "Boshqa");
        const bm = new Map(r.baholar.map((b) => [`${b.oquvchi_id}|${b.fan}`, b.daraja]));
        const opt = (d) => `<option value="">—</option>${[1, 2, 3].map((x) => `<option value="${x}" ${d === x ? "selected" : ""}>${DARAJALAR[x].b}</option>`).join("")}`;
        el("#b-jadval").innerHTML = `<thead><tr><th>O'quvchi</th>${fs.map((f) => `<th>${FAN_BELGI[f]} ${xv(f)}</th>`).join("")}</tr></thead><tbody>${r.oquvchilar.map((o) => `<tr><td><b>${xv(o.ism)}</b></td>${fs.map((f) => {
            const d = bm.get(`${o.id}|${f}`);
            return `<td><select data-baho="${o.id}|${xv(f)}" data-d="${d ?? ""}" aria-label="${xv(o.ism)} — ${xv(f)}">${opt(d)}</select></td>`;
        }).join("")}</tr>`).join("") || `<tr><td colspan="${fs.length + 1}">Bu guruhda o'quvchi yo'q</td></tr>`}</tbody>`;
    }
    el("#b-guruh").addEventListener("change", () => baholarniYukla().catch((e) => xabar(e.message)));
    el("#b-oy").addEventListener("change", () => baholarniYukla().catch((e) => xabar(e.message)));
    el("#b-jadval").addEventListener("change", async (e) => {
        const s = e.target;
        if (!s.dataset.baho)
            return;
        const [oid, fan] = s.dataset.baho.split("|");
        try {
            await put("/api/admin/baho", { oquvchi_id: Number(oid), oy: bOy(), fan, daraja: Number(s.value) || 0 });
            s.dataset.d = s.value;
        }
        catch (err) {
            xabar(err.message);
        }
    });
    el("#b-yubor").addEventListener("click", async () => {
        if (!confirm(`${oyMatn(bOy())} natijalari ota-onalarga yuborilsinmi?`))
            return;
        try {
            const r = await post("/api/admin/baholar-yubor", { guruh_id: bGuruh(), oy: bOy() });
            xabar(`Yuborildi: ${r.yuborildi} ota-onaga`);
        }
        catch (err) {
            xabar(err.message);
        }
    });
    // ================= ARIZALAR =================
    async function arizalarniYukla() {
        const r = await api("/api/admin/arizalar");
        el("#ariza-soni").textContent = String(r.length);
        el("#ariza-soni").hidden = !r.length;
        el("#ar-royxat").innerHTML = r.map((a) => `<div class="r-qator karta"><div>
        <p><b>${xv(a.bola)}</b>${a.sinf ? " · " + xv(a.sinf) : ""}</p>
        <p>👤 ${xv(a.ism)} · 📞 <b>${xv(a.tel)}</b></p>
        ${a.izoh ? `<p class="izoh">${xv(a.izoh)}</p>` : ""}
        <span class="izoh">${xv(a.vaqt.slice(0, 16).replace("T", " "))} (UTC)</span>
      </div><button class="ochir" type="button" data-ar="${a.id}" aria-label="O'chirish">✕</button></div>`).join("")
            || `<div class="bosh-holat">Yangi ariza yo'q. Saytdagi «Darsga yozilish» formasi orqali keladi.</div>`;
    }
    el("#ar-royxat").addEventListener("click", async (e) => {
        const b = e.target.closest("[data-ar]");
        if (!b || !confirm("Ariza o'chirilsinmi?"))
            return;
        await del(`/api/admin/arizalar/${b.dataset.ar}`);
        await arizalarniYukla();
    });
    // ================= SOZLAMALAR =================
    const S_MAYDON = ["ism", "tajriba", "shior", "haqida", "manzil", "narxlar", "jadval"];
    async function sozlamalarniYukla() {
        const s = await api("/api/admin/sozlamalar");
        for (const k of S_MAYDON)
            el("#s-" + k).value = s[k] || "";
        const h = await api("/api/admin/holat");
        const holat = el("#bot-holat"), tug = el("#bot-tugmalar");
        if (!h.token) {
            holat.innerHTML = "Bot sozlanmagan. Cloudflare'ga <b>TELEGRAM_TOKEN</b> (Secret) qo'shing.";
            tug.innerHTML = "";
        }
        else if (!h.bot) {
            holat.textContent = "Token noto'g'ri yoki Telegram javob bermadi.";
            tug.innerHTML = "";
        }
        else {
            holat.innerHTML = h.repetitorChat
                ? `✅ Ulangan · Bot: <b>@${xv(h.bot)}</b> · Arizalar: <b>${xv(h.repetitorChat)}</b>`
                : `Bot: <b>@${xv(h.bot)}</b> · hali ulanmagan. «Botni ulash» ni bosing va Telegram'da «Start» ni bosing.`;
            tug.innerHTML = `<button class="tugma ${h.repetitorChat ? "" : "asosiy"}" type="button" data-bot="ulash">${h.repetitorChat ? "Qayta ulash" : "Botni ulash"}</button>${h.repetitorChat ? `<button class="tugma" type="button" data-bot="sinov">Sinov xabari</button>` : ""}`;
        }
    }
    el("#bot-tugmalar").addEventListener("click", async (e) => {
        const b = e.target.closest("[data-bot]");
        if (!b)
            return;
        try {
            if (b.dataset.bot === "ulash") {
                const r = await post("/api/admin/bot/ulash", {});
                window.open(r.havola, "_blank", "noopener");
                el("#bot-holat").innerHTML = `Telegram'da <b>«Start»</b> ni bosing, so'ng <b>«Tekshirish»</b> ni bosing.`;
                el("#bot-tugmalar").innerHTML = `<a class="tugma" href="${xv(r.havola)}" target="_blank" rel="noopener">Botni ochish ↗</a><button class="tugma asosiy" type="button" data-bot="tekshir">Tekshirish</button>`;
            }
            else if (b.dataset.bot === "tekshir") {
                await sozlamalarniYukla();
            }
            else {
                await post("/api/admin/bot/sinov", {});
                xabar("Sinov xabari yuborildi ✓");
            }
        }
        catch (err) {
            xabar(err.message);
        }
    });
    el("#s-forma").addEventListener("submit", async (e) => {
        e.preventDefault();
        const b = {};
        for (const k of S_MAYDON)
            b[k] = el("#s-" + k).value;
        try {
            await put("/api/admin/sozlamalar", b);
            xabar("Saqlandi ✓ Ochiq sahifa yangilandi");
        }
        catch (err) {
            xabar(err.message);
        }
    });
    // B8: belgilar bosilganda kichik "sakrash" animatsiyasi (qayta chizilgandan keyin)
    document.addEventListener("click", (e) => {
        const b = e.target.closest("[data-dav], [data-baj], [data-yulduz]");
        if (!b)
            return;
        const kalit = b.matches("[data-dav]") ? `[data-dav="${b.dataset.dav}"]` : b.matches("[data-baj]") ? `[data-baj="${b.dataset.baj}"]` : "[data-yulduz]";
        const qator = b.closest("[data-oq]")?.dataset.oq, top = b.closest("[data-top]")?.dataset.top;
        window.setTimeout(() => {
            const joy = top ? `[data-top="${top}"] [data-oq="${qator}"]` : `#j-davomat [data-oq="${qator}"]`;
            const yangi = document.querySelector(`${joy} ${kalit}`);
            if (!yangi)
                return;
            yangi.classList.remove("sakra");
            void yangi.offsetWidth;
            yangi.classList.add("sakra");
        }, 180);
    });
    // ================= ISHGA TUSHIRISH =================
    if (token)
        boshlash().catch(() => chiqishEkrani());
})();
