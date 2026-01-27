import { createElement, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

export type ChatRole = 'user' | 'assistant'

export interface ReferenceChunk {
  content: string
  document_name?: string
  document_id?: string | number
  id?: string
}

export interface ReferenceData {
  chunks?: ReferenceChunk[]
}

interface ChatBubbleProps {
  role: ChatRole
  content: string
  references?: ReferenceData
  documentBaseUrl?: string
}

const referencePattern = /\[ID:(\d+)\](?!\()/g

const tableTags = new Set([
  'table',
  'caption',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'th',
  'td',
  'colgroup',
  'col',
])

const tableAttributeAllowlist: Record<string, string[]> = {
  td: ['colspan', 'rowspan'],
  th: ['colspan', 'rowspan'],
  col: ['span'],
}

const injectReferenceLinks = (text: string) =>
  text.replace(referencePattern, (_match, id) => `[ref:${id}](/__reference__/${id})`)

const hasTableMarkup = (value: string) => /<table[\s>]/i.test(value)

const sanitizeTableAttributes = (element: Element) => {
  const tagName = element.tagName.toLowerCase()
  const allowed = tableAttributeAllowlist[tagName]
  if (!allowed) return undefined
  const attributes: Record<string, string> = {}
  allowed.forEach((name) => {
    const value = element.getAttribute(name)
    if (value) {
      attributes[name] = value
    }
  })
  return attributes
}

const sanitizeNode = (node: Node, key: string): ReactNode[] => {
  if (node.nodeType === Node.TEXT_NODE) {
    return [node.textContent ?? '']
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return []
  }

  const element = node as Element
  const tagName = element.tagName.toLowerCase()
  const children = Array.from(element.childNodes).flatMap((child, index) =>
    sanitizeNode(child, `${key}-${index}`),
  )

  if (!tableTags.has(tagName)) {
    return children
  }

  const attributes = sanitizeTableAttributes(element)
  const props = attributes ? { key, ...attributes } : { key }

  return [createElement(tagName, props, children)]
}

const sanitizeReferenceContent = (value: string): ReactNode => {
  if (!value || !hasTableMarkup(value)) {
    return value
  }

  if (typeof DOMParser === 'undefined') {
    return value
  }

  const document = new DOMParser().parseFromString(value, 'text/html')
  const nodes = Array.from(document.body.childNodes)
  const sanitizedNodes = nodes.flatMap((node, index) => sanitizeNode(node, `ref-${index}`))

  return sanitizedNodes.length > 0 ? sanitizedNodes : value
}

const parseReferenceIndex = (href?: string) => {
  if (!href) return null
  const match = href.match(/^\/__reference__\/(\d+)$/)
  if (!match) return null
  const value = Number(match[1])
  return Number.isNaN(value) ? null : value
}

const buildDocumentUrl = (baseUrl?: string, documentId?: string | number) => {
  if (!baseUrl) return null
  const normalizedId = documentId !== undefined && documentId !== null ? String(documentId).trim() : ''
  if (!normalizedId) return null
  const normalizedBaseUrl = baseUrl.replace(/\/$/, '')
  return `${normalizedBaseUrl}/v1/document/get/${encodeURIComponent(normalizedId)}`
}

const ReferenceIcon = ({
  index,
  chunk,
  documentBaseUrl,
}: {
  index: number
  chunk?: ReferenceChunk
  documentBaseUrl?: string
}) => {
  const title = chunk?.document_name ?? 'Reference'
  const content = chunk?.content ?? 'Reference not available.'
  const documentId = chunk?.document_id ?? chunk?.id
  const documentUrl = buildDocumentUrl(documentBaseUrl, documentId)
  const sanitizedContent = sanitizeReferenceContent(content)

  return (
    <span className="reference-icon" role="button" tabIndex={0} aria-label={`Reference ${index}`}>
      <span className="reference-icon__badge">{index}</span>
      <div className="reference-icon__popup">
        <div className="reference-icon__title">
          {documentUrl ? (
            <a className="reference-icon__title-link" href={documentUrl} target="_blank" rel="noreferrer">
              {title}
            </a>
          ) : (
            title
          )}
        </div>
        <div className="reference-icon__content">{sanitizedContent}</div>
      </div>
    </span>
  )
}

export function ChatBubble({ role, content, references, documentBaseUrl }: ChatBubbleProps) {
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
                    documentBaseUrl={documentBaseUrl}
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

