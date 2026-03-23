// routes/detect.js  VERSION=4.0-ACCURATE
const express = require("express");
const router  = express.Router();
const Groq    = require("groq-sdk");
const axios   = require("axios");
const cheerio = require("cheerio");
const multer  = require("multer");
const { v4: uuidv4 } = require("uuid");
const db = require("../db");

console.log("detect.js VERSION 4.0-ACCURATE loaded");

let pdf;
try { pdf = require("pdf-parse"); } catch(e) {}

let groqClient;
function getGroqClient() {
  const key = (process.env.GROQ_API_KEY || "").trim();
  if (!key || key.includes("_your_")) {
    const err = new Error("GROQ_API_KEY is missing. Add it to backend/.env");
    err.status = 503;
    throw err;
  }
  if (!groqClient) groqClient = new Groq({ apiKey: key });
  return groqClient;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    const ok = [
      "text/plain","text/html","text/markdown","application/pdf",
      "application/msword","application/octet-stream","binary/octet-stream",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ].includes(file.mimetype) || /\.(txt|md|html|htm|pdf)$/i.test(file.originalname);
    ok ? cb(null, true) : cb(new Error("Unsupported file type."));
  },
});

function parseGoogleUrl(url) {
  const docsMatch = url.match(/docs\.google\.com\/document\/d\/([a-zA-Z0-9_-]+)/);
  if (docsMatch) return {
    type: "gdoc", id: docsMatch[1],
    urls: [
      "https://docs.google.com/document/d/" + docsMatch[1] + "/export?format=txt",
      "https://docs.google.com/document/d/" + docsMatch[1] + "/export?format=html",
    ],
  };
  const driveMatch = url.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (driveMatch) return {
    type: "gdrive", id: driveMatch[1],
    urls: [
      "https://docs.google.com/document/d/" + driveMatch[1] + "/export?format=txt",
      "https://drive.google.com/uc?export=download&id=" + driveMatch[1],
    ],
  };
  const openMatch = url.match(/drive\.google\.com\/open\?id=([a-zA-Z0-9_-]+)/);
  if (openMatch) return {
    type: "gdrive", id: openMatch[1],
    urls: [
      "https://docs.google.com/document/d/" + openMatch[1] + "/export?format=txt",
      "https://drive.google.com/uc?export=download&id=" + openMatch[1],
    ],
  };
  const sheetsMatch = url.match(/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (sheetsMatch) return {
    type: "gsheets", id: sheetsMatch[1],
    urls: ["https://docs.google.com/spreadsheets/d/" + sheetsMatch[1] + "/export?format=csv"],
  };
  const slidesMatch = url.match(/docs\.google\.com\/presentation\/d\/([a-zA-Z0-9_-]+)/);
  if (slidesMatch) return {
    type: "gslides", id: slidesMatch[1],
    urls: ["https://docs.google.com/presentation/d/" + slidesMatch[1] + "/export?format=txt"],
  };
  return null;
}

async function fetchGoogleContent(info) {
  const headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Accept": "text/html,text/plain,*/*",
  };
  for (const tryUrl of info.urls) {
    try {
      console.log("[GOOGLE] Trying: " + tryUrl);
      const res = await axios.get(tryUrl, {
        timeout: 25000, headers,
        maxContentLength: 5 * 1024 * 1024,
        maxRedirects: 10,
        validateStatus: function(s) { return s < 400; },
      });
      const ct = (res.headers["content-type"] || "").toLowerCase();
      let text = "";
      if (ct.includes("text/plain")) {
        text = String(res.data).replace(/\r\n/g, "\n").trim();
      } else if (ct.includes("text/html") || ct.includes("text/csv")) {
        const $ = cheerio.load(res.data);
        const title = $("title").text().toLowerCase();
        if (title.includes("sign in") || title.includes("login") || title.includes("consent")) {
          console.warn("[GOOGLE] Hit login page, trying next...");
          continue;
        }
        $("script,style,head,nav,footer,form,button").remove();
        text = $("body").text().replace(/\s+/g, " ").trim();
      } else if (typeof res.data === "string") {
        text = res.data.replace(/\s+/g, " ").trim();
      }
      const words = text.split(/\s+/).filter(Boolean).length;
      console.log("[GOOGLE] Got " + words + " words");
      if (words >= 20) {
        if (text.toLowerCase().includes("sign in to google") && text.length < 500) continue;
        return text;
      }
    } catch (e) {
      const status = e.response ? e.response.status : null;
      console.warn("[GOOGLE] Failed: " + (status || e.message));
      if (status === 403) {
        throw new Error("Google Drive access denied (403).\n\nFix: Open the Google Doc > Share > 'Anyone with the link can view' > Save.");
      }
    }
  }
  throw new Error("Could not read this Google Drive link.\n\nMake sure:\n1. Shared as 'Anyone with the link can view'\n2. It is a Google Doc/Sheet/Slide\n\nOr paste the text directly into the Text tab.");
}

function extractTextFromCheerio($) {
  $("script,style,noscript,iframe,nav,header,footer,aside,form,button").remove();
  var clean = function(t) { return t.replace(/\s+/g, " ").trim(); };
  var wc = function(t) { return t.split(/\s+/).filter(Boolean).length; };
  var selectors = ["article","main","[role='main']",".post-content",".entry-content","#content","#main-content"];
  for (var i = 0; i < selectors.length; i++) {
    try {
      var text = clean($(selectors[i]).first().text());
      if (wc(text) >= 30) return text;
    } catch(_) {}
  }
  var paras = $("p").map(function(_, el) { return $(el).text().trim(); }).get().filter(function(t) { return t.length > 40; });
  if (paras.length >= 3) return paras.join(" ").trim();
  return clean($("body").text());
}

async function extractFromUrl(url) {
  const googleInfo = parseGoogleUrl(url);
  if (googleInfo) {
    console.log("[GOOGLE] Detected " + googleInfo.type);
    return fetchGoogleContent(googleInfo);
  }
  const HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept": "text/html,application/xhtml+xml,*/*",
  };
  let html = null;
  try {
    const res = await axios.get(url, { timeout: 15000, headers: HEADERS, maxContentLength: 5*1024*1024, maxRedirects: 5 });
    html = res.data;
  } catch (e) {
    const s = e.response && e.response.status;
    if (s === 401 || s === 403 || s === 429) throw new Error("Site blocked access (HTTP " + s + "). Paste the text instead.");
  }
  if (!html || html.length < 300) {
    try {
      const r = await axios.get("https://api.allorigins.win/get?url=" + encodeURIComponent(url), { timeout: 12000 });
      html = (r.data && r.data.contents) || "";
    } catch(e) {}
  }
  if (!html || html.length < 300) throw new Error("Could not fetch this URL. Paste the text into the Text tab instead.");
  const $ = cheerio.load(html);
  const text = extractTextFromCheerio($);
  if (text.split(/\s+/).filter(Boolean).length < 20) throw new Error("Not enough text at this URL. Try the Text tab.");
  return text;
}

// ─── IMPROVED SYSTEM PROMPT ───────────────────────────────────────────────────
// Detailed signal-based prompt for much higher accuracy

const SYSTEM_PROMPT = `You are an expert AI text detection system. Your job is to analyze writing patterns to determine if text was written by a human or generated by an AI (like ChatGPT, Claude, Gemini, etc).

Analyze these specific signals carefully:

AI-GENERATED SIGNALS (raise ai_probability):
- Uniform sentence lengths with little variation (AI writes consistently, humans vary)
- Overused transition phrases: "Furthermore", "Moreover", "In conclusion", "It is worth noting", "It is important to", "In today's world", "In summary"
- Hedging language: "may", "might", "could potentially", "it appears that", "one might argue"
- Passive voice overuse
- No personal anecdotes, emotions, or first-person opinions
- Perfect grammar, zero typos or informal language
- Generic vague examples with no specific names, dates, or places
- Repetitive paragraph structure (intro, 3 points, conclusion every time)
- Unnecessary restatements and summaries
- Corporate buzzwords without substance
- Balanced "on one hand / on the other hand" without taking a position
- Overly comprehensive coverage of a topic (AI tries to cover everything)
- Starts paragraphs with "The", "This", "It is", "One of the"

HUMAN-WRITTEN SIGNALS (lower ai_probability):
- Mixed short and long sentences — natural rhythm variation
- Personal pronouns with real opinions ("I think", "honestly", "I've noticed")
- Typos, contractions, slang, informal grammar
- Specific real examples: names of people, specific dates, actual places
- Tangents, digressions, incomplete thoughts
- Strong opinions or emotional reactions
- Domain-specific jargon used naturally
- Abrupt topic changes or conversational asides
- Self-correction ("well actually...", "wait, I mean...")
- Humor, sarcasm, or personality

SCORING:
- 0-20: Almost certainly human
- 21-40: Likely human with minor AI patterns
- 41-59: Mixed or uncertain — possibly AI-edited human text
- 60-79: Likely AI-generated
- 80-100: Almost certainly AI-generated

Return ONLY a raw JSON object. No markdown. No code fences. No explanation. Start with { and end with }.

JSON structure:
{"verdict":"AI","ai_probability":85,"confidence":"High","summary":"Two sentence summary of key findings.","signals":{"perplexity":{"score":70,"label":"low perplexity"},"burstiness":{"score":20,"label":"very uniform sentences"},"vocabulary":{"score":65,"label":"formal academic tone"},"sentence_structure":{"score":80,"label":"repetitive paragraph structure"}},"ai_flags":["overused transitions","no personal voice","uniform sentence length"],"human_flags":[],"suspicious_phrases":["it is worth noting","furthermore","in conclusion"],"word_count":250,"sentence_count":12,"avg_sentence_length":20.8}

verdict = "AI" or "Human" or "Mixed"
ai_probability = integer 0-100
confidence = "Low" or "Medium" or "High" or "Very High"
Output ONLY the JSON. Nothing before or after.`;

const SYSTEM_PROMPT_IMAGE = `You are an expert AI image forensic analyst. Your task is to examine an uploaded image and determine if it was created by an AI image generator (Midjourney, DALL-E, Stable Diffusion) or if it is a real photograph/human-created digital art.

Look for these AI GENERATION SIGNALS:
- "Uncanny" skin textures (too smooth, plastic-like, or overly detailed in weird ways)
- Lighting inconsistencies (shadows going the wrong way, light sources that don't exist)
- Structural errors in complex objects: hands (too many fingers), eyes (mismatched pupils), hair (merging into skin)
- Background "blur" that looks unnatural or inconsistent
- Nonsensical text or symbols in the background
- Perfect symmetry in organic objects where it shouldn't be
- Repeating patterns or "checkerboard" artifacts in solid colors

JSON structure to return:
{"verdict":"AI","ai_probability":90,"confidence":"High","summary":"Analysis summary highlighting visual artifacts.","signals":{"texture":{"score":85,"label":"unnatural smoothness"},"lighting":{"score":70,"label":"inconsistent shadows"},"details":{"score":95,"label":"malformed limb structures"}},"ai_flags":["plastic skin","mismatched eyes"],"human_flags":[],"suspicious_phrases":[],"word_count":0,"sentence_count":0,"avg_sentence_length":0}

Return ONLY raw JSON.`;

function extractJson(raw) {
  if (!raw || !raw.trim()) throw new Error("Empty response from model.");
  try { return JSON.parse(raw.trim()); } catch(_) {}
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) { try { return JSON.parse(fenced[1].trim()); } catch(_) {} }
  const start = raw.indexOf("{");
  const end   = raw.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try { return JSON.parse(raw.slice(start, end + 1)); } catch(_) {}
  }
  console.error("[GROQ] Cannot parse JSON. Raw:\n" + raw.slice(0, 400));
  throw new Error("Could not parse detection result. Please try again.");
}

// ─── Pre-compute text stats for better accuracy ───────────────────────────────
function computeTextStats(text) {
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
  const words     = text.trim().split(/\s+/).filter(Boolean);

  // Sentence length variance (low = AI, high = human)
  const lengths   = sentences.map(s => s.trim().split(/\s+/).length);
  const avgLen    = lengths.reduce((a,b) => a+b, 0) / (lengths.length || 1);
  const variance  = lengths.reduce((a,b) => a + Math.pow(b - avgLen, 2), 0) / (lengths.length || 1);

  // AI phrase detection
  const aiPhrases = [
    "furthermore","moreover","in conclusion","it is worth noting",
    "it is important to","in today's world","in summary","on the other hand",
    "it is essential","needless to say","as mentioned above",
    "in this regard","it goes without saying","at the end of the day",
  ];
  const foundPhrases = aiPhrases.filter(p => text.toLowerCase().includes(p));

  // Passive voice count (rough)
  const passiveMatches = text.match(/\b(is|are|was|were|been|being)\s+\w+ed\b/gi) || [];

  return {
    wordCount:       words.length,
    sentenceCount:   sentences.length,
    avgSentenceLen:  Math.round(avgLen * 10) / 10,
    sentenceVariance: Math.round(variance * 10) / 10,
    aiPhrasesFound:  foundPhrases,
    passiveCount:    passiveMatches.length,
  };
}

async function callGroqImageDetection(buffer) {
  const base64 = buffer.toString("base64");
  const completion = await getGroqClient().chat.completions.create({
    model: "llama-3.2-11b-vision-preview",
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: SYSTEM_PROMPT_IMAGE },
          { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64}` } }
        ]
      }
    ],
    temperature: 0.0,
    max_tokens: 500,
  });

  const raw = (completion.choices[0] && completion.choices[0].message && completion.choices[0].message.content) || "";
  return extractJson(raw);
}

async function callGroqImageDetection(buffer) {
  const base64 = buffer.toString("base64");
  const completion = await getGroqClient().chat.completions.create({
    model: "llama-3.2-11b-vision-preview",
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: SYSTEM_PROMPT_IMAGE },
          { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64}` } }
        ]
      }
    ],
    temperature: 0.0,
    max_tokens: 500,
  });

  const raw = (completion.choices[0] && completion.choices[0].message && completion.choices[0].message.content) || "";
  return extractJson(raw);
}

async function callGroqDetection(text) {
  if (!text || text.trim().length < 50) throw new Error("Text is too short for reliable AI detection.");

  // Compute stats to include in prompt — helps model focus
  const stats = computeTextStats(text);

  // Use up to 4000 chars for better accuracy
  const truncated = text.slice(0, 4000);
  console.log("[GROQ] Analyzing " + truncated.length + " chars, " + stats.wordCount + " words");

  // Include pre-computed stats in the user message to guide the model
  const userMessage = [
    "Analyze this text for AI detection:",
    "",
    "PRE-COMPUTED STATS (use these to guide your analysis):",
    "- Word count: " + stats.wordCount,
    "- Sentence count: " + stats.sentenceCount,
    "- Avg sentence length: " + stats.avgSentenceLen + " words",
    "- Sentence length variance: " + stats.sentenceVariance + " (low variance = AI)",
    "- AI transition phrases found: " + (stats.aiPhrasesFound.length > 0 ? stats.aiPhrasesFound.join(", ") : "none"),
    "- Passive voice instances: " + stats.passiveCount,
    "",
    "TEXT TO ANALYZE:",
    truncated,
  ].join("\n");

  const completion = await getGroqClient().chat.completions.create({
    model: "llama-3.3-70b-versatile",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user",   content: userMessage },
    ],
    temperature: 0.0,  // Zero temp = deterministic, more consistent
    max_tokens: 800,
    // NO response_format — avoids Groq 400 json_validate_failed error
  });

  const raw = (completion.choices[0] && completion.choices[0].message && completion.choices[0].message.content) || "";
  console.log("[GROQ] Response: " + raw.slice(0, 200));

  const result = extractJson(raw);

  // Merge our pre-computed stats into result for accuracy
  result.word_count     = result.word_count     || stats.wordCount;
  result.sentence_count = result.sentence_count || stats.sentenceCount;
  result.avg_sentence_length = result.avg_sentence_length || stats.avgSentenceLen;

  // Boost ai_probability if we found many AI phrases (model sometimes undershoots)
  if (stats.aiPhrasesFound.length >= 3 && result.ai_probability < 60) {
    result.ai_probability = Math.min(result.ai_probability + 15, 100);
    result.suspicious_phrases = [...(result.suspicious_phrases || []), ...stats.aiPhrasesFound].slice(0, 5);
  }

  return result;
}

async function extractFromFile(buffer, mimetype, originalname) {
  if (mimetype === "application/pdf" || originalname.toLowerCase().endsWith(".pdf")) {
    if (!pdf) throw new Error("PDF parser unavailable.");
    const result = await pdf(buffer);
    const text = (result.text || "").replace(/\s+/g," ").trim();
    if (text.length < 50) throw new Error("No readable text in PDF.");
    return text;
  }
  return buffer.toString("utf-8");
}

async function saveScan(id, source_type, source_ref, text, result, ip) {
  await db.saveScan({
    id, source_type, source_ref,
    input_text: text.slice(0, 500), word_count: result.word_count,
    verdict: result.verdict, ai_prob: result.ai_probability,
    confidence: result.confidence, summary: result.summary,
    signals: result.signals, ai_flags: result.ai_flags,
    human_flags: result.human_flags, phrases: result.suspicious_phrases || [],
    ip_address: ip,
  });
}

router.post("/text", async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: "text is required" });
    if (text.trim().split(/\s+/).length < 20) return res.status(400).json({ error: "Minimum 20 words required." });
    const result = await callGroqDetection(text.trim());
    const id = uuidv4();
    await saveScan(id, "text", null, text.trim(), result, req.ip);
    res.json({ id, ...result });
  } catch (err) {
    console.error("[text]", err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post("/url", async (req, res) => {
  try {
    const { url, text: preExtracted } = req.body;
    if (!url || !/^https?:\/\/.+/.test(url)) return res.status(400).json({ error: "Valid URL required" });
    const text = (preExtracted && preExtracted.trim().split(/\s+/).length >= 20)
      ? preExtracted.trim()
      : await extractFromUrl(url);
    const result = await callGroqDetection(text);
    const id = uuidv4();
    await saveScan(id, "url", url, text, result, req.ip);
    res.json({ id, url, ...result });
  } catch (err) {
    console.error("[url]", err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post("/file", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    const text = await extractFromFile(req.file.buffer, req.file.mimetype, req.file.originalname);
    if (!text || text.split(/\s+/).length < 20) return res.status(400).json({ error: "File has too little text." });
    const result = await callGroqDetection(text.trim());
    const id = uuidv4();
    await saveScan(id, "file", req.file.originalname, text.trim(), result, req.ip);
    res.json({ id, filename: req.file.originalname, ...result });
  } catch (err) {
    console.error("[file]", err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post("/image", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No image uploaded" });
    const result = await callGroqImageDetection(req.file.buffer);
    const id = uuidv4();
    await saveScan(id, "image", req.file.originalname, "Image Analysis", result, req.ip);
    res.json({ id, ...result });
  } catch (err) {
    console.error("[image]", err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;