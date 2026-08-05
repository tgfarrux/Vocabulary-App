// Lug'at Daftarcha — Telegram Mini App backend
const express = require('express');
const path = require('path');
const TelegramBot = require('node-telegram-bot-api');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// So'z turkumlarini o'zbekchaga o'girish xaritasi
const POS_MAP = {
  noun: "ot",
  verb: "fe'l",
  adjective: "sifat",
  adverb: "ravish",
  pronoun: "olmosh",
  preposition: "predlog",
  conjunction: "bog'lovchi",
  interjection: "undov"
};

// 1. Google Translate bepul xizmati
async function translateWithGoogle(text, fromLang, toLang) {
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${fromLang}&tl=${toLang}&dt=t&q=${encodeURIComponent(text)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Google Translate xatosi');
    const data = await res.json();
    if (data && data[0]) {
      return data[0].map(item => item[0]).join('');
    }
  } catch (e) {
    console.error('Google Translate xabari:', e.message);
  }
  return text;
}

// 2. Free Dictionary API orqali haqiqiy gap, talaffuz va so'z turkumini olish
async function fetchFreeDictionaryData(word) {
  try {
    const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`);
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data) || !data[0]) return null;

    const entry = data[0];
    let ipa = entry.phonetics?.find(p => p.text)?.text || `[${word}]`;
    let pos = "so'z";
    let exampleSentence = "";

    if (entry.meanings && entry.meanings.length > 0) {
      const primaryMeaning = entry.meanings[0];
      const rawPos = primaryMeaning.partOfSpeech;
      pos = POS_MAP[rawPos] || rawPos || "so'z";

      // Barcha ma'nolardan namuna gap qidirish
      for (const m of entry.meanings) {
        for (const d of m.definitions || []) {
          if (d.example) {
            exampleSentence = d.example;
            break;
          }
        }
        if (exampleSentence) break;
      }
    }

    return { ipa, pos, exampleSentence };
  } catch (e) {
    console.warn('Free Dictionary API xatosi:', e.message);
    return null;
  }
}

// MAIN API: So'z tarjima qilish va gap tuzish
app.post('/api/translate', async (req, res) => {
  try {
    const word = (req.body && req.body.word || '').trim();
    const direction = (req.body && req.body.direction === 'uz-en') ? 'uz-en' : 'en-uz';

    if (!word) {
      return res.status(400).json({ error: "So'z yuborilmadi" });
    }

    // 1-USUL: Gemini AI (Agar kalit sozlangan va ishlayotgan bo'lsa)
    if (GEMINI_API_KEY) {
      try {
        const promptText = `
        You are an expert English teacher.
        Target Word: "${word}"
        Direction: ${direction === 'uz-en' ? 'Uzbek to English' : 'English to Uzbek'}.

        Return ONLY a JSON object with this structure:
        {
          "en": "English word in lowercase",
          "uzbek": "Short Uzbek translation",
          "transcription": "IPA pronunciation, e.g. [/haɪd/]",
          "partOfSpeech": "Part of speech in Uzbek (fe'l, ot, sifat, ravish)",
          "example": "A natural, realistic B1-B2 level intermediate sentence using the English word."
        }
        Do NOT use generic text like "I am learning the word...". Make the sentence realistic.
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
        } else {
          const errBody = await aiResponse.text();
          console.error('Gemini API xatosi kodi:', aiResponse.status, errBody);
        }
      } catch (aiErr) {
        console.warn('Gemini AI ishlamadi, zaxiraga o\'tilmoqda:', aiErr.message);
      }
    }

    // 2-USUL (MUKAMMAL ZAXIRA): Free Dictionary API + Google Translate
    const fromLang = direction === 'uz-en' ? 'uz' : 'en';
    const toLang = direction === 'uz-en' ? 'en' : 'uz';
    const translatedText = await translateWithGoogle(word, fromLang, toLang);

    const enWord = direction === 'en-uz' ? word.toLowerCase() : translatedText.toLowerCase();
    const uzWord = direction === 'en-uz' ? translatedText : word;

    // Lug'at bazasidan ma'lumotlarni tortish
    const dictData = await fetchFreeDictionaryData(enWord);

    let finalPos = dictData?.pos || "so'z";
    let finalIpa = dictData?.ipa || `[${enWord}]`;
    let finalExample = dictData?.exampleSentence;

    // Gar sentence topilmagan bo'lsa, turkumiga qarab o'rtacha darajadagi tabiiy gaplar yasash
    if (!finalExample) {
      if (finalPos === "fe'l") {
        finalExample = `It is important to ${enWord} carefully when you are in this situation.`;
      } else if (finalPos === "sifat") {
        finalExample = `She gave a very ${enWord} explanation that helped everyone understand.`;
      } else if (finalPos === "ravish") {
        finalExample = `He completed the whole assignment ${enWord} without any help.`;
      } else {
        finalExample = `We need to consider the ${enWord} before making our final decision.`;
      }
    }

    res.json({
      en: enWord,
      uzbek: uzWord,
      example: finalExample,
      transcription: finalIpa,
      partOfSpeech: finalPos
    });

  } catch (e) {
    console.error('Server xatosi:', e.message);
    res.status(500).json({ error: 'Serverda xatolik yuz berdi' });
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
