// Lug'at Daftarcha — Telegram Mini App backend
const express = require('express');
const path = require('path');
const TelegramBot = require('node-telegram-bot-api');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
// Barqaror Gemini modeli
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;

// 1. So'z tarjima qilish API
app.post('/api/translate', async (req, res) => {
  try {
    const word = (req.body && req.body.word || '').trim();
    const direction = (req.body && req.body.direction === 'uz-en') ? 'uz-en' : 'en-uz';
    
    if (!word) {
      return res.status(400).json({ error: "So'z yuborilmadi" });
    }
    if (!GEMINI_API_KEY) {
      console.error("GEMINI_API_KEY topilmadi!");
      return res.status(500).json({ error: 'Server sozlanmagan: GEMINI_API_KEY topilmadi' });
    }

    const directionInstruction = direction === 'uz-en'
      ? "Foydalanuvchi bitta o'zbekcha so'z yuboradi. Uning inglizcha muqobilini top."
      : "Foydalanuvchi bitta inglizcha so'z yuboradi.";

    const promptText = 
      "Sen ingliz va o'zbek tillari o'rtasida tarjima qiluvchi yordamchisan. " +
      directionInstruction + " So'z: '" + word + "'. " +
      "Faqat va faqat quyidagi JSON formatida javob ber, boshqa hech qanday markdown yoki izohlarsiz: " +
      '{"en":"inglizcha so\'z","uzbek":"o\'zbekcha tarjimasi","transcription":"[IPA talaffuzi]","partOfSpeech":"so\'z turkumi","example":"namuna gap"}';

    const response = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: promptText }] }]
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Gemini API xatosi:', response.status, errText);
      return res.status(502).json({ error: 'Tarjima xizmati javob bermadi' });
    }

    const data = await response.json();
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!rawText) {
      return res.status(502).json({ error: "Bo'sh javob keldi" });
    }

    const cleanJson = rawText.trim()
      .replace(/^```json/i, '')
      .replace(/^```/, '')
      .replace(/```$/, '')
      .trim();

    const parsed = JSON.parse(cleanJson);

    res.json({
      en: parsed.en || word,
      uzbek: parsed.uzbek || "Tarjima topilmadi",
      example: parsed.example || "",
      transcription: parsed.transcription || "",
      partOfSpeech: parsed.partOfSpeech || ""
    });

  } catch (e) {
    console.error('Serverda xatolik:', e);
    res.status(500).json({ error: 'Server xatosi' });
  }
});

// 2. Katta Matn va Gaplarni Tarjima qilish API
app.post('/api/translate-text', async (req, res) => {
  try {
    const text = (req.body && req.body.text || '').trim();
    const direction = (req.body && req.body.direction === 'uz-en') ? 'uz-en' : 'en-uz';

    if (!text) return res.status(400).json({ error: 'Matn yuborilmadi' });
    if (!GEMINI_API_KEY) return res.status(500).json({ error: 'GEMINI_API_KEY topilmadi' });

    const srcLang = direction === 'en-uz' ? 'Ingliz' : "O'zbek";
    const targetLang = direction === 'en-uz' ? "O'zbek" : 'Ingliz';

    const promptText = `Matnni ${srcLang} tilidan ${targetLang} tiliga ravon tarjima qil. Faqat tarjimani qaytar: "${text}"`;

    const response = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: promptText }] }]
      })
    });

    if (!response.ok) return res.status(502).json({ error: 'Tarjima xizmati javob bermadi' });

    const data = await response.json();
    const resultText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';

    res.json({ translation: resultText.trim() });

  } catch (e) {
    console.error('Text translate error:', e);
    res.status(500).json({ error: 'Server xatosi' });
  }
});

// 3. Auto-ping (Render uxlab qolmasligi uchun)
const APP_URL = process.env.MINI_APP_URL || process.env.RENDER_EXTERNAL_URL;
if (APP_URL) {
  setInterval(() => {
    fetch(APP_URL).then(() => console.log('Self-ping ok')).catch(() => {});
  }, 10 * 60 * 1000);
}

// 4. Telegram Bot
const BOT_TOKEN = process.env.BOT_TOKEN;
if (BOT_TOKEN) {
  const bot = new TelegramBot(BOT_TOKEN, { polling: true });
  bot.onText(/\/start/, (msg) => {
    if (!APP_URL) return bot.sendMessage(msg.chat.id, "MINI_APP_URL sozlanmagan.");
    bot.sendMessage(msg.chat.id, "Lug'at daftarchangizga xush kelibsiz! 📖", {
      reply_markup: {
        inline_keyboard: [[{ text: '📖 Ilovani ochish', web_app: { url: APP_URL } }]]
      }
    });
  });
}

// 5. Talaffuz (TTS)
app.get('/api/speak', async (req, res) => {
  try {
    const text = (req.query.text || '').toString().trim().slice(0, 300);
    if (!text) return res.status(400).send('Matn yo\'q');
    const ttsUrl = `[https://translate.google.com/translate_tts?ie=UTF-8&q=$](https://translate.google.com/translate_tts?ie=UTF-8&q=$){encodeURIComponent(text)}&tl=en&client=tw-ob`;
    const response = await fetch(ttsUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    if (!response.ok) return res.status(502).send('Ovoz olinmadi');
    const buffer = Buffer.from(await response.arrayBuffer());
    res.setHeader('Content-Type', 'audio/mpeg');
    res.send(buffer);
  } catch (e) {
    res.status(500).send('Server xatosi');
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server ${PORT}-portda ishga tushdi`));
