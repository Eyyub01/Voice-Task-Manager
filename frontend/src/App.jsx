import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useVoiceSocket } from './hooks/voiceSocket';
import './App.css';

const API_BASE = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000';

function formatDateTime(iso) {
  const d = new Date(iso);
  return d.toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function groupTasksByDay(tasks) {
  const groups = {};
  const sorted = [...tasks].sort(
    (a, b) => new Date(a.due_datetime) - new Date(b.due_datetime)
  );
  for (const task of sorted) {
    const d = new Date(task.due_datetime);
    const key = d.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    });
    if (!groups[key]) groups[key] = [];
    groups[key].push(task);
  }
  return groups;
}

function Waveform({ active }) {
  return (
    <div className={`waveform ${active ? 'waveform--active' : ''}`} aria-hidden="true">
      {Array.from({ length: 5 }).map((_, i) => (
        <span key={i} className="waveform__bar" style={{ animationDelay: `${i * 0.1}s` }} />
      ))}
    </div>
  );
}

function TranscriptBubble({ role, text }) {
  if (!text) return null;
  return (
    <div className={`bubble bubble--${role}`}>
      <span className="bubble__label">{role === 'user' ? 'You' : 'Assistant'}</span>
      <p className="bubble__text">{text}</p>
    </div>
  );
}

function TaskCard({ task }) {
  const isPast = new Date(task.due_datetime) < new Date();
  return (
    <div className={`task-card ${task.status === 'completed' ? 'task-card--done' : ''} ${isPast && task.status !== 'completed' ? 'task-card--overdue' : ''}`}>
      <div className="task-card__title">{task.title}</div>
      <div className="task-card__time">{formatDateTime(task.due_datetime)}</div>
      <span className={`task-card__badge task-card__badge--${task.status}`}>
        {task.status}
      </span>
    </div>
  );
}

export default function App() {
  const [tasks, setTasks] = useState([]);
  const [transcript, setTranscript] = useState([]);
  const [aiDraft, setAiDraft] = useState('');
  const [userSpeaking, setUserSpeaking] = useState(false);
  const [aiSpeaking, setAiSpeaking] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const transcriptEndRef = useRef(null);

  const fetchTasks = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/tasks`);
      if (res.ok) setTasks(await res.json());
    } catch (_) {}
  }, []);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcript, aiDraft]);

  const handleEvent = useCallback((data) => {
    const type = data.type;

    if (type === 'user_speaking') {
      setUserSpeaking(true);
      setAiSpeaking(false);
      setAiDraft('');
    } else if (type === 'user_transcript') {
      setUserSpeaking(false);
      if (data.text?.trim()) {
        setTranscript(prev => [...prev, { role: 'user', text: data.text.trim() }]);
      }
    } else if (type === 'ai_transcript_delta') {
      setAiSpeaking(true);
      setAiDraft(prev => prev + data.delta);
    } else if (type === 'ai_audio_done') {
      setAiSpeaking(false);
      setAiDraft(prev => {
        if (prev.trim()) {
          setTranscript(t => [...t, { role: 'assistant', text: prev.trim() }]);
        }
        return '';
      });
    } else if (type === 'response.output_audio_transcript.done') {
      setAiSpeaking(false);
      if (data.transcript?.trim()) {
        setAiDraft('');
        setTranscript(t => {
          const last = t[t.length - 1];
          if (last?.role === 'assistant') {
            return [...t.slice(0, -1), { role: 'assistant', text: data.transcript.trim() }];
          }
          return [...t, { role: 'assistant', text: data.transcript.trim() }];
        });
      }
    } else if (type === 'conversation.item.done' && data.item?.role === 'user') {
      setUserSpeaking(false);
      const audioContent = data.item?.content?.find(c => c.type === 'input_audio');
      if (audioContent?.transcript?.trim()) {
        setTranscript(prev => [...prev, { role: 'user', text: audioContent.transcript.trim() }]);
      }
    } else if (type === 'task_list_updated') {
      fetchTasks();
    } else if (type === 'disconnected') {
      setStatusMsg('Disconnected. Click the mic to reconnect.');
      setUserSpeaking(false);
      setAiSpeaking(false);
    } else if (type === 'error') {
      setStatusMsg(data.message || 'An error occurred.');
    }
  }, [fetchTasks]);

  const { status, connect, disconnect } = useVoiceSocket(handleEvent);

  const isConnected = status === 'connected';
  const isConnecting = status === 'connecting';

  const handleMicClick = () => {
    if (isConnected) {
      disconnect();
    } else if (!isConnecting) {
      setStatusMsg('');
      connect();
    }
  };

  const taskGroups = groupTasksByDay(tasks);

  return (
    <div className="app">
      <header className="app__header">
        <h1 className="app__title">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/>
            <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
            <line x1="12" y1="19" x2="12" y2="22"/>
          </svg>
          Voice Task Manager
        </h1>
        <span className={`status-pill status-pill--${status}`}>
          {status === 'connected' ? 'Live' : status === 'connecting' ? 'Connecting…' : 'Offline'}
        </span>
      </header>

      <main className="app__body">
        <section className="voice-panel" aria-label="Voice interface">
          <div className="voice-panel__orb-area">
            <button
              className={`mic-btn ${isConnected ? 'mic-btn--active' : ''} ${isConnecting ? 'mic-btn--connecting' : ''}`}
              onClick={handleMicClick}
              aria-label={isConnected ? 'Disconnect microphone' : 'Connect microphone'}
              disabled={isConnecting}
            >
              {isConnecting ? (
                <svg className="spin" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
                </svg>
              ) : (
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/>
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                  <line x1="12" y1="19" x2="12" y2="22"/>
                </svg>
              )}
            </button>

            <Waveform active={userSpeaking || aiSpeaking} />

            <p className="voice-panel__hint">
              {isConnecting && 'Connecting…'}
              {isConnected && userSpeaking && 'Listening…'}
              {isConnected && aiSpeaking && 'Speaking…'}
              {isConnected && !userSpeaking && !aiSpeaking && 'Ready — just speak'}
              {!isConnected && !isConnecting && 'Tap the mic to start'}
            </p>
          </div>

          {statusMsg && (
            <div className="status-msg" role="alert">{statusMsg}</div>
          )}

          <div className="transcript" aria-live="polite" aria-label="Conversation transcript">
            {transcript.length === 0 && !aiDraft && (
              <p className="transcript__empty">Your conversation will appear here.</p>
            )}
            {transcript.map((msg, i) => (
              <TranscriptBubble key={i} role={msg.role} text={msg.text} />
            ))}
            {aiDraft && (
              <TranscriptBubble role="assistant" text={aiDraft} />
            )}
            <div ref={transcriptEndRef} />
          </div>
        </section>

        <section className="tasks-panel" aria-label="Task list">
          <div className="tasks-panel__header">
            <h2>Tasks</h2>
            <span className="tasks-panel__count">{tasks.length}</span>
          </div>

          {tasks.length === 0 ? (
            <p className="tasks-panel__empty">No tasks yet. Ask the assistant to create one.</p>
          ) : (
            Object.entries(taskGroups).map(([day, dayTasks]) => (
              <div key={day} className="task-group">
                <h3 className="task-group__label">{day}</h3>
                {dayTasks.map(task => (
                  <TaskCard key={task.id} task={task} />
                ))}
              </div>
            ))
          )}
        </section>
      </main>
    </div>
  );
}
