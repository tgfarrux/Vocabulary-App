// Lug'at Daftarcha — Telegram Mini App backend
const express = require('express');
const path = require('path');
const TelegramBot = require('node-telegram-bot-api');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Haqiqiy foydalanuvchilar bazasi
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

// 2. Google Translate serve
async function translateWithGoogle(text, fromLang, toLang) {
  try {
    const url = `[https://translate.googleapis.com/translate_a/single?client=gtx&sl=$](https://translate.googleapis.com/translate_a/single?client=gtx&sl=$){fromLang}&tl=${toLang}&dt=t&q=${encodeURIComponent(text)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Google Translate xatosi');
    const data = await res.json();
    if (data && data[0]) {
      return data[0].map(item => item[0]).join('');
    }
  } catch (e) {
    console.error('Google Translate error:', e.message);
  }
  return text;
}

// 3. Free Dictionary API
async function fetchFreeDictionaryData(word) {
  try {
    const res = await fetch(`[https://api.dictionaryapi.dev/api/v2/entries/en/$](https://api.dictionaryapi.dev/api/v2/entries/en/$){encodeURIComponent(word)}`);
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

// 4. Tabiiy va Real Gaplar Yasovchi generator (Zaxira uchun)
function generateSmartExample(word, pos) {
  const w = word.toLowerCase();

  const nounTemplates = [
    `The overall ${w} of this design looks very modern and clean.`,
    `We need to examine the main ${w} before making a final decision.`,
    `She found a unique ${w} that fits perfectly into our new project.`,
    `The instructor explained how this ${w} functions in practice.`
  ];

  const verbTemplates = [
    `They decided to ${w} their true intentions from the audience.`,
    `It took us a while to learn how to ${w} this complex task.`,
    `She always tries to ${w} her work with great care and attention.`,
    `Please make sure to ${w} all important files before leaving.`
  ];

  const adjTemplates = [
    `The team achieved a remarkably ${w} result after weeks of effort.`,
    `Everyone was surprised by her ${w} response during the meeting.`,
    `It was a very ${w} moment that brought a smile to everyone's face.`,
    `He gave a detailed and ${w} explanation of the entire situation.`
  ];

  const advTemplates = [
    `She completed the entire project ${w} without making any mistakes.`,
    `The situation changed ${w} over the course of a few days.`,
    `He handled the unexpected challenge ${w} and kept his calm.`
  ];

  let list = nounTemplates;
  if (pos === "fe'l") list = verbTemplates;
  else if (pos === "sifat") list = adjTemplates;
  else if (pos === "ravish") list = advTemplates;

  return list[Math.floor(Math.random() * list.length)];
}

// MAIN API: So'z tarjima qilish va gap tuzish
app.post('/api/translate', async (req, res) => {
  try {
    const word = (req.body && req.body.word || '').trim();
    const direction = (req.body && req.body.direction === 'uz-en') ? 'uz-en' : 'en-uz';

    if (!word) return res.status(400).json({ error: "So'z yuborilmadi" });

    // 1-USUL: Gemini AI (Markdown tozalash bilan)
    if (GEMINI_API_KEY) {
      try {
        const promptText = `
        Target Word: "${word}"
        Direction: ${direction === 'uz-en' ? 'Uzbek to English' : 'English to Uzbek'}.

        Return ONLY a raw JSON object (no markdown, no backticks):
        {
          "en": "English word in lowercase",
          "uzbek": "Short Uzbek translation",
          "transcription": "IPA pronunciation in brackets, e.g. [/ˈpæt.ən/]",
          "partOfSpeech": "Correct part of speech in Uzbek (fe'l, ot, sifat, ravish)",
          "example": "A natural, realistic intermediate B1-B2 level English sentence using the target word naturally in real context."
        }
        `;

        const geminiUrl = `[https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=$](https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=$){GEMINI_API_KEY}`;
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
          
          // Markdown kod bloklarini tozalash (Xatolikni oldini oladi)
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
        console.warn('Gemini AI parse xatosi, zaxiraga o\'tdi:', aiErr.message);
      }
    }

    // 2-USUL: Lug'at bazasi + Aqlli Zaxira
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

    const ttsUrl = `[https://translate.google.com/translate_tts?ie=UTF-8&q=$](https://translate.google.com/translate_tts?ie=UTF-8&q=$){encodeURIComponent(text)}&tl=${lang}&client=tw-ob`;
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
