# Ta'lim — boshlang'ich sinf repetitori tizimi

Repetitor uchun sayt: ochiq sahifa, repetitor paneli va ota-onalar kabineti.

## Sahifalar
| Manzil | Kim uchun |
|---|---|
| `/` | Hamma: repetitor haqida, guruhlar, darsga yozilish |
| `/ota-ona` | Ota-onalar: farzand kodi bilan kirish |
| `/admin` | Repetitor: login va parol bilan |

## Imkoniyatlar
- Guruhlar va o'quvchilar, har bir o'quvchiga ota-ona kodi
- Kunlik jurnal: davomat, o'tilgan mavzular, topshiriqlar (rasm bilan)
- Bajarilishi bir bosishda (✅ ⚠️ ❌), yulduzcha va izoh
- Oylik o'zlashtirish bahosi: 🌟 Mustahkam o'zlashtirdi · 👍 O'zlashtirmoqda · 💪 Ko'proq mashq kerak
- To'lovlar hisobi va qarzdorlarga eslatma
- Telegram bot: arizalar repetitorga, kunlik hisobot / vazifa / oylik natija ota-onalarga
- Xavfsizlik: 5 xato urinishdan keyin 15 daqiqa blok, 12 soatlik token, xavfsizlik sarlavhalari, so'rovlar cheklovi

## Tuzilishi
| Fayl | Vazifasi |
|---|---|
| `worker/index.ts` | Server (API, D1 baza, Telegram) |
| `src/*.ts` | Sahifalar mantig'i (`tsc -p .` → `dist/`) |
| `*.html`, `*.css` | Sahifalar va dizayn |

## Cloudflare sozlamalari
1. D1 baza `ta-lim-db` yaratiladi, ID `wrangler.jsonc` ga yoziladi
2. Secrets: `ADMIN_LOGIN`, `ADMIN_PAROL`, `TELEGRAM_TOKEN` (alohida bot)
3. Admin panel → Sozlamalar → «Botni ulash»
