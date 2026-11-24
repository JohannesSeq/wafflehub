import { cloneElement, isValidElement, useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent, type ReactElement, type ReactNode } from 'react';
import { Check, ChevronDown, ChevronRight, CircleHelp, Coffee, Download, Ellipsis, Expand, Flower2, Heart, House, ImagePlus, Leaf, LoaderCircle, MessageCircle, Moon, Plus, RotateCcw, Settings2, ShieldCheck, SlidersHorizontal, Sparkles, Square, Sun, Upload, UsersRound, Volume2, VolumeX, WandSparkles, X } from 'lucide-react';
import { MAX_REPLY_VARIANTS, companionSchema, appStateSchema, type Companion, type Message, type Secrets, type Settings } from './types';
import { demoReply, greeting, sakura } from './defaults';
import { api, downloadJSON, pop, readChatStream, useRoom } from './lib';
import { createId } from './id';
import { addReply, editMessage, regenerationHistory, replyVariants, selectReply } from './conversation';
import ChatMessage from './ChatMessage';

type Panel = 'settings' | 'studio' | 'about' | null;
type Health = { local: boolean; configured: { openrouter: boolean; elevenlabs: boolean }; keyStorage?: boolean; stored?: { openrouter: boolean; elevenlabs: boolean } };
const backgrounds = [{ id: 'tea', name: 'Tea room', icon: Coffee }, { id: 'evening', name: 'Evening glow', icon: Moon }, { id: 'garden', name: 'Garden light', icon: Leaf }] as const;

export default function App() {
  const { state, setState, ready, saveStatus, saveError, retrySave } = useRoom();
  const companion = state.companions.find(c => c.id === state.activeId) ?? state.companions[0];
  const messages = state.chats[companion.id] ?? [];
  const [page, setPage] = useState<'room' | 'library'>('room');
  const [panel, setPanel] = useState<Panel>(null);
  const [editing, setEditing] = useState<Companion | null>(null);
  const [secrets, setSecrets] = useState<Secrets>({ openrouter: '', elevenlabs: '' });
  const [health, setHealth] = useState<Health | null>(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [generation, setGeneration] = useState<{ companionId: string; message: Message; content: string } | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [chatError, setChatError] = useState('');
  const [toast, setToast] = useState('');
  const [love, setLove] = useState(false);
  const [menu, setMenu] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const voiceAbort = useRef<AbortController | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const chatBottom = useRef<HTMLDivElement>(null);
  const room = useRef<HTMLDivElement>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const currentGeneration = generation?.companionId === companion.id ? generation : null;
  const visibleMessages = currentGeneration && !messages.some(message => message.id === currentGeneration.message.id)
    ? [...messages, currentGeneration.message] : messages;
  const lastMessage = visibleMessages.at(-1);
  const lastDraft = currentGeneration?.message.id === lastMessage?.id ? currentGeneration?.content : undefined;

  useLayoutEffect(() => {
    if (!ready) return;
    document.documentElement.dataset.theme = state.settings.theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', state.settings.theme === 'dark' ? '#1b1721' : '#fbf7f5');
    try { localStorage.setItem('waffle-theme', state.settings.theme); } catch { /* The database still saves the preference when browser storage is unavailable. */ }
  }, [ready, state.settings.theme]);
  useEffect(() => { void api<Health>('/api/health').then(setHealth).catch(() => {}); }, []);
  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(''), 4200); return () => clearTimeout(t); } }, [toast]);
  useEffect(() => { chatBottom.current?.scrollIntoView({ behavior: 'instant', block: 'nearest' }); }, [lastMessage?.id, lastMessage?.content, lastDraft]);
  useEffect(() => { setEditingMessageId(null); }, [companion.id, page]);
  useEffect(() => () => { abort.current?.abort(); voiceAbort.current?.abort(); audio.current?.pause(); window.speechSynthesis?.cancel(); }, []);
  useEffect(() => { if (!menu) return; const close = () => setMenu(false); document.addEventListener('click', close); return () => document.removeEventListener('click', close); }, [menu]);
  function openStudio(value: Companion | null = null) { setEditing(value); setPanel('studio'); }
  async function savePreferences(settings: Settings, nextSecrets: Secrets) {
    const patch = Object.fromEntries(Object.entries(nextSecrets).filter(([, value]) => value.trim()).map(([name, value]) => [name, value.trim()]));
    if (Object.keys(patch).length && !health) throw new Error('Please wait for the server to be ready before saving your keys.');
    if (health?.keyStorage) {
      if (Object.keys(patch).length) setHealth(await api<Health>('/api/keys', patch, 'PUT'));
      setSecrets({ openrouter: '', elevenlabs: '' });
    } else setSecrets(nextSecrets);
    if (settings.voice !== state.settings.voice) stopVoice();
    setState(s => ({ ...s, settings })); setPanel(null); setToast('Your preferences are ready.');
  }
  async function removeSavedKey(provider: keyof Secrets) {
    const result = await api<Health>('/api/keys', { [provider]: null }, 'PUT');
    setHealth(result); setSecrets(current => ({ ...current, [provider]: '' }));
    setToast('The locally saved key was removed.');
  }
  function stopVoice() { voiceAbort.current?.abort(); audio.current?.pause(); window.speechSynthesis?.cancel(); setSpeaking(false); }
  async function speak(text: string) {
    stopVoice();
    if (state.settings.voice === 'off') { setToast('Choose a voice in Settings to listen to replies.'); return; }
    const clean = text.replace(/\*[^*]*\*/g, '').replace(/[♡♥]/g, '').trim();
    if (!clean) return;
    if (state.settings.voice === 'browser') {
      if (!('speechSynthesis' in window)) { setToast('This browser does not support built-in speech. Try ElevenLabs in Settings.'); return; }
      const utterance = new SpeechSynthesisUtterance(clean);
      utterance.rate = 0.94; utterance.pitch = 1.05;
      utterance.onend = () => setSpeaking(false); utterance.onerror = () => setSpeaking(false);
      setSpeaking(true); window.speechSynthesis.speak(utterance); return;
    }
    if (!companion.voiceId) { setToast('Add an ElevenLabs voice ID in your companion’s Studio.'); return; }
    const controller = new AbortController(); voiceAbort.current = controller;
    try {
      setSpeaking(true);
      const response = await fetch('/api/voice', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: clean.slice(0, 6000), voiceId: companion.voiceId, model: state.settings.voiceModel, key: secrets.elevenlabs }), signal: controller.signal });
      if (!response.ok) { const data = await response.json(); throw new Error(data.error); }
      const blob = await response.blob();
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(blob);
      const player = new Audio(url); audio.current = player;
      const release = () => { URL.revokeObjectURL(url); setSpeaking(false); };
      player.onended = release; player.onerror = release;
      player.onpause = () => { URL.revokeObjectURL(url); };
      await player.play();
    } catch (error) { if (!controller.signal.aborted) { setSpeaking(false); setToast((error as Error).message || 'Unable to play this voice.'); } }
  }
  function selectCompanion(value: Companion) {
    cancelGeneration(); stopVoice(); setChatError(''); setEditingMessageId(null);
    setState(s => ({ ...s, activeId: value.id, chats: { ...s.chats, [value.id]: s.chats[value.id] ?? [greeting(value)] } }));
    setPage('room');
  }
  async function send(text = input) {
    text = text.trim();
    if (!text || busy || abort.current || !ready || editingMessageId) return;
    if (messages.length + 2 > 200) { setToast('Export this conversation and start a fresh one to keep your room running smoothly.'); return; }
    setInput('');
    const user: Message = { id: createId(), role: 'user', content: text, createdAt: new Date().toISOString() };
    const assistant: Message = { id: createId(), role: 'assistant', content: '', createdAt: new Date().toISOString() };
    const history = [...messages, user];
    setState(s => ({ ...s, chats: { ...s.chats, [companion.id]: history } }));
    await generateReply(history, assistant);
  }
  function cancelGeneration() {
    abort.current?.abort(); abort.current = null;
    setGeneration(null); setBusy(false);
  }
  async function generateReply(history: Message[], target: Message, original?: Message) {
    if (abort.current || !ready || editingMessageId) return;
    stopVoice(); setChatError(''); setBusy(true);
    const controller = new AbortController(); abort.current = controller;
    const id = companion.id;
    setGeneration({ companionId: id, message: target, content: '' });
    let finalText = '';
    const update = (content: string) => {
      if (controller.signal.aborted || abort.current !== controller) return;
      if (content.length > 30000) throw new Error('This reply is too long to save. Lower the reply token limit and try again.');
      finalText = content;
      setGeneration({ companionId: id, message: target, content });
    };
    try {
      if (state.settings.provider === 'demo') {
        const text = [...history].reverse().find(message => message.role === 'user')?.content ?? '';
        const result = demoReply(text, companion, history.length, original ? replyVariants(original).length : 0);
        const words = result.split(' ');
        for (let n = 0; n < words.length; n += 3) {
          await new Promise<void>((resolve, reject) => {
            const done = () => { controller.signal.removeEventListener('abort', cancel); resolve(); };
            const t = setTimeout(done, 45);
            const cancel = () => { clearTimeout(t); reject(new DOMException('Stopped', 'AbortError')); };
            controller.signal.addEventListener('abort', cancel, { once: true });
            if (controller.signal.aborted) cancel();
          });
          update(words.slice(0, n + 3).join(' '));
        }
      } else {
        const response = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ settings: state.settings, companion, messages: history.slice(-state.settings.contextMessages), key: secrets.openrouter }), signal: controller.signal });
        await readChatStream(response, update);
      }
      if (controller.signal.aborted || abort.current !== controller) return;
      const variant = { id: createId(), content: finalText, createdAt: new Date().toISOString() };
      const completed = original ? addReply(original, variant) : { ...target, content: finalText, variants: [variant], selectedVariant: 0 };
      setState(s => ({ ...s, chats: { ...s.chats, [id]: original
        ? (s.chats[id] ?? []).map(message => message.id === target.id ? completed : message)
        : [...(s.chats[id] ?? []), completed] } }));
      if (state.settings.voice !== 'off') void speak(finalText);
    } catch (error) {
      if (!controller.signal.aborted) setChatError((error as Error).message);
    } finally {
      if (abort.current === controller) { setBusy(false); setGeneration(null); abort.current = null; }
    }
  }
  async function regenerate(messageId: string) {
    if (busy || abort.current || !ready || editingMessageId) return;
    const target = messages.find(message => message.id === messageId);
    if (!target) return;
    if (replyVariants(target).length >= MAX_REPLY_VARIANTS) { setToast(`You can keep up to ${MAX_REPLY_VARIANTS} replies for one message.`); return; }
    try { await generateReply(regenerationHistory(messages, messageId), target, target); }
    catch (error) { setToast((error as Error).message); }
  }
  function chooseReply(messageId: string, index: number) {
    if (busy || !ready || editingMessageId) return;
    stopVoice(); setChatError('');
    setState(s => ({ ...s, chats: { ...s.chats, [companion.id]: (s.chats[companion.id] ?? []).map(message => message.id === messageId ? selectReply(message, index) : message) } }));
  }
  function saveMessage(messageId: string, text: string) {
    if (busy || !ready) return;
    stopVoice(); setChatError('');
    setState(s => ({ ...s, chats: { ...s.chats, [companion.id]: (s.chats[companion.id] ?? []).map(message => message.id === messageId ? editMessage(message, text) : message) } }));
  }
  function retryReply() {
    if (messages.at(-1)?.role !== 'user' || messages.length >= 200 || busy || !ready || editingMessageId) return;
    void generateReply(messages, { id: createId(), role: 'assistant', content: '', createdAt: new Date().toISOString() });
  }
  function saveCompanion(value: Companion) {
    setState(s => {
      const exists = s.companions.some(c => c.id === value.id);
      return { ...s, companions: exists ? s.companions.map(c => c.id === value.id ? value : c) : [...s.companions, value], activeId: value.id, chats: { ...s.chats, [value.id]: s.chats[value.id] ?? [greeting(value)] } };
    });
    setPanel(null); setPage('room'); setToast(`${value.name}’s little corner is ready.`);
  }
  async function importCompanion(file?: File) {
    if (!file) return;
    try {
      if (file.size > 2000000) throw new Error('Choose a companion file smaller than 2 MB.');
      const data = companionSchema.parse(JSON.parse(await file.text()));
      const value = { ...data, id: createId(), artwork: data.artwork.startsWith('/api/art/') ? sakura.artwork : safeArtwork(data.artwork) ? data.artwork : sakura.artwork };
      if (state.companions.length >= 30) throw new Error('Your library can hold 30 companions.');
      saveCompanion(value);
    } catch { setToast('That companion file could not be imported. Use a Waffle companion JSON export.'); }
  }
  const providerLabel = state.settings.provider === 'demo' ? 'Demo mode' : state.settings.provider === 'ollama' ? 'Local · Ollama' : 'OpenRouter';
  const settingsSummary = state.settings.provider === 'demo' ? 'Connect your favorite AI' : state.settings.model || 'Choose a model';

  return <div className={`app ${!state.settings.motion ? 'reduce-motion' : ''}`} onClickCapture={event => {
    if ((event.target as HTMLElement).closest('button, a, input[type="checkbox"], select')) pop(state.settings.sound);
  }}>
    <aside className="sidebar" aria-label="Main navigation">
      <a className="waffle-mark" href="#room" aria-label="Waffle home" onClick={e => { e.preventDefault(); setPage('room'); }}><WaffleMark /></a>
      <div className="rail-nav">
        <NavButton icon={<House />} label="Room" active={page === 'room'} onClick={() => setPage('room')} />
        <NavButton icon={<UsersRound />} label="Companions" active={page === 'library'} onClick={() => setPage('library')} />
        <NavButton icon={<WandSparkles />} label="Studio" active={panel === 'studio'} onClick={() => openStudio(companion)} />
        <span className="rail-divider" />
        <NavButton icon={<Settings2 />} label="Settings" active={panel === 'settings'} onClick={() => setPanel('settings')} />
      </div>
      <button className="rail-help" aria-label="About Waffle" onClick={() => setPanel('about')}><CircleHelp size={21} /></button>
      <div className="rail-flower"><Flower2 size={28} /></div>
    </aside>
    <div className="app-main">
      <header className="topbar">
        <a href="#room" className="wordmark" onClick={e => { e.preventDefault(); setPage('room'); }}>waffle<span>♡</span></a>
        <span className="topbar-tagline">a little company, a lot of heart.</span>
        <div className="topbar-actions">
          <span className="privacy-label"><ShieldCheck size={16} /> Your space, your choice</span>
          <button className="icon-button sound-button theme-button" aria-label={state.settings.theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'} title={state.settings.theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'} aria-pressed={state.settings.theme === 'dark'} disabled={!ready} onClick={() => setState(s => ({ ...s, settings: { ...s.settings, theme: s.settings.theme === 'dark' ? 'light' : 'dark' } }))}>{state.settings.theme === 'dark' ? <Sun size={19} /> : <Moon size={19} />}</button>
          <button className="icon-button sound-button" aria-label={state.settings.sound ? 'Mute interface sounds' : 'Enable interface sounds'} title={state.settings.sound ? 'Mute interface sounds' : 'Enable interface sounds'} onClick={() => setState(s => ({ ...s, settings: { ...s.settings, sound: !s.settings.sound } }))}>{state.settings.sound ? <Volume2 size={19} /> : <VolumeX size={19} />}</button>
          <button className="profile-button" aria-label="Open settings" onClick={() => setPanel('settings')}><Flower2 size={22} /></button>
        </div>
      </header>
      <main className="workspace">
        <section className="page-intro">
          <div><div className="eyebrow"><Sparkles size={13} /> A SOFT PLACE TO LAND</div><h1>{page === 'room' ? <>Life’s sweeter with a little <em>company.</em></> : <>Your kind of <em>company.</em></>}</h1><p>{page === 'room' ? 'Take a breath. Get comfortable. Someone’s happy to see you.' : 'Familiar faces, new connections, and a little room to be yourself.'}</p></div>
          <button className="button button-pink new-companion" onClick={() => openStudio()} disabled={state.companions.length >= 30 || !ready}><Plus size={17} /> Create companion</button>
        </section>
        {saveStatus === 'error' && <div className="error-banner" role="alert">{saveError || 'Your changes could not be saved.'}<button onClick={retrySave}>Try again</button></div>}
        {page === 'room' ? <div className="room-grid">
          <section className="companion-space" aria-label={`${companion.name}’s companion room`}>
            <div ref={room} className={`stage ${state.settings.background} ${speaking ? 'is-speaking' : ''} ${love ? 'is-loved' : ''}`}>
              <div className="stage-background" />
              <div className="stage-light" />
              <div className="stage-top"><span className="room-label"><Coffee size={14} /> {backgrounds.find(b => b.id === state.settings.background)?.name}</span><button className="stage-icon" aria-label="Expand companion room" title="Expand companion room" onClick={() => { if (document.fullscreenElement) void document.exitFullscreen(); else void room.current?.requestFullscreen?.().catch(() => setToast('Full screen is not available in this browser.')); }}><Expand size={17} /></button></div>
              <div className="floating-petal petal-one">✿</div><div className="floating-petal petal-two">✧</div><div className="floating-petal petal-three">✿</div>
              <img className={`character tint-${companion.tint}`} src={companion.artwork || sakura.artwork} alt={`${companion.name}, your illustrated companion`} onError={e => { if (!e.currentTarget.src.endsWith(sakura.artwork)) e.currentTarget.src = sakura.artwork; }} />
              <div className="stage-speech">{love ? 'That made my day. ♡' : speaking ? 'A little something, just for you…' : 'I’m glad you’re here. ♡'}</div>
              {love && <div className="heart-particles" aria-hidden="true"><span>♡</span><span>♡</span><span>♡</span><span>♡</span></div>}
              <div className="character-caption"><span className="caption-label"><span className="presence-dot" /> HERE WITH YOU</span><h2>{companion.name}<span>✿</span></h2><p>{companion.subtitle}</p></div>
              <button className={`love-button ${love ? 'loved' : ''}`} aria-label={`Send ${companion.name} a little love`} title="Send a little love" onClick={() => { setLove(true); pop(state.settings.sound, true); setTimeout(() => setLove(false), 2500); }}><Heart size={23} fill={love ? 'currentColor' : 'none'} /></button>
            </div>
            <div className="stage-footer"><div className="background-picker"><span>Set the mood</span>{backgrounds.map(background => <button key={background.id} className={`background-option ${state.settings.background === background.id ? 'selected' : ''} ${background.id}`} aria-label={background.name} title={background.name} aria-pressed={state.settings.background === background.id} onClick={() => setState(s => ({ ...s, settings: { ...s.settings, background: background.id } }))}><background.icon size={17} /></button>)}</div><button className="text-button customize-button" onClick={() => openStudio(companion)}><SlidersHorizontal size={15} /> Customize</button></div>
            <div className="companion-tags">{companion.traits.map(trait => <span key={trait}><Flower2 size={12} /> {trait}</span>)}<span className="art-label">Illustrated 2D</span></div>
          </section>
          <section className="chat-panel" aria-label={`Chat with ${companion.name}`}>
            <div className="chat-header"><Avatar companion={companion} /><div><h2>A little time with {companion.name}</h2><span><span className="presence-dot" /> {speaking ? 'Speaking softly…' : busy ? 'Thinking of a reply…' : 'Here for a conversation'}</span></div><div className="chat-menu-wrapper"><button className="icon-button" aria-label="Conversation options" onClick={e => { e.stopPropagation(); setMenu(!menu); }}><Ellipsis size={22} /></button>{menu && <div className="dropdown" onClick={e => e.stopPropagation()}><button onClick={() => { downloadJSON(`${companion.name.toLowerCase()}-conversation.json`, { companion: companion.name, messages }); setMenu(false); }}><Download size={15} /> Export conversation</button><button onClick={() => { setConfirmClear(true); setMenu(false); }}><RotateCcw size={15} /> Start a new conversation</button></div>}</div></div>
            <button className={`connection-strip ${state.settings.provider !== 'demo' ? 'connected' : ''}`} onClick={() => setPanel('settings')}><span><Sparkles size={13} /><strong>{providerLabel}</strong><span>{state.settings.provider === 'demo' ? 'A little preview of the magic' : state.settings.model || 'Choose your model'}</span></span><ChevronRight size={15} /></button>
            <div className="message-list" role="log" aria-label="Conversation messages" aria-live="polite" aria-relevant="additions text">
              <div className="conversation-date"><span />{new Date(messages[0]?.createdAt || Date.now()).toLocaleDateString([], { month: 'long', day: 'numeric' })}<span /></div>
              {visibleMessages.map((message, index) => <ChatMessage key={message.id} message={message}
                author={message.role === 'user' ? 'You' : companion.name}
                avatar={message.role === 'assistant' ? <Avatar companion={companion} small /> : undefined}
                demo={state.settings.provider === 'demo' && message.role === 'assistant' && index > 0}
                generating={currentGeneration?.message.id === message.id}
                draftContent={currentGeneration?.message.id === message.id ? currentGeneration.content : undefined}
                disabled={busy || !ready} editingBlocked={!!editingMessageId}
                canRegenerate={message.role === 'assistant' && messages.slice(0, index).some(previous => previous.role === 'user') && replyVariants(message).length < MAX_REPLY_VARIANTS}
                latest={index === visibleMessages.length - 1}
                onEditing={editing => setEditingMessageId(editing ? message.id : null)}
                onSave={text => saveMessage(message.id, text)}
                onRegenerate={() => void regenerate(message.id)}
                onChoose={selected => chooseReply(message.id, selected)}
                onSpeak={() => void speak(message.content)}
                onCopy={() => {
                  if (!navigator.clipboard) { setToast('Copying needs HTTPS or localhost in this browser.'); return; }
                  void navigator.clipboard.writeText(message.content).then(() => setToast('Message copied.')).catch(() => setToast('Your browser could not copy this message.'));
                }}
              />)}
              <div ref={chatBottom} />
            </div>
            {chatError && <div className="chat-error" role="alert">{chatError}<button onClick={() => setPanel('settings')}>Open settings</button></div>}
            <div className="chat-compose">
              {!busy && messages.at(-1)?.role === 'user' && <button className="button button-secondary retry-reply" disabled={!ready || !!editingMessageId} onClick={retryReply}><RotateCcw size={15} /> Generate reply</button>}
              {messages.length < 4 && !busy && <div className="suggestions"><span>A little conversation starter</span><div>{['How was your day?', 'Tell me a story', 'I need a little comfort'].map(text => <button key={text} onClick={() => void send(text)} disabled={!ready || !!editingMessageId}>{text}<span>✧</span></button>)}</div></div>}
              <form onSubmit={e => { e.preventDefault(); void send(); }} className="composer"><textarea aria-label={`Message ${companion.name}`} placeholder={editingMessageId ? 'Finish editing your message first…' : `Tell ${companion.name} what’s on your mind…`} disabled={!!editingMessageId} value={input} maxLength={10000} rows={2} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }} /><div className="composer-bottom"><span>Just be yourself. ♡</span>{busy ? <button type="button" className="send-button" aria-label="Stop response" onClick={() => abort.current?.abort()}><Square size={14} fill="currentColor" /></button> : <button type="submit" className="send-button" aria-label="Send message" disabled={!input.trim() || !ready || !!editingMessageId}><Sparkles size={18} /></button>}</div></form>
              <div className="chat-footnote"><Heart size={11} /> A little space for you to feel heard.<button className={speaking ? 'voice-active' : ''} onClick={() => { if (speaking) stopVoice(); else setPanel('settings'); }} aria-label={speaking ? 'Stop voice playback' : 'Configure voice'}>{speaking ? <Square size={11} /> : <Volume2 size={13} />}{speaking ? 'Stop' : 'Voice'}</button></div>
            </div>
          </section>
        </div> : <section className="library" aria-label="Companion library"><div className="library-toolbar"><span>{state.companions.length} {state.companions.length === 1 ? 'companion' : 'companions'} in your little world</span><button className="text-button" onClick={() => importInput.current?.click()}><Upload size={15} /> Import companion</button></div><div className="library-grid">{state.companions.map(value => <article className={`companion-card tint-${value.tint}`} key={value.id}><button className="companion-card-art" onClick={() => selectCompanion(value)} aria-label={`Open ${value.name}’s room`}><img src={value.artwork || sakura.artwork} alt={value.name} />{value.id === companion.id && <span><Heart size={12} /> Your current companion</span>}</button><div className="companion-card-info"><h2>{value.name}</h2><p>{value.subtitle}</p><div className="companion-card-tags">{value.traits.map(t => <span key={t}>{t}</span>)}</div><div className="card-buttons"><button className="button button-pink" onClick={() => selectCompanion(value)}><MessageCircle size={15} /> Spend some time</button><button className="icon-button" aria-label={`Edit ${value.name}`} onClick={() => openStudio(value)}><SlidersHorizontal size={18} /></button></div></div></article>)}<button className="create-card" onClick={() => openStudio()} disabled={state.companions.length >= 30}><span><Plus size={28} /></span><h2>A new little connection</h2><p>Give a character a personality,<br />a voice, and a place in your world.</p><span className="text-button">Create a companion</span></button></div></section>}
        <footer className="workspace-footer"><span><Flower2 size={13} /> A cozy corner, made yours.</span><button className="model-shortcut" onClick={() => setPanel('settings')}><span className={`provider-indicator ${state.settings.provider}`} />{settingsSummary}<ChevronDown size={12} /></button><span className="save-indicator">{saveStatus === 'saving' || saveStatus === 'loading' ? <LoaderCircle size={12} className="spin" /> : saveStatus === 'error' ? <CircleHelp size={12} /> : <Check size={12} />}{saveStatus === 'saved' ? 'Your room is saved' : saveStatus === 'error' ? 'Changes not saved' : saveStatus === 'loading' ? 'Opening your room…' : 'Saving your room…'}</span></footer>
      </main>
    </div>
    <input ref={importInput} type="file" accept="application/json,.json" className="visually-hidden" aria-label="Import a companion JSON file" onChange={e => { void importCompanion(e.target.files?.[0]); e.currentTarget.value = ''; }} />
    {panel === 'settings' && <Drawer title="Make yourself at home" eyebrow="YOUR PREFERENCES" onClose={() => setPanel(null)}><SettingsForm settings={state.settings} secrets={secrets} health={health} onSave={savePreferences} onRemoveKey={removeSavedKey} onExport={() => downloadJSON('waffle-room-backup.json', state)} onImport={data => { try { const parsed = appStateSchema.parse(data); cancelGeneration(); stopVoice(); setEditingMessageId(null); setState(parsed); setPanel(null); setToast('Your room has been restored.'); } catch { setToast('That backup is not a valid Waffle room file.'); } }} /></Drawer>}
    {panel === 'studio' && <Drawer title={editing ? `A little more ${editing.name}` : 'Bring someone to life'} eyebrow="COMPANION STUDIO" onClose={() => setPanel(null)}><StudioForm companion={editing} onSave={saveCompanion} onExport={value => { const exportValue = { ...value, artwork: value.artwork.startsWith('/api/art/') ? '' : value.artwork }; downloadJSON(`${value.name.toLowerCase().replace(/[^a-z0-9]/g, '-')}-companion.json`, exportValue); setToast('Companion exported. Uploaded artwork stays in this room.'); }} /></Drawer>}
    {panel === 'about' && <Drawer title="A little company, on your terms." eyebrow="HELLO FROM WAFFLE" onClose={() => setPanel(null)}><div className="about-content"><WaffleMark /><p>Waffle is your cozy corner for a conversation with an illustrated virtual companion.</p><h3>Make it yours</h3><p>Create a companion in the Studio, choose their personality and portrait, and connect Ollama or OpenRouter in Settings.</p><h3>A gentle first version</h3><p>Demo mode uses scripted replies. Connect a model for real AI conversations. Portraits have subtle motion; they are not rigged Live2D models.</p><h3>Your room remembers</h3><p>Companions, chats, and preferences are saved to this app’s database. {health?.keyStorage ? 'API keys are saved privately on the computer running this app and reused after a refresh. They are excluded from room exports and publishing.' : 'API keys entered here stay in this tab’s memory and are sent only to the backend for provider requests.'}</p><p className="form-note">Need a fresh start? Export a room backup from Settings first.</p></div></Drawer>}
    {confirmClear && <Drawer title="A fresh cup, a fresh conversation?" eyebrow="START AGAIN" onClose={() => setConfirmClear(false)}><p className="form-description">This will clear your conversation with {companion.name}. You can save a copy first.</p><div className="stack"><button className="button button-secondary" onClick={() => downloadJSON(`${companion.name}-conversation.json`, { companion: companion.name, messages })}><Download size={16} /> Export conversation</button><button className="button button-pink" onClick={() => { cancelGeneration(); stopVoice(); setChatError(''); setEditingMessageId(null); setState(s => ({ ...s, chats: { ...s.chats, [companion.id]: [greeting(companion)] } })); setConfirmClear(false); }}><RotateCcw size={16} /> Start a new conversation</button></div></Drawer>}
    {toast && <div className="toast" role="status"><Flower2 size={18} />{toast}<button aria-label="Dismiss notification" onClick={() => setToast('')}><X size={15} /></button></div>}
  </div>;
}

function NavButton({ icon, label, active, onClick }: {icon: ReactNode; label: string; active?: boolean; onClick: () => void}) { return <button className={`nav-button ${active ? 'active' : ''}`} aria-current={active ? 'page' : undefined} onClick={onClick}>{icon}<span>{label}</span></button>; }
function Avatar({ companion, small = false }: { companion: Companion; small?: boolean }) { return <div className={`avatar tint-${companion.tint} ${small ? 'avatar-small' : ''}`}><img src={companion.artwork || sakura.artwork} alt="" /></div>; }
function WaffleMark() { return <svg viewBox="0 0 48 48" fill="none" aria-hidden="true"><rect x="6" y="8" width="34" height="34" rx="11" fill="#DCA66E" /><rect x="9" y="11" width="28" height="28" rx="8" fill="#F0C28A" /><path d="M18 14v22M28 14v22M13 20h20M13 30h20" stroke="#C58C58" strokeWidth="3" strokeLinecap="round" /><path d="M36 6c-5-5-12 2 0 10 12-8 5-15 0-10" fill="#D77794" /><path d="M11 14l2-2" stroke="#FFE8B9" strokeWidth="2" strokeLinecap="round" /></svg>; }

function Drawer({ title, eyebrow, children, onClose }: { title: string; eyebrow: string; children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose); closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
    ref.current?.querySelector<HTMLElement>('button, input, select, textarea')?.focus();
    function handle(event: KeyboardEvent) {
      if (event.key === 'Escape') closeRef.current();
      if (event.key === 'Tab') {
        const elements = Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]') ?? []).filter(e => e.getClientRects().length > 0);
        const first = elements[0]; const last = elements[elements.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }
    document.addEventListener('keydown', handle);
    return () => { document.body.style.overflow = overflow; document.removeEventListener('keydown', handle); previous?.focus(); };
  }, []);
  return <div className="drawer-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}><div className="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title" ref={ref}><div className="drawer-header"><div><span className="eyebrow">{eyebrow}</span><h2 id="drawer-title">{title}</h2></div><button className="icon-button" aria-label="Close panel" onClick={onClose}><X size={22} /></button></div><div className="drawer-body">{children}</div></div></div>;
}

function Field({ label, note, children }: { label: string; note?: string; children: ReactNode }) {
  const id = useId();
  return <div className="field"><label htmlFor={id}>{label}</label>{isValidElement(children) ? cloneElement(children as ReactElement<{id?: string; 'aria-describedby'?: string}>, { id, 'aria-describedby': note ? `${id}-note` : undefined }) : children}{note && <small id={`${id}-note`}>{note}</small>}</div>;
}
function Toggle({ label, note, checked, onChange }: {label: string; note: string; checked: boolean; onChange: () => void}) { return <label className="toggle-row"><span><strong>{label}</strong><small>{note}</small></span><input type="checkbox" checked={checked} onChange={onChange} /><span className="toggle" /></label>; }
function safeArtwork(value: string) { return value === '' || value.startsWith('/art/') || /^\/api\/art\/[a-f0-9-]{36}\.(png|jpg|webp)$/.test(value) || /^https:\/\//.test(value); }

function StudioForm({ companion, onSave, onExport }: {companion: Companion | null; onSave: (companion: Companion) => void; onExport: (companion: Companion) => void}) {
  const [draft, setDraft] = useState<Companion>(() => companion ? { ...companion } : { ...sakura, id: createId(), name: '', subtitle: '', description: '', traits: ['Gentle', 'Curious'], prompt: 'You are a warm and thoughtful fictional virtual companion. Listen carefully, ask natural questions, and respond in a conversational way. Keep replies to a few sentences and adapt to the user’s language.', greeting: 'Hi there! I’m happy we get to meet. What would you like to talk about?', memory: '', voiceId: '' });
  const [traits, setTraits] = useState(draft.traits.join(', '));
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const upload = useRef<HTMLInputElement>(null);
  function set<K extends keyof Companion>(key: K, value: Companion[K]) { setDraft(s => ({ ...s, [key]: value })); }
  async function uploadArt(file?: File) {
    if (!file) return;
    setUploading(true); setError('');
    try {
      const form = new FormData(); form.append('file', file);
      const response = await fetch('/api/upload', { method: 'POST', body: form });
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      set('artwork', data.url);
    } catch (error) { setError((error as Error).message); } finally { setUploading(false); }
  }
  function submit(e: FormEvent) {
    e.preventDefault(); setError('');
    const value = { ...draft, name: draft.name.trim(), traits: [...new Set(traits.split(',').map(t => t.trim()).filter(Boolean))] };
    if (!safeArtwork(value.artwork)) { setError('Use an uploaded portrait or an HTTPS artwork URL.'); return; }
    const parsed = companionSchema.safeParse(value);
    if (!parsed.success) { setError(parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(' · ')); return; }
    onSave(parsed.data);
  }
  return <form onSubmit={submit} className="settings-form"><p className="form-description">A familiar face. A personality all their own. Make a companion that feels like your kind of company.</p>
    <div className={`studio-portrait tint-${draft.tint}`}><img src={safeArtwork(draft.artwork) ? draft.artwork || sakura.artwork : sakura.artwork} alt="Companion portrait preview" /><button className="button button-secondary" type="button" disabled={uploading} onClick={() => upload.current?.click()}>{uploading ? <LoaderCircle className="spin" size={15} /> : <ImagePlus size={15} />} {uploading ? 'Uploading…' : 'Upload portrait'}</button><span>PNG, JPEG, or WebP · up to 5 MB</span></div>
    <input ref={upload} type="file" accept="image/png,image/jpeg,image/webp" className="visually-hidden" aria-label="Upload companion portrait" onChange={e => { void uploadArt(e.target.files?.[0]); }} />
    <Field label="Name"><input required maxLength={40} placeholder="What should we call them?" value={draft.name} onChange={e => set('name', e.target.value)} /></Field>
    <Field label="A little introduction"><input maxLength={120} placeholder="Your soft place to land" value={draft.subtitle} onChange={e => set('subtitle', e.target.value)} /></Field>
    <Field label="Personality" note="Up to 6 traits, separated by commas."><input value={traits} maxLength={180} onChange={e => setTraits(e.target.value)} placeholder="Gentle, curious, a little playful" /></Field>
    <Field label="Their story"><textarea rows={3} maxLength={1000} placeholder="The things they love, their little quirks, their world…" value={draft.description} onChange={e => set('description', e.target.value)} /></Field>
    <div className="field"><span>Accent color</span><div className="tint-picker">{(['rose', 'lavender', 'sage'] as const).map(tint => <button type="button" key={tint} className={`tint-swatch ${tint} ${draft.tint === tint ? 'selected' : ''}`} aria-label={`${tint} accent`} aria-pressed={draft.tint === tint} onClick={() => set('tint', tint)}>{draft.tint === tint && <Check size={15} />}</button>)}</div></div>
    <Field label="First words" note="Used when starting a new conversation."><textarea rows={3} maxLength={2000} value={draft.greeting} onChange={e => set('greeting', e.target.value)} /></Field>
    <details className="advanced-fields" open><summary><WandSparkles size={16} /> Personality prompt & memory<ChevronDown size={15} /></summary><Field label="Personality prompt" note="Instructions that shape how your connected chat model responds."><textarea className="code-input" required rows={7} maxLength={12000} value={draft.prompt} onChange={e => set('prompt', e.target.value)} /></Field><Field label="Things to remember" note="These notes are included with each AI conversation request."><textarea rows={3} maxLength={8000} placeholder="Your name, favorite things, ongoing projects…" value={draft.memory} onChange={e => set('memory', e.target.value)} /></Field><Field label="ElevenLabs voice ID" note="Choose ElevenLabs in Settings to use this voice."><input value={draft.voiceId} maxLength={120} placeholder="Paste a voice ID" onChange={e => set('voiceId', e.target.value)} /></Field><Field label="Artwork URL" note="An HTTPS image URL, or use Upload portrait above."><input value={draft.artwork} maxLength={2048} onChange={e => set('artwork', e.target.value)} /></Field></details>
    {error && <p className="form-error" role="alert">{error}</p>}<div className="form-actions">{companion && <button className="button button-secondary" type="button" onClick={() => onExport(draft)}><Download size={16} /> Export</button>}<button className="button button-pink" type="submit" disabled={uploading}><Heart size={16} /> {companion ? 'Save companion' : 'Create companion'}</button></div>
  </form>;
}

function SettingsForm({ settings, secrets, health, onSave, onRemoveKey, onExport, onImport }: {settings: Settings; secrets: Secrets; health: Health | null; onSave: (settings: Settings, secrets: Secrets) => Promise<void>; onRemoveKey: (provider: keyof Secrets) => Promise<void>; onExport: () => void; onImport: (data: unknown) => void}) {
  const [draft, setDraft] = useState(settings);
  const [keys, setKeys] = useState(secrets);
  const [models, setModels] = useState<{id: string; name: string}[]>([]);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ok: boolean; text: string} | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const restore = useRef<HTMLInputElement>(null);
  function set<K extends keyof Settings>(key: K, value: Settings[K]) { setDraft(s => ({ ...s, [key]: value })); }
  async function save() {
    if (saving) return;
    setSaving(true); setSaveError('');
    try { await onSave(draft, keys); }
    catch (error) { setSaveError((error as Error).message); }
    finally { setSaving(false); }
  }
  async function remove(provider: keyof Secrets) {
    if (saving) return;
    setSaving(true); setSaveError('');
    try { await onRemoveKey(provider); setKeys(current => ({ ...current, [provider]: '' })); }
    catch (error) { setSaveError((error as Error).message); }
    finally { setSaving(false); }
  }
  async function test() {
    setTesting(true); setTestResult(null);
    try {
      const result = await api<{models: {id: string; name: string}[]}>('/api/models', { settings: draft, key: keys.openrouter });
      setModels(result.models);
      setTestResult({ ok: true, text: draft.provider === 'demo' ? 'Demo is ready. Replies are scripted and do not use an AI model.' : `Connected. ${result.models.length} model${result.models.length === 1 ? '' : 's'} available.` });
      if (draft.provider !== 'demo' && !draft.model && result.models[0]) set('model', result.models[0].id);
    } catch (error) { setTestResult({ ok: false, text: (error as Error).message }); } finally { setTesting(false); }
  }
  return <form className="settings-form" onSubmit={e => { e.preventDefault(); void save(); }}>
    <p className="form-description">Choose the mind behind the conversation, find their voice, and add your little finishing touches.</p>
    <div className="form-section-title"><MessageCircle size={17} /><h3>The conversation</h3></div>
    <Field label="Chat provider"><select value={draft.provider} onChange={e => { const provider = e.target.value as Settings['provider']; setDraft(s => ({ ...s, provider, model: '' })); setModels([]); setTestResult(null); }}><option value="demo">Waffle demo · no setup needed</option><option value="ollama">Ollama / local compatible server</option><option value="openrouter">OpenRouter</option></select></Field>
    {draft.provider === 'demo' && <p className="form-callout"><Sparkles size={17} /> A few scripted replies to explore the experience. Choose Ollama or OpenRouter for real AI conversation.</p>}
    {draft.provider === 'ollama' && <><Field label="Local server URL" note="Use the OpenAI-compatible endpoint on your computer."><input type="url" required value={draft.baseUrl} onChange={e => set('baseUrl', e.target.value)} placeholder="http://127.0.0.1:11434/v1" /></Field>{health && !health.local && <p className="form-callout">To reach Ollama on your computer, run this app locally and open http://localhost:5174. A hosted app cannot reach your computer’s localhost.</p>}</>}
    {draft.provider === 'openrouter' && <ProviderKeyField provider="openrouter" label="OpenRouter" value={keys.openrouter} health={health} disabled={saving} onChange={value => setKeys(current => ({ ...current, openrouter: value }))} onRemove={() => void remove('openrouter')} />}
    {draft.provider !== 'demo' && <><Field label="Chat model" note="Test the connection to load available models, or enter a model ID."><input list="available-models" required value={draft.model} onChange={e => set('model', e.target.value)} placeholder={draft.provider === 'ollama' ? 'qwen3:8b' : 'provider/model-id'} /></Field><datalist id="available-models">{models.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}</datalist></>}
    <button className="button button-secondary test-button" type="button" disabled={testing} onClick={() => void test()}>{testing ? <LoaderCircle className="spin" size={15} /> : <ShieldCheck size={16} />}{testing ? 'Testing connection…' : 'Test connection'}</button>
    {testResult && <p role="status" className={testResult.ok ? 'form-success' : 'form-error'}>{testResult.text}</p>}
    <details className="advanced-fields">
      <summary><SlidersHorizontal size={16} /> Fine-tune the conversation<ChevronDown size={15} /></summary>
      <Field label="Conversation prompt" note="Extra instructions for all your companions, alongside their personality and memories. Leave empty to use their usual behavior.">
        <textarea rows={5} maxLength={12000} placeholder="For example: Be a supportive conversation partner. Ask thoughtful questions, help me explore ideas, and avoid giving advice unless I ask." value={draft.conversationPrompt} onChange={e => set('conversationPrompt', e.target.value)} />
      </Field>
      <Field label="Response style" note="Personalize the language, tone, length, or format of AI replies. These preferences apply to Ollama and OpenRouter; demo replies remain scripted.">
        <textarea rows={4} maxLength={6000} placeholder="For example: Reply in Spanish with a warm, playful tone. Keep replies under 100 words, use occasional emojis, and avoid roleplay actions." value={draft.responseStyle} onChange={e => set('responseStyle', e.target.value)} />
      </Field>
      <Field label={`Creativity · ${draft.temperature.toFixed(1)}`} note="Lower feels more predictable; higher adds variety."><input type="range" min="0" max="2" step="0.1" value={draft.temperature} onChange={e => set('temperature', Number(e.target.value))} /></Field>
      <div className="two-fields"><Field label="Reply token limit"><input type="number" min="64" max="8192" required value={draft.maxTokens} onChange={e => set('maxTokens', Number(e.target.value))} /></Field><Field label="Context messages"><input type="number" min="2" max="100" required value={draft.contextMessages} onChange={e => set('contextMessages', Number(e.target.value))} /></Field></div>
    </details>
    <div className="form-section-title"><Volume2 size={17} /><h3>A familiar voice</h3></div>
    <Field label="Voice provider"><select value={draft.voice} onChange={e => set('voice', e.target.value as Settings['voice'])}><option value="off">Text only</option><option value="browser">Browser voice · no API key</option><option value="elevenlabs">ElevenLabs</option></select></Field>
    {draft.voice === 'browser' && <p className="form-note">Uses your browser’s speech service. Available voices and offline support depend on your browser and operating system.</p>}
    {draft.voice === 'elevenlabs' && <><ProviderKeyField provider="elevenlabs" label="ElevenLabs" value={keys.elevenlabs} health={health} disabled={saving} onChange={value => setKeys(current => ({ ...current, elevenlabs: value }))} onRemove={() => void remove('elevenlabs')} /><Field label="Speech model ID" note="Set each companion’s voice ID in their Studio. Spoken reply text is sent to ElevenLabs."><input value={draft.voiceModel} required onChange={e => set('voiceModel', e.target.value)} maxLength={100} /></Field></>}
    <div className="form-section-title"><Flower2 size={17} /><h3>The little details</h3></div>
    <Toggle label="Dark mode" note="A cozy palette for quieter evenings." checked={draft.theme === 'dark'} onChange={() => set('theme', draft.theme === 'dark' ? 'light' : 'dark')} />
    <Toggle label="Soft little sounds" note="A gentle pop when you tap a button." checked={draft.sound} onChange={() => set('sound', !draft.sound)} />
    <Toggle label="Gentle motion" note="A little movement to bring the room to life." checked={draft.motion} onChange={() => set('motion', !draft.motion)} />
    <div className="form-section-title"><ShieldCheck size={17} /><h3>Your room, kept safe</h3></div><p className="form-note">Back up your companions, conversations, and preferences. API keys and uploaded artwork files are not included; uploaded portraits stay in this installation.</p>
    <div className="two-fields"><button className="button button-secondary" type="button" onClick={onExport}><Download size={15} /> Export room</button><button className="button button-secondary" type="button" onClick={() => restore.current?.click()}><Upload size={15} /> Restore room</button></div>
    <input ref={restore} type="file" accept="application/json,.json" className="visually-hidden" aria-label="Restore room backup" onChange={async e => { const file = e.target.files?.[0]; if (!file) return; if (file.size > 2000000) { setTestResult({ ok: false, text: 'Choose a backup smaller than 2 MB.' }); return; } try { const data = JSON.parse(await file.text()); if (window.confirm('Restore this backup? It will replace your current companions and conversations.')) onImport(data); } catch { setTestResult({ ok: false, text: 'That backup could not be read.' }); } }} />
    {saveError && <p className="form-error" role="alert">{saveError}</p>}
    <div className="form-actions"><button className="button button-pink" type="submit" disabled={saving}>{saving ? <LoaderCircle size={16} className="spin" /> : <Check size={16} />} {saving ? 'Saving…' : 'Save preferences'}</button></div>
  </form>;
}

function ProviderKeyField({ provider, label, value, health, disabled, onChange, onRemove }: {provider: keyof Secrets; label: string; value: string; health: Health | null; disabled: boolean; onChange: (value: string) => void; onRemove: () => void}) {
  const stored = !!health?.stored?.[provider];
  const configured = !!health?.configured[provider];
  const note = health?.keyStorage
    ? stored ? 'Saved on this computer. Leave empty to keep it, or enter a replacement.' : configured ? 'A server key is configured. Enter a key to save a local override.' : 'Saved privately on this computer when you save preferences.'
    : configured ? 'A server key is configured. Leave empty to use it, or enter a key for this tab.' : 'Kept in this tab’s memory. You’ll need to re-enter it after a refresh.';
  return <div className="provider-key-field">
    <Field label={`${label} API key`} note={note}><input type="password" autoComplete="off" spellCheck={false} maxLength={1000} value={value} disabled={disabled} onChange={event => onChange(event.target.value)} placeholder={stored ? 'Saved on this computer' : configured ? 'Server key configured' : provider === 'openrouter' ? 'sk-or-…' : 'Your ElevenLabs key'} /></Field>
    {stored && health?.keyStorage && <button type="button" className="text-button" disabled={disabled} onClick={onRemove} aria-label={`Remove saved ${label} key`}>Remove saved key</button>}
  </div>;
}
