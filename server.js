// Lug'at Daftarcha — Telegram Mini App backend
const express = require('express');
const path = require('path');
const fs = require('fs');
const TelegramBot = require('node-telegram-bot-api');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const LEADERBOARD_FILE = path.join(__dirname, 'leaderboard.json');

// Leaderboard ma'lumotlarini fayldan o'qish / saqlash
let leaderboardData = [];
try {
  if (fs.existsSync(LEADERBOARD_FILE)) {
    const raw = fs.readFileSync(LEADERBOARD_FILE, 'utf8');
    leaderboardData = JSON.parse(raw) || [];
  }
} catch (e) {
  leaderboardData = [];
}

function saveLeaderboardToFile() {
  try {
    fs.writeFileSync(LEADERBOARD_FILE, JSON.stringify(leaderboardData, null, 2), 'utf8');
  } catch (e) {
    console.error('Leaderboard saqlashda xato:', e.message);
  }
}

const POS_MAP = {
  noun: "ot", verb: "fe'l", adjective: "sifat", adverb: "ravish",
  pronoun: "olmosh", preposition: "predlog", conjunction: "bog'lovchi", interjection: "undov"
};

// 1. Leaderboard API
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
    saveLeaderboardToFile();
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Leaderboard update error' });
  }
});

app.get('/api/leaderboard', (req, res) => {
  leaderboardData.sort((a, b) => b.xp - a.xp);
  res.json(leaderboardData.slice(0, 50));
});

// 2. Free Dictionary API
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
      for (const m of entry.meanings) {
        const rawPos = m.partOfSpeech;
        if (rawPos && POS_MAP[rawPos]) pos = POS_MAP[rawPos];
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

// 3. Zaxira Tarjima xizmati
async function translateBackup(text, fromLang, toLang) {
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
  } catch (e) {}

  try {
    const mmUrl = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${fromLang}|${toLang}`;
    const mmRes = await fetch(mmUrl);
    if (mmRes.ok) {
      const mmData = await mmRes.json();
      if (mmData?.responseData?.translatedText) {
        return mmData.responseData.translatedText;
      }
    }
  } catch (e) {}

  return text;
}

// 4. Gemini AI murojaat funksiyasi
async function callGeminiAI(promptText) {
  if (!GEMINI_API_KEY) return null;
  const models = ['gemini-3.5-flash-lite', 'gemini-2.0-flash', 'gemini-1.5-flash'];
  for (const model of models) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: promptText }] }],
          generationConfig: { temperature: 0.3, responseMimeType: "application/json" }
        })
      });
      if (res.ok) {
        const data = await res.json();
        let rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        rawText = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();
        if (rawText) return JSON.parse(rawText);
      }
    } catch (e) {}
  }
  return null;
}

// MAIN API: So'z tarjimasi
app.post('/api/translate', async (req, res) => {
  try {
    const word = (req.body && req.body.word || '').trim();
    const direction = (req.body && req.body.direction === 'uz-en') ? 'uz-en' : 'en-uz';

    if (!word) return res.status(400).json({ error: "So'z yuborilmadi" });

    const aiPrompt = `
    Target Word or Phrase: "${word}"
    Direction: ${direction === 'uz-en' ? 'Uzbek to English' : 'English to Uzbek'}.

    Return ONLY a JSON object with this exact structure:
    {
      "en": "English word or phrase in lowercase",
      "uzbek": "Accurate Uzbek translation",
      "transcription": "IPA pronunciation in brackets, e.g. [/ˈæp.əl/]",
      "partOfSpeech": "Part of speech in Uzbek (fe'l, ot, sifat, ravish)",
      "example": "A real, high-quality, grammatically correct English sentence that naturally uses this English word in context."
    }
    `;

    const aiResult = await callGeminiAI(aiPrompt);

    if (aiResult && aiResult.en && aiResult.uzbek && aiResult.example) {
      return res.json({
        en: aiResult.en.toLowerCase(),
        uzbek: aiResult.uzbek,
        example: aiResult.example,
        transcription: aiResult.transcription || `[${aiResult.en}]`,
        partOfSpeech: aiResult.partOfSpeech || "so'z"
      });
    }

    const fromLang = direction === 'uz-en' ? 'uz' : 'en';
    const toLang = direction === 'uz-en' ? 'en' : 'uz';
    const translatedText = await translateBackup(word, fromLang, toLang);

    const enWord = direction === 'en-uz' ? word.toLowerCase() : translatedText.toLowerCase();
    const uzWord = direction === 'en-uz' ? translatedText : word;

    const dictData = await fetchFreeDictionaryData(enWord);

    let finalPos = dictData?.pos || "so'z";
    let finalIpa = dictData?.ipa || `[${enWord}]`;
    let finalExample = dictData?.exampleSentence || `Practice using the word "${enWord}" in daily English studies.`;

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

// Katta Matn Tarjimasi API
app.post('/api/translate-text', async (req, res) => {
  try {
    const text = (req.body && req.body.text || '').trim();
    const direction = (req.body && req.body.direction === 'uz-en') ? 'uz-en' : 'en-uz';

    if (!text) return res.status(400).json({ error: 'Matn yuborilmadi' });

    const fromLang = direction === 'uz-en' ? 'uz' : 'en';
    const toLang = direction === 'uz-en' ? 'en' : 'uz';

    const textPrompt = `Translate text from ${fromLang === 'uz' ? 'Uzbek' : 'English'} to ${toLang === 'uz' ? 'Uzbek' : 'English'}. Return ONLY JSON: {"translation": "result"}.\nText: "${text}"`;
    const aiTextResult = await callGeminiAI(textPrompt);

    if (aiTextResult && aiTextResult.translation) {
      return res.json({ translation: aiTextResult.translation });
    }

    const backupResult = await translateBackup(text, fromLang, toLang);
    res.json({ translation: backupResult });

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
