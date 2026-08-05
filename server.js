// Lug'at Daftarcha — Telegram Mini App backend
const express = require('express');
const path = require('path');
const TelegramBot = require('node-telegram-bot-api');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Google Translate zaxira xizmati
async function translateWithGoogle(text, fromLang, toLang) {
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${fromLang}&tl=${toLang}&dt=t&q=${encodeURIComponent(text)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Google Translate xatosi');
  const data = await res.json();
  if (data && data[0]) {
    return data[0].map(item => item[0]).join('');
  }
  throw new Error('Tarjima olinmadi');
}

// 1. So'z tarjima qilish va sifatli B1-B2 gap tuzish API
app.post('/api/translate', async (req, res) => {
  try {
    const word = (req.body && req.body.word || '').trim();
    const direction = (req.body && req.body.direction === 'uz-en') ? 'uz-en' : 'en-uz';

    if (!word) {
      return res.status(400).json({ error: "So'z yuborilmadi" });
    }

    // 1-USUL: Gemini AI orqali sifatli, B1/B2 darajadagi gap va tarjima olish
    if (GEMINI_API_KEY) {
      try {
        const promptText = `
        You are an expert English language teacher.
        Input word: "${word}"
        Direction: ${direction === 'uz-en' ? 'Uzbek to English' : 'English to Uzbek'}.

        Generate a JSON object with:
        1. "en": The English word (lowercase).
        2. "uzbek": Concise Uzbek translation.
        3. "transcription": Correct IPA pronunciation in brackets, e.g. [/leɪk/].
        4. "partOfSpeech": Part of speech in Uzbek (e.g. ot, fe'l, sifat, ravish).
        5. "example": A natural, meaningful, medium-level (B1/B2 intermediate) English sentence using the English word correctly in real context. Do NOT use generic sentences like "I am learning the word...".

        Return ONLY raw valid JSON.
        `;

        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;
        const aiResponse = await fetch(geminiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: promptText }] }],
            generationConfig: {
              temperature: 0.7,
              responseMimeType: "application/json"
            }
          })
        });

        if (aiResponse.ok) {
          const aiData = await aiResponse.json();
          const rawJson = aiData?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (rawJson) {
            const parsed = JSON.parse(rawJson);
            if (parsed.en && parsed.uzbek && parsed.example) {
              return res.json({
                en: parsed.en.toLowerCase(),
                uzbek: parsed.uzbek,
                example: parsed.example,
                transcription: parsed.transcription || `[${parsed.en}]`,
                partOfSpeech: parsed.partOfSpeech || "so'z"
              });
            }
          }
        }
      } catch (aiErr) {
        console.warn('Gemini AI xatosi, zaxiraga o\'tilmoqda:', aiErr.message);
      }
    }

    // 2-USUL (ZAXIRA): Google Translate
    const fromLang = direction === 'uz-en' ? 'uz' : 'en';
    const toLang = direction === 'uz-en' ? 'en' : 'uz';
    const translatedText = await translateWithGoogle(word, fromLang, toLang);

    const enWord = direction === 'en-uz' ? word.toLowerCase() : translatedText.toLowerCase();
    const uzWord = direction === 'en-uz' ? translatedText : word;

    const backupExamples = [
      `We noticed the word "${enWord}" used frequently in the article.`,
      `Understanding how to use "${enWord}" properly will improve your vocabulary.`,
      `She explained the meaning of "${enWord}" with a clear situation.`
    ];
    const randomExample = backupExamples[Math.floor(Math.random() * backupExamples.length)];

    res.json({
      en: enWord,
      uzbek: uzWord,
      example: randomExample,
      transcription: `[${enWord}]`,
      partOfSpeech: "so'z"
    });

  } catch (e) {
    console.error('Tarjimada xatolik:', e.message);
    res.status(500).json({ error: 'Tarjima qilishda xatolik yuz berdi' });
  }
});

// 2. Katta Matn va Gaplarni Tarjima qilish API
app.post('/api/translate-text', async (req, res) => {
  try {
    const text = (req.body && req.body.text || '').trim();
    const direction = (req.body && req.body.direction === 'uz-en') ? 'uz-en' : 'en-uz';

    if (!text) return res.status(400).json({ error: 'Matn yuborilmadi' });

    const fromLang = direction === 'uz-en' ? 'uz' : 'en';
    const toLang = direction === 'uz-en' ? 'en' : 'uz';

    const resultText = await translateWithGoogle(text, fromLang, toLang);
    res.json({ translation: resultText, translatedText: resultText });

  } catch (e) {
    console.error('Text translate error:', e.message);
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

// 5. Talaffuz (TTS) API
app.get('/api/speak', async (req, res) => {
  try {
    const text = (req.query.text || '').toString().trim().slice(0, 300);
    const lang = (req.query.lang === 'uz') ? 'uz' : 'en';
    if (!text) return res.status(400).send('Matn yo\'q');

    const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text)}&tl=${lang}&client=tw-ob`;
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
