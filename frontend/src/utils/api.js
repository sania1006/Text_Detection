// utils/api.js  VERSION=3.0-FINAL
import axios from "axios";

const api = axios.create({
  baseURL: "/api",
  timeout: 60000,
  headers: { "Content-Type": "application/json" },
});

function timedFetch(url, opts = {}, ms = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { ...opts, signal: ctrl.signal }).finally(() => clearTimeout(t));
}

function isGoogleUrl(url) {
  return /drive\.google\.com|docs\.google\.com/.test(url);
}

function getGoogleIds(url) {
  const docId = url.match(/docs\.google\.com\/document\/d\/([a-zA-Z0-9_-]+)/)?.[1];
  if (docId) return { type: "doc", id: docId };
  const driveId =
    url.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/)?.[1] ||
    url.match(/drive\.google\.com\/open\?id=([a-zA-Z0-9_-]+)/)?.[1];
  if (driveId) return { type: "drive", id: driveId };
  const sheetId = url.match(/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/)?.[1];
  if (sheetId) return { type: "sheet", id: sheetId };
  const slideId = url.match(/docs\.google\.com\/presentation\/d\/([a-zA-Z0-9_-]+)/)?.[1];
  if (slideId) return { type: "slide", id: slideId };
  return null;
}

function getGoogleExportUrls(info) {
  const { type, id } = info;
  if (type === "doc") return [
    `https://docs.google.com/document/d/${id}/pub`,
    `https://docs.google.com/document/d/${id}/export?format=txt`,
    `https://docs.google.com/document/d/${id}/export?format=html`,
  ];
  if (type === "drive") return [
    `https://docs.google.com/document/d/${id}/pub`,
    `https://docs.google.com/document/d/${id}/export?format=txt`,
    `https://drive.google.com/uc?export=download&id=${id}`,
  ];
  if (type === "sheet") return [
    `https://docs.google.com/spreadsheets/d/${id}/export?format=csv`,
    `https://docs.google.com/spreadsheets/d/${id}/pub?output=csv`,
  ];
  if (type === "slide") return [
    `https://docs.google.com/presentation/d/${id}/export?format=txt`,
    `https://docs.google.com/presentation/d/${id}/pub?output=txt`,
  ];
  return [];
}

function parseHtml(html) {
  try {
    const doc = new DOMParser().parseFromString(html, "text/html");
    ["script","style","noscript","iframe","nav","header","footer","aside","form","button"].forEach(s => {
      try { doc.querySelectorAll(s).forEach(e => e.remove()); } catch(_){}
    });
    const wc    = t => t ? t.split(/\s+/).filter(Boolean).length : 0;
    const clean = t => t ? t.replace(/\s+/g," ").trim() : "";
    for (const sel of ["article","main","[role='main']",".post-content",".entry-content",".article-body","#content","#main-content"]) {
      try {
        const el = doc.querySelector(sel);
        if (el) { const t = clean(el.textContent); if (wc(t) >= 30) return t; }
      } catch(_) {}
    }
    let best = null, bestScore = 0;
    doc.querySelectorAll("div,section").forEach(el => {
      const p = el.querySelectorAll("p").length;
      const s = p * 100 + (el.textContent || "").length;
      if (p >= 3 && s > bestScore) { bestScore = s; best = el; }
    });
    if (best) { const t = clean(best.textContent); if (wc(t) >= 30) return t; }
    const paras = Array.from(doc.querySelectorAll("p"))
      .map(e => (e.textContent||"").replace(/\s+/g," ").trim())
      .filter(t => t.length > 40);
    if (paras.length >= 3) return paras.join(" ").trim();
    const body = doc.body ? clean(doc.body.textContent) : "";
    return wc(body) >= 20 ? body : null;
  } catch(e) { return null; }
}

async function fetchGoogleViaProxy(googleExportUrl, onProgress) {
  const proxies = [
    {
      name: "allorigins",
      run: async () => {
        const r = await timedFetch(
          `https://api.allorigins.win/get?url=${encodeURIComponent(googleExportUrl)}`,
          { headers: { Accept: "application/json" } }, 15000
        );
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const d = await r.json();
        if (d.status?.http_code === 302 || d.status?.http_code === 401) throw new Error("Google requires login");
        return d.contents || "";
      },
    },
    {
      name: "corsproxy.io",
      run: async () => {
        const r = await timedFetch(`https://corsproxy.io/?${encodeURIComponent(googleExportUrl)}`, {}, 15000);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      },
    },
    {
      name: "codetabs",
      run: async () => {
        const r = await timedFetch(`https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(googleExportUrl)}`, {}, 15000);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      },
    },
  ];

  for (const proxy of proxies) {
    try {
      onProgress && onProgress(`Fetching via ${proxy.name}...`);
      const content = await proxy.run();
      if (!content || content.length < 100) continue;
      if (
        content.includes("accounts.google.com") ||
        (content.includes("Sign in") && content.includes("Google")) ||
        content.includes("ServiceLogin")
      ) {
        console.warn(`[GOOGLE] ${proxy.name} got login redirect`);
        continue;
      }
      let text = content;
      if (content.trim().startsWith("<") || content.includes("<!DOCTYPE")) {
        text = parseHtml(content) || content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      }
      const wc = text ? text.split(/\s+/).filter(Boolean).length : 0;
      if (wc >= 20) return text;
    } catch(e) {
      console.warn(`[GOOGLE] ${proxy.name} failed:`, e.message);
    }
  }
  return null;
}

async function fetchGoogleContent(url, onProgress) {
  const info = getGoogleIds(url);
  if (!info) return null;
  const exportUrls = getGoogleExportUrls(info);
  for (const exportUrl of exportUrls) {
    onProgress && onProgress(`Trying Google export...`);
    const text = await fetchGoogleViaProxy(exportUrl, onProgress);
    if (text) return text;
  }
  return null;
}

async function fetchViaProxy(url, onProgress) {
  const strategies = [
    {
      name: "allorigins",
      run: async () => {
        const r = await timedFetch(`https://api.allorigins.win/get?url=${encodeURIComponent(url)}`, { headers: { Accept: "application/json" } }, 12000);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return (await r.json()).contents || "";
      },
    },
    {
      name: "corsproxy.io",
      run: async () => {
        const r = await timedFetch(`https://corsproxy.io/?${encodeURIComponent(url)}`, {}, 12000);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      },
    },
    {
      name: "codetabs",
      run: async () => {
        const r = await timedFetch(`https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`, {}, 12000);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      },
    },
    {
      name: "direct",
      run: async () => {
        const r = await timedFetch(url, { headers: { Accept: "text/html" } }, 12000);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      },
    },
  ];

  for (let i = 0; i < strategies.length; i++) {
    const s = strategies[i];
    onProgress && onProgress(`Trying method ${i + 1}/${strategies.length} (${s.name})...`);
    try {
      const html = await s.run();
      if (!html || html.length < 300) continue;
      const text = parseHtml(html);
      const wc = text ? text.split(/\s+/).filter(Boolean).length : 0;
      if (text && wc >= 20) {
        onProgress && onProgress(`Extracted ${wc} words via ${s.name}`);
        return text;
      }
    } catch(e) { console.warn(`[${s.name}]`, e.message); }
  }
  return null;
}

export const detectUrl = async (url, onProgress) => {
  onProgress && onProgress("Contacting server...");

  // Step 1: server-side
  try {
    const res = await api.post("/detect/url", { url });
    return res.data;
  } catch (err) {
    const msg = (err.response?.data?.error || err.message || "").toLowerCase();
    const isFetchError =
      err.response?.status === 500 ||
      msg.includes("fetch") || msg.includes("block") ||
      msg.includes("enough") || msg.includes("readable") ||
      msg.includes("could not") || msg.includes("short") ||
      msg.includes("forbidden") || msg.includes("403") ||
      msg.includes("network") || msg.includes("denied");
    if (!isFetchError) throw err;
    console.log("[URL] Server failed, trying client-side...");
  }

  // Step 2: Google Drive via CORS proxies
  if (isGoogleUrl(url)) {
    onProgress && onProgress("Detected Google Drive — fetching via proxy...");
    const text = await fetchGoogleContent(url, onProgress);
    if (text) {
      onProgress && onProgress("Analyzing with AI...");
      const res = await api.post("/detect/url", { url, text });
      return res.data;
    }
    const e = new Error(
      "Could not access this Google Drive file.\n\n" +
      "Fix: Open the file → Share → Change to\n" +
      "'Anyone with the link' → Viewer\n\n" +
      "Then paste the link again.\n\n" +
      "Or copy the text and paste it in the Text tab."
    );
    e.extractionFailed = true;
    throw e;
  }

  // Step 3: normal URL
  onProgress && onProgress("Trying browser extraction...");
  const text = await fetchViaProxy(url, onProgress);
  if (text) {
    onProgress && onProgress("Analyzing with AI...");
    const res = await api.post("/detect/url", { url, text });
    return res.data;
  }

  const e = new Error("EXTRACTION_FAILED");
  e.extractionFailed = true;
  throw e;
};

export const detectText = (text) =>
  api.post("/detect/text", { text }).then(r => r.data);

export const detectFile = (file) => {
  const form = new FormData();
  form.append("file", file);
  return api.post("/detect/file", form, {
    headers: { "Content-Type": "multipart/form-data" },
  }).then(r => r.data);
};

export const detectImage = (file) => {
  const form = new FormData();
  form.append("image", file);
  return api.post("/detect/image", form, {
    headers: { "Content-Type": "multipart/form-data" },
  }).then(r => r.data);
};

export const getHistory  = (p = 1, l = 20) => api.get(`/history?page=${p}&limit=${l}`).then(r => r.data);
export const getScanById = (id) => api.get(`/history/${id}`).then(r => r.data);
export const deleteScan  = (id) => api.delete(`/history/${id}`).then(r => r.data);
export const getStats    = ()   => api.get("/history/stats").then(r => r.data);
export const checkHealth = ()   => api.get("/health").then(r => r.data);

export default api;
