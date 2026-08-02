// Lug'at Daftarcha — Telegram Mini App backend
// Bu server ikki vazifani bajaradi:
// 1) public/ papkasidagi Mini App sahifasini ko'rsatadi
// 2) /api/translate manzili orqali Gemini API bilan xavfsiz gaplashadi
//    (API kalit shu yerda, serverda turadi — brauzerga hech qachon chiqmaydi)

const express = require('express');
const path = require('path');
const TelegramBot = require('node-telegram-bot-api');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = 'gemini-3.5-flash-lite';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

app.post('/api/translate', async (req, res) => {
  try {
    const word = (req.body && req.body.word || '').trim();
    if (!word) {
      return res.status(400).json({ error: 'So\'z yuborilmadi' });
    }
    if (!GEMINI_API_KEY) {
      return res.status(500).json({ error: 'Server sozlanmagan: GEMINI_API_KEY topilmadi' });
    }

    const systemPrompt =
      "Sen ingliz tilidan o'zbek tiliga tarjima qiluvchi yordamchisan. " +
      "Foydalanuvchi bitta inglizcha so'z yuboradi. " +
      "Faqat va faqat quyidagi JSON formatida javob ber, boshqa hech qanday matn, izoh yoki markdown belgilarisiz: " +
      '{"uzbek":"so\'zning o\'zbekcha ma\'nosi (qisqa, 1-4 so\'z)","example":"shu inglizcha so\'z ishtirok etgan oddiy va qisqa inglizcha gap"}';

    const response = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': GEMINI_API_KEY
      },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: word }] }],
        generationConfig: { temperature: 0.4 }
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Gemini xatosi:', response.status, errText);
      return res.status(502).json({ error: 'Tarjima xizmati javob bermadi' });
    }

    const data = await response.json();
    const text = data && data.candidates && data.candidates[0] &&
      data.candidates[0].content && data.candidates[0].content.parts &&
      data.candidates[0].content.parts[0] && data.candidates[0].content.parts[0].text;

    if (!text) {
      return res.status(502).json({ error: 'Bo\'sh javob keldi' });
    }

    const clean = text.trim()
      .replace(/^```json/i, '')
      .replace(/^```/, '')
      .replace(/```$/, '')
      .trim();

    let parsed;
    try {
      parsed = JSON.parse(clean);
    } catch (e) {
      console.error('JSON parse xatosi:', clean);
      return res.status(502).json({ error: 'Noto\'g\'ri formatdagi javob' });
    }

    if (!parsed.uzbek || !parsed.example) {
      return res.status(502).json({ error: 'Tarjima topilmadi' });
    }

    res.json({ uzbek: parsed.uzbek, example: parsed.example });
  } catch (e) {
    console.error('Server xatosi:', e);
    res.status(500).json({ error: 'Server xatosi' });
  }
});

// ---------- Telegram bot: /start bosilganda "Ilovani ochish" tugmasi ----------
const BOT_TOKEN = process.env.BOT_TOKEN;
const APP_URL = process.env.MINI_APP_URL || process.env.RENDER_EXTERNAL_URL;

if (BOT_TOKEN) {
  const bot = new TelegramBot(BOT_TOKEN, { polling: true });

  bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    if (!APP_URL) {
      bot.sendMessage(chatId, "Ilova havolasi hali sozlanmagan. MINI_APP_URL o'zgaruvchisini qo'shing.");
      return;
    }
    bot.sendMessage(chatId, "Lug'at daftarchangizga xush kelibsiz! 📖\nBilmagan so'zlaringizni yozib boring, avtomatik tarjima va gap tuziladi.", {
      reply_markup: {
        inline_keyboard: [[{ text: '📖 Ilovani ochish', web_app: { url: APP_URL } }]]
      }
    });
  });

  bot.on('polling_error', (err) => {
    console.error('Bot polling xatosi:', err.message);
  });

  console.log('Telegram bot ishga tushdi (polling)');
} else {
  console.log('BOT_TOKEN topilmadi — faqat veb-sahifa ishlaydi, bot ishga tushmadi');
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server ${PORT}-portda ishga tushdi`);
});
