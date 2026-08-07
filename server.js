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

// Leaderboard fayli bilan ishlash
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

// Leaderboard API
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

// Zaxira Tarjima xizmati (Google Translate / MyMemory)
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

// FAQAT GEMINI 3.5 FLASH LITE MODELI ISHLATILADI
async function callGeminiAI(promptText) {
  if (!GEMINI_API_KEY) return null;
  const modelName = 'gemini-3.5-flash-lite';
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${GEMINI_API_KEY}`;
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
  } catch (e) {
    console.warn('Gemini AI error:', e.message);
  }
  return null;
}

// MAIN API: Ko'p tilli so'z tarjimasi
app.post('/api/translate', async (req, res) => {
  try {
    const word = (req.body && req.body.word || '').trim();
    const fromLang = (req.body && req.body.fromLang) || 'en';
    const toLang = (req.body && req.body.toLang) || 'uz';

    if (!word) return res.status(400).json({ error: "So'z yuborilmadi" });

    const aiPrompt = `
    Source Word: "${word}"
    Source Language Code: "${fromLang}"
    Target Language Code: "${toLang}"

    Return ONLY a JSON object with this exact structure:
    {
      "sourceWord": "Original word in source language",
      "translatedWord": "Accurate translation in target language",
      "transcription": "IPA pronunciation if applicable or brackets",
      "partOfSpeech": "Short part of speech (noun, verb, adj, etc.)",
      "example": "A high quality sentence in target/source context using this word naturally."
    }
    `;

    const aiResult = await callGeminiAI(aiPrompt);

    if (aiResult && aiResult.sourceWord && aiResult.translatedWord) {
      return res.json({
        sourceWord: aiResult.sourceWord,
        translatedWord: aiResult.translatedWord,
        example: aiResult.example || `Example with ${aiResult.sourceWord}`,
        transcription: aiResult.transcription || `[${word}]`,
        partOfSpeech: aiResult.partOfSpeech || "so'z"
      });
    }

    // Backup Translate
    const backupTrans = await translateBackup(word, fromLang, toLang);
    res.json({
      sourceWord: word,
      translatedWord: backupTrans,
      example: `Practice using "${word}" in your study.`,
      transcription: `[${word}]`,
      partOfSpeech: "so'z"
    });

  } catch (e) {
    console.error('Server xatosi:', e.message);
    res.status(500).json({ error: 'Serverda xatolik yuz berdi' });
  }
});

// Ko'p tilli Katta Matn Tarjimasi
app.post('/api/translate-text', async (req, res) => {
  try {
    const text = (req.body && req.body.text || '').trim();
    const fromLang = (req.body && req.body.fromLang) || 'en';
    const toLang = (req.body && req.body.toLang) || 'uz';

    if (!text) return res.status(400).json({ error: 'Matn yuborilmadi' });

    const textPrompt = `Translate this text from language "${fromLang}" to language "${toLang}". Return ONLY JSON: {"translation": "translated string"}.\nText: "${text}"`;
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
    const lang = (req.query.lang || 'en').toString();
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
