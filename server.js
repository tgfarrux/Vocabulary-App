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
  const models = ['gemini-3.5-flash-lite'];
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
        rawText = rawText.replace(/```json/gi, '').replace(/
