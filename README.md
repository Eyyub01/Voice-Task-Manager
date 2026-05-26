# Voice Task Manager

A voice-controlled task manager built with React + FastAPI + OpenAI Realtime API.

## Features

- Create, read, update, and delete tasks entirely through voice
- Real-time speech-to-text and text-to-speech
- Context-aware AI conversations with interruption support
- Confirmation before destructive actions
- SQLite database for task storage

## Tech Stack

- **Frontend:** React 19 + Vite + Web Audio API
- **Backend:** FastAPI + WebSockets
- **AI:** OpenAI Realtime API (`gpt-realtime`)
- **Database:** SQLite + SQLAlchemy

## Local Setup

### 1. Clone the repo

```bash
git clone https://github.com/YOUR_USERNAME/voice-task-manager.git
cd voice-task-manager
```

### 2. Configure environment

```bash
cp .env.example .env
```

Add your OpenAI API key to `.env`:

```
OPENAI_API_KEY=sk-proj-...
```

### 3. Backend

```bash
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

### 4. Frontend

```bash
cd frontend
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173), click the mic, and start speaking.

---

## Deployment

### Backend → Render

1. Go to [render.com](https://render.com) and create a new **Web Service**
2. Connect your GitHub repo
3. Set **Build Command:** `pip install -r requirements.txt`
4. Set **Start Command:** `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
5. Add environment variable: `OPENAI_API_KEY` = your key
6. Deploy — backend URL: `https://voice-task-manager-mb76.onrender.com`

### Frontend → Vercel

1. Go to [vercel.com](https://vercel.com) and import your GitHub repo
2. Set **Root Directory** to `frontend`
3. Add environment variable: `VITE_API_URL` = `https://voice-task-manager-mb76.onrender.com`
4. Deploy — frontend URL: `https://voice-task-manager-4nla.vercel.app`

---

## Example voice commands

| Say | Result |
|---|---|
| "Create a task for team sync tomorrow at 10 AM" | Task created |
| "What are my tasks for today?" | Conversational summary |
| "Change the LinkedIn task to 6 PM" | Task updated |
| "Delete the 10 AM task" | Asks for confirmation first |
| "Create three tasks: gym at 7, sync at 9, LinkedIn at 11" | All three created |

## Live Demo

**[https://voice-task-manager-4nla.vercel.app](https://voice-task-manager-4nla.vercel.app)**

> Note: The backend runs on Render's free tier and may take ~50 seconds to wake up on first visit.


