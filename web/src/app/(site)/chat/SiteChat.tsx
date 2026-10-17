'use client'

// FayFort AI chat help on every www.fayfort.com page that uses the site layout (LANDED has its own layout and is
// untouched). Owner decisions: "Talk to a person" offers Join free and WhatsApp; the conversation carries into the
// member chat on joining; a welcome bubble appears automatically on desktop only.

import { FormEvent, useCallback, useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { MessageCircle, Minus, Send, X } from 'lucide-react'
import { FayfortLogo } from '@/app/components/brand/FayfortLogo'
import { JOIN_URL, SIGN_IN_URL, WHATSAPP_URL } from '@/config/contact'
import './site-chat.css'

export const SITE_CHAT_API = (process.env.NEXT_PUBLIC_FAYFORT_API_URL || 'https://api.fayfort.com').replace(/\/$/, '')
export const WELCOME = "Hi, I'm FayFort AI 👋 Ask me anything about sourcing from China."
export const STARTERS = ['How does it work?', 'Is it free to join?', 'Do you ship to my country?', 'Talk to a person']
const TOKEN_KEY = 'ff_site_chat_token'
const VIEW_KEY = 'ff_site_chat_view'
const BUBBLE_KEY = 'ff_site_chat_bubble_seen'
const BUBBLE_DELAY_MS = 5000

export type ChatAction = 'join' | 'whatsapp'
export type ChatMessage = { id: string; sender_type: 'visitor' | 'assistant'; content: string; actions?: ChatAction[] }
type View = 'closed' | 'open' | 'minimised'

function read(storage: 'local' | 'session', key: string): string {
  try {
    return (storage === 'local' ? window.localStorage : window.sessionStorage).getItem(key) || ''
  } catch {
    return ''
  }
}
function write(storage: 'local' | 'session', key: string, value: string) {
  try {
    ;(storage === 'local' ? window.localStorage : window.sessionStorage).setItem(key, value)
  } catch {
    /* Private windows: the chat still works for this page view. */
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = read('local', TOKEN_KEY)
  const response = await fetch(`${SITE_CHAT_API}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(token ? { 'X-Visitor-Token': token } : {}), ...(init.headers || {}) },
  })
  if (!response.ok) throw new Error(`Chat request failed (${response.status})`)
  return response.json() as Promise<T>
}

/** Join free / Sign in with a one-time code, so the member chat opens with this conversation. */
async function accountLink(base: string): Promise<string> {
  if (!read('local', TOKEN_KEY)) return base
  try {
    const { code } = await call<{ code: string | null }>('/public/site-chat/handoff', { method: 'POST' })
    return code ? `${base}?site_chat=${encodeURIComponent(code)}` : base
  } catch {
    return base
  }
}

export default function SiteChat() {
  const pathname = usePathname()
  const [view, setView] = useState<View>('closed')
  const [enabled, setEnabled] = useState(true)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [loaded, setLoaded] = useState(false)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [problem, setProblem] = useState('')
  const [bubble, setBubble] = useState(false)
  const [opening, setOpening] = useState<'' | 'join' | 'signin'>('')
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Remember open / minimised while the visitor moves between pages or reloads.
  useEffect(() => {
    const saved = read('session', VIEW_KEY) as View
    if (saved === 'open' || saved === 'minimised') setView(saved)
  }, [])
  useEffect(() => write('session', VIEW_KEY, view), [view])

  const load = useCallback(async () => {
    try {
      const data = await call<{ enabled: boolean; messages: ChatMessage[] }>('/public/site-chat')
      setEnabled(data.enabled !== false)
      setMessages(data.messages || [])
    } catch {
      /* The chat still opens; sending will report a problem if the API is down. */
    } finally {
      setLoaded(true)
    }
  }, [])
  useEffect(() => {
    if (view !== 'closed' && !loaded) void load()
  }, [view, loaded, load])

  // Welcome bubble: desktop only, once per visit, a few seconds after the page loads, if the chat hasn't been opened.
  useEffect(() => {
    if (view !== 'closed' || read('session', BUBBLE_KEY)) return
    if (!window.matchMedia?.('(min-width: 1024px) and (hover: hover)').matches) return
    const timer = window.setTimeout(() => {
      setBubble(true)
      write('session', BUBBLE_KEY, '1')
    }, BUBBLE_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [view])

  useEffect(() => {
    const list = listRef.current
    if (list) list.scrollTop = list.scrollHeight
  }, [messages.length, sending, view])

  useEffect(() => {
    if (view === 'open') inputRef.current?.focus({ preventScroll: true })
  }, [view])

  function open() {
    setBubble(false)
    write('session', BUBBLE_KEY, '1')
    setView('open')
  }

  async function send(text: string) {
    const content = text.trim()
    if (!content || sending) return
    setDraft('')
    setProblem('')
    setSending(true)
    const pending: ChatMessage = { id: `local-${Date.now()}`, sender_type: 'visitor', content }
    setMessages((current) => [...current, pending])
    try {
      const result = await call<{ visitor_token: string; visitor_message: ChatMessage; reply: ChatMessage }>(
        '/public/site-chat/messages',
        { method: 'POST', body: JSON.stringify({ content, page: pathname || '/' }) },
      )
      if (result.visitor_token) write('local', TOKEN_KEY, result.visitor_token)
      setMessages((current) => [...current.filter((m) => m.id !== pending.id), result.visitor_message, result.reply])
    } catch {
      setMessages((current) => current.filter((m) => m.id !== pending.id))
      setDraft(content)
      setProblem("That didn't send. Check your connection and try again.")
    } finally {
      setSending(false)
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    void send(draft)
  }

  async function go(kind: 'join' | 'signin') {
    setOpening(kind)
    window.location.href = await accountLink(kind === 'join' ? JOIN_URL : SIGN_IN_URL)
  }

  const visitorSpoke = messages.some((m) => m.sender_type === 'visitor')
  const last = [...messages].reverse().find((m) => m.sender_type === 'assistant')

  if (view === 'minimised')
    return (
      <div className="site-chat-root">
        <button type="button" className="site-chat-minibar" onClick={() => setView('open')} aria-label="Open the FayFort AI chat">
          <span className="site-chat-avatar"><FayfortLogo variant="on-dark" /></span>
          <span className="site-chat-minibar-text">
            <strong>FayFort AI</strong>
            <small>{last ? last.content : 'Ask me anything about sourcing from China.'}</small>
          </span>
          <span className="site-chat-icon-button" aria-hidden="true"><MessageCircle size={16} /></span>
        </button>
      </div>
    )

  if (view === 'closed')
    return (
      <div className="site-chat-root">
        {bubble && (
          <div className="site-chat-bubble" role="status">
            <button type="button" className="site-chat-bubble-text" onClick={open}>{WELCOME}</button>
            <button type="button" className="site-chat-bubble-close" aria-label="Dismiss" onClick={() => setBubble(false)}>
              <X size={14} />
            </button>
          </div>
        )}
        <button type="button" className="site-chat-launcher" onClick={open} aria-label="Chat with FayFort AI">
          <FayfortLogo variant="on-dark" />
        </button>
      </div>
    )

  return (
    <div className="site-chat-root">
      <section
        className="site-chat-panel"
        role="dialog"
        aria-label="FayFort AI chat"
        onKeyDown={(event) => event.key === 'Escape' && setView('minimised')}
      >
        <header className="site-chat-head">
          <span className="site-chat-avatar"><FayfortLogo variant="on-dark" /></span>
          <div>
            <strong>FayFort AI</strong>
            <small>Usually answers in seconds</small>
          </div>
          <button type="button" className="site-chat-icon-button" aria-label="Minimise chat" onClick={() => setView('minimised')}>
            <Minus size={18} />
          </button>
          <button type="button" className="site-chat-icon-button" aria-label="Close chat" onClick={() => setView('closed')}>
            <X size={18} />
          </button>
        </header>

        <div className="site-chat-messages" ref={listRef} aria-live="polite">
          <p className="site-chat-msg from-ai">{WELCOME}</p>
          {messages.map((message) => (
            <div key={message.id} className="site-chat-turn">
              <p className={`site-chat-msg ${message.sender_type === 'visitor' ? 'from-visitor' : 'from-ai'}`}>{message.content}</p>
              {message.sender_type === 'assistant' && !!message.actions?.length && (
                <div className="site-chat-actions">
                  {message.actions.includes('join') && (
                    <>
                      <button type="button" className="site-chat-join" disabled={!!opening} onClick={() => void go('join')}>
                        {opening === 'join' ? 'Opening…' : 'Join free'}
                      </button>
                      <button type="button" className="site-chat-link" disabled={!!opening} onClick={() => void go('signin')}>
                        I have an account
                      </button>
                    </>
                  )}
                  {message.actions.includes('whatsapp') && (
                    <a className="site-chat-whatsapp" href={WHATSAPP_URL} target="_blank" rel="noreferrer">WhatsApp us</a>
                  )}
                </div>
              )}
            </div>
          ))}
          {sending && (
            <p className="site-chat-typing" role="status">
              <span className="site-chat-typing-mark"><FayfortLogo animated /></span>
              FayFort AI is typing…
            </p>
          )}
          {!visitorSpoke && !sending && enabled && (
            <div className="site-chat-starters" aria-label="Suggested questions">
              {STARTERS.map((starter) => (
                <button key={starter} type="button" onClick={() => void send(starter)}>{starter}</button>
              ))}
            </div>
          )}
        </div>

        {problem && <p className="site-chat-problem" role="alert">{problem}</p>}
        {enabled ? (
          <form className="site-chat-composer" onSubmit={submit}>
            <textarea
              ref={inputRef}
              value={draft}
              rows={1}
              maxLength={1000}
              placeholder="Ask about sourcing, shipping, joining…"
              aria-label="Message FayFort AI"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  void send(draft)
                }
              }}
            />
            <button type="submit" aria-label="Send" disabled={!draft.trim() || sending}>
              <Send size={18} />
            </button>
          </form>
        ) : (
          <div className="site-chat-off">
            <p>FayFort AI is resting right now.</p>
            <div className="site-chat-actions">
              <button type="button" className="site-chat-join" onClick={() => void go('join')}>Join free</button>
              <a className="site-chat-whatsapp" href={WHATSAPP_URL} target="_blank" rel="noreferrer">WhatsApp us</a>
            </div>
          </div>
        )}
        <p className="site-chat-note">AI answers can be wrong. Never share payment details in chat.</p>
      </section>
    </div>
  )
}
