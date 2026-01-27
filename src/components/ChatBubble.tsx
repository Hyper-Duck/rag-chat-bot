import {
  createElement,
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
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

const reactAttrMap: Record<string, string> = {
  rowspan: 'rowSpan',
  colspan: 'colSpan',
  span: 'span',
}

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
      const reactName = reactAttrMap[name] ?? name
      attributes[reactName] = value
    }
  })

  return attributes
}

const isTableContainer = (tagName?: string) =>
  tagName === 'table' ||
  tagName === 'thead' ||
  tagName === 'tbody' ||
  tagName === 'tfoot' ||
  tagName === 'tr'

const sanitizeNode = (node: Node, key: string, parentTag?: string): ReactNode[] => {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent ?? ''

    // 在 table / tbody / tr 里：丢弃纯空白文本节点
    if (parentTag && isTableContainer(parentTag)) {
      if (text.trim() === '') return []
    }

    return [text]
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return []
  }

  const element = node as Element
  const tagName = element.tagName.toLowerCase()

  const children = Array.from(element.childNodes).flatMap((child, index) =>
    sanitizeNode(child, `${key}-${index}`, tagName),
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
  const containerRef = useRef<HTMLSpanElement>(null)
  const popupRef = useRef<HTMLDivElement>(null)
  const [isOpen, setIsOpen] = useState(false)
  const [isFocused, setIsFocused] = useState(false)
  const [isPositioned, setIsPositioned] = useState(false)
  const [popupStyle, setPopupStyle] = useState<CSSProperties>({ top: 0, left: 0 })
  const title = chunk?.document_name ?? 'Reference'
  const content = chunk?.content ?? 'Reference not available.'
  const documentId = chunk?.document_id ?? chunk?.id
  const documentUrl = buildDocumentUrl(documentBaseUrl, documentId)
  const sanitizedContent = sanitizeReferenceContent(content)

  const isWithinPopup = useCallback((target: EventTarget | null) => {
    if (!target || !(target instanceof Node)) return false
    return (
      (containerRef.current?.contains(target) ?? false) ||
      (popupRef.current?.contains(target) ?? false)
    )
  }, [])

  const openByHover = useCallback(() => {
    if (isFocused) return
    setIsOpen(true)
    console.log('openByHover')
  }, [])
  
  const openByFocus = useCallback(() => {
    setIsFocused(true)
    setIsOpen(true)
    console.log('openByFocus')
  }, [])
  
  const closePopup = useCallback(() => {
    console.log('closePopup')
    setIsOpen(false)
    setIsPositioned(false)
    setIsFocused(false)
  }, [])

  const updatePlacement = useCallback(() => {
    const container = containerRef.current
    const popup = popupRef.current
    if (!container || !popup || typeof window === 'undefined') return
    const containerRect = container.getBoundingClientRect()
    const popupRect = popup.getBoundingClientRect()

    const margin = 8
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight
    const shouldShowBelow = containerRect.top - popupRect.height < margin
    const shouldShowLeft = containerRect.left + popupRect.width > viewportWidth - margin
    const preferredTop = shouldShowBelow
      ? containerRect.bottom + margin
      : containerRect.top - popupRect.height - margin
    const preferredLeft = shouldShowLeft ? containerRect.right - popupRect.width : containerRect.left
    const top = Math.min(Math.max(preferredTop, margin), viewportHeight - popupRect.height - margin)
    const left = Math.min(Math.max(preferredLeft, margin), viewportWidth - popupRect.width - margin)

    setPopupStyle({ top, left })
    setIsPositioned(true)
  }, [])

  useLayoutEffect(() => {
    if (!isOpen) return
    setIsPositioned(false)
    updatePlacement()
  }, [isOpen, content, updatePlacement])

  useEffect(() => {
    if (!isOpen || typeof window === 'undefined') return
    const handleUpdate = () => updatePlacement()
    window.addEventListener('resize', handleUpdate)
    window.addEventListener('scroll', handleUpdate, true)
    return () => {
      window.removeEventListener('resize', handleUpdate)
      window.removeEventListener('scroll', handleUpdate, true)
    }
  }, [isOpen, updatePlacement])

  const popupClassName = [
    'reference-icon__popup',
    isOpen && isPositioned ? 'reference-icon__popup--open' : '',
  ]
    .filter(Boolean)
    .join(' ')

  const popup = isOpen && typeof document !== 'undefined'
    ? createPortal(
        <div
          ref={popupRef}
          className={popupClassName}
          style={popupStyle}
        >
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
        </div>,
        document.body,
      )
    : null

  return (
    <span
      ref={containerRef}
      className="reference-icon"
      role="button"
      tabIndex={0}
      aria-label={`Reference ${index}`}
      onMouseEnter={openByHover}
      onMouseLeave={(event) => {
        if (!isWithinPopup(event.relatedTarget) && !isFocused) {
          closePopup()
        }
      }}
      onFocus={openByFocus}
      onBlur={(event) => {
        if (!isWithinPopup(event.relatedTarget)) {
          closePopup()
        }
      }}
    >
      <span className="reference-icon__badge">{index}</span>
      {popup}
    </span>
  )
}

export function ChatBubble({ role, content, references, documentBaseUrl }: ChatBubbleProps) {
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

