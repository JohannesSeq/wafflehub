import { useId, useRef, useState, type ReactNode, type PointerEvent } from 'react';
import { Check, ChevronLeft, ChevronRight, Copy, Pencil, RotateCcw, Volume2, X } from 'lucide-react';
import { replyVariants } from './conversation';
import { timeLabel } from './lib';
import type { Message } from './types';

type Props = {
  message: Message; author: string; avatar?: ReactNode; demo: boolean;
  generating: boolean; draftContent?: string; disabled: boolean;
  editingBlocked: boolean; canRegenerate: boolean; latest: boolean;
  onEditing: (editing: boolean) => void;
  onSave: (text: string) => void; onRegenerate: () => void;
  onChoose: (index: number) => void; onSpeak: () => void; onCopy: () => void;
};

export default function ChatMessage({ message, author, avatar, demo, generating, draftContent, disabled, editingBlocked, canRegenerate, latest, onEditing, onSave, onRegenerate, onChoose, onSpeak, onCopy }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const editButton = useRef<HTMLButtonElement>(null);
  const gesture = useRef<{ x: number; y: number; id: number } | null>(null);
  const hint = useId();
  const assistant = message.role === 'assistant';
  const variants = replyVariants(message);
  const selected = message.selectedVariant ?? 0;
  const hasNext = selected < variants.length - 1;
  const content = generating ? draftContent ?? '' : message.content;
  const locked = disabled || editingBlocked;
  const swipable = assistant && !locked && !editing && (variants.length > 1 || canRegenerate);

  function closeEditor() {
    setEditing(false); onEditing(false);
    requestAnimationFrame(() => editButton.current?.focus());
  }
  function save() {
    if (!draft.trim() || disabled) return;
    onSave(draft); closeEditor();
  }
  function next() { if (hasNext) onChoose(selected + 1); else if (canRegenerate) onRegenerate(); }
  function finishSwipe(event: PointerEvent<HTMLDivElement>) {
    const start = gesture.current; gesture.current = null;
    if (!start || start.id !== event.pointerId || !swipable || window.getSelection()?.toString()) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) < 55 || Math.abs(dx) < Math.abs(dy) * 1.6) return;
    if (dx < 0) next(); else if (selected > 0) onChoose(selected - 1);
  }

  return <div className={`message message-${message.role} ${editing ? 'is-editing' : ''}`} role="group" aria-label={`${author} message`} data-message-id={message.id}>
    {avatar}
    <div className="message-content">
      <span className="message-name">{author}<time>{timeLabel(message.createdAt)}</time>{message.editedAt && <span className="edited-label">Edited</span>}</span>
      {editing ? <form className="message-editor" onSubmit={event => { event.preventDefault(); save(); }}>
        <textarea aria-label="Edit message text" aria-describedby={hint} autoFocus rows={5} maxLength={30000} value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === 'Escape') { event.preventDefault(); closeEditor(); }
          else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); save(); }
        }} />
        <small id={hint}>Edits apply to future replies. Later messages stay in place.</small>
        <div><button type="button" className="button button-secondary" onClick={closeEditor}><X size={14} /> Cancel</button><button type="submit" className="button button-pink" disabled={!draft.trim() || disabled}><Check size={14} /> Save edit</button></div>
      </form> : <div className={`message-bubble ${swipable ? 'swipeable-bubble' : ''}`} onPointerDown={event => {
        if (!swipable || !event.isPrimary || !['touch', 'pen'].includes(event.pointerType)) return;
        gesture.current = { x: event.clientX, y: event.clientY, id: event.pointerId };
      }} onPointerUp={finishSwipe} onPointerCancel={() => { gesture.current = null; }}>
        {content ? <MessageText text={content} /> : generating ? <span className="typing-dots" aria-label="Writing a reply"><i /><i /><i /></span> : <span className="empty-reply">No reply yet. Try regenerating.</span>}
      </div>}
      {!editing && <div className="message-tools">
        {assistant && !!content && <button disabled={locked || generating} aria-label={`Listen to ${author}’s message`} title="Listen to this message" onClick={onSpeak}><Volume2 size={14} /></button>}
        {!!content && <button disabled={generating} aria-label="Copy message" title="Copy message" onClick={onCopy}><Copy size={14} /></button>}
        <button ref={editButton} disabled={locked || generating || !message.content} aria-label={assistant ? 'Edit companion message' : 'Edit your message'} title="Edit message" onClick={() => { setDraft(message.content); setEditing(true); onEditing(true); }}><Pencil size={14} /></button>
        {assistant && canRegenerate && <button disabled={locked || generating} aria-label="Regenerate reply" title="Generate another reply" onClick={onRegenerate}><RotateCcw size={14} /></button>}
        {assistant && (canRegenerate || variants.length > 1) && <div className="reply-swipes" aria-label="Alternate replies">
          <button disabled={locked || generating || selected === 0} aria-label="Previous reply" title="Previous reply" onClick={() => onChoose(selected - 1)}><ChevronLeft size={16} /></button>
          <span className="reply-position" aria-label={generating ? 'Generating another reply' : `Reply ${selected + 1} of ${variants.length}`}>{generating ? '…' : `${selected + 1} / ${variants.length}`}</span>
          <button disabled={locked || generating || (!hasNext && !canRegenerate)} aria-label="Next reply" title={hasNext ? 'Next saved reply' : 'Generate another reply'} onClick={next}><ChevronRight size={16} /></button>
        </div>}
        {demo && <span className="demo-reply-label">Scripted demo</span>}
      </div>}
      {!editing && !generating && latest && swipable && <span className="swipe-hint">{hasNext || canRegenerate ? 'Swipe left for another reply' : 'Swipe right for previous replies'}</span>}
    </div>
  </div>;
}

function MessageText({ text }: {text: string}) {
  return <>{text.split(/(\*[^*]+\*)/g).map((part, index) => part.startsWith('*') && part.endsWith('*') ? <em key={index}>{part.slice(1, -1)}</em> : part)}</>;
}
