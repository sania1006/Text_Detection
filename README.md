# 🔬 DetectAI Super Champion — AI Content Detector

> **Hackathon Project** — Detect whether text or images were created by AI or a human.  
> Supports **Text**, **URL**, **File Upload**, and **Image Analysis**.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/SAMPRIT-NANDI/DETECT-AI-SUPER-CHAMPION)

---

## ✨ Features

| Feature | Description |
|---|---|
| 📝 **Text Detection** | Paste text (≥ 20 words) for AI probability analysis |
| 🌐 **URL Detection** | Extract and analyze content from any public URL |
| 📄 **File Upload** | Upload `.txt`, `.md`, `.html`, `.pdf` files for analysis |
| 🖼️ **Image Detection** | Upload images (JPG, PNG, WebP) to detect AI-generated visuals |
| 📊 **Statistics Dashboard** | View aggregated scan results and trends |
| 📋 **Scan History** | Browse, view details, and delete past scans |
| 🔒 **Authentication** | Clerk-powered sign-in/sign-up with JWT-secured API |
| ⚡ **Real-time Analysis** | Powered by Groq's ultra-fast LPU inference |

---

## 🏗️ Architecture

```
DETECT-AI-SUPER-CHAMPION/
├── api/
│   └── index.js              # Vercel serverless entry point
├── backend/
│   ├── server.js             # Express server with CORS, rate limiting, Helmet
│   ├── db.js                 # SQLite via sql.js (pure JS, no native deps)
│   ├── routes/
│   │   ├── detect.js         # POST /api/detect/text|url|file|image
│   │   └── history.js        # GET/DELETE /api/history, stats
│   ├── .env.example
│   ├── Dockerfile
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── App.jsx           # Root with Clerk auth + routing
│   │   ├── main.jsx          # Entry with ClerkProvider
│   │   ├── index.css         # Dark theme design system
│   │   ├── utils/api.js      # Axios API helpers + URL extractors
│   │   ├── components/
│   │   │   ├── ClerkApiSetup.jsx  # JWT interceptor
│   │   │   ├── Navbar.jsx
│   │   │   ├── Results.jsx        # Rich detection results UI
│   │   │   └── UI.jsx             # Shared: Gauge, SignalBar, Badge, etc.
│   │   └── pages/
│   │       ├── Detect.jsx         # Main detection page (all 4 modes)
│   │       ├── History.jsx        # Scan history list
│   │       ├── ScanDetail.jsx     # Single scan detail view
│   │       └── Stats.jsx          # Statistics dashboard
│   ├── vite.config.js
│   └── package.json
├── vercel.json               # Vercel deployment config
├── docker-compose.yml        # Docker production setup
├── package.json              # Root scripts (install:all, dev, build)
└── README.md
```

---

## 🚀 Quick Start (Local Development)

### Prerequisites
- **Node.js** ≥ 18
- **Groq API Key** — [Get one free at console.groq.com](https://console.groq.com)
- **Clerk Keys** — [Get from clerk.com](https://clerk.com)

### 1. Clone and install

```bash
git clone https://github.com/SAMPRIT-NANDI/DETECT-AI-SUPER-CHAMPION.git
cd DETECT-AI-SUPER-CHAMPION
npm run install:all
```

### 2. Configure environment

**Backend** (`backend/.env`):
```env
PORT=4001
GROQ_API_KEY=gsk_your_key_here
FRONTEND_URL=http://localhost:5174
CLERK_PUBLISHABLE_KEY=pk_test_your_key
CLERK_SECRET_KEY=sk_test_your_key
```

**Frontend** (`frontend/.env`):
```env
VITE_CLERK_PUBLISHABLE_KEY=pk_test_your_key
```

### 3. Run

```bash
npm run dev     # Starts both backend (port 4001) and frontend (port 5174)
```

---

## 🐳 Docker (Production)

```bash
cp backend/.env.example backend/.env
# Edit backend/.env with your keys

docker-compose up --build
```

---

## 🌐 Deploy to Vercel

1. Push code to GitHub
2. Import project in [Vercel](https://vercel.com)
3. Set environment variables in Vercel dashboard:
   - `GROQ_API_KEY`
   - `CLERK_PUBLISHABLE_KEY`
   - `CLERK_SECRET_KEY`
4. Deploy — Vercel uses `vercel.json` to serve the frontend and API

---

## 🔌 API Reference

### Text Detection
```http
POST /api/detect/text
Content-Type: application/json

{ "text": "Your text here (≥ 20 words)..." }
```

### URL Detection
```http
POST /api/detect/url
Content-Type: application/json

{ "url": "https://example.com/article" }
```

### File Detection
```http
POST /api/detect/file
Content-Type: multipart/form-data

file: <upload>   (.txt, .md, .html, .pdf)
```

### Image Detection
```http
POST /api/detect/image
Content-Type: multipart/form-data

file: <upload>   (.jpg, .jpeg, .png, .webp)
```

### History & Stats
```http
GET    /api/history?page=1&limit=20
GET    /api/history/:id
DELETE /api/history/:id
GET    /api/history/stats
GET    /api/health
```

---

## 🗄️ Database Schema

SQLite database managed by `sql.js` (pure JavaScript, no native binaries).

**scans** table:
| Column | Type | Description |
|---|---|---|
| id | TEXT (UUID) | Primary key |
| created_at | DATETIME | Timestamp |
| source_type | TEXT | `text`, `url`, `file`, or `image` |
| source_ref | TEXT | URL or filename |
| input_text | TEXT | First 500 chars of input |
| word_count | INTEGER | Total words |
| verdict | TEXT | `AI`, `Human`, or `Mixed` |
| ai_prob | REAL | 0–100 probability |
| confidence | TEXT | Low / Medium / High / Very High |
| summary | TEXT | Analysis summary |
| signals | TEXT | JSON object with signal scores |
| ai_flags | TEXT | JSON array of AI indicators |
| human_flags | TEXT | JSON array of human indicators |
| phrases | TEXT | JSON array of flagged phrases |
| ip_address | TEXT | Client IP |

---

## ⚙️ Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | React 18, Vite, React Router v6 |
| **Auth** | Clerk (sign-in/sign-up + JWT) |
| **Backend** | Node.js, Express 4 |
| **Database** | SQLite via sql.js (pure JS) |
| **AI Engine** | Groq API (Llama 4 Scout for vision, Llama 3.3 70B for text) |
| **Web Scraping** | Axios + Cheerio |
| **File Uploads** | Multer (10MB limit) |
| **Security** | Helmet, express-rate-limit, CORS |
| **Deployment** | Vercel (serverless) / Docker + Nginx |

---

## 🔬 How Detection Works

### Text Analysis (Dual-Engine)
1. **Statistical Analysis** — Burstiness, vocabulary richness, transition density, sentence variance, AI vocabulary scoring
2. **LLM Analysis** — Three Groq model passes with weighted ensemble scoring
3. **Final Verdict** — Combined statistical + LLM scores → AI / Human / Mixed

### Image Analysis
- Uses **Llama 4 Scout** (multimodal) via Groq to analyze visual patterns
- Detects: over-smoothing, unnatural lighting, artifact patterns, symmetry anomalies

---

## 🔒 Security

- **Rate limiting**: 30 requests/minute per IP on `/api/detect`
- **File size cap**: 10MB max upload
- **Text truncation**: Input capped at 8000 characters
- **CORS**: Restricted to configured `FRONTEND_URL`
- **Helmet**: Secure HTTP headers
- **Auth**: All API routes protected with Clerk JWT verification

---

## 👥 Team

**SAMPRIT NANDI** — Full-Stack Developer  
Built for Hackathon 2026

---

## 📝 License

MIT — See [LICENSE](./LICENSE)
