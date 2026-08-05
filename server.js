// Lug'at Daftarcha — Telegram Mini App backend
const express = require('express');
const path = require('path');
const TelegramBot = require('node-telegram-bot-api');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// So'z turkumlarini o'zbekchaga o'girish
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

// 2. Free Dictionary API orqali ma'lumot olish
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

// 3. Aqlli va Xilma-xil gap tuzuvchi zaxira funksiyasi
function generateSmartExample(word, pos) {
  const w = word.toLowerCase();

  const templates = {
    "ot": [
      `He turned on the ${w} to light up the quiet room.`,
      `We bought a new decorative ${w} for our living room.`,
      `She placed the ${w} carefully on the wooden table.`,
      `The technician fixed the broken ${w} yesterday afternoon.`
    ],
    "fe'l": [
      `They decided to ${w} behind the building to surprise him.`,
      `It is not easy to ${w} such an important detail from everyone.`,
      `She tried her best to ${w} her true feelings during the interview.`,
      `Please ${w} your bags under the seat before the journey.`
    ],
    "sifat": [
      `She couldn't stop laughing at that funny and ${w} situation.`,
      `Don't be so ${w}, everything will turn out completely fine.`,
      `It was a slightly ${w} mistake, but nobody seemed to mind.`,
      `He gave a very ${w} answer that confused all his friends.`
    ],
    "ravish": [
      `She finished the difficult task ${w} and left the office early.`,
      `He listened ${w} to the teacher's explanation during class.`,
      `The car moved ${w} through the narrow mountain road.`
    ]
  };

  const list = templates[pos] || [
    `Understanding how to use "${w}" correctly will improve your vocabulary.`,
    `She used the word "${w}" in a very creative way during her speech.`,
    `We discussed the importance of "${w}" in our English lesson today.`
  ];

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
          "uzbek": "Short Uzbek translation",
          "transcription": "IPA pronunciation, e.g. [/sɪli/]",
          "partOfSpeech": "Part of speech in Uzbek (fe'l, ot, sifat, ravish)",
          "example": "A realistic, intermediate level English sentence using the word."
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
        console.warn('Gemini AI zaxiraga o\'tdi');
      }
    }

    // 2-USUL: Google Translate + Free Dictionary API + Smart Example Generator
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
