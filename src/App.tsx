import { useEffect, useRef, useState } from 'react'
import { ChatBubble, type ChatRole, type ReferenceData } from './components/ChatBubble'
import './App.css'
import logo from './assets/InvCloud.jpg'

type ChatMessage = {
  id: string
  role: ChatRole
  content: string
  references?: ReferenceData
}

type SessionMessage = {
  id?: string
  role: ChatRole
  content?: string
  reference?: unknown
  created_at?: number
}

type ChatSession = {
  id: string
  name?: string
  update_time?: number
  update_date?: string
  create_time?: number
  create_date?: string
  messages?: SessionMessage[]
}

type CompletionResponse = {
  code: number
  message?: string
  data?: {
    answer?: string
    reference?: unknown
    session_id?: string
  }
}

const API_BASE_URL = 'http://192.168.50.112'
const CHAT_ID = '91a6e01ceba111f0ae6966a74df2239d'
const API_TOKEN = 'ragflow-bQVbOM5dsmkgl4slLlerDZSe6ftqsezW9C8iroJw44M'
const COMPLETIONS_URL = `${API_BASE_URL}/api/v1/chats/${CHAT_ID}/completions`
const SESSIONS_URL = `${API_BASE_URL}/api/v1/chats/${CHAT_ID}/sessions`

const createId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [inputValue, setInputValue] = useState('')
  const [stream, setStream] = useState(false)
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isSessionLoading, setIsSessionLoading] = useState(false)
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const messagesRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void loadSessions()
  }, [])

  useEffect(() => {
    if (messagesRef.current) {
      messagesRef.current.scrollTop = messagesRef.current.scrollHeight
    }
  }, [messages, isLoading])

  const ensureToken = () => {
    if (!API_TOKEN.trim()) {
      setError('API token is required. Set API_TOKEN in App.tsx.')
      return false
    }
    return true
  }

  const getAuthHeaders = () => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${API_TOKEN}`,
  })

  const normalizeReference = (reference: unknown): ReferenceData | undefined => {
    if (!reference) return undefined
    if (Array.isArray(reference)) {
      return reference.length > 0 ? { chunks: reference as ReferenceData['chunks'] } : undefined
    }
    if (typeof reference === 'object') {
      const normalized = reference as ReferenceData
      if (Array.isArray(normalized.chunks) && normalized.chunks.length > 0) {
        return normalized
      }
    }
    return undefined
  }

  const buildMessagesFromSession = (session?: ChatSession | null): ChatMessage[] => {
    if (!session?.messages) return []
    return session.messages
      .filter((message) => message.content && message.content.trim().length > 0)
      .map((message, index) => ({
        id: message.id ?? `${session.id}-${index}`,
        role: message.role,
        content: message.content ?? '',
        references: normalizeReference(message.reference),
      }))
  }

  const selectSession = (session: ChatSession | null) => {
    if (!session) {
      setActiveSessionId(null)
      setMessages([])
      return
    }
    setActiveSessionId(session.id)
    setMessages(buildMessagesFromSession(session))
  }

  const formatSessionTimestamp = (session: ChatSession) => {
    const timestamp = session.update_time ?? session.create_time
    if (timestamp) {
      return new Date(timestamp).toLocaleString()
    }
    return session.update_date ?? session.create_date ?? ''
  }

  const loadSessions = async (preferredSessionId?: string) => {
    if (!ensureToken()) return
    setIsSessionLoading(true)
    try {
      const response = await fetch(SESSIONS_URL, {
        headers: getAuthHeaders(),
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(
          `Failed to load sessions (${response.status})${errorText ? `: ${errorText}` : ''}`
        )
      }

      const responseJSON = (await response.json()) as {
        code: number
        message?: string
        data?: ChatSession[]
      }

      if (responseJSON.code !== 0) {
        throw new Error(responseJSON.message ?? 'Failed to load sessions.')
      }

      const sessionList = Array.isArray(responseJSON.data) ? responseJSON.data : []
      setSessions(sessionList)

      const resolvedActiveId = preferredSessionId ?? activeSessionId
      if (resolvedActiveId && sessionList.some((session) => session.id === resolvedActiveId)) {
        setActiveSessionId(resolvedActiveId)
        return
      }

      if (preferredSessionId) {
        return
      }

      selectSession(sessionList[0] ?? null)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load sessions.'
      setError(message)
    } finally {
      setIsSessionLoading(false)
    }
  }

  const initializeSession = async () => {
    if (!ensureToken()) return null
    try {
      const response = await fetch(SESSIONS_URL, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ name: '新会话' }),
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(
          `Session initialization failed (${response.status})${errorText ? `: ${errorText}` : ''}`
        )
      }

      const responseJSON = (await response.json()) as {code: number, message?: string, data?: ChatSession}
      if (responseJSON.code !== 0 || !responseJSON.data) {
        throw new Error(responseJSON.message ?? 'Session initialization failed.')
      }

      const answer = responseJSON.data?.messages ?? []
      const sessionId = responseJSON.data.id
      if (!sessionId) {
        throw new Error('Session ID is missing from the response.')
      }

      setActiveSessionId(sessionId)
      setMessages(
        answer.length > 0
          ? [{ id: createId(), role: 'assistant', content: answer[0].content ?? '' }]
          : []
      )

      await loadSessions(sessionId)
      return sessionId
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to initialize session.'
      setError(message)
      return null
    }
  }

  const handleSend = async () => {
    if (isLoading) return

    const trimmedMessage = inputValue.trim()
    if (!trimmedMessage) return
    if (!ensureToken()) return

    setIsLoading(true)
    setError(null)

    let sessionId = activeSessionId
    if (!sessionId) {
      sessionId = await initializeSession()
      if (!sessionId) {
        setIsLoading(false)
        return
      }
    }

    setMessages((prev) => [...prev, { id: createId(), role: 'user', content: trimmedMessage }])
    setInputValue('')

    try {
      const payload = {
        question: trimmedMessage,
        stream,
        session_id: sessionId,
      }

      const response = await fetch(COMPLETIONS_URL, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(
          `Request failed (${response.status})${errorText ? `: ${errorText}` : ''}`
        )
      }

      if (stream) {
        if (!response.body) {
          throw new Error('Streaming response body is missing.')
        }

        const assistantId = createId()
        setMessages((prev) => [...prev, { id: assistantId, role: 'assistant', content: '' }])

        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        let currentText = ''
        let latestReference: ReferenceData | undefined
        let latestSessionId: string | undefined

        const appendChunk = (chunk: string) => {
          if (!chunk) return
          setMessages((prev) =>
            prev.map((message) =>
              message.id === assistantId
                ? { ...message, content: `${message.content}${chunk}` }
                : message
            )
          )
        }

        const processPayload = (payload: unknown) => {
          if (!payload) return
          if (typeof payload === 'string') {
            appendChunk(payload)
            return
          }

          const payloadObject = payload as {
            data?: {
              answer?: string
              reference?: unknown
              session_id?: string
            }
            answer?: string
            reference?: unknown
            session_id?: string
            choices?: Array<{
              delta?: { content?: string }
              message?: { content?: string }
              text?: string
            }>
          }

          const data = payloadObject.data ?? payloadObject
          const answer =
            data?.answer ??
            payloadObject.answer ??
            payloadObject.choices?.[0]?.delta?.content ??
            payloadObject.choices?.[0]?.message?.content ??
            payloadObject.choices?.[0]?.text ??
            ''

          const references = normalizeReference(data?.reference ?? payloadObject.reference)
          if (references) {
            latestReference = references
          }

          if (typeof data?.session_id === 'string') {
            latestSessionId = data.session_id
          }

          if (typeof answer === 'string' && answer.length > 0) {
            let nextChunk = answer
            if (answer.startsWith(currentText)) {
              nextChunk = answer.slice(currentText.length)
              currentText = answer
            } else {
              currentText = `${currentText}${answer}`
            }
            appendChunk(nextChunk)
          }
        }

        const processLine = (line: string) => {
          const trimmed = line.trim()
          if (!trimmed) return
          if (trimmed.startsWith('event:')) return

          const payloadLine = trimmed.startsWith('data:')
            ? trimmed.slice(5).trim()
            : trimmed
          if (!payloadLine) return
          if (payloadLine === '[DONE]') return

          try {
            processPayload(JSON.parse(payloadLine))
          } catch {
            processPayload(payloadLine)
          }
        }

        while (true) {
          const { value, done } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split(/\r?\n/)
          buffer = lines.pop() ?? ''
          lines.forEach(processLine)
        }

        if (buffer.trim()) {
          processLine(buffer)
        }

        if (latestReference) {
          setMessages((prev) =>
            prev.map((message) =>
              message.id === assistantId ? { ...message, references: latestReference } : message
            )
          )
        }

        if (latestSessionId && latestSessionId !== activeSessionId) {
          setActiveSessionId(latestSessionId)
        }
      } else {
        const responseJSON = (await response.json()) as CompletionResponse
        if (responseJSON.code !== 0) {
          throw new Error(responseJSON.message ?? 'Request failed.')
        }

        const answer = responseJSON.data?.answer ?? ''
        if (!answer.trim()) {
          throw new Error('No response content returned from the API.')
        }

        const references = normalizeReference(responseJSON.data?.reference)
        const responseSessionId = responseJSON.data?.session_id
        if (responseSessionId && responseSessionId !== activeSessionId) {
          setActiveSessionId(responseSessionId)
        }

        setMessages((prev) => [
          ...prev,
          { id: createId(), role: 'assistant', content: answer, references },
        ])
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Request failed.'
      setError(message)
    } finally {
      setIsLoading(false)
    }
  }

  const handleCreateSession = async () => {
    if (isLoading) return
    setIsLoading(true)
    setError(null)
    try {
      await initializeSession()
    } finally {
      setIsLoading(false)
    }
  }

  const handleDeleteSession = async (sessionId: string) => {
    if (isLoading) return
    if (!ensureToken()) return

    setDeletingSessionId(sessionId)
    setError(null)

    try {
      const response = await fetch(SESSIONS_URL, {
        method: 'DELETE',
        headers: getAuthHeaders(),
        body: JSON.stringify({ ids: [sessionId] }),
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(
          `Failed to delete session (${response.status})${errorText ? `: ${errorText}` : ''}`
        )
      }

      const responseJSON = (await response.json()) as {
        code: number
        message?: string
      }

      if (responseJSON.code !== 0) {
        throw new Error(responseJSON.message ?? 'Failed to delete session.')
      }

      await loadSessions()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete session.'
      setError(message)
    } finally {
      setDeletingSessionId(null)
    }
  }

  return (
    <div className="app">
      <header className="app__header">
        <h1>知识库 Chatbot</h1>
      </header>

      <main className="app__main">
        <section className="session-sidebar">
          <img src={logo} alt="logo" />
          <div className="session-header">
            <h2>Sessions</h2>
            <button
              type="button"
              className="icon-button"
              onClick={handleCreateSession}
              disabled={isLoading || isSessionLoading}
              aria-label="Create new session"
            >
              +
            </button>
          </div>
          <div className="session-list">
            {isSessionLoading && <div className="session-empty">Loading sessions...</div>}
            {!isSessionLoading && sessions.length === 0 && (
              <div className="session-empty">No sessions yet. Create one to start chatting.</div>
            )}
            {!isSessionLoading &&
              sessions.map((session) => {
                const isActive = session.id === activeSessionId
                return (
                  <div
                    key={session.id}
                    className={`session-item ${isActive ? 'session-item--active' : ''}`}
                  >
                    <button
                      type="button"
                      className="session-item__button"
                      onClick={() => selectSession(session)}
                      disabled={isLoading}
                    >
                      <span className="session-item__title">{session.name ?? 'New session'}</span>
                      <span className="session-item__meta">{formatSessionTimestamp(session)}</span>
                    </button>
                    <button
                      type="button"
                      className="session-item__delete"
                      onClick={() => void handleDeleteSession(session.id)}
                      disabled={isLoading || deletingSessionId === session.id}
                    >
                      {deletingSessionId === session.id ? 'Deleting...' : 'Delete'}
                    </button>
                  </div>
                )
              })}
          </div>
        </section>

        {/* Chat Panel */}
        <section className="chat-panel">
          <div className="chat-messages" ref={messagesRef}>
            {messages.length === 0 && (
              <div className="empty-state">Select a session or start a new one.</div>
            )}

            {messages.map((message) => (
              <ChatBubble
                key={message.id + message.role}
                role={message.role}
                content={message.content}
                references={message.references}
                documentBaseUrl={API_BASE_URL}
              />
            ))}

            {isLoading && <div className="typing-indicator">Assistant is typing...</div>}
          </div>

          <form
            className="chat-input"
            onSubmit={(event) => {
              event.preventDefault()
              void handleSend()
            }}
          >
            <textarea
              value={inputValue}
              onChange={(event) => setInputValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  void handleSend()
                }
              }}
              placeholder={isLoading ? '正在等待AI回复...' : '输入消息并按回车键发送...'}
              rows={3}
              disabled={isLoading}
            />
            <div className="chat-actions">
              <label className="toggle toggle--compact">
                <span>流式输出: </span>
                <button
                  type="button"
                  className={`toggle__button ${stream ? 'toggle__button--on' : ''}`}
                  onClick={() => setStream((prev) => !prev)}
                  disabled={isLoading}
                  aria-pressed={stream}
                >
                  <span className="toggle__knob" />
                </button>
              </label>
              <button type="submit" disabled={isLoading || inputValue.trim().length === 0}>
                {isLoading ? 'Sending...' : 'Send'}
              </button>
            </div>
          </form>

          {error && <div className="status status--error">{error}</div>}
        </section>
      </main>
    </div>
  )
}

export default App
