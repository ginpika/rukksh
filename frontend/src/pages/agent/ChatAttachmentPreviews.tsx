import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { FileText, Image, X } from 'lucide-react'
import { createPortal } from 'react-dom'
import { getChatAttachment, type ChatAttachmentInfo } from '../../api/client'
import ImagePreview from '../../components/ImagePreview'
import './chatAttachmentPreviews.css'

type AttachmentProps = { attachment: ChatAttachmentInfo; sessionId: string; messageId: number; index: number }
type PreviewState = { status: 'loading' | 'error' } | { status: 'ready'; value: string }

export function AttachmentLabel({ attachment }: { attachment: ChatAttachmentInfo }) {
  const Icon = attachment.image ? Image : FileText
  return <><Icon size={14} aria-hidden="true" /><span title={attachment.name}>{attachment.name}</span></>
}

function AttachmentImage({ attachment, sessionId, messageId, index }: AttachmentProps) {
  const itemRef = useRef<HTMLLIElement>(null)
  const [preview, setPreview] = useState<PreviewState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    let url: string | undefined

    async function load() {
      try {
        const blob = await getChatAttachment(sessionId, messageId, index, controller.signal)
        if (!/^image\/(png|jpeg|gif)$/.test(blob.type)) throw new Error('Invalid image')
        if (controller.signal.aborted) return
        url = URL.createObjectURL(blob)
        setPreview({ status: 'ready', value: url })
      } catch {
        if (!controller.signal.aborted) setPreview({ status: 'error' })
      }
    }

    // Long conversations only fetch images near the visible part of the transcript.
    const observer = itemRef.current && typeof IntersectionObserver !== 'undefined'
      ? new IntersectionObserver(entries => {
          if (!entries.some(entry => entry.isIntersecting)) return
          observer?.disconnect()
          void load()
        }, { rootMargin: '160px' })
      : null
    if (observer && itemRef.current) observer.observe(itemRef.current)
    else void load()
    return () => {
      observer?.disconnect()
      controller.abort()
      if (url) URL.revokeObjectURL(url)
    }
  }, [sessionId, messageId, index, attempt])

  return <li ref={itemRef} className="sl-chat__image-attachment">
    {preview.status === 'ready'
      ? <ImagePreview src={preview.value} alt={attachment.name} className="sl-chat__attachment-thumbnail"
          onError={() => setPreview({ status: 'error' })} />
      : preview.status === 'error'
        ? <button type="button" className="sl-chat__image-placeholder" aria-label={'重新加载图片 ' + attachment.name}
            onClick={() => { setPreview({ status: 'loading' }); setAttempt(previous => previous + 1) }}>
            <Image size={20} aria-hidden="true" /><span>图片加载失败</span><span>点击重试</span>
          </button>
        : <span role="status" className="sl-chat__image-placeholder"><Image size={20} aria-hidden="true" /><span>正在加载图片…</span></span>}
  </li>
}

function DocumentPreview({ attachment, sessionId, messageId, index, onClose }: AttachmentProps & { onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const backdropPress = useRef(false)
  const titleId = useId()
  const [preview, setPreview] = useState<PreviewState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useLayoutEffect(() => {
    const dialog = dialogRef.current
    dialog?.showModal()
    closeRef.current?.focus({ preventScroll: true })
    return () => dialog?.close()
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    void getChatAttachment(sessionId, messageId, index, controller.signal)
      .then(async blob => {
        if (!blob.type.startsWith('text/plain')) throw new Error('Invalid document')
        const value = await blob.text()
        if (!controller.signal.aborted) setPreview({ status: 'ready', value })
      })
      .catch(() => { if (!controller.signal.aborted) setPreview({ status: 'error' }) })
    return () => controller.abort()
  }, [sessionId, messageId, index, attempt])

  return <dialog ref={dialogRef} className="rukksh-surface sl-chat__document-preview" aria-labelledby={titleId}
    onCancel={event => { event.preventDefault(); onClose() }}
    onPointerDown={event => { backdropPress.current = event.target === event.currentTarget }}
    onClick={event => {
      event.stopPropagation()
      if (backdropPress.current && event.target === event.currentTarget) onClose()
    }}>
    <header>
      <FileText size={20} aria-hidden="true" />
      <div>
        <h2 id={titleId}>{attachment.name}</h2>
        <span>文档正文</span>
      </div>
      <button ref={closeRef} type="button" aria-label="关闭文档预览" className="sl-chat__icon" onClick={onClose}><X size={19} /></button>
    </header>
    <div className="sl-chat__document-body scrollbar-slim" role="region" aria-label="文档内容" aria-busy={preview.status === 'loading'} tabIndex={0}>
      {preview.status === 'ready' ? <pre>{preview.value}</pre>
        : preview.status === 'error' ? <div className="sl-chat__document-state">
          <span role="alert">无法读取文档预览。</span>
          <button type="button" onClick={() => { setPreview({ status: 'loading' }); setAttempt(previous => previous + 1) }}>重试</button>
        </div> : <p className="sl-chat__document-state" role="status">正在读取文档…</p>}
    </div>
  </dialog>
}

function AttachmentDocument(props: AttachmentProps) {
  const [open, setOpen] = useState(false)
  return <li>
    <button type="button" className="sl-chat__attachment sl-chat__attachment-open" aria-haspopup="dialog"
      aria-label={'预览' + props.attachment.name} onClick={() => setOpen(true)}>
      <AttachmentLabel attachment={props.attachment} />
    </button>
    {open && createPortal(<DocumentPreview {...props} onClose={() => setOpen(false)} />, document.body)}
  </li>
}

export default function ChatAttachmentPreviews({ attachments, sessionId, messageId }: {
  attachments?: ChatAttachmentInfo[]
  sessionId: string | null
  messageId?: number
}) {
  if (!attachments?.length) return null
  return <ul className="sl-chat__attachments sl-chat__attachments--sent" aria-label="消息附件">
    {attachments.map((attachment, index) => {
      if (!sessionId || messageId === undefined) {
        return <li className="sl-chat__attachment" key={index}><AttachmentLabel attachment={attachment} /></li>
      }
      const Preview = attachment.image ? AttachmentImage : AttachmentDocument
      return <Preview key={sessionId + ':' + messageId + ':' + index} {...{ attachment, sessionId, messageId, index }} />
    })}
  </ul>
}
