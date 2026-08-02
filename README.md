# Lug'at Daftarcham — Telegram Mini App

Shaxsiy foydalanish uchun ingliz tili lug'at daftarchasi. So'z qo'shsangiz,
avtomatik o'zbekcha tarjima va namunali gap chiqadi. 10 ta so'zni "yodladim"
deb belgilasangiz, quiz test ochiladi.

## Kerakli narsalar
- GitHub hisobi (bepul)
- Render.com hisobi (bepul, GitHub orqali kirish mumkin)
- Google AI Studio'dan bepul Gemini API kalit

## 1-qadam: Gemini API kalit olish (bepul)
1. https://aistudio.google.com sahifasiga kiring, Google hisobingiz bilan tizimga kiring
2. "Get API key" tugmasini bosing
3. Yangi kalit yarating va nusxa oling (AIza... bilan boshlanadi)
4. Buni hech kimga bermang

## 2-qadam: Kodni GitHub'ga yuklash
1. github.com'da yangi repository yarating (masalan `lugat-daftarcha`)
2. Shu papkadagi barcha fayllarni (server.js, package.json, public/) o'sha repoga yuklang
   (GitHub saytida "Add file → Upload files" orqali ham qilsa bo'ladi, git bilishingiz shart emas)

## 3-qadam: Render.com'da joylashtirish
1. https://render.com ga GitHub hisobingiz bilan kiring
2. "New +" → "Web Service" ni tanlang
3. GitHub repongizni tanlang (lugat-daftarcha)
4. Sozlamalar:
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Instance Type: Free
5. "Environment" bo'limida yana ikkita o'zgaruvchi qo'shing:
   - Key: `GEMINI_API_KEY`, Value: (1-qadamda olgan Gemini kalitingiz)
   - Key: `BOT_TOKEN`, Value: (BotFather bergan bot tokeningiz)
6. "Create Web Service" tugmasini bosing va kuting (2-3 daqiqa)
7. Tayyor bo'lgach, sizga shunday havola beriladi: `https://lugat-daftarcha.onrender.com`

Eslatma: Render bu havolani `RENDER_EXTERNAL_URL` nomli o'zgaruvchida avtomatik
o'zi biladi, shuning uchun uni qo'lda kiritish shart emas — bot shu havoladan
avtomatik foydalanadi.

Eslatma 2: Render'ning bepul rejasi 15 daqiqa ishlatilmasa "uxlab qoladi" va
qayta ochilganda 30-50 soniya kutish kerak bo'lishi mumkin. Shaxsiy
foydalanish uchun bu muammo emas.

## 4-qadam: Botni sinab ko'rish
1. Telegram'da botingizni oching (masalan @tgfarruxbot)
2. `/start` deb yozing
3. "📖 Ilovani ochish" tugmasi chiqadi — bosing, Mini App ochiladi

BotFather'dagi `/newapp` orqali kiritgan "Web App URL"ni ham xohlasangiz
o'sha `https://lugat-daftarcha.onrender.com` havolasiga o'zgartiring —
bu ikkinchi, to'g'ridan-to'g'ri kirish yo'li bo'lib qoladi (ixtiyoriy).

## Nima uchun bunday qurildi?
- So'zlar telefoningizning o'zida (localStorage) saqlanadi
- Tarjima so'rovlari serverga boradi, u yerda API kalit xavfsiz turadi —
  kalit hech qachon brauzerga yoki foydalanuvchiga ko'rinmaydi
