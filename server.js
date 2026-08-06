// Lug'at Daftarcha — Telegram Mini App backend
const express = require('express');
const path = require('path');
const TelegramBot = require('node-telegram-bot-api');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

let leaderboardData = [];

const POS_MAP = {
  noun: "ot", verb: "fe'l", adjective: "sifat", adverb: "ravish",
  pronoun: "olmosh", preposition: "predlog", conjunction: "bog'lovchi", interjection: "undov"
};

// 1. Leaderboard API lar
app.post('/api/leaderboard/update', (req, res) => {
  try {
    const { id, name, username, photoUrl, xp, wordsCount, memorizedCount, streak } = req.body;
    if (!id) return res.status(400).json({ error: 'ID topilmadi' });

    const idx = leaderboardData.findIndex(u => String(u.id) === String(id));
    const userData = {
      id: String(id),
      name: name || 'Foydalanuvchi',
      username: username || '',
      photoUrl: photoUrl || '',
      xp: xp || 0,
      wordsCount: wordsCount || 0,
      memorizedCount: memorizedCount || 0,
      streak: streak || 1
    };

    if (idx !== -1) {
      leaderboardData[idx] = { ...leaderboardData[idx], ...userData };
    } else {
      leaderboardData.push(userData);
    }

    leaderboardData.sort((a, b) => b.xp - a.xp);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Leaderboard update error' });
  }
});

app.get('/api/leaderboard', (req, res) => {
  leaderboardData.sort((a, b) => b.xp - a.xp);
  res.json(leaderboardData.slice(0, 50));
});

// 2. Kuchaytirilgan Tarjima xizmati (Google Translate + MyMemory Backup)
async function translateWithGoogle(text, fromLang, toLang) {
  // 1-urinish: Google Translate API
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${fromLang}&tl=${toLang}&dt=t&q=${encodeURIComponent(text)}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
    });
    if (res.ok) {
      const data = await res.json();
      if (data && data[0] && data[0][0] && data[0][0][0]) {
        const trans = data[0].map(item => item[0]).join('');
        if (trans.toLowerCase() !== text.toLowerCase()) return trans;
      }
    }
  } catch (e) {
    console.warn('Google Translate xatosi:', e.message);
  }

  // 2-urinish: MyMemory Translate API (Gar Google rad etsa)
  try {
    const mmUrl = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${fromLang}|${toLang}`;
    const mmRes = await fetch(mmUrl);
    if (mmRes.ok) {
      const mmData = await mmRes.json();
      if (mmData && mmData.responseData && mmData.responseData.translatedText) {
        return mmData.responseData.translatedText;
      }
    }
  } catch (e) {
    console.warn('MyMemory Translate xatosi:', e.message);
  }

  return text;
}

// 3. Free Dictionary API
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
    return null;
  }
}

// 4. Mantiqli va Tabiiy Gap Yasovchi (Zaxira uchun)
function generateSmartExample(word, pos) {
  const w = word.toLowerCase();

  const nounTemplates = [
    `The fire started in the kitchen and spread quickly through the building.`,
    `She created a colorful pattern on the paper using water colors.`,
    `We need to study this main ${w} very carefully before making a move.`,
    `He noticed an interesting ${w} while examining the artwork.`
  ];

  const verbTemplates = [
    `The soldier was ordered to fire at the target.`,
    `They tried to hide the valuable items inside a wooden box.`,
    `She always tries to ${w} her work with great enthusiasm.`
  ];

  const adjTemplates = [
    `It was a remarkably ${w} solution to a difficult problem.`,
    `He gave a very ${w} answer that satisfied everyone in the room.`
  ];

  let list = nounTemplates;
  if (pos === "fe'l") list = verbTemplates;
  else if (pos === "sifat") list = adjTemplates;

  return list[Math.floor(Math.random() * list.length)];
}

// MAIN API: So'z tarjima qilish
app.post('/api/translate', async (req, res) => {
  try {
    const word = (req.body && req.body.word || '').trim();
    const direction = (req.body && req.body.direction === 'uz-en') ? 'uz-en' : 'en-uz';

    if (!word) return res.status(400).json({ error: "So'z yuborilmadi" });

    // 1-USUL: Gemini AI
    if (GEMINI_API_KEY) {
      try {
        const promptText = `
        Target Word: "${word}"
        Direction: ${direction === 'uz-en' ? 'Uzbek to English' : 'English to Uzbek'}.

        Return ONLY a JSON object:
        {
          "en": "English word in lowercase",
          "uzbek": "Accurate Uzbek translation (e.g. fire -> olov, pattern -> naqsh)",
          "transcription": "IPA pronunciation in brackets, e.g. [/faɪər/]",
          "partOfSpeech": "Correct part of speech in Uzbek (fe'l, ot, sifat, ravish)",
          "example": "A realistic, intermediate B1-B2 level sentence using the word naturally in real context."
        }
        `;

        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;
        const aiResponse = await fetch(geminiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: promptText }] }],
            generationConfig: { temperature: 0.7, responseMimeType: "application/json" }
          })
        });

        if (aiResponse.ok) {
          const aiData = await aiResponse.json();
          let rawJson = aiData?.candidates?.[0]?.content?.parts?.[0]?.text || '';
          rawJson = rawJson.replace(/```json/gi, '').replace(/```/g, '').trim();

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
        console.warn('Gemini AI parse xatosi:', aiErr.message);
      }
    }

    // 2-USUL: Dual Translate + Dictionary
    const fromLang = direction === 'uz-en' ? 'uz' : 'en';
    const toLang = direction === 'uz-en' ? 'en' : 'uz';
    const translatedText = await translateWithGoogle(word, fromLang, toLang);

    const enWord = direction === 'en-uz' ? word.toLowerCase() : translatedText.toLowerCase();
    const uzWord = direction === 'en-uz' ? translatedText : word;

    const dictData = await fetchFreeDictionaryData(enWord);

    let finalPos = dictData?.pos || "so'z";
    let finalIpa = dictData?.ipa || `[${enWord}]`;
    let finalExample = dictData?.exampleSentence;

    if (!finalExample) {
      finalExample = generateSmartExample(enWord, finalPos);
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

// Katta Matn Tarjimasi
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
    res.status(500).json({ error: 'Server xatosi' });
  }
});

// Auto-ping
const APP_URL = process.env.MINI_APP_URL || process.env.RENDER_EXTERNAL_URL;
if (APP_URL) {
  setInterval(() => {
    fetch(APP_URL).then(() => console.log('Self-ping ok')).catch(() => {});
  }, 10 * 60 * 1000);
}

// Telegram Bot
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

// TTS API
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
