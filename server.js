// Lug'at Daftarcha — Telegram Mini App backend
const express = require('express');
const path = require('path');
const TelegramBot = require('node-telegram-bot-api');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = 'gemini-1.5-flash'; // yoki mos keluvchi model
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// 1. So'z tarjima qilish API
app.post('/api/translate', async (req, res) => {
  try {
    const word = (req.body && req.body.word || '').trim();
    const direction = (req.body && req.body.direction === 'uz-en') ? 'uz-en' : 'en-uz';
    if (!word) {
      return res.status(400).json({ error: 'So'z yuborilmadi' });
    }
    if (!GEMINI_API_KEY) {
      return res.status(500).json({ error: 'Server sozlanmagan: GEMINI_API_KEY topilmadi' });
    }

    const directionInstruction = direction === 'uz-en'
      ? "Foydalanuvchi bitta o'zbekcha so'z yuboradi. Uning inglizcha muqobilini top."
      : "Foydalanuvchi bitta inglizcha so'z yuboradi.";

    const systemPrompt =
      "Sen ingliz va o'zbek tillari o'rtasida tarjima qiluvchi yordamchisan. " +
      directionInstruction + " " +
      "Faqat va faqat quyidagi JSON formatida javob ber, boshqa hech qanday matn, izoh yoki markdown belgilarisiz: " +
      '{"en":"inglizcha so'z (lug'at shaklida, kichik harflarda)",' +
      '"uzbek":"so'zning o'zbekcha ma'nosi (qisqa, 1-4 so'z)",' +
      '"transcription":"inglizcha so'zning IPA talaffuz belgisi, kvadrat qavslarda, masalan ['\\u00e6n\\u0259m(\\u0259)l]",' +
      '"partOfSpeech":"so'z turkumi o'zbekcha bitta so'z bilan: ot, fe'l, sifat, ravish, olmosh, son, predlog yoki undov",' +
      '"example":"shu inglizcha so'z ishtirok etgan oddiy va qisqa inglizcha gap"}';

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
      return res.status(502).json({ error: 'Bo'sh javob keldi' });
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
      return res.status(502).json({ error: 'Noto'g'ri formatdagi javob' });
    }

    if (!parsed.en || !parsed.uzbek || !parsed.example) {
      return res.status(502).json({ error: 'Tarjima topilmadi' });
    }

    res.json({
      en: parsed.en,
      uzbek: parsed.uzbek,
      example: parsed.example,
      transcription: parsed.transcription || '',
      partOfSpeech: parsed.partOfSpeech || ''
    });
  } catch (e) {
    console.error('Server xatosi:', e);
    res.status(500).json({ error: 'Server xatosi' });
  }
});

// 2. Katta Matn va Gaplarni Tarjima qilish API
app.post('/api/translate-text', async (req, res) => {
  try {
    const text = (req.body && req.body.text || '').trim();
    const direction = (req.body && req.body.direction === 'uz-en') ? 'uz-en' : 'en-uz';

    if (!text) {
      return res.status(400).json({ error: 'Matn yuborilmadi' });
    }
    if (!GEMINI_API_KEY) {
      return res.status(500).json({ error: 'Server sozlanmagan: GEMINI_API_KEY topilmadi' });
    }

    const srcLang = direction === 'en-uz' ? 'Ingliz' : 'O'zbek';
    const targetLang = direction === 'en-uz' ? 'O'zbek' : 'Ingliz';

    const systemPrompt = `Sen professional tarjimonsan. Berilgan matnni ${srcLang} tilidan ${targetLang} tiliga aniq, tabiy va ravon tarjima qilib ber. Faqat tarjimaning o'zini qaytar, hech qanday qo'shimcha izoh yoki belgilarsiz.`;

    const response = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': GEMINI_API_KEY
      },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: text }] }],
        generationConfig: { temperature: 0.3 }
      })
    });

    if (!response.ok) {
      return res.status(502).json({ error: 'Tarjima xizmati javob bermadi' });
    }

    const data = await response.json();
    const resultText = data && data.candidates && data.candidates[0] &&
      data.candidates[0].content && data.candidates[0].content.parts &&
      data.candidates[0].content.parts[0] && data.candidates[0].content.parts[0].text;

    res.json({ translatedText: (resultText || '').trim() });

  } catch (e) {
    console.error('Text translate error:', e);
    res.status(500).json({ error: 'Server xatosi' });
  }
});

// 3. Auto-ping (Self-ping) - Render'da serverni doimiy uyg'oq tutish uchun
const APP_URL = process.env.MINI_APP_URL || process.env.RENDER_EXTERNAL_URL;
if (APP_URL) {
  setInterval(() => {
    fetch(APP_URL).then(() => console.log('Self-ping yuborildi')).catch(err => console.error('Ping xatosi:', err.message));
  }, 10 * 60 * 1000); // Har 10 daqiqada ping yuboradi
}

// 4. Telegram bot: /start
const BOT_TOKEN = process.env.BOT_TOKEN;

if (BOT_TOKEN) {
  const bot = new TelegramBot(BOT_TOKEN, { polling: true });

  bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    if (!APP_URL) {
      bot.sendMessage(chatId, "Ilova havolasi hali sozlanmagan. MINI_APP_URL o'zgaruvchisini qo'shing.");
      return;
    }
    bot.sendMessage(chatId, "Lug'at daftarchangizga xush kelibsiz! 📖\nBilmagan so'zlaringizni yozib boring va matnlarni tarjima qiling.", {
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

// 5. Talaffuz (TTS) API
app.get('/api/speak', async (req, res) => {
  try {
    const text = (req.query.text || '').toString().trim().slice(0, 300);
    const lang = (req.query.lang === 'uz') ? 'uz' : 'en';
    if (!text) {
      return res.status(400).send('Matn yuborilmadi');
    }
    const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text)}&tl=${lang}&client=tw-ob`;
    const response = await fetch(ttsUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
      }
    });
    if (!response.ok) {
      return res.status(502).send('Ovoz olinmadi');
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(buffer);
  } catch (e) {
    console.error('Talaffuz server xatosi:', e);
    res.status(500).send('Server xatosi');
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server ${PORT}-portda ishga tushdi`);
});
