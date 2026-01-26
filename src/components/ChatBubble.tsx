import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

export type ChatRole = 'user' | 'assistant'

export interface ReferenceChunk {
  content: string
  document_name?: string
  id?: string
}

export interface ReferenceData {
  chunks?: ReferenceChunk[]
}

interface ChatBubbleProps {
  role: ChatRole
  content: string
  references?: ReferenceData
}

const referencePattern = /\[ID:(\d+)\](?!\()/g

const injectReferenceLinks = (text: string) =>
  text.replace(referencePattern, (_match, id) => `[ref:${id}](/__reference__/${id})`)

const parseReferenceIndex = (href?: string) => {
  if (!href) return null
  const match = href.match(/^\/__reference__\/(\d+)$/)
  if (!match) return null
  const value = Number(match[1])
  return Number.isNaN(value) ? null : value
}

const ReferenceIcon = ({ index, chunk }: { index: number; chunk?: ReferenceChunk }) => {
  const title = chunk?.document_name ?? 'Reference'
  const content = chunk?.content ?? 'Reference not available.'

  return (
    <span className="reference-icon" role="button" tabIndex={0} aria-label={`Reference ${index}`}>
      <span className="reference-icon__badge">{index}</span>
      <span className="reference-icon__popup">
        <span className="reference-icon__title">{title}</span>
        <span className="reference-icon__content">{content}</span>
      </span>
    </span>
  )
}

export function ChatBubble({ role, content, references }: ChatBubbleProps) {
  console.log(content, references)
  const isAssistant = role === 'assistant'
  const referenceChunks = references?.chunks ?? []
  const markdownContent = injectReferenceLinks(content)

  return (
    <div className={`chat-message ${isAssistant ? 'chat-message--assistant' : 'chat-message--user'}`}>
      <div className="chat-message__meta">{isAssistant ? 'Assistant' : 'You'}</div>
      <div className="chat-message__content">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            a: ({ href, children, node: _node, ...props }) => {
              const referenceIndex = parseReferenceIndex(href)
              if (referenceIndex !== null) {
                return (
                  <ReferenceIcon
                    index={referenceIndex}
                    chunk={referenceChunks[referenceIndex]}
                  />
                )
              }

              return (
                <a href={href} {...props}>
                  {children}
                </a>
              )
            },
          }}
        >
          {markdownContent}
        </ReactMarkdown>
      </div>
    </div>
  )
}

