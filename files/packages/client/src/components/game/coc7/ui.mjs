/* global document, fetch, navigator, createImageBitmap, Node, DOMParser, clearTimeout, setTimeout, FormData, AbortController, structuredClone, URL, window */
import { ATTR, DIFFICULTY, LEVEL, SKILL_CATEGORIES, ageRules, referenceSkillList, skillReference, applyAge, creationIssues, creationPointUsage, derived, integer, normalized, rollDice, skillCategory, skillGrowthAmount, skillStartingValue } from './rules.mjs';
import { defaultHistoryLimit, historyLimit, buildReplayHtml, rollText, currentInvestigatorSecret, scenarioFields, wrapUpSession, acceptTurn, addSkill, advanceSkill, append, applyCardProfile, applyCardSheetValues, applyProposal, audit, syncSheetProfile, buildPublicContext, capResources, cardAutoTargets, cardProfileFields, createCampaign, createSheet, evaluateProposal, expandMacro, handleInput, illustrationPrompt, imageTypes, injury, investigatorNotes, isIllustrationScene, latestRerollableTurn, pendingCount, personaSheet, pinnedMessageLimit, rerollTurnState, resolveIdea, rollCheck, rollGeneric, sanity, setSkillCategory, sheetFor, stat, textValue, uid } from './campaign.mjs';
import { assetFromFile, dataUrl, downloadFile, importBackup, makeBackup, parseModelJson, sendTurn, suggestionInput, summarizeSession } from './platform.mjs';
import { actionDex, attack, changeCombatantHealth, chaseMoves, enemyAttack, heal, resolveDying, spendMagic } from './advanced.mjs';
import { createMemoryLink, currentMemoryLink, memoryModes, memoryPeople } from './memory.mjs';
import { portraitWeatherLayer } from './portrait-weather.mjs';
import { costTotals, currencyLabel, fetchExchangeRate, fetchLocalRates, formatLocalAmount, formatMoney, fxSources, localCost, formatRate, formatTokens, formatUsd, modelPrices, priceSources, recordCost, shortTokens, usageLimit, usageParts, usageTasks, usageTotals, validUsageRecord } from './usage.mjs';

const imageAccept = '.png,.jpg,.jpeg,.gif,.webp';
const handoutAccept = `${imageAccept},.pdf,.txt`;
const leftPortraitAction = '왼쪽 사진으로 사용';
const defaultFrame = Object.freeze({ x:50, y:0 });

/* Message formatting: Markdown emphasis (***both***, **bold**, *italic*, ~~strike~~, `code`) and a safe subset of HTML.
   HTML is parsed inertly and rebuilt from allowed tags only, keeping a few harmless style properties, so a
   message can never run script or load anything. */
const richTags = new Set(['B','STRONG','I','EM','U','S','DEL','BR','SMALL','SUP','SUB','CODE','MARK','SPAN','FONT','P','DIV','BLOCKQUOTE','UL','OL','LI','H1','H2','H3','H4','HR','CENTER']);
const richStyles = new Set(['color','background-color','font-weight','font-style','text-decoration','font-size','text-align']);
const emphasis = /\*\*\*([^*\n]+?)\*\*\*|\*\*([^*\n]+?)\*\*|\*([^*\n]+?)\*|~~([^~\n]+?)~~|`([^`\n]+?)`/g;

function markdownInline(text) {
  const nodes = [];
  let last = 0;
  for (const match of text.matchAll(emphasis)) {
    if (match.index > last) nodes.push(document.createTextNode(text.slice(last,match.index)));
    const [, both, bold, italic, strike, code] = match;
    if (both != null) { const strong = document.createElement('strong'); strong.append(el('em',{},markdownInline(both))); nodes.push(strong); }
    else if (bold != null) nodes.push(el('strong',{},markdownInline(bold)));
    else if (italic != null) nodes.push(el('em',{},markdownInline(italic)));
    else if (strike != null) nodes.push(el('del',{},markdownInline(strike)));
    else nodes.push(el('code',{},code));
    last = match.index + match[0].length;
  }
  if (last < text.length) nodes.push(document.createTextNode(text.slice(last)));
  return nodes;
}

function richText(text) {
  const value = String(text ?? '');
  if (!/[<*~`&]/.test(value)) return value;
  const body = new DOMParser().parseFromString(`<body>${value}</body>`,'text/html').body;
  const rebuild = (node) => {
    if (node.nodeType === Node.TEXT_NODE) return markdownInline(node.textContent);
    if (node.nodeType !== Node.ELEMENT_NODE) return [];
    const children = [...node.childNodes].flatMap(rebuild);
    if (!richTags.has(node.tagName)) return children;
    const tag = { FONT:'span', CENTER:'div' }[node.tagName] ?? node.tagName.toLowerCase();
    const copy = document.createElement(tag);
    const styles = [...(node.style ?? [])].filter((name) => richStyles.has(name)).map((name) => [name,node.style.getPropertyValue(name)]);
    if (node.tagName === 'FONT' && node.getAttribute('color')) styles.push(['color',node.getAttribute('color')]);
    if (node.tagName === 'CENTER') styles.push(['text-align','center']);
    for (const [name,setting] of styles) if (!/url\(|expression|javascript:/i.test(setting)) copy.style.setProperty(name,setting);
    copy.append(...children);
    return [copy];
  };
  return [...body.childNodes].flatMap(rebuild);
}
const portraitWeather = { snow:'눈',rain:'비',fog:'안개' };
const tabs = { sheet:'조사자 시트', persona:'페르소나 시트', macros:'매크로', handouts:'핸드아웃', art:'삽화', npcs:'NPC', notes:'조사 노트', scenario:'시나리오', memory:'기억 서재', combat:'전투·추격', private:'키퍼 기록', sessions:'세션·설정', archive:'메시지 보관함' };
const roleLabels = { keeper:'키퍼', scene:'장면', npc:'NPC', emote:'행동', persona:'페르소나', investigator:'조사자', roll:'판정', handout:'핸드아웃', illustration:'삽화' };
const noteLabels = { fact:'확인된 사실 · AI에 공개', learned:'AI 요약', hypothesis:'조사자 가설', goal:'키퍼 목표 · 비공개', secret:'키퍼 단서 · 비공개', summary:'세션 요약 · AI에 공개' };
const messageIconPaths = {
  edit:'M21.2 8.8a2.8 2.8 0 0 0-4-4L5 17l-1 4 4-1Z M15 7l4 4',
  marks:'M5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16l-7-4Z',
  reroll:'M20 4v5h-5 M4 20v-5h5 M4.55 9a8 8 0 0 1 13.1-3L20 9 M4 15l2.35 3a8 8 0 0 0 13.1-3',
  copy:'M9 9h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V10a1 1 0 0 1 1-1Z M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1',
  close:'M6 6l12 12 M18 6L6 18',
  hide:'M3 3l18 18 M10.6 5.1A10 10 0 0 1 12 5c5 0 9 4.5 10 7a12 12 0 0 1-2.6 3.6 M6.6 6.6A12 12 0 0 0 2 12c1 2.5 5 7 10 7a9.8 9.8 0 0 0 4.4-1 M9.9 9.9a3 3 0 0 0 4.2 4.2',
  show:'M2 12c1-2.5 5-7 10-7s9 4.5 10 7c-1 2.5-5 7-10 7S3 14.5 2 12Z M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z',
  trash:'M3 6h18 M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2 M19 6l-1 14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1L5 6 M10 10v7 M14 10v7',
};

function el(tag, props = {}, ...children) {
  const item = document.createElement(tag);
  for (const [key,value] of Object.entries(props)) {
    if (key === 'class') item.className = value;
    else if (key.startsWith('on')) item.addEventListener(key.slice(2), value);
    else if (key === 'value') item.value = value ?? '';
    else if (key === 'checked') item.checked = !!value;
    else if (value === true) item.setAttribute(key, '');
    else if (value !== false && value != null) item.setAttribute(key, String(value));
  }
  for (const child of children.flat(Infinity)) {
    if (child != null && child !== false) item.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return item;
}

// A button whose label ends in 삭제/제거 is marked as destructive, so every panel can style those alike.
const destructiveLabel = /(?:삭제|제거)$/;
const button = (label, fn, props) => el('button', { type:'button', onclick:fn, ...props,
  ...(typeof label === 'string' && destructiveLabel.test(label.trim()) ? { class:[props?.class,'is-danger'].filter(Boolean).join(' ') } : {}) }, label);
const input = (name, value = '', attrs = {}) => el('input', { name, value, ...attrs });
const textarea = (name,value = '',attrs = {}) => el('textarea', { name, value, rows:3, ...attrs });
const check = (name, checked = false) => el('input', { type:'checkbox', name, checked });
const field = (label, control) => el('label', { class:'field' }, el('span', {}, label), control);
const toggle = (label, control) => el('label', { class:'toggle' }, control, label);
const select = (name, entries, value) => {
  const item = el('select', { name }, entries.map(([key,label]) => el('option', { value:key }, label)));
  item.value = value ?? '';
  if (item.selectedIndex < 0 && item.options.length) item.selectedIndex = 0;
  return item;
};
const row = (...content) => el('div', { class:'row' }, content);
const grid = (...content) => el('div', { class:'grid' }, content);
const note = (...children) => el('p', { class:'quiet' }, children);
const headline = (label) => el('h3', {}, label);
const section = (label, ...children) => el('details', { open:true }, el('summary', {}, label), el('div', { class:'section' }, children));
const required = { required:true };
const numeric = (min, max) => ({ type:'number', min, max, step:1, inputmode:'numeric' });
const sessionHeading = (session) => (session.number === 1 && session.title === '첫 세션' && !session.renamed ? '세션 1' : session.title) || `세션 ${session.number}`;
const currentSession = (campaign) => campaign.sessions.find((item) => item.number === campaign.session);
const messageSnippet = (entry) => entry.text.replace(/\s+/g,' ').slice(0,64);

function investigatorMessageParts(entry) {
  const { text, action } = entry;
  if (entry.type !== 'investigator' || typeof action !== 'string') return null;
  if (!action) return { action:'',dialogue:text };
  const paragraphs = action.split(/(\r?\n[ \t]*\r?\n)/).map((part,index) => index % 2
    ? part : part.trim().replace(/^(\*{1,3})([\s\S]+?)\1$/,'$2').trim());
  const starredAction = paragraphs.map((part,index) => index % 2 || !part ? part : `*${part}*`).join('');
  const prefix = [action,starredAction].find((candidate) => text === candidate || text.startsWith(`${candidate}\n\n`));
  return prefix ? { action:paragraphs.join(''),dialogue:text.slice(prefix.length + 2) } : null;
}

// A persona line split like an investigator answer: *starred* text is action, the rest is speech.
// An /em line is action as a whole.
function personaMessageParts(entry) {
  if (entry.type !== 'persona') return null;
  const text = String(entry.text ?? '');
  if (entry.personaAction) return [{ action:true,text:text.trim().replace(/^\*{1,3}([\s\S]+?)\*{1,3}$/,'$1').trim() }];
  const parts = [];
  let last = 0;
  const push = (action, value) => { const trimmed = value.trim(); if (trimmed) parts.push({ action,text:trimmed }); };
  for (const match of text.matchAll(/(?<!\*)\*(?!\*)([\s\S]+?)(?<!\*)\*(?!\*)/g)) {
    push(false,text.slice(last,match.index));
    push(true,match[1]);
    last = match.index + match[0].length;
  }
  push(false,text.slice(last));
  return parts.some((part) => part.action) ? parts : null;
}

function messageIcon(kind, filled = false) {
  const namespace = 'http://www.w3.org/2000/svg';
  const icon = document.createElementNS(namespace,'svg');
  icon.setAttribute('viewBox','0 0 24 24');
  icon.setAttribute('aria-hidden','true');
  const path = document.createElementNS(namespace,'path');
  path.setAttribute('d',messageIconPaths[kind]);
  path.setAttribute('fill',filled ? 'currentColor' : 'none');
  path.setAttribute('stroke','currentColor');
  path.setAttribute('stroke-width','2');
  path.setAttribute('stroke-linecap','round');
  path.setAttribute('stroke-linejoin','round');
  icon.append(path);
  return icon;
}

export function createWorkspace(container, adapter, options = {}) {
  let vault, state, status = '', statusKind = '', running, draft = '', active = 'sheet', closed = false;
  let library = { cards:[], presets:[], connections:[], chats:[], personas:[], lorebooks:[], ready:false };
  let libraryError = '', libraryLoaded = false;
  let memoryRooms, memoryDraft;
  let analyzePending = null, extractPending = null, older = 120, flashRoll = '', revealArt = '';
  let timelineAtEnd = true, followLatest = false;
  // Phones read more than they play, so the input folds to one line until it is tapped open.
  let composeOpen = false;
  // Session wrap-up: the button shows it is working, and the record of the wrap-up just made opens by itself.
  let wrappingUp = false, justWrappedAt = null;
  // A phone reader can tuck the input away entirely; a small ✎ button brings it back. Remembered per browser.
  let composeHidden = false;
  try { composeHidden = window.localStorage.getItem('coc7.composeHidden') === '1'; } catch { /* Start shown. */ }
  const setComposeHidden = (hidden) => {
    composeHidden = hidden;
    composeOpen = false;
    try { window.localStorage.setItem('coc7.composeHidden',hidden ? '1' : '0'); } catch { /* Kept for this session only. */ }
    render();
  };
  let timelineCache = null;
  let revealHandout = '';
  let skillAnalysisFor = null;
  let statusTimer;
  let smallPane = false;
  // The side panel folds into a thin strip on wide screens; remembered per browser.
  let panelFolded = false;
  try { panelFolded = window.localStorage.getItem('coc7.panelFolded') === '1'; } catch { /* Start unfolded. */ }
  let choosingScenes = false;
  const urls = new Map();
  const imageColors = new Map();
  const selectedScenes = new Set();
  const temporaryDisclosures = new Map();
  const surface = el('div', { class:'coc7-game-workspace', lang:'ko' });
  container.append(surface);
  // The investigator photo column can be dragged wider or narrower on wide screens; remembered per browser.
  let leftWidth = 0;
  try { leftWidth = Number(window.localStorage.getItem('coc7.leftWidth')) || 0; } catch { /* Default width. */ }
  const applyLeftWidth = () => {
    if (leftWidth) surface.style.setProperty('--coc-left-width',`${leftWidth}px`);
    else surface.style.removeProperty('--coc-left-width');
  };
  const saveLeftWidth = () => {
    try {
      if (leftWidth) window.localStorage.setItem('coc7.leftWidth',String(leftWidth));
      else window.localStorage.removeItem('coc7.leftWidth');
    } catch { /* Kept for this session only. */ }
  };
  applyLeftWidth();
  const safeImageUrl = (url) => typeof url === 'string' && /^\/(?:api\/(?:gallery|characters|avatars)\/|avatars\/)[^\\\s]+$/.test(url);
  const playerPersona = () => library.personas.find((item) => item.id === library.chats[0]?.personaId);
  // Usage arrives while a call finishes and is written with the next save, so it never races another save.
  let pendingUsage = [];
  adapter.setUsageListener?.((record) => { pendingUsage.push({ ...record, id:uid(), session:state?.session ?? 1 }); });

  function restoreDisclosures(panel, previousPanel) {
    const keyFor = (summary) => {
      const { disclosureId, handoutId } = summary.parentElement.dataset;
      return `marinara:coc7:disclosure:${options.gameChatId}:${panel.dataset.tab}:${disclosureId ?? handoutId ?? summary.textContent}`;
    };
    const previous = previousPanel?.dataset.tab === panel.dataset.tab
      ? new Map([...previousPanel.querySelectorAll('details > summary')].map((summary) => [keyFor(summary),summary.parentElement.open]))
      : new Map();
    for (const summary of panel.querySelectorAll('details > summary')) {
      const details = summary.parentElement;
      const key = keyFor(summary);
      let saved;
      try { saved = window.localStorage.getItem(key); } catch { /* Keep using the in-memory preference. */ }
      const preference = temporaryDisclosures.get(key) ?? (saved === 'open' ? true : saved === 'closed' ? false : undefined);
      details.open = preference ?? previous.get(key) ?? details.open;
      summary.addEventListener('click',(event) => {
        if (event.defaultPrevented || event.target.closest?.('a,button,input,label,select,textarea')) return;
        event.preventDefault();
        details.open = !details.open;
        try {
          window.localStorage.setItem(key,details.open ? 'open' : 'closed');
          temporaryDisclosures.delete(key);
        } catch {
          temporaryDisclosures.set(key,details.open);
        }
      });
    }
  }

  function updateNotice() {
    const error = statusKind === 'error' ? status : '';
    const bar = surface.querySelector('[data-status]');
    if (bar) {
      bar.textContent = error ? '' : status || (state?.keeperWait ? '키퍼의 판정 결과를 기다리는 중' : '');
      bar.classList.toggle('notice',statusKind === 'notice');
    }
    const errorLine = surface.querySelector('#coc7-keeper-error');
    const composer = surface.querySelector('#coc7-keeper-input');
    if (errorLine && composer) {
      errorLine.hidden = !error;
      errorLine.textContent = error;
      if (error) composer.setAttribute('aria-describedby',errorLine.id);
      else composer.removeAttribute('aria-describedby');
    }
  }

  function announce(message, kind = '') {
    clearTimeout(statusTimer);
    status = message;
    statusKind = kind;
    updateNotice();
    if (message === '응답 완료') statusTimer = setTimeout(() => announce(''),2500);
  }

  function form(submit, children, label = '저장', className = '') {
    return el('form', { class:className, onsubmit:(event) => {
      event.preventDefault();
      const values = new FormData(event.currentTarget);
      void run((signal) => submit(values,signal), '', false, true);
    } }, children, label === null ? null : el('button', { class:'button', type:'submit' }, label));
  }

  async function run(task, label = '', cancellable = false, queue = false) {
    if (closed || running) return;
    const initialSequence = state?.seq;
    const controller = new AbortController();
    const cancelLocation = cancellable === true ? 'chat' : cancellable || null;
    running = { controller, cancelLocation };
    announce(label);
    surface.setAttribute('aria-busy', 'true');
    for (const control of surface.querySelectorAll('[data-cancel]')) {
      control.hidden = control.dataset.cancel !== cancelLocation;
    }
    let completed = false;
    try { await task(controller.signal); completed = true; }
    catch (error) { announce(error?.message ?? '요청을 완료하지 못했습니다.', 'error'); }
    finally {
      running = null;
      if (!closed) render();
    }
    if (completed && queue && state.seq > initialSequence && state.settings.auto && pendingCount(state) && !state.keeperWait && !state.pending.length) void answer();
  }

  function cancelRequestButton(location) {
    return button('요청 취소',() => {
      if (running?.cancelLocation === location) running.controller.abort();
    },{ 'data-cancel':location,hidden:running?.cancelLocation !== location });
  }

  async function transact(update) {
    const next = structuredClone(state);
    const media = { add:[], remove:[] };
    await update(next, media);
    const flushedUsage = pendingUsage.slice();
    if (flushedUsage.length) next.usageLog = [...(Array.isArray(next.usageLog) ? next.usageLog : []),...flushedUsage].slice(-usageLimit);
    if (next.audit.length === state.audit.length) audit(next,`저장 · ${tabs[active]} 또는 플레이 입력`);
    next.revision++;
    await vault.save(next, state.revision, media);
    if (flushedUsage.length) pendingUsage = pendingUsage.filter((record) => !flushedUsage.includes(record));
    for (const id of media.remove) {
      const key = `${state.id}:${id}`;
      if (urls.has(key)) URL.revokeObjectURL(urls.get(key));
      urls.delete(key);
    }
    if (next.settings.cardId !== state.settings.cardId ||
      (!next.settings.cardId && normalized(String(next.sheet.name ?? '')) !== normalized(String(state.sheet.name ?? '')))) memoryDraft = null;
    state = next;
    return state;
  }

  function action(update, label = '') {
    return () => void run(async () => { await transact(update); announce(label); }, '', false, true);
  }

  function revokeUrls() {
    for (const url of urls.values()) URL.revokeObjectURL(url);
    urls.clear();
  }

  function assetImage(id, alt, props = {}) {
    const image = el('img', { alt, ...props });
    const key = `${state.id}:${id}`;
    if (urls.has(key)) image.src = urls.get(key);
    else if (id) void vault.blob(state.id, id).then((blob) => {
      if (!blob || closed || !image.isConnected) return;
      if (!urls.has(key)) urls.set(key, URL.createObjectURL(blob));
      image.src = urls.get(key);
    }).catch(() => {});
    return image;
  }

  function sourceImage(url, alt, props = {}) {
    return el('img', { alt, ...props, src:safeImageUrl(url) ? url : undefined });
  }

  function portraitSource(entry = {}) {
    const key = entry.characterId ?? (state.settings.cardId || 'local');
    const choice = state.portraitChoices?.[key];
    if (choice?.remote?.startsWith('/api/gallery/') && safeImageUrl(choice.remote)) return { remote:choice.remote };
    if (choice?.asset && state.assets.some((item) => item.id === choice.asset && imageTypes.includes(item.type))) return { asset:choice.asset };
    const asset = state.portraits[key];
    if (choice?.upload && asset) return { asset };
    if (key === state.settings.cardId && safeImageUrl(state.card.avatar)) return { remote:state.card.avatar };
    return asset ? { asset } : null;
  }

  function openSheet() {
    active = 'sheet';
    smallPane = true;
    render();
    surface.querySelector('[data-investigator-sheet]')?.focus({ preventScroll:true });
  }

  function openPersonaSheet() {
    active = 'persona';
    smallPane = true;
    render();
    surface.querySelector('[data-tab="persona"]')?.focus({ preventScroll:true });
  }

  function investigatorName() {
    return button(state.sheet.name,openInvestigatorName,{ class:'investigator-name', title:state.sheet.finalized ? '캐릭터 시트 보기' : '조사자 시트 열기' });
  }

  function setPortraitChoice(choice) {
    return action((next) => {
      const key = next.settings.cardId || 'local';
      if (choice) (next.portraitChoices ??= {})[key] = choice;
      else if (next.portraitChoices) delete next.portraitChoices[key];
      // A new picture starts from the default framing.
      if (next.portraitFrames) delete next.portraitFrames[key];
    },choice ? '선택한 삽화를 조사자 사진으로 적용했습니다.' : '봇카드 사진으로 복원했습니다.');
  }

  async function choosePortrait() {
    if (running) return;
    const images = new Map();
    const add = (image) => images.set(image.asset || image.remote,image);
    for (const entry of [...state.timeline].reverse()) {
      if (visibleIllustration(entry) && (entry.assetId || entry.remote?.startsWith('/api/gallery/'))) {
        add({ asset:entry.assetId, remote:entry.remote, title:entry.text });
      }
    }
    await run(async (signal) => {
      for (const item of await adapter.gallery(signal)) {
        if (item.url?.startsWith('/api/gallery/') && safeImageUrl(item.url)) add({ remote:item.url, title:textValue(item.title,150) || '장면 삽화' });
      }
      announce('');
    },'이 게임의 삽화를 불러오는 중…',true);
    if (closed) return;
    const dialog = el('dialog',{ class:'media-dialog portrait-gallery','aria-label':'삽화에서 조사자 사진 고르기' });
    dialog.addEventListener('close',() => dialog.remove(),{ once:true });
    const current = portraitSource();
    dialog.append(row(headline('삽화에서 조사자 사진 고르기'),button('닫기',() => dialog.close())));
    const botPhoto = safeImageUrl(state.card.avatar) ? state.card.avatar : '';
    const restoreCard = botPhoto ? button([sourceImage(botPhoto,''),el('span',{},'봇카드')],() => {
      dialog.close();
      setPortraitChoice(null)();
    },{ class:'portrait-candidate','aria-label':'봇카드 사진으로 복원','aria-pressed':String(current?.remote === botPhoto) }) : null;
    dialog.append(el('div',{ class:'portrait-gallery-grid' },restoreCard,[...images.values()].map(({ asset,remote,title }) => {
      const selected = asset ? current?.asset === asset : current?.remote === remote;
      return button([asset ? assetImage(asset,'') : sourceImage(remote,'',{ loading:'lazy' }),el('span',{},title),
        el('span',{ class:'quiet' },leftPortraitAction)],() => {
        dialog.close();
        setPortraitChoice(asset ? { asset } : { remote })();
      },{ class:'portrait-candidate','aria-label':`${leftPortraitAction} · ${title}`,'aria-pressed':String(selected) });
    })));
    surface.append(dialog);
    dialog.showModal();
  }

  function openPortraitSettings() {
    if (running) return;
    active = 'sheet';
    smallPane = true;
    render();
    const picker = surface.querySelector('input[name=image]');
    if (picker) {
      picker.closest('details').open = true;
      picker.focus();
    }
  }

  function portrait(entry = {}, kind = 'round') {
    const photo = portraitSource(entry);
    if (!photo && (kind === 'print' || kind === 'heading')) {
      return button([
        el('span',{ class:'portrait-placeholder-icon','aria-hidden':true },'＋'),
        kind === 'print' ? el('span',{},'사진 추가') : null,
      ],openPortraitSettings,{
        class:`portrait-button portrait-placeholder portrait-${kind === 'print' ? 'print' : 'round'}`,
        'aria-label':'조사자 사진 추가', title:'조사자 사진 추가', disabled:!!running,
      });
    }
    if (!photo) return el('span', { class:'avatar fallback', 'aria-hidden':true }, '🕵️');
    const name = entry.speaker || state.sheet.name;
    const title = `${name} 조사자 사진`;
    const image = photo.asset ? assetImage(photo.asset, '') : sourceImage(photo.remote, '');
    const previewKind = kind === 'print' || kind === 'heading' ? 'portrait' : undefined;
    if (kind === 'print') watchImageAccent(image,photo.asset || photo.remote,(color) => surface.style.setProperty('--portrait-image-color',color));
    return button(image, () => showPreview(photo.asset,photo.remote,title,previewKind), {
      class:`portrait-button portrait-${kind === 'heading' ? 'round' : kind}`, 'aria-label':`${title} 확대`, title:`${title} 확대`,
    });
  }

  function watchImageAccent(image,key,apply) {
    if (!image || !key) return;
    if (imageColors.has(key)) {
      apply(imageColors.get(key));
      return;
    }
    image.addEventListener('load',() => {
      if (!surface.contains(image)) return;
      if (imageColors.has(key)) { apply(imageColors.get(key)); return; }
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 16;
      let color = '';
      try {
        const context = canvas.getContext('2d',{ willReadFrequently:true });
        if (!context) return;
        context.drawImage(image,0,0,16,16);
        const pixels = context.getImageData(0,0,16,16).data;
        const sums = [0,0,0];
        let weight = 0;
        for (let i=0; i<pixels.length; i+=4) {
          const [r,g,b,a] = pixels.subarray(i,i+4);
          const saturation = Math.max(r,g,b)-Math.min(r,g,b);
          if (a < 180 || saturation < 24 || Math.max(r,g,b) < 60) continue;
          sums[0] += r*saturation; sums[1] += g*saturation; sums[2] += b*saturation;
          weight += saturation;
        }
        if (weight) color = `rgb(${sums.map((value) => Math.round(value/weight)).join(' ')})`;
      } catch { /* The theme still applies to images that cannot be sampled. */ }
      imageColors.set(key,color);
      apply(color);
    },{ once:true });
  }

  // The left photo is kept between redraws while nothing on it changes, so its weather canvas keeps running
  // instead of being rebuilt (and its pattern redrawn) on every click.
  let boardCache = null;
  function investigatorBoard() {
    const photo = portraitSource();
    const key = JSON.stringify([photo, state.sheet.hp, state.sheet.san, state.sheet.name, state.sheet.occupation, state.sheet.finalized,
      currentSession(state)?.portraitWeather ?? '', running ? 1 : 0]);
    if (boardCache?.key === key) return boardCache.node;
    const node = buildInvestigatorBoard(photo);
    boardCache = { key, node };
    return node;
  }

  function buildInvestigatorBoard(photo) {
    const stats = photo ? el('dl',{ class:'portrait-vitals','aria-label':'조사자 상태' },
      el('div',{},el('dt',{},'HP'),el('dd',{},state.sheet.hp)),
      el('div',{},el('dt',{},'SAN'),el('dd',{},state.sheet.san))) : null;
    return el('aside',{ class:'investigator-board','aria-label':'조사자 프로필' },
      el('figure',{ class:'investigator-photo' },
        el('div',{ class:'portrait-frame' },portrait({},'print'),photo ? portraitWeatherLayer(currentSession(state)?.portraitWeather) : null,stats),
        el('figcaption',{},investigatorName(),
          state.sheet.occupation ? note(state.sheet.occupation) : null)),
      boardResizer());
  }

  // The divider on the photo column's right edge: drag (or arrow keys) to resize, double-click to reset.
  function boardResizer() {
    const handle = el('div',{ class:'board-resizer',role:'separator','aria-orientation':'vertical',tabindex:0,
      'aria-label':'조사자 사진 칸 너비',title:'끌어서 너비 조절 · 두 번 누르면 원래대로' });
    const setWidth = (px) => {
      const board = surface.querySelector('.board');
      if (!board) return;
      const max = Math.max(240,board.clientWidth * .6);
      leftWidth = Math.round(Math.min(max,Math.max(180,px)));
      applyLeftWidth();
    };
    handle.addEventListener('pointerdown',(event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      const left = surface.querySelector('.board')?.getBoundingClientRect().left ?? 0;
      const move = (next) => setWidth(next.clientX - left);
      const stop = () => {
        handle.removeEventListener('pointermove',move);
        handle.removeEventListener('pointerup',stop);
        handle.removeEventListener('pointercancel',stop);
        surface.classList.remove('resizing');
        saveLeftWidth();
      };
      handle.setPointerCapture(event.pointerId);
      surface.classList.add('resizing');
      handle.addEventListener('pointermove',move);
      handle.addEventListener('pointerup',stop);
      handle.addEventListener('pointercancel',stop);
    });
    handle.addEventListener('dblclick',() => { leftWidth = 0; applyLeftWidth(); saveLeftWidth(); });
    handle.addEventListener('keydown',(event) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      setWidth(handle.parentElement.getBoundingClientRect().width + (event.key === 'ArrowRight' ? 16 : -16));
      saveLeftWidth();
    });
    return handle;
  }

  // The prompt an illustration was drawn from, under the enlarged image: the one saved with it, or, for
  // illustrations made before prompts were saved, the one Marinara's gallery kept for the same file.
  // The prompt is editable: redrawing sends whatever the box holds, so it rerolls as-is or with changes.
  function illustrationPromptView(entry, close) {
    const text = textarea('image-prompt',entry.imagePrompt || '',{ class:'illustration-prompt-text',rows:9,'aria-label':'삽화 프롬프트',
      placeholder:entry.imagePrompt ? '' : '프롬프트를 불러오는 중…' });
    const copy = button(messageIcon('copy'),() => { void navigator.clipboard?.writeText(text.value).then(() => announce('프롬프트를 복사했습니다.','ok')); },
      { class:'viewer-icon',title:'프롬프트 복사','aria-label':'프롬프트 복사' });
    const redraw = button([messageIcon('reroll'),el('span',{},'이 프롬프트로 다시 그리기')],() => { close(); rerollIllustration(entry,text.value); },
      { class:'viewer-redraw',disabled:!!running || !entry.remote });
    const versions = Array.isArray(entry.variants) && entry.variants.length > 1 ? el('div',{ class:'viewer-section' },
      el('div',{ class:'viewer-label' },el('strong',{},'버전'),el('span',{},`${entry.variants.length}개 · 눌러서 바꾸기`)),
      el('div',{ class:'illustration-variant-list' },entry.variants.map((variant,index) => button([sourceImage(variant.remote,`버전 ${index + 1}`),el('span',{},index + 1)],() => {
        close();
        chooseIllustrationVariant(entry,index);
      },{ class:'illustration-variant','aria-pressed':String(variant.remote === entry.remote),title:`버전 ${index + 1}` })))) : null;
    const box = el('aside',{ class:'viewer-panel' },
      el('div',{ class:'viewer-section viewer-prompt' },
        el('div',{ class:'viewer-label' },el('strong',{},'프롬프트'),el('span',{},'고쳐서 다시 그릴 수 있어요'),copy),text),
      versions,redraw);
    if (!entry.imagePrompt) {
      adapter.illustrationRequest(entry.remote).then((request) => {
        text.value = request.prompt;
        text.placeholder = request.prompt ? '' : '이 삽화의 프롬프트 기록을 찾지 못했어요.';
      }).catch((error) => { text.placeholder = error.message; });
    }
    return box;
  }

  // Redraws an illustration through Marinara's regenerate; every version stays so an earlier one can come back.
  // Without an edited prompt the picture is redrawn from its scenes, so the prompt writer runs again with the
  // current appearance tags and settings; an edited prompt (or scenes since deleted) is sent to the image model as-is.
  function rerollIllustration(entry, prompt = '') {
    if (!entry.remote) return announce('업로드한 삽화는 다시 그릴 수 없어요.','error');
    void run(async (signal) => {
      let fresh = null;
      if (!prompt.trim() && entry.sceneIds?.length && adapter.illustrate) {
        try { fresh = illustrationPrompt(state,entry.sceneIds,playerPersona()); } catch { fresh = null; }
      }
      const drawn = fresh
        ? await adapter.illustrate(state,fresh.prompt,signal,fresh.appearances)
        : await adapter.rerollIllustration(entry.remote,prompt.trim(),signal);
      if (closed || signal.aborted) return;
      await transact((next) => {
        const target = next.timeline.find((item) => item.id === entry.id);
        if (!target) throw Error('삽화 메시지를 찾을 수 없습니다.');
        const variants = Array.isArray(target.variants) && target.variants.length ? target.variants : [{ remote:target.remote, imagePrompt:target.imagePrompt ?? '' }];
        target.variants = [...variants,{ remote:drawn.url, imagePrompt:drawn.prompt }].slice(-12);
        target.remote = drawn.url;
        target.imagePrompt = drawn.prompt;
        audit(next,`삽화 다시 그리기 · 버전 ${target.variants.length}`);
      });
      revealArt = entry.id;
      announce('삽화를 다시 그렸어요. 크게 보기에서 예전 버전으로 바꿀 수 있어요.','ok');
    },'삽화를 다시 그리는 중…',true);
  }

  function chooseIllustrationVariant(entry, index) {
    action((next) => {
      const target = next.timeline.find((item) => item.id === entry.id);
      const variant = target?.variants?.[index];
      if (!variant) throw Error('그 버전을 찾을 수 없습니다.');
      target.remote = variant.remote;
      target.imagePrompt = variant.imagePrompt;
    },`삽화를 버전 ${index + 1}(으)로 바꿨어요.`)();
  }

  function showPreview(asset, remote, title, kind = 'attachment', entry = null) {
    const dialog = el('dialog', { class:'media-dialog', 'aria-label':title });
    const close = () => dialog.close();
    dialog.addEventListener('close', () => dialog.remove(), { once:true });
    const image = asset ? assetImage(asset,title) : sourceImage(remote,title);
    const canUseAsPortrait = kind === 'illustration' && (asset || remote?.startsWith('/api/gallery/'));
    if (canUseAsPortrait) {
      watchImageAccent(image,asset || remote,(color) => dialog.style.setProperty('--illustration-color',color));
    }
    const preview = kind === 'portrait' ? el('div',{ class:'portrait-preview' },image,
      portraitWeatherLayer(currentSession(state)?.portraitWeather)) : image;
    // An illustration opens as a viewer: the picture on a dark stage, its prompt and versions in a side panel.
    if (kind === 'illustration' && entry) {
      dialog.classList.add('illustration-viewer');
      dialog.append(el('header',{ class:'viewer-head' },el('strong',{},title),
        canUseAsPortrait ? button(leftPortraitAction,() => { close(); setPortraitChoice(asset ? { asset } : { remote })(); },{ class:'viewer-chip' }) : null,
        button(messageIcon('close'),close,{ class:'viewer-icon',title:'닫기','aria-label':'닫기' })),
      el('div',{ class:'viewer-body' },el('div',{ class:'viewer-stage' },image),illustrationPromptView(entry,close)));
      surface.append(dialog);
      dialog.showModal();
      return;
    }
    dialog.append(row(el('strong',{},title),
      canUseAsPortrait ? button(leftPortraitAction,() => { close(); setPortraitChoice(asset ? { asset } : { remote })(); }) : null,
      button('닫기',close)),preview);
    surface.append(dialog);
    dialog.showModal();
  }

  // A finalized sheet opens as a read-only character sheet.
  // Drafts keep opening the editing tab, since their numbers are still moving.
  function openInvestigatorName() {
    if (state.sheet.finalized) showCharacterSheet();
    else openSheet();
  }

  function openPersonaName() {
    const id = playerPersona()?.id;
    if (personaSheet(state,id)?.finalized) showCharacterSheet(id);
    else openPersonaSheet();
  }

  const defaultSheetAccent = '#1f1f1f';
  const validAccent = (value) => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);

  // White or near-black band text, whichever reads better on the chosen accent.
  function accentTextColor(hex) {
    const channel = (offset) => {
      const value = parseInt(hex.slice(offset,offset + 2),16) / 255;
      return value <= .03928 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
    };
    const luminance = .2126 * channel(1) + .7152 * channel(3) + .0722 * channel(5);
    return luminance > .42 ? '#1f1f1f' : '#ffffff';
  }

  function applySheetAccent(target, hex) {
    const color = validAccent(hex) ? hex : defaultSheetAccent;
    target.style.setProperty('--sheet-accent',color);
    target.style.setProperty('--sheet-band-text',accentTextColor(color));
  }

  function showCharacterSheet(personaId) {
    const sheet = sheetFor(state,personaId);
    const persona = personaId ? playerPersona() : null;
    const limits = derived(sheet);
    const condition = personaId ? null : state.condition;
    const half = (value) => Math.floor(value / 2);
    const fifth = (value) => Math.floor(value / 5);
    const cell = (value, kind = '', title) => el('span',{ class:`sheet-cell${kind ? ` ${kind}` : ''}`,title },value);
    const box = (title, ...content) => el('section',{ class:'sheet-box' },el('h4',{},title),el('div',{ class:'sheet-box-body' },content));
    const info = (label, value) => el('div',{},el('dt',{},label),el('dd',{},value === '' || value == null ? '—' : String(value)));
    const levels = (value) => [cell(half(value),'sub','어려운 성공 (절반)'),cell(fifth(value),'sub','극단적 성공 (1/5)')];

    const source = personaId ? (safeImageUrl(persona?.avatarPath) ? { remote:persona.avatarPath } : null) : portraitSource();
    const photo = source ? (source.asset ? assetImage(source.asset,`${sheet.name} 사진`) : sourceImage(source.remote,`${sheet.name} 사진`))
      : el('span',{ class:'sheet-photo-empty' },'사진 없음');

    const identity = box('탐사자 정보',el('dl',{ class:'sheet-info' },
      info('이름',sheet.name),
      info('플레이어',personaId ? `페르소나 · ${persona?.name ?? sheet.name}` : 'AI 조사자'),
      info('직업',sheet.occupation),
      info('나이',sheet.age),
      info('성별',sheet.gender)));

    const attributes = box('특성치',el('div',{ class:'sheet-attributes' },
      Object.entries(ATTR).map(([key,label]) => el('div',{ class:'sheet-attribute' },
        el('span',{ class:'sheet-label' },label),cell(sheet.attributes[key],'main'),el('span',{ class:'sheet-levels' },levels(sheet.attributes[key])))),
      el('div',{ class:'sheet-attribute' },el('span',{ class:'sheet-label' },'이동력'),cell(limits.mov,'main'))));

    // Conditions show as words only while they apply; the sheet has no checkboxes.
    const wounds = condition ? [['dead','사망'],['dying','빈사'],['unconscious','의식불명'],['wound','중상']].filter(([key]) => condition[key]).map(([,label]) => label) : [];
    const insanity = condition?.insanity ?? '';
    const pair = (current, max, label) => el('div',{ class:'sheet-pair' },el('span',{ class:'sheet-label' },label),cell(current,'main'),
      max == null ? null : [el('span',{ class:'sheet-slash' },'/'),cell(max,'max','최대')]);
    const vitals = el('div',{ class:'sheet-vitals' },
      box('체력',pair(sheet.hp,limits.hp,'현재'),wounds.length ? el('p',{ class:'sheet-status' },wounds.join(' · ')) : null),
      box('행운',el('div',{ class:'sheet-pair' },el('span',{ class:'sheet-label' },'현재'),cell(sheet.luck,'main'),levels(sheet.luck))),
      box('마력',pair(sheet.mp,limits.mp,'현재')),
      box('이성',pair(sheet.san,limits.san,'현재'),
        condition ? el('div',{ class:'sheet-pair' },el('span',{ class:'sheet-label' },'시작'),cell(condition.sanAtStart,'max')) : null,
        insanity ? el('p',{ class:'sheet-status' },insanity) : null),
      box('피해 보너스 · 체구',el('div',{ class:'sheet-pair' },el('span',{ class:'sheet-label' },'피해'),cell(limits.db,'main'),
        el('span',{ class:'sheet-label' },'체구'),cell(limits.build,'main'))));

    const madness = condition && (insanity || condition.bout) ? box('광기의 발작',el('dl',{ class:'sheet-info' },
      info('현재 정신 상태',insanity),
      condition.bout ? info('발작표',`D10 ${condition.bout}${condition.hours ? ` · ${condition.hours}시간` : ''}`) : null)) : null;

    // Three columns: the occupation-side printed skills under the occupation points,
    // the interest-side ones under the personal interest points, and growth skills plus any added skills under
    // the remaining points. Points follow the rules: occupation formula (EDU×4 by default) and INT×2.
    const [occupationUsage, interestUsage] = creationPointUsage(sheet);
    const remaining = Math.max(0,occupationUsage.budget - occupationUsage.used) + Math.max(0,interestUsage.budget - interestUsage.used);
    const owned = new Set();
    const columns = { occupation:[], interest:[], growth:[] };
    for (const { name, base, category } of referenceSkillList(sheet)) {
      const reference = skillReference(name);
      const skill = sheet.skills.find((item) => !owned.has(item) && skillReference(item.name) === reference);
      if (skill) owned.add(skill);
      columns[category].push(skill ?? { name, base:base ?? 0, value:base ?? 0 });
    }
    columns.growth.push(...sheet.skills.filter((skill) => !owned.has(skill)).sort((a,b) => a.name.localeCompare(b.name,'ko')));

    const skillRow = (skill) => el('li',{ class:skill.value > skill.base ? 'is-owned' : 'is-base' },
      el('span',{ class:'sheet-skill-name' },el('span',{},skill.name)),
      cell(skill.base,'base','기본값'),
      cell(skill.value,'main','현재 값'),
      levels(skill.value));
    const pointHead = ({ used, budget, overBudget }, label) =>
      el('div',{ class:`sheet-column-head${overBudget ? ' over' : ''}`,title:overBudget ? '배정 가능한 점수를 넘었습니다' : undefined },
        el('span',{ class:'sheet-column-label' },label),cell(used,'main','사용한 점수'),el('span',{ class:'sheet-slash' },'/'),cell(budget,'max','배정 가능'));
    const column = (head, list) => el('section',{ class:'sheet-skill-column' },head,el('ul',{ class:'sheet-skills' },list.map(skillRow)));
    const skillBox = box('탐사자 기능',el('div',{ class:'sheet-skill-columns' },
      column(pointHead(occupationUsage,'직업 기능 점수'),columns.occupation),
      column(pointHead(interestUsage,'관심 기능 점수'),columns.interest),
      column(el('div',{ class:'sheet-column-head' },el('span',{ class:'sheet-column-label' },'스킬 성장치'),
        el('span',{ class:'sheet-column-label' },'남은 점수'),cell(remaining,'main','직업 · 관심 기능 점수 중 남은 점수')),columns.growth)));

    const dialog = el('dialog',{ class:'media-dialog character-sheet','aria-label':`${sheet.name} 캐릭터 시트` });
    applySheetAccent(dialog,sheet.accent);
    dialog.addEventListener('close',() => dialog.remove(),{ once:true });

    // Point color, per sheet: previews while choosing, saves when the picker closes.
    const picker = el('input',{ type:'color',value:validAccent(sheet.accent) ? sheet.accent : defaultSheetAccent,'aria-label':'포인트 색' });
    // Saved without run(): run() re-renders the workspace, which would take this open dialog with it.
    let saving = Promise.resolve();
    const saveAccent = (value) => {
      saving = saving.then(() => transact((next) => {
        const target = sheetFor(next,personaId);
        if (value) target.accent = value;
        else delete target.accent;
        audit(next,`${target.name} 캐릭터 시트 포인트 색 ${value || '기본색'}`);
      })).catch((error) => announce(`포인트 색을 저장하지 못했습니다 · ${error.message}`,'error'));
    };
    picker.addEventListener('input',() => applySheetAccent(dialog,picker.value));
    picker.addEventListener('change',() => saveAccent(picker.value));

    dialog.append(
      el('header',{ class:'sheet-header' },
        el('div',{ class:'sheet-title' },el('h3',{},sheet.name),el('span',{},'캐릭터 시트')),
        el('div',{ class:'sheet-actions' },
          el('label',{ class:'sheet-color' },picker,el('span',{},'포인트 색')),
          button(personaId ? '페르소나 시트 편집' : '조사자 시트 편집',() => { dialog.close(); if (personaId) openPersonaSheet(); else openSheet(); }),
          button('닫기',() => dialog.close()))),
      el('div',{ class:'sheet-top' },identity,attributes,box('캐릭터 이미지',el('div',{ class:'sheet-photo' },photo))),
      ...[vitals,madness,skillBox].filter(Boolean));
    surface.append(dialog);
    dialog.showModal();
  }

  function illustrationImage(entry) {
    if (!entry.assetId && !safeImageUrl(entry.remote)) return null;
    return entry.assetId ? assetImage(entry.assetId,entry.text) : sourceImage(entry.remote,entry.text);
  }

  function illustrationEntry(entry) {
    const image = illustrationImage(entry);
    return image && button(image, () => showPreview(entry.assetId, entry.remote, entry.text,'illustration',entry), { class:'image-button', 'aria-label':`${entry.text} 확대` });
  }

  function attachedIllustration(entry, featured) {
    const image = illustrationEntry(entry);
    if (!image) return null;
    // A reroll button on the picture itself redraws it from its scenes with a freshly written prompt.
    const reroll = entry.remote && !choosingScenes ? button(messageIcon('reroll'),() => rerollIllustration(entry),{
      class:'illustration-reroll',title:'장면부터 다시 그리기','aria-label':'삽화 다시 그리기',disabled:!!running }) : null;
    const count = Array.isArray(entry.variants) ? entry.variants.length : 0;
    const shown = count > 1 ? entry.variants.findIndex((variant) => variant.remote === entry.remote) + 1 : 0;
    const badge = shown ? el('span',{ class:'illustration-badge' },`${shown}/${count}`) : null;
    // Hiding takes it out of the chat only; the art tab keeps it and can show it again.
    const hide = !choosingScenes ? button(messageIcon('hide'),() => setIllustrationHidden(entry,true),{
      class:'illustration-hide',title:'채팅에서 숨기기 (삽화 탭에 남아요)','aria-label':'삽화를 채팅에서 숨기기',disabled:!!running }) : null;
    const figure = el('figure',{ class:'scene-illustration', 'data-illustration-id':entry.id },
      el('div',{ class:'illustration-frame' },image,badge,hide,reroll),
      entry.text !== '장면 삽화' ? el('figcaption',{},entry.text) : null);
    watchImageAccent(image.querySelector('img'),entry.assetId || entry.remote,(color) => {
      figure.style.setProperty('--illustration-color',color);
      if (featured) surface.style.setProperty('--scene-image-color',color);
    });
    return figure;
  }

  function finishSceneSelection() {
    choosingScenes = false;
    selectedScenes.clear();
  }

  function scenePicker(entry) {
    const id = `coc7-scene-${entry.id}`;
    return button(null,() => {
      if (running) return;
      if (selectedScenes.has(entry.id)) selectedScenes.delete(entry.id);
      else selectedScenes.add(entry.id);
      render();
      document.getElementById(id)?.focus({ preventScroll:true });
    },{ id,class:'message-pick',disabled:!!running,
      'aria-label':`삽화 참고 메시지 · ${messageSnippet(entry)}`,'aria-pressed':String(selectedScenes.has(entry.id)) });
  }

  function illustrationTools() {
    const id = 'coc7-pick-art-scenes';
    const label = '삽화 참고 메시지 선택';
    const control = input('select-art-scenes','on',{
      id,type:'checkbox',checked:choosingScenes,disabled:!!running,'aria-label':label,
      onchange:(event) => {
        if (running) return;
        if (event.currentTarget.checked) choosingScenes = true;
        else finishSceneSelection();
        render();
        document.getElementById(id)?.focus({ preventScroll:true });
      },
    });
    return el('div',{ class:'illustration-tools','aria-label':'삽화 장면' },
      el('label',{ class:'illustration-select',title:label },control),
      button(el('span',{ class:'image-glyph','aria-hidden':true }),() => void generateIllustration([...selectedScenes]),{
        class:'illustrate-icon','aria-label':'선택한 메시지로 삽화 생성',title:'선택한 메시지로 삽화 생성',
        disabled:!selectedScenes.size || !!running || !adapter.illustrate,
      }));
  }

  async function generateIllustration(ids) {
    await run(async (signal) => {
      const { prompt,sceneIds,appearances } = illustrationPrompt(state,ids,playerPersona());
      render();
      const { url:remote, prompt:imagePrompt } = await adapter.illustrate(state,prompt,signal,appearances);
      if (closed || signal.aborted) return;
      if (!safeImageUrl(remote)) throw Error('삽화 파일 경로를 확인할 수 없습니다.');
      const next = await transact((next) => {
        if (next.timeline.some((entry) => entry.type === 'illustration' && entry.remote === remote)) throw Error('이 삽화를 이미 채팅에 삽입했습니다.');
        append(next,'illustration','장면 삽화',{ assetId:null,remote,sceneIds,...(imagePrompt ? { imagePrompt } : {}) });
        audit(next,`Marinara 생성 삽화 삽입 · 참고 장면 ${sceneIds.length}개`);
      });
      revealArt = next.timeline.at(-1).id;
      finishSceneSelection();
      smallPane = false;
      announce('선택한 마지막 메시지에 삽화를 붙였습니다.','ok');
    },'Marinara 삽화 생성 중…',true);
  }

  function rollCard(roll, animate = false, correction = false) {
    const heading = (title) => el('header',{ class:'dice-heading' },el('strong',{},title),
      el('span',{ class:'dice-meta' },[roll.actorName,roll.pushed && '강행',correction && '키퍼 수정'].filter(Boolean).join(' · ')));
    const line = (label, ...content) => el('div',{ class:'dice-line' },el('dt',{},label),el('dd',{},content));
    const cardClass = `dice-card${animate ? ' rolling' : ''}`;
    if (roll.kind === 'dice') {
      const faces = roll.terms.filter((term) => term.faces).map((term) => `${term.sign < 0 ? '−' : '+'} [${term.faces.join(', ')}]`);
      return el('article',{ class:cardClass },heading(roll.expression),
        el('dl',{ class:'dice-lines' },line('합계',el('b',{ class:'dice-value' },roll.total))),
        faces.length ? el('div',{ class:'dice-notes' },note(faces.join(' · '))) : null);
    }
    const outcome = !correction && roll.original ? roll.baseOutcome ?? roll : roll;
    const result = !correction && roll.original ? roll.original : roll.result;
    const tone = outcome.success || outcome.level === 'fumble' ? outcome.level : 'fail';
    const thresholds = el('div',{ class:'dice-thresholds' },Object.entries(DIFFICULTY).map(([key,label]) =>
      el('span',{},el('small',{},label),el('b',{},roll.thresholds[key]))));
    const requirement = !roll.opponent && roll.difficulty !== 'regular' ? `${DIFFICULTY[roll.difficulty]} 기준 ${outcome.success ? '충족' : '미달'}` : '';
    const notes = [
      roll.candidates?.length > 1 && `후보 ${roll.candidates.join(' / ')}`,
      roll.opponent && `상대 D100 ${roll.opponent.result} / ${roll.opponent.value}% · ${{ left:'조사자 우세',right:'상대 우세',tie:'동률',neither:'양측 실패' }[roll.opposed]}`,
      roll.tieBreak && `동률 해소 D100 · 조사자 ${roll.tieBreak[0]} / 상대 ${roll.tieBreak[1]}`,
      correction && roll.edits?.at(-1)?.reason,
    ].filter(Boolean);
    return el('article',{ class:cardClass,'data-outcome':tone },heading(roll.kind === 'san' ? '이성 (SAN)' : roll.name),
      el('dl',{ class:'dice-lines' },
        line('기준치',thresholds),
        line('굴림',el('b',{ class:'dice-value' },result)),
        el('div',{ class:'dice-line dice-outcome' },el('dt',{},'판정 결과'),el('dd',{},
          el('strong',{},LEVEL[outcome.level]),requirement ? el('small',{},requirement) : null))),
      notes.length ? el('div',{ class:'dice-notes' },notes.map((text) => note(text))) : null);
  }

  function updateMessage(id, update, message) {
    return transact((next) => {
      const entry = next.timeline.find((item) => item.id === id);
      if (!entry || (!isIllustrationScene(entry) && entry.type !== 'roll')) throw Error('메시지를 찾을 수 없습니다.');
      update(entry,next);
      audit(next,message);
    }).then(() => announce(message,'ok'));
  }

  function messageDialog(title, submitLabel, content, submit) {
    if (running) return;
    const dialog = el('dialog',{ class:'media-dialog message-dialog','aria-label':title });
    const cancel = button('취소',() => dialog.close());
    dialog.addEventListener('close',() => dialog.remove(),{ once:true });
    dialog.append(row(headline(title),cancel),form(submit,content,submitLabel));
    surface.append(dialog);
    dialog.showModal();
    (dialog.querySelector('[autofocus], textarea[name="message"]') ?? cancel).focus();
  }

  function editMessage(entry) {
    const parts = investigatorMessageParts(entry);
    if (parts) {
      messageDialog('메시지 수정','저장',[
        field('행동과 생각',textarea('message',parts.action,{ maxlength:200000,rows:4 })),
        field('대사',textarea('dialogue',parts.dialogue,{ maxlength:200000 })),
      ],(values) => {
        const action = textValue(values.get('message'),200000);
        const dialogue = textValue(values.get('dialogue'),200000);
        const text = [action,dialogue].filter(Boolean).join('\n\n');
        if (!text) throw Error('메시지 내용을 입력하세요.');
        if (text.length > 200000) throw Error('메시지는 200,000자까지 입력할 수 있습니다.');
        return updateMessage(entry.id,(target) => { Object.assign(target,{ action,dialogue,text }); },'메시지를 수정했습니다.');
      });
      return;
    }
    messageDialog('메시지 수정','저장',field('메시지',textarea('message',entry.text,{ required:true,maxlength:200000,rows:6 })),
      (values) => {
        const text = textValue(values.get('message'),200000);
        if (!text) throw Error('메시지 내용을 입력하세요.');
        return updateMessage(entry.id,(target) => { target.text = text; },'메시지를 수정했습니다.');
      });
  }

  function markMessage(entry) {
    const bookmark = check('bookmark',Boolean(entry.bookmark));
    const label = input('bookmark-label',entry.bookmark?.label,{ maxlength:80,disabled:!bookmark.checked });
    bookmark.addEventListener('change',() => { label.disabled = !bookmark.checked; });
    messageDialog('메시지 북마크 및 메모','저장',[
      toggle('북마크에 추가',bookmark),field('북마크 이름',label),
      toggle(`AI 참고에 고정 (최대 ${pinnedMessageLimit}개)`,check('pin',entry.pinnedToContext)),
      field('비공개 메모',textarea('private-note',entry.privateNote,{ maxlength:2000 })),
    ],(values) => updateMessage(entry.id,(target,next) => {
      const pin = values.has('pin');
      if (pin && !target.pinnedToContext && next.timeline.filter((item) => item.pinnedToContext).length >= pinnedMessageLimit) {
        throw Error(`AI 참고에 고정하는 메시지는 최대 ${pinnedMessageLimit}개입니다.`);
      }
      if (values.has('bookmark')) target.bookmark = { label:textValue(values.get('bookmark-label'),80) };
      else delete target.bookmark;
      target.pinnedToContext = pin;
      target.privateNote = textValue(values.get('private-note'),2000);
    },'메시지 표시를 저장했습니다.'));
  }

  // The AI investigator's check request ("관찰력 판정 요청" …) rolled against the investigator's own sheet:
  // the longest skill or characteristic name found in the request, at the difficulty it mentions.
  function requestedCheck(text) {
    const flat = normalized(text);
    const names = [...Object.values(ATTR),'이성','행운',...state.sheet.skills.map((skill) => skill.name)];
    const name = names.filter((item) => item && flat.includes(normalized(item))).sort((a,b) => b.length - a.length)[0];
    const difficulty = /극단|extreme/i.test(text) ? 'extreme' : /어려운|어렵|hard/i.test(text) ? 'hard' : 'regular';
    return name ? { name, difficulty } : null;
  }

  function rollRequest(entry) {
    const check = requestedCheck(entry.request);
    if (!check) {
      draft = `/check ${state.sheet.name} `;
      render();
      surface.querySelector('#coc7-keeper-input')?.focus();
      announce('요청에서 기능 이름을 찾지 못했어요. 입력창에 기능 이름을 이어서 적어 주세요.','notice');
      return;
    }
    void run(() => transact((next) => {
      const result = handleInput(next,`/check ${check.name} | ${check.difficulty}`);
      if (result?.kind && Object.hasOwn(result,'public')) flashRoll = result.id;
    }),`${state.sheet.name} · ${check.name} 판정 중…`);
  }

  // A small confirmation card: what is about to go, then a quiet Cancel and a red Delete.
  function confirmDelete({ label, heading, who = '', preview = '', image = null, notice, onConfirm }) {
    if (running) return;
    const dialog = el('dialog',{ class:'media-dialog confirm-dialog','aria-label':label });
    dialog.addEventListener('close',() => dialog.remove(),{ once:true });
    const cancel = button('취소',() => dialog.close(),{ class:'confirm-cancel' });
    // Native append writes null as the text "null", so the parts this dialog leaves out are dropped first.
    dialog.append(...[
      el('div',{ class:'confirm-icon','aria-hidden':true },messageIcon('trash')),
      el('h3',{},heading),
      image ? el('div',{ class:'confirm-image' },image) : null,
      preview ? el('blockquote',{ class:'confirm-preview' },who ? el('strong',{},who) : null,
        el('span',{},preview.length > 160 ? `${preview.slice(0,160)}…` : preview)) : null,
      el('p',{ class:'confirm-note' },notice),
      el('div',{ class:'confirm-actions' },cancel,
        button('삭제',() => { dialog.close(); onConfirm(); },{ class:'confirm-delete' }))].filter(Boolean));
    surface.append(dialog);
    dialog.showModal();
    cancel.focus();
  }

  function deleteMessage(entry) {
    const roll = entry.type === 'roll' ? state.rollHistory.find((item) => item.id === entry.rollId) : null;
    confirmDelete({
      label:roll ? '주사위 결과 삭제' : '메시지 삭제',
      heading:roll ? '이 주사위 결과를 지울까요?' : '이 메시지를 지울까요?',
      who:roll ? '' : entry.type === 'investigator' ? (entry.speaker || state.sheet.name) : entry.speaker || roleLabels[entry.type] || '',
      preview:roll ? rollText(roll) : entry.text.replace(/\s+/g,' ').trim(),
      notice:roll ? '채팅과 AI가 읽는 기록에서 빠지고, 키퍼 기록의 굴림 내역에는 남아요.' : '채팅과 AI가 읽는 기록에서 빠지고, 되돌릴 수 없어요.',
      // Through run(), which redraws the chat once the deletion is saved.
      onConfirm:() => void run(() => updateMessage(entry.id,(target) => { target.trashedAt = new Date().toISOString(); },roll ? '주사위 결과를 지웠습니다.' : '메시지를 지웠습니다.')),
    });
  }

  /* Illustrations: hidden from the chat (kept, and shown again from the art tab) or deleted for good. */
  function visibleIllustration(entry) {
    return entry.type === 'illustration' && !entry.trashedAt && Boolean(entry.assetId || safeImageUrl(entry.remote));
  }

  function setIllustrationHidden(entry, hidden) {
    action((next) => {
      const target = next.timeline.find((item) => item.id === entry.id);
      if (!target) throw Error('삽화를 찾을 수 없습니다.');
      if (hidden) target.hiddenInChat = true;
      else delete target.hiddenInChat;
      audit(next,hidden ? '삽화를 채팅에서 숨김' : '삽화를 채팅에 다시 표시');
    },hidden ? '삽화를 채팅에서 숨겼어요. 삽화 탭에서 다시 보이게 할 수 있어요.' : '삽화를 채팅에 다시 보이게 했어요.')();
  }

  function deleteIllustration(entry) {
    const files = [...new Set([entry.remote,...(Array.isArray(entry.variants) ? entry.variants.map((variant) => variant.remote) : [])])]
      .filter((url) => url?.startsWith('/api/gallery/'));
    confirmDelete({
      label:'삽화 삭제',
      heading:'이 삽화를 완전히 지울까요?',
      image:illustrationImage(entry),
      notice:`채팅과 삽화 탭에서 사라지고, 마리나라 갤러리의 그림 파일${files.length > 1 ? ` ${files.length}개(다시 그린 버전 포함)` : ''}도 지워져요. 되돌릴 수 없어요.`,
      onConfirm:() => void run(async (signal) => {
        for (const url of files) await adapter.deleteGalleryImage(url,signal);
        await transact((next,media) => {
          const target = next.timeline.find((item) => item.id === entry.id);
          if (!target) return;
          removeAsset(next,media,target.assetId);
          // The entry stays as an empty, deleted record so the timeline's numbering is untouched.
          target.trashedAt = new Date().toISOString();
          delete target.remote;
          delete target.assetId;
          delete target.variants;
          delete target.imagePrompt;
          for (const [key,choice] of Object.entries(next.portraitChoices ?? {})) {
            if ((choice?.remote && files.includes(choice.remote)) || (entry.assetId && choice?.asset === entry.assetId)) delete next.portraitChoices[key];
          }
          audit(next,'삽화 삭제');
        });
        announce('삽화를 지웠어요.','ok');
      },'삽화를 지우는 중…'),
    });
  }

  // A chapter title in the chat where a later session begins: "제 2 장", the session's name between two lines, a ◆. It is only shown;
  // the AI never reads it. A session just added with no messages yet gets its line at the end of the chat.
  function sessionDivider(number) {
    const session = state.sessions.find((item) => item.number === number) ?? { number };
    return el('div',{ class:'session-divider',role:'separator','aria-label':`제 ${number} 장 · ${sessionHeading(session)}` },
      el('span',{ class:'session-divider-no' },`제 ${number} 장`),
      el('span',{ class:'session-divider-title' },sessionHeading(session)),
      el('span',{ class:'session-divider-mark','aria-hidden':true },'◆'));
  }

  function withSessionDividers(entries, view) {
    const nodes = [];
    let previous = null;
    for (const entry of entries) {
      const session = entry.session ?? 1;
      if (previous !== null && session !== previous) nodes.push(sessionDivider(session));
      nodes.push(view(entry));
      previous = session;
    }
    if (previous !== null && state.session > previous) nodes.push(sessionDivider(state.session));
    return nodes;
  }

  // On phones a message's buttons stay folded behind one ⋯ button so they do not cover the text.
  function toolGroup(label, ...controls) {
    const group = el('div',{ class:'message-tools',role:'group','aria-label':label });
    const toggle = button('⋯',() => {
      const open = !group.classList.contains('open');
      for (const other of surface.querySelectorAll('.message-tools.open')) {
        other.classList.remove('open');
        other.querySelector('.tools-toggle')?.setAttribute('aria-expanded','false');
      }
      group.classList.toggle('open',open);
      toggle.setAttribute('aria-expanded',String(open));
    },{ class:'tools-toggle',title:`${label} 열기`,'aria-label':`${label} 열기`,'aria-expanded':'false' });
    group.append(toggle,...controls);
    return group;
  }

  function messageTools(entry) {
    const control = (kind, label, handle, filled = false) => button(messageIcon(kind,filled),() => handle(entry),{
      title:label,'aria-label':label,'aria-haspopup':'dialog',disabled:!!running,
    });
    return toolGroup('메시지 작업',
      control('edit','메시지 수정',editMessage),
      control('marks','메시지 북마크 및 메모',markMessage,Boolean(entry.bookmark)),
      control('trash','메시지 삭제',deleteMessage));
  }

  function entryView(entry, illustrations, featured, descriptionSlots) {
    if (entry.type === 'roll') {
      const roll = state.rollHistory.find((item) => item.id === entry.rollId && item.public);
      if (!roll) return null;
      // Dice results can be removed from the chat like any message; the roll stays in the Keeper's roll history.
      const card = rollCard(roll, flashRoll === roll.id, entry.correction);
      if (!choosingScenes) card.prepend(toolGroup('주사위 메시지 작업',
        button(messageIcon('trash'),() => deleteMessage(entry),{ title:'주사위 메시지 삭제','aria-label':'주사위 메시지 삭제','aria-haspopup':'dialog',disabled:!!running })));
      card.classList.add('message-with-tools');
      return card;
    }
    if (entry.type === 'handout') {
      const handout = state.handouts.find((item) => item.id === entry.handoutId && item.public);
      if (!handout) return null;
      const image = handoutImage(handout);
      const description = handout.description ? el('div',{ class:'handout-description mari-message-content' }) : null;
      if (description) descriptionSlots.push({ id:entry.id, host:description, source:handout.description });
      const text = !handout.assetId && handout.text;
      return el('article',{ class:'message artifact','data-handout-id':handout.id },
        el('div',{ class:'message-head' },row(el('strong',{},handout.title))),
        image || description || text ? el('div',{ class:'message-body handout-message' },image,description,
          text ? el('div',{ class:'message-text' },text) : null) : null);
    }
    const profileId = entry.type === 'npc' ? state.npcs.find((npc) => npc.id === entry.npcId)?.profileId : null;
    const canOpenPersona = entry.type === 'persona' && entry.personaId === playerPersona()?.id;
    const canReroll = entry.type === 'investigator' && entry.seq === state.through && latestRerollableTurn(state) === entry;
    const personaAvatar = entry.type === 'persona' && (safeImageUrl(entry.personaAvatar)
      ? sourceImage(entry.personaAvatar,'',{ class:'avatar' })
      : el('span',{ class:'avatar persona-initial','aria-hidden':true },Array.from(entry.speaker?.trim() || '페')[0]));
    const pickable = choosingScenes && isIllustrationScene(entry);
    // A scene of only blank filler (like a #빈칸 macro's ㅤ) is a thin spacer box, about half a one-line scene.
    const spacer = entry.type === 'scene' && !/[^\sㅤᅟᅠ​]/u.test(entry.text ?? '');
    const speakerName = entry.type === 'investigator' && (entry.characterId ?? 'local') === (state.settings.cardId || 'local')
      ? button(entry.speaker || state.sheet.name,openSheet,{ class:'investigator-name',title:'조사자 시트 열기' })
      : canOpenPersona ? button(entry.speaker,openPersonaName,{ class:'investigator-name',title:'페르소나 시트 열기' })
        : el('strong', {}, entry.speaker || roleLabels[entry.type]);
    // The persona's photo sits beside the name, mirrored to the right like the card itself.
    const header = entry.type !== 'scene' && el('div',{ class:'message-head' },
      personaAvatar ? row(speakerName,personaAvatar)
        : row(entry.type === 'investigator' ? portrait(entry,'sticker') : profileId ? assetImage(profileId,'',{ class:'avatar' }) : null,speakerName),
      // The answer's token chip sits at the right edge, beside the reroll button.
      el('div',{ class:'message-head-actions' },
        entry.type === 'investigator' ? usageChip(entry) : null,
        canReroll ? button(messageIcon('reroll'),() => rerollAnswer(entry.id),{
          class:'message-reroll', title:'답변 리롤','aria-label':'답변 리롤',disabled:!!running,
        }) : null));
    const parts = investigatorMessageParts(entry);
    // Speech already in quotes (a bilingual line like "Ciao" (안녕) included) is shown as written.
    const dialogue = parts?.dialogue.trim();
    const spoken = dialogue && (/^["“「『]/.test(dialogue) ? dialogue : `"${dialogue}"`);
    const personaParts = personaMessageParts(entry);
    const body = el('div',{ class:'message-body' },
      parts ? [parts.action ? el('div',{ class:'message-text investigator-action' },richText(parts.action)) : null,
        spoken ? el('div',{ class:'message-text' },richText(spoken)) : null]
        : personaParts ? personaParts.map((part) => el('div',{ class:`message-text${part.action ? ' investigator-action' : ''}` },richText(part.text)))
          : el('div',{ class:`message-text${entry.personaAction ? ' persona-action' : ''}` },richText(entry.text)),
      entry.request ? row(note(`조사자 판정 요청 · ${entry.request}`),
        entry.type === 'investigator' && !choosingScenes && (entry.characterId ?? 'local') === (state.settings.cardId || 'local')
          ? button('🎲 판정 굴리기',() => rollRequest(entry),{ class:'request-roll',title:'조사자 시트로 이 판정을 굴립니다',disabled:!!running }) : null) : null,
      illustrations?.map((art) => attachedIllustration(art,art === featured)));
    const tools = !choosingScenes && isIllustrationScene(entry) ? messageTools(entry) : null;
    const message = el('article',{ id:`coc7-message-${entry.id}`,tabindex:-1,
      class:`message ${entry.type}${spacer ? ' spacer' : ''}${pickable ? ' scene-pickable' : ''}${selectedScenes.has(entry.id) ? ' selected-scene' : ''}`,'data-entry-id':entry.id },
      personaAvatar ? el('div',{ class:'persona-bubble' },tools,header,body) : [tools,header,body]);
    if (pickable) {
      for (const control of message.querySelectorAll('button')) control.inert = true;
      message.append(scenePicker(entry));
    }
    return message;
  }

  /* Token usage meter: every model call of this game is logged with its token counts and the price looked up
     for it, summed per session and overall. The Keeper's own per-model price overrides the looked-up one. */
  const usageLog = () => (Array.isArray(state.usageLog) ? state.usageLog : []).filter(validUsageRecord);
  const pricing = () => state.settings.pricing ?? {};
  const fx = () => state.settings.fx ?? null;
  let priceTable = null;

  function linkTurnUsage(next, entryId) {
    const id = entryId ?? next.timeline.filter((entry) => entry.type === 'investigator').at(-1)?.id;
    const record = [...pendingUsage].reverse().find((item) => item.task === 'turn' && !item.entryId);
    if (id && record) record.entryId = id;
  }

  function usageMeter() {
    const records = usageLog().filter((item) => item.session === state.session);
    const session = usageTotals(records);
    // Just this session's tokens, to keep it short; what they are and cost is in the tooltip and the dialog.
    return button(el('strong',{},`${shortTokens(session.tokens)} tok`),
      () => showUsage(),{ class:'usage-meter',title:'이번 세션 토큰 · 눌러서 사용량과 비용 보기','aria-label':'이번 세션 토큰 사용량','aria-haspopup':'dialog' });
  }

  function usageChip(entry) {
    const records = usageLog().filter((item) => item.entryId === entry.id);
    if (!records.length) return null;
    const totals = usageTotals(records);
    const title = `${entry.speaker || state.sheet.name} 답변 영수증`;
    const sent = records.findLast((item) => item.promptId);
    return button(`${shortTokens(totals.tokens)} tok`,
      () => (sent ? showPromptBreakdown(sent,records,title) : showUsage(records,title)),
      { class:'usage-chip',title:sent ? '이 답변의 프롬프트 구성과 토큰 보기' : '이 답변의 토큰 영수증','aria-haspopup':'dialog' });
  }

  /* Prompt breakdown, like Marinara's prompt inspector: the exact request an answer was generated from,
     split into its sections with a token estimate each, searchable, with the model's reported counts. */
  const promptRequestNames = {
    investigator:'조사자 시트', card:'봇카드', scenarioSetting:'시나리오', investigatorSecret:'비밀 HO',
    previousSessionSummaries:'지난 세션 요약', knownFactsAndHypotheses:'조사 노트', pinnedChatContext:'고정한 대화',
    referenceMemories:'기억 서재', pendingKeeperEvents:'이번 턴 장면', handouts:'핸드아웃', images:'첨부 이미지',
    instructions:'키퍼 지시', session:'세션', log:'세션 기록',
  };
  const promptLabelNames = { rules:'게임 규칙', persona:'플레이어 페르소나', lorebook:'조사자 로어북', keeper:'키퍼 지시',
    chat_history:'대화 기록', request:'요청', preset_system:'프리셋 · system', preset_user:'프리셋 · user', preset_assistant:'프리셋 · assistant' };
  const promptLabel = (section) => {
    if (section.label.startsWith('request:')) {
      const key = section.label.slice(8);
      return `요청 · ${promptRequestNames[key] ?? key}`;
    }
    return promptLabelNames[section.label] ?? section.label.replace(/_/g,' ').toUpperCase();
  };
  const promptLabelKind = (label) => (label.startsWith('request') ? 'request' : label === 'chat_history' ? 'history'
    : ['rules','persona','lorebook','keeper'].includes(label) ? 'coc' : 'preset');
  const parameterNames = { temperature:'Temperature', maxTokens:'Max Output Tokens', topP:'Top P', topK:'Top K', minP:'Min P',
    frequencyPenalty:'Freq Penalty', presencePenalty:'Pres Penalty', reasoningEffort:'Reasoning', verbosity:'Verbosity',
    showThoughts:'Thinking', enableThinking:'Thinking', thinkingBudget:'Thinking Budget', serviceTier:'Service Tier' };

  function showPromptBreakdown(record, records, receiptTitle) {
    const dialog = el('dialog',{ class:'media-dialog prompt-breakdown','aria-label':'프롬프트 구성' });
    const close = () => dialog.close();
    dialog.addEventListener('close',() => dialog.remove(),{ once:true });
    const body = el('div',{ class:'prompt-breakdown-body' },note('프롬프트 기록을 불러오는 중…'));
    dialog.append(body);
    surface.append(dialog);
    dialog.showModal();
    adapter.promptSnapshot(record.promptId).then((snapshot) => {
      // Plain numbers here: each line already says 토큰.
      const formatTokens = (value) => Math.round(Number(value) || 0).toLocaleString('en-US');
      const sections = Array.isArray(snapshot.sections) ? snapshot.sections : [];
      const estimated = sections.reduce((sum,section) => sum + (Number(section.tokens) || 0),0);
      const used = record.usage ?? {};
      const reported = (used.input ?? 0) + (used.cacheRead ?? 0) + (used.cacheWrite ?? 0);
      const cost = recordCost(record,pricing());
      const amount = cost && (formatLocalAmount(localCost(cost,fx()),fx()) || formatMoney(cost.total * cost.usdRate,cost.currency));
      const whole = sections.map((section) => `### ${promptLabel(section)}\n${section.content}`).join('\n\n');
      const pills = Object.entries(snapshot.parameters ?? {})
        .filter(([key,value]) => parameterNames[key] && value !== '' && value !== false)
        .map(([key,value]) => el('span',{ class:'prompt-pill' },parameterNames[key],el('strong',{},value === true ? 'On' : typeof value === 'number' ? value.toLocaleString('en-US') : String(value))));
      const blocks = sections.map((section) => {
        const text = el('pre',{ class:'prompt-section-text' },section.content);
        return el('details',{ class:`prompt-section kind-${promptLabelKind(section.label)}` },
          el('summary',{},el('span',{ class:'prompt-section-label' },promptLabel(section)),
            section.entries ? el('span',{ class:'prompt-section-count' },`메시지 ${section.entries}개`) : null,
            el('span',{ class:'prompt-section-tokens' },`~${formatTokens(section.tokens)} 토큰`)),
          text);
      });
      // Find: opens every section containing the text, marks each match, and steps through them.
      let marks = [];
      let current = -1;
      const counter = el('span',{ class:'prompt-find-count' });
      const highlight = (query) => {
        marks = [];
        current = -1;
        sections.forEach((section,index) => {
          const block = blocks[index];
          const pre = block.querySelector('pre');
          if (!query) { pre.textContent = section.content; return; }
          const lower = section.content.toLowerCase();
          const parts = [];
          let from = 0;
          for (let at = lower.indexOf(query); at >= 0; at = lower.indexOf(query,at + query.length)) {
            parts.push(section.content.slice(from,at));
            const mark = el('mark',{},section.content.slice(at,at + query.length));
            marks.push(mark);
            parts.push(mark);
            from = at + query.length;
          }
          parts.push(section.content.slice(from));
          pre.replaceChildren(...parts);
          if (parts.length > 1) block.open = true;
        });
        counter.textContent = query ? (marks.length ? `${marks.length}개` : '없음') : '';
      };
      const step = (direction) => {
        if (!marks.length) return;
        marks[current]?.classList.remove('current');
        current = (current + direction + marks.length) % marks.length;
        marks[current].classList.add('current');
        marks[current].scrollIntoView({ block:'center' });
        counter.textContent = `${current + 1}/${marks.length}`;
      };
      const find = input('prompt-find','',{ type:'search',placeholder:'찾기','aria-label':'프롬프트에서 찾기' });
      find.addEventListener('input',() => highlight(find.value.trim().toLowerCase()));
      find.addEventListener('keydown',(event) => { if (event.key === 'Enter') { event.preventDefault(); step(event.shiftKey ? -1 : 1); } });
      body.replaceChildren(
        el('header',{ class:'prompt-breakdown-head' },
          el('h3',{},'프롬프트 구성'),el('span',{ class:'prompt-badge' },'실제로 보낸 요청'),
          el('span',{ class:'quiet' },`${sections.length}개 섹션 · ~${formatTokens(estimated)} 토큰`),
          el('div',{ class:'prompt-head-tools' },
            button(messageIcon('copy'),() => { void navigator.clipboard?.writeText(whole).then(() => announce('프롬프트를 복사했습니다.','ok')); },
              { class:'viewer-icon',title:'프롬프트 전체 복사','aria-label':'프롬프트 전체 복사' }),
            button(messageIcon('close'),close,{ class:'viewer-icon',title:'닫기','aria-label':'닫기' }))),
        el('div',{ class:'prompt-find' },find,counter,
          button('↑',() => step(-1),{ title:'이전 결과','aria-label':'이전 결과' }),
          button('↓',() => step(1),{ title:'다음 결과','aria-label':'다음 결과' })),
        el('section',{ class:'prompt-summary' },
          el('div',{ class:'prompt-summary-model' },el('span',{ class:'quiet' },`${snapshot.connection || record.connection || '연결'} / `),
            el('strong',{},snapshot.model || record.model),
            el('span',{ class:'quiet' },`~${formatTokens(estimated)} 예상 토큰${reported ? ` · ${formatTokens(reported)} 보고된 입력 토큰` : ''}`)),
          record.missing ? note('이 호출은 모델이 토큰 사용량을 알려주지 않았어요.')
            : note(`입력 ${formatTokens(used.input ?? 0)}${used.cacheRead ? ` · 캐시 읽기 ${formatTokens(used.cacheRead)}` : ''}${used.cacheWrite ? ` · 캐시 쓰기 ${formatTokens(used.cacheWrite)}` : ''} · 출력 ${formatTokens(used.output ?? 0)}${used.reasoning ? ` (추론 ${formatTokens(used.reasoning)})` : ''} 토큰${amount ? ` · 약 ${amount}` : ''}`),
          pills.length ? el('div',{ class:'prompt-pills' },pills) : null,
          button('영수증 보기',() => { close(); showUsage(records,receiptTitle); },{ class:'prompt-receipt' })),
        note('섹션 토큰은 마리나라와 같은 방식으로 어림한 값이에요. 실제 청구는 위의 보고된 토큰 기준이에요.'),
        el('div',{ class:'prompt-sections' },blocks));
      find.focus();
    }).catch((error) => {
      body.replaceChildren(row(headline('프롬프트 구성'),button('닫기',close)),note(error.message),
        button('영수증 보기',() => { close(); showUsage(records,receiptTitle); }));
    });
  }

  // One receipt in the layout of a till slip: tokens and cost per part, the total, and the local estimate.
  function receipt(records, title) {
    const totals = usageTotals(records);
    const cost = costTotals(records,pricing(),fx());
    const models = [...new Set(records.map((item) => [item.connection,item.model].filter(Boolean).join(' · ')))].filter(Boolean);
    const rate = fx();
    const priced = cost.total > 0 || !cost.unpriced;
    // A receipt whose calls are all billed in one other currency (LinkAPI: yuan) shows that currency, as LinkAPI does.
    const billed = cost.billed;
    const amount = (key) => billed ? formatMoney(billed.parts[key],cost.currency) : formatUsd(cost.parts[key]);
    const line = (label, tokens, key) => el('div',{ class:'receipt-line' },el('span',{},label),el('span',{},tokens == null ? '' : formatTokens(tokens)),el('strong',{},priced ? amount(key) : '—'));
    const rated = billed && records.find((item) => item.pricing?.currency === cost.currency && item.pricing.usdRate)?.pricing.usdRate;
    return el('section',{ class:'usage-receipt' },
      el('h4',{},title),
      models.length ? el('p',{ class:'receipt-model' },models.join(' / ')) : null,
      // Cache lines appear only when the calls used the cache.
      usageParts.filter(([key]) => !key.startsWith('cache') || totals[key] > 0).map(([key,label]) => line(label,totals[key],key)),
      cost.parts.perCall ? line(`호출당 요금 · ${totals.calls - totals.missing}회`,null,'perCall') : null,
      totals.reasoning ? note(`출력 중 추론 ${formatTokens(totals.reasoning)}`) : null,
      el('div',{ class:'receipt-total' },el('span',{},`합계 · 호출 ${totals.calls}회`),
        el('strong',{},!priced ? '단가 없음' : billed ? formatMoney(billed.total,cost.currency) : formatUsd(cost.total))),
      billed && priced ? el('div',{ class:'receipt-line local' },el('span',{},'달러 환산'),el('strong',{},formatUsd(cost.total))) : null,
      el('div',{ class:'receipt-line local' },el('span',{},'현재 환율 원화 예상액'),el('strong',{},formatLocalAmount(cost.local,rate) ? `약 ${formatLocalAmount(cost.local,rate)}` : '환율 미설정')),
      rate?.rate ? note(`${formatRate(rate)}${rate.date ? ` · 기준 ${rate.date}` : ''}`) : null,
      cost.sources.length ? note(`단가 출처 · ${cost.sources.map((source) => priceSources[source] ?? source).join(', ')}${billed ? ` · ${currencyLabel(cost.currency)}로 청구${rated ? ` · 1 USD = ${rated} ${cost.currency}` : ''} · 원화는 달러를 거쳐 환산` : ''}`) : null,
      totals.missing ? note(`사용량을 알려주지 않은 호출 ${totals.missing}회는 합계에서 빠졌어요.`) : null,
      cost.unpriced ? note(`가격표에 없는 모델의 호출 ${cost.unpriced}회는 금액에서 빠졌어요. 아래 단가 설정에서 직접 넣을 수 있어요.`) : null);
  }

  // Reference table: the common model families of NanoGPT, OpenRouter, Vertex and LinkAPI, in USD per 1M tokens.
  function priceTableView(host) {
    const show = () => {
      if (!priceTable) return;
      const provider = host.querySelector('[name=price-provider]')?.value ?? priceTable.providers[0]?.id;
      const query = (host.querySelector('[name=price-query]')?.value ?? '').trim().toLowerCase();
      const current = priceTable.providers.find((item) => item.id === provider) ?? priceTable.providers[0];
      const rows = (current?.models ?? []).filter((item) => !query || item.id.toLowerCase().includes(query));
      // Prices in the list's own currency (LinkAPI: yuan), with the dollar value on hover.
      const cell = (item, key) => {
        const usd = item[key];
        if (usd == null) return el('td',{},'—');
        const own = item.currency && item.original?.[key] != null;
        const shown = own ? item.original[key] : usd;
        const symbol = own ? ({ CNY:'¥' }[item.currency] ?? `${item.currency} `) : '$';
        return el('td',{ title:own ? `≈ $${usd}` : undefined },`${symbol}${Number(shown).toLocaleString('en-US',{ maximumFractionDigits:4 })}`);
      };
      host.querySelector('.price-table-body')?.replaceChildren(rows.length ? el('table',{ class:'price-table' },
        el('thead',{},el('tr',{},['모델','입력','출력','캐시 읽기','호출당'].map((label) => el('th',{},label)))),
        el('tbody',{},rows.slice(0,300).map((item) => el('tr',{},el('td',{ class:'price-table-model' },item.id),cell(item,'input'),cell(item,'output'),cell(item,'cacheRead'),cell(item,'perCall'))))) : note('조건에 맞는 모델이 없어요.'));
    };
    const load = () => {
      if (priceTable || host.dataset.loading) return;
      host.dataset.loading = '1';
      host.querySelector('.price-table-body')?.replaceChildren(note('가격표를 불러오는 중…'));
      adapter.prices().then((table) => {
        priceTable = table;
        const select = host.querySelector('[name=price-provider]');
        select?.replaceChildren(...table.providers.map((item) => el('option',{ value:item.id },`${item.label} · ${item.models.length}개`)));
        show();
      }).catch((error) => host.querySelector('.price-table-body')?.replaceChildren(note(`가격표를 불러오지 못했어요 · ${error.message}`)))
        .finally(() => { delete host.dataset.loading; });
    };
    host.append(
      note('deepseek · kimi · gemini · claude · gpt · glm 계열을 서비스별로 모았어요. 100만 토큰당 가격이고, LinkAPI는 위안(¥) 그대로(그룹 할인 전), 나머지는 달러($)예요. 위안 칸에 마우스를 올리면 달러 환산이 보여요. AI가 답변할 때는 쓰는 연결의 단가가 자동으로 적용돼요.'),
      el('div',{ class:'row price-table-controls' },
        select('price-provider',(priceTable?.providers ?? []).map((item) => [item.id,`${item.label} · ${item.models.length}개`])),
        input('price-query','',{ placeholder:'모델 이름으로 찾기 (예: kimi, glm-5)','aria-label':'모델 이름으로 찾기' })),
      el('div',{ class:'price-table-body' }));
    host.querySelector('[name=price-provider]').addEventListener('change',show);
    host.querySelector('[name=price-query]').addEventListener('input',show);
    host.closest('details')?.addEventListener('toggle',(event) => { if (event.target.open) load(); });
    if (priceTable) show();
  }

  function showUsage(only, onlyTitle) {
    const dialog = el('dialog',{ class:'media-dialog usage-dialog','aria-label':'토큰 사용량' });
    dialog.addEventListener('close',() => dialog.remove(),{ once:true });
    // Saved without run(): run() re-renders the workspace and would take this open dialog with it.
    let saving = Promise.resolve();
    const save = (update, after) => {
      saving = saving.then(() => transact(update)).then(() => { paint(); after?.(); })
        .catch((error) => announce(`저장하지 못했습니다 · ${error.message}`,'error'));
    };
    // A form that saves inside this dialog without run(), so the dialog stays open.
    const dialogForm = (submit, children, label, className) => el('form',{ class:className, onsubmit:(event) => {
      event.preventDefault();
      Promise.resolve().then(() => submit(new FormData(event.currentTarget))).catch((error) => announce(error.message,'error'));
    } }, children, el('button',{ class:'button', type:'submit' },label));
    const paint = () => {
      const all = usageLog();
      // The model this game answers with is listed before its first call, so its price can be checked up front.
      const current = library.connections.find((item) => item.id === (state.settings.connectionId || library.chats[0]?.connectionId))?.model;
      const models = [...new Set([current,...all.map((item) => item.model)].filter(Boolean))];
      const prices = pricing();
      const rate = fx();
      // Units of `currency` per USD, from a call priced in it, the reference table, or today's public rate.
      const knownRate = async (currency) => all.findLast?.((item) => item.pricing?.currency === currency && item.pricing.usdRate)?.pricing.usdRate
        ?? priceTable?.providers.flatMap((item) => item.models).find((item) => item.currency === currency && item.usdRate)?.usdRate
        ?? (await fetchExchangeRate(currency)).rate;
      const priceForm = (model) => {
        const row = prices[model] ?? {};
        const auto = [...all].reverse().find((item) => item.model === model && item.pricing)?.pricing;
        const autoUnit = auto?.currency && auto.original ? auto.currency : 'USD';
        const symbol = { CNY:'¥', USD:'$' }[autoUnit] ?? `${autoUnit} `;
        const hint = (key) => {
          const value = autoUnit === 'USD' ? auto?.[key] : auto?.original?.[key];
          return value != null ? `자동 ${symbol}${value}` : key.startsWith('cache') ? '입력과 같음' : '0';
        };
        const box = (key, label) => field(label,input(key,row[key] ?? '',{ type:'number',min:0,step:'any',inputmode:'decimal',placeholder:hint(key) }));
        return dialogForm(async (values) => {
          const unit = String(values.get('unit') || 'USD');
          const read = (key) => { const value = String(values.get(key) ?? '').trim(); return value === '' ? undefined : Math.max(0,Number(value)); };
          const entry = Object.fromEntries(['input','cacheRead','cacheWrite','output','perCall'].map((key) => [key,read(key)]).filter(([,value]) => Number.isFinite(value)));
          if (Object.keys(entry).length && unit !== 'USD') Object.assign(entry,{ unit, usdRate:await knownRate(unit) });
          save((next) => {
            next.settings.pricing = { ...(next.settings.pricing ?? {}) };
            if (Object.keys(entry).length) next.settings.pricing[model] = entry;
            else delete next.settings.pricing[model];
            audit(next,`토큰 단가 저장 · ${model}`);
          });
        }, [el('strong',{ class:'price-model' },model),
          note(modelPrices(prices,model) ? '직접 넣은 단가를 쓰는 중이에요. 칸을 모두 비우고 저장하면 자동 단가로 돌아가요.'
            : auto ? `자동 단가 사용 중 · ${priceSources[auto.source] ?? auto.source}${autoUnit !== 'USD' ? ` · ${currencyLabel(autoUnit)}` : ''}` : '아직 자동 단가가 확인되지 않았어요. AI가 답변하면 가격표에서 찾아봐요.'),
          field('통화',select('unit',[['USD','달러($)'],['CNY','위안(¥)']],row.unit ?? autoUnit)),
          grid(box('input','입력'),box('cacheRead','캐시 읽기'),box('cacheWrite','캐시 쓰기'),box('output','출력'),box('perCall','호출당'))],'단가 저장','price-form');
      };
      const recent = (only ?? all).slice(-20).reverse();
      const tableHost = el('div',{ class:'price-table-host' });
      const table = el('details',{ class:'record' },el('summary',{},'기본 단가표 · NanoGPT · OpenRouter · Vertex · LinkAPI'),tableHost);
      priceTableView(tableHost);
      dialog.replaceChildren(...[
        row(headline(only ? onlyTitle : '토큰 사용량 · 비용'),button('닫기',() => dialog.close())),
        only ? receipt(only,'이 답변')
          : receipt(all.filter((item) => item.session === state.session),`이번 세션 · ${sessionHeading(currentSession(state) ?? { number:state.session })}`),
        recent.length ? el('details',{ class:'record usage-recent' },el('summary',{},`최근 호출 ${recent.length}개`),
          el('ul',{ class:'scene-list' },recent.map((item) => {
            const cost = recordCost(item,prices);
            const tokens = usageTotals([item]).tokens;
            return el('li',{},`${new Date(item.at).toLocaleString('ko-KR',{ month:'numeric',day:'numeric',hour:'numeric',minute:'2-digit' })} · ${usageTasks[item.task] ?? item.task} · ${item.missing ? '사용량 없음' : formatTokens(tokens)}${cost ? ` · ${formatLocalAmount(localCost(cost,fx()),fx()) || formatMoney(cost.total * cost.usdRate,cost.currency)}` : ''}`);
          }))) : note('아직 기록된 호출이 없어요. AI가 답변하면 여기에 쌓여요.'),
        el('details',{ class:'record' },
          el('summary',{},'모델 단가 · 자동 / 직접 입력 (USD / 100만 토큰)'),
          note('NanoGPT · OpenRouter · Vertex · LinkAPI 연결은 가격표에서 단가를 자동으로 가져와요. 직접 넣은 단가가 있으면 그게 우선이에요.'),
          models.length ? models.map(priceForm) : note('게임 설정에서 텍스트 모델 연결을 고르거나 AI가 한 번 답변하면 모델이 여기에 나타나요.')),
        table,
        el('details',{ class:'record' },el('summary',{},`환율 · ${rate?.rate ? formatRate(rate) : '미설정'}`),
          dialogForm((values) => save((next) => {
            const currency = String(values.get('currency') || 'KRW').toUpperCase().replace(/[^A-Z]/g,'').slice(0,3) || 'KRW';
            const value = Number(values.get('rate'));
            if (!Number.isFinite(value) || value <= 0) throw Error('달러 환율을 숫자로 입력하세요.');
            const rates = {};
            for (const from of fxSources.filter((item) => item !== 'USD')) {
              const typed = String(values.get(`rate-${from}`) ?? '').trim();
              if (typed === '') continue;
              const parsed = Number(typed);
              if (!Number.isFinite(parsed) || parsed <= 0) throw Error(`${from} 환율을 숫자로 입력하세요.`);
              rates[from] = parsed;
            }
            next.settings.fx = { currency, rate:value, rates, date:'직접 입력', updatedAt:new Date().toISOString() };
          }), [grid(field('표시 통화',input('currency',rate?.currency ?? 'KRW',{ maxlength:3 })),
            field('USD 1당',input('rate',rate?.rate ?? '',{ type:'number',min:0,step:'any',inputmode:'decimal',placeholder:'예: 1339.44' })),
            ...fxSources.filter((item) => item !== 'USD').map((from) => field(`${from} 1당`,input(`rate-${from}`,rate?.rates?.[from] ?? '',{ type:'number',min:0,step:'any',inputmode:'decimal',placeholder:from === 'CNY' ? '예: 200.55 (LinkAPI용)' : '' })))),
            note('LinkAPI처럼 위안으로 청구되는 호출은 CNY 환율로, 나머지는 USD 환율로 원화를 계산해요. CNY 칸을 비우면 달러를 거쳐 계산해요.')],'환율 저장','price-form'),
          button('오늘 환율 가져오기',() => {
            announce('환율을 불러오는 중…');
            fetchLocalRates(rate?.currency ?? 'KRW')
              .then((value) => save((next) => { next.settings.fx = value; },() => announce(`환율을 불러왔습니다 · ${formatRate(value)}`,'ok')))
              .catch((error) => announce(error.message,'error'));
          }),
          note('오늘 환율(달러·위안)은 공개 환율 서비스(frankfurter)에서 가져와요. 버튼을 누를 때만 요청해요.')),
        only ? null : button('사용량 기록 초기화',() => {
          if (window.confirm('이 게임의 토큰 사용 기록을 모두 지울까요? 단가와 환율 설정은 남아요.')) save((next) => { next.usageLog = []; audit(next,'토큰 사용 기록 초기화'); });
        },{ class:'usage-reset' }),
      ].flat(Infinity).filter((part) => part != null && part !== false));
    };
    paint();
    surface.append(dialog);
    dialog.showModal();
  }

  function compose() {
    const persona = playerPersona();
    const suggestions = ['/desc','/as','/em','/check','/roll','/gmroll','/toai','/w', ...(persona ? ['/keeper'] : []), ...state.macros.map((macro) => `#${macro.name}`)];
    const helper = el('div', { class:'suggestions' });
    const composer = textarea('keeper',draft,{ id:'coc7-keeper-input',rows:3,enterkeyhint:'send',
      title:'Enter로 보내기 · Shift+Enter로 줄바꿈',placeholder:persona ? `페르소나 대사, /em 행동, /d 장면, /as NPC · pc → ${state.sheet.name}, npc → ${persona.name}` : `장면이나 NPC 대사를 입력하세요. /d(/desc), /as, /check, /toai · pc → ${state.sheet.name}`,
      'aria-label':persona ? '플레이 메시지' : '키퍼 메시지' });
    const updateSuggestions = () => {
      const prefix = composer.value.trimStart();
      const matches = prefix && !/\s/.test(prefix) ? suggestions.filter((value) => value.startsWith(prefix)).slice(0, 8) : [];
      helper.replaceChildren(...matches.map((value) => button(value, () => { draft = composer.value = value + ' '; helper.replaceChildren(); composer.focus(); })));
    };
    composer.addEventListener('input', () => {
      // Typing a short command and a space expands it in place, e.g. "/d " becomes "/desc ".
      const expanded = expandCommandAliases(composer.value);
      if (expanded !== composer.value && /\s$/.test(composer.value.slice(0,composer.selectionStart))) {
        const caret = composer.selectionStart + expanded.length - composer.value.length;
        composer.value = expanded;
        composer.setSelectionRange(caret,caret);
      }
      draft = composer.value;
      updateSuggestions();
    });
    composer.addEventListener('keydown', (event) => {
      // Tab takes the first command suggestion while one is showing.
      if (event.key === 'Tab' && !event.shiftKey && helper.firstChild) {
        event.preventDefault();
        helper.firstChild.click();
        return;
      }
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) {
        event.preventDefault();
        if (!event.repeat) send();
      }
    });
    const folded = !composeOpen && !draft.trim();
    return el('div',{ class:`compose${folded ? ' folded' : ''}${composeHidden ? ' tucked' : ''}` },
      el('div',{ class:'compose-heading' },persona ? button(`페르소나 · ${persona.name}`,openPersonaName,{ class:'investigator-name',title:'페르소나 시트 열기' }) : el('label',{ for:'coc7-keeper-input' },'키퍼 입력'),
        el('div',{ class:'compose-meta' },usageMeter(),note(state.settings.auto ? '자동 응답 켜짐' : '자동 응답 꺼짐'),
          button('접기',() => { composeOpen = false; render(); },{ class:'mobile-only compose-fold' }))),
      el('div',{ class:'compose-input' },composer,
        el('p',{ id:'coc7-keeper-error',class:'compose-error',role:'alert',hidden:true })),
      helper,
      el('div',{ class:'compose-actions' },
        button('✎',() => setComposeHidden(false),{ class:'mobile-only compose-show',title:'입력창 보이기','aria-label':'입력창 보이기' }),
        button('✎ 입력하기',() => { composeOpen = true; render(); document.getElementById('coc7-keeper-input')?.focus(); },{ class:'mobile-only compose-open' }),
        button(`AI 답변${pendingCount(state) ? ` (${pendingCount(state)}개 읽기)` : ''}`,answer,{ class:'primary' }),
        cancelRequestButton('chat'),
        button('⌄',() => setComposeHidden(true),{ class:'mobile-only compose-hide',title:'입력창 숨기기','aria-label':'입력창 숨기기' })));
  }

  // Shorthand in typed text: "npc" becomes the linked persona's name and "pc" the investigator's name,
  // so the chat, the replay and the model all read the real names. Only whole Latin-letter words change
  // ("npc가", "pc한테" do; "kpc", "pcs" do not); "npc" is left alone while no persona is linked.
  // Short forms of commands, expanded at the start of any line: "/d" is "/desc".
  const commandAliases = { '/d':'/desc' };
  function expandCommandAliases(text) {
    return String(text).replace(/^([ \t]*)(\/[a-z]+)(?=\s|$)/gim,(match, indent, command) => `${indent}${commandAliases[command.toLowerCase()] ?? command}`);
  }

  // A particle typed right after the shorthand is re-chosen for the real name's last syllable
  // (npc는 → 박도윤은, pc를 → 이수아를), the way it would be written for the name itself.
  const particlePairs = [['은','는'],['이랑','랑'],['을','를'],['과','와'],['으로','로'],['이','가']];
  function particleFor(name, particle) {
    const pair = particlePairs.find((item) => item.includes(particle));
    if (!pair) return particle;
    const last = name.trim().slice(-1).charCodeAt(0);
    if (last < 0xAC00 || last > 0xD7A3) return particle;
    const final = (last - 0xAC00) % 28;
    const consonant = pair[0] === '으로' ? final !== 0 && final !== 8 : final !== 0;
    return consonant ? pair[0] : pair[1];
  }

  function withShorthandNames(text) {
    const swap = (value, pattern, name) => value.replace(pattern,(match, particle) => `${name}${particle ? particleFor(name,particle) : ''}`);
    const particles = '(이랑|랑|으로|로|은|는|을|를|과|와|가|이(?=$|[\\s.,!?~…"\')\\]]))?';
    const persona = playerPersona()?.name;
    const investigator = state.sheet.name;
    let result = String(text);
    if (persona) result = swap(result,new RegExp(`(?<![A-Za-z0-9])npc(?![A-Za-z0-9])${particles}`,'gi'),persona);
    if (investigator) result = swap(result,new RegExp(`(?<![A-Za-z0-9])pc(?![A-Za-z0-9])${particles}`,'gi'),investigator);
    return result;
  }

  async function consumeDraft() {
    if (!draft.trim()) return;
    const typed = draft;
    const source = expandCommandAliases(typed);
    const macro = /^\s*(#|%\{)/.test(source) || /(?:@\{|\?\{|\[\[)/.test(source);
    const player = playerPersona();
    const sheet = personaSheet(state,player?.id);
    const expanded = withShorthandNames(macro ? previewMacro(source,sheet ? player.id : undefined) : source);
    if (!expanded) return;
    const attribution = player && { personaId:player.id, speaker:textValue(player.name,150), personaAvatar:safeImageUrl(player.avatarPath) ? player.avatarPath : '' };
    await transact((next) => {
      for (const line of macro ? expanded.split(/\r?\n/).filter((value) => value.trim()) : [expanded]) {
        if (/^\s*\/check\s/i.test(line) && ['auto','private'].includes(next.settings.rollMode)) announce(`${sheet?.name || next.sheet.name} 주사위 굴리는 중…`);
        const result = handleInput(next,line,undefined,attribution);
        if (result?.kind && Object.hasOwn(result, 'public')) flashRoll = result.id;
      }
    });
    if (draft === typed) draft = '';
    followLatest = true;
    announce('');
  }

  function previewMacro(source, personaId) {
    const expanded = expandMacro(state, source, (label, choices) => {
      const labels = choices.map((item) => item.split(',')[0]);
      const response = window.prompt(choices.length ? `${label}\n${labels.join(' / ')}` : label, labels[0] ?? '');
      if (response === null) return null;
      if (!choices.length) {
        if (/\r|\n/.test(response)) throw Error('매크로 질문은 한 줄로 답하세요.');
        return response;
      }
      const found = choices.find((item) => item.split(',')[0] === response);
      if (!found) throw Error('매크로 질문의 보기 중 하나를 입력하세요.');
      return found.includes(',') ? found.slice(found.indexOf(',') + 1) : found;
    },undefined,personaId);
    return window.confirm(`매크로 실행 미리보기\n\n${expanded}`) ? expanded : null;
  }

  function send() {
    if (draft.trim()) void run(consumeDraft,'',false,true);
  }

  function answer() {
    void run(async (signal) => {
      await consumeDraft();
      if (state.pending.length) throw Error('키퍼 기록에서 대기 중인 판정을 처리하세요.');
      if (state.keeperWait) throw Error('행동 결과를 먼저 서술하거나 키퍼 기록에서 대기를 해제하세요.');
      if (!pendingCount(state)) throw Error('조사자가 읽을 메시지나 지시를 먼저 입력하세요.');
      if (!library.ready) throw Error('Marinara 게임 서버에 연결할 수 없습니다. 세션·설정에서 목록을 새로고침하세요.');
      announce('AI 응답 준비 중…');
      render();
      const { snapshot, response } = await sendTurn(state, vault, adapter, () => announce(`${state.sheet.name} 답변 생성 중…`), signal, { personaName:playerPersona()?.name ?? "" });
      if (closed || signal.aborted) return;
      await transact((next) => { acceptTurn(next, snapshot, response); linkTurnUsage(next); });
      announce('응답 완료', 'ok');
      continueMemory();
    }, 'AI 응답 준비 중…', true);
  }

  function rerollAnswer(id) {
    void run(async (signal) => {
      if (!library.ready) throw Error('Marinara 게임 서버에 연결할 수 없습니다. 세션·설정에서 목록을 새로고침하세요.');
      const replay = rerollTurnState(state,id);
      render();
      const { snapshot, response } = await sendTurn(replay,vault,adapter,() => announce(`${replay.sheet.name} 답변 다시 생성 중…`),signal,{ personaName:playerPersona()?.name ?? "" });
      if (closed || signal.aborted) return;
      await transact((next) => { acceptTurn(next,snapshot,response,id); linkTurnUsage(next,id); });
      announce('응답 완료','ok');
      continueMemory();
    },'AI 답변 리롤 준비 중…',true);
  }

  function fieldSettings() {
    const resolved = library.chats.find((chat) => chat.id === state.settings.chatId);
    const connection = library.connections.find((item) => item.id === (state.settings.connectionId || resolved?.connectionId))
      ?? library.connections.find((item) => item.isDefault === true || item.isDefault === 'true');
    const selectedId = state.settings.presetId || resolved?.promptPresetId || connection?.promptPresetId;
    const selected = selectedId ? library.presets.find((preset) => preset.id === selectedId)
      : library.presets.find((item) => item.isDefault === true || item.isDefault === 'true');
    return section('AI 조사자 설정',
      note(library.ready ? 'Marinara 게임 서버 연결됨' : (libraryError || '게임 서버 연결을 확인하는 중입니다.')),
      note(`프리셋 · ${selected?.name ?? 'Marinara 기본값'}`),
      selected?.id ? presetSectionPicker(selected) : null,
      lorebookPicker(),
      form(async (values) => {
        const cardId = String(values.get('cardId'));
        const card = cardId ? await adapter.card(cardId) : null;
        await transact((next) => {
          for (const key of ['connectionId','presetId','analysisConnection','illustrationConnection']) next.settings[key] = String(values.get(key));
          if (card) {
            const changed = next.settings.cardId !== card.id;
            setCard(next,card);
            if (changed) applyCardSheetValues(next,card.sheetValues);
          }
          if (!cardId && next.settings.cardId) { next.settings.cardId = ''; next.card = {}; }
        });
        announce('연결 설정을 저장했습니다.', 'ok');
      }, grid(
        field('조사자 봇카드',cardSelector('선택 안 함')),
        field('텍스트 모델 연결', select('connectionId', [['','채팅 또는 기본 연결'], ...library.connections.map((item) => [item.id,item.name])], state.settings.connectionId)),
        field('프롬프트 프리셋', select('presetId', [['','채팅 프리셋 따르기'], ...library.presets.map((item) => [item.id,item.name])], state.settings.presetId)),
        field('별도 이미지 분석 모델', select('analysisConnection', [['','사용 안 함'], ...library.connections.map((item) => [item.id,item.name])], state.settings.analysisConnection)),
        field('삽화 프롬프트 모델', select('illustrationConnection', [['','이미지 분석 모델 따르기'], ...library.connections.map((item) => [item.id,item.name])], state.settings.illustrationConnection ?? '')),
      ), '연결 저장'),
      button('Marinara 목록 새로고침', () => void run(loadLibrary)));
  }

  // A checklist form whose save button shares one right-aligned row with the picker's other buttons.
  function pickerForm(submit, boxes, label, ...buttons) {
    const node = form(submit,[el('div',{ class:'preset-section-list' },boxes)],label);
    node.append(el('div',{ class:'row picker-actions' },...buttons,node.querySelector(':scope > button[type=submit]')));
    return node;
  }

  /* Which lorebooks the investigator's answers draw on. Unpicked means the bot card's own lorebooks;
     the Keeper can pick any lorebooks instead. Entries still activate only by the scene's keywords. */
  function lorebookPicker() {
    const picked = Array.isArray(state.settings.lorebookIds) ? state.settings.lorebookIds : null;
    const cardId = state.settings.cardId;
    const own = (book) => !!cardId && book.characterIds.includes(cardId);
    const books = [...library.lorebooks].sort((a,b) => Number(own(b)) - Number(own(a)) || a.name.localeCompare(b.name,'ko'));
    const missing = picked ? picked.filter((id) => !books.some((book) => book.id === id)).length : 0;
    const modeLabel = picked ? (picked.length ? `직접 고름 · ${picked.length}개` : '보내지 않음') : `봇카드 로어북 · ${books.filter(own).length}개`;
    const apply = (value) => (next) => {
      if (value == null) delete next.settings.lorebookIds;
      else next.settings.lorebookIds = value;
    };
    // The form already runs inside run(), so it saves directly; the reset button goes through action().
    const save = (value, message) => action(apply(value),message)();
    const saveNow = async (value, message) => { await transact(apply(value)); announce(message,'ok'); };
    const boxes = books.map((book) => {
      const box = check('lorebookId',picked ? picked.includes(book.id) : own(book));
      box.value = book.id;
      return el('label',{ class:'preset-section' },box,
        el('span',{ class:'preset-section-name' },book.name,
          own(book) ? el('small',{},'봇카드') : null,
          book.enabled ? null : el('small',{},'꺼짐 · 안 보내요')));
    });
    const body = !library.ready && !books.length ? [note('Marinara 목록을 새로고침해 로어북을 불러오세요.')] : [
      note('AI 답변에 넣을 로어북을 골라요. 기본은 봇카드에 연결된 로어북이에요. 모두 해제하고 저장하면 로어북을 보내지 않아요. 고른 로어북도 지금 장면의 단어로 켜진 항목만 들어가요. Marinara에서 꺼 둔 로어북은 보내지 않아요.'),
      missing ? note(`고른 로어북 중 ${missing}개를 찾을 수 없어요. 다시 저장하면 빠져요.`) : null,
      books.length ? pickerForm((values) => saveNow(values.getAll('lorebookId').map(String),'고른 로어북을 저장했어요.'),boxes,'고른 로어북 저장',
        button('봇카드 로어북 쓰기',() => save(null,'봇카드에 연결된 로어북을 써요.'),{ disabled:!!running || !picked })) : note('Marinara에 로어북이 없어요.')];
    return el('details',{ class:'record','data-disclosure-id':'investigator-lorebooks' },
      el('summary',{},`조사자 로어북 · ${modeLabel}`),...body.filter(Boolean));
  }

  /* Which parts of the preset a CoC turn sends. Automatic keeps the writing-style sections and {{기억}};
     the role, NPC, status-window and content sections are left out because the CoC rules cover them, and the
     card, persona and lorebook because CoC sends its own. The Keeper can tick sections by hand or send all. */
  const presetSectionCache = new Map();

  function presetSectionPicker(preset) {
    const choice = state.settings.presetSections?.[preset.id];
    const modeLabel = choice === 'all' ? '전부 보내기' : Array.isArray(choice) ? `직접 고름 · ${choice.length}개` : '자동 · 문체만';
    const host = el('div',{ class:'preset-sections' });
    const apply = (value) => (next) => {
      next.settings.presetSections = { ...(next.settings.presetSections ?? {}) };
      if (value == null) delete next.settings.presetSections[preset.id];
      else next.settings.presetSections[preset.id] = value;
    };
    // The form already runs inside run(), so it saves directly; the other buttons go through action().
    const save = (value, message) => action(apply(value),message)();
    const saveNow = async (value, message) => { await transact(apply(value)); announce(message,'ok'); };
    const fill = (data) => {
      const sections = data.sections ?? [];
      const picked = (item) => (choice === 'all' ? true : Array.isArray(choice) ? choice.includes(item.id) : item.auto);
      const size = (item) => (item.tokens == null ? '자동' : `~${item.tokens.toLocaleString('en-US')}`);
      const total = el('strong',{});
      const boxes = sections.map((item) => {
        const box = check('preset-section',picked(item));
        box.value = item.id;
        return el('label',{ class:`preset-section${item.auto ? ' is-auto' : ''}` },box,
          el('span',{ class:'preset-section-name' },item.name || item.tag || '이름 없는 섹션',
            item.memory ? el('small',{},'{{기억}}') : item.auto ? el('small',{},'문체') : null),
          el('span',{ class:'preset-section-size' },size(item)));
      });
      const recount = () => {
        const ids = new Set(boxes.map((label) => label.querySelector('input')).filter((box) => box.checked).map((box) => box.value));
        const tokens = sections.filter((item) => ids.has(item.id)).reduce((sum,item) => sum + (item.tokens ?? 0),0);
        const all = sections.reduce((sum,item) => sum + (item.tokens ?? 0),0);
        total.textContent = `보내는 섹션 ${ids.size}/${sections.length}개 · 약 ${tokens.toLocaleString('en-US')} / ${all.toLocaleString('en-US')} 토큰`;
      };
      for (const label of boxes) label.querySelector('input').addEventListener('change',recount);
      recount();
      host.replaceChildren(
        note('"자동"은 문체 섹션과 {{기억}}만 보내요. 역할·NPC·상태창·수위 섹션은 게임 규칙과 부딪혀서, 카드·페르소나·로어북은 게임이 따로 보내서 빼요. 카드 정보 같은 "자동" 크기 섹션은 내용이 그때그때 정해져요.'),
        total,
        pickerForm((values) => saveNow(values.getAll('preset-section').map(String),'고른 섹션만 보내도록 저장했어요.'),boxes,'고른 섹션 저장',
          button('자동으로 (문체만)',() => save(null,'프리셋을 자동(문체만)으로 보내요.'),{ disabled:!!running || choice == null }),
          button('전부 보내기',() => save('all','프리셋 전체를 보내요.'),{ disabled:!!running || choice === 'all' })));
    };
    const cached = presetSectionCache.get(preset.id);
    if (cached) fill(cached);
    else {
      host.append(note('프리셋 섹션을 불러오는 중…'));
      adapter.presetSections(preset.id).then((data) => {
        presetSectionCache.set(preset.id,data);
        if (host.isConnected || !closed) fill(data);
      }).catch((error) => host.replaceChildren(note(`프리셋 섹션을 불러오지 못했어요 · ${error.message}`)));
    }
    return el('details',{ class:'record','data-disclosure-id':'preset-sections' },
      el('summary',{},`프리셋에서 보낼 부분 · ${modeLabel}`),host);
  }

  function personaConnectionForm() {
    if (!library.ready) return note('Marinara 목록을 새로고침해 페르소나를 불러오세요.');
    const currentId = library.chats[0]?.personaId;
    return [currentId && !playerPersona() ? note('연결했던 페르소나를 찾을 수 없습니다. 다시 선택하세요.') : null,
      form(async (values) => {
        const id = String(values.get('personaId')) || null;
        if (id && !library.personas.some((item) => item.id === id)) throw Error('Marinara 페르소나를 다시 선택하세요.');
        await options.setPersona(id);
        library.chats[0].personaId = id;
        announce(id ? '플레이어 페르소나를 연결했습니다.' : '플레이어 페르소나 연결을 해제했습니다.','ok');
      },field('Marinara 페르소나',select('personaId',[['','연결 안 함'],...library.personas.map((item) => [item.id,item.name])],currentId)),'페르소나 저장','persona-form')];
  }

  function personaSettings() {
    const current = playerPersona();
    return section('플레이어 페르소나',
      current ? row(safeImageUrl(current.avatarPath) ? sourceImage(current.avatarPath,'',{ class:'avatar' }) : null,el('strong',{},current.name),
        button('페르소나 시트 열기',openPersonaSheet)) : null,
      library.ready ? note('플레이어가 이 페르소나의 대사와 행동을 맡고, AI는 조사자 한 명을 맡습니다.') : null,
      personaConnectionForm());
  }

  function setCard(next, card) {
    const oldCard = next.card;
    const sameCard = next.settings.cardId === card.id;
    if (!sameCard || !next.sheet.occupation || next.sheet.occupation === textValue(oldCard.occupation,2000)) {
      next.sheet.occupation = textValue(card.occupation,2000);
    }
    for (const [field,key] of Object.entries(cardProfileFields)) {
      if (field === 'occupation') continue;
      const value = textValue(card[key],field === 'name' ? 100 : 2000);
      if (!value) continue;
      if (sameCard && oldCard[key] && String(next.sheet[field]) !== oldCard[key]) continue;
      if (field === 'age') {
        const age = Number(value);
        if (Number.isInteger(age) && age >= 15 && age <= 89) next.sheet.age = age;
      } else next.sheet[field] = value;
    }
    next.settings.cardId = card.id;
    next.card = card;
    audit(next, 'Marinara 조사자 카드 연결');
  }

  function cardSelector(empty) {
    return select('cardId',[['',empty],...library.cards.map((item) => [item.id,item.name])],state.settings.cardId);
  }

  function investigatorCardPanel() {
    const picker = cardSelector('봇카드를 고르세요');
    picker.required = true;
    const connected = Boolean(state.settings.cardId);
    return section('조사자 봇카드',
      form(async (values) => {
        const card = await adapter.card(String(values.get('cardId')));
        let count;
        await transact((next) => {
          setCard(next,card);
          count = applyCardSheetValues(next,card.sheetValues);
        });
        announce(count ? `봇카드에 적힌 수치 ${count}개를 가져왔습니다.` : '봇카드를 연결했습니다. 능력치 자동 적용을 사용할 수 있습니다.','ok');
      },field('Marinara 봇카드',picker),'봇카드 불러오기'),
      library.ready ? null : note(libraryError || 'Marinara 봇카드 목록을 불러오는 중입니다.'),
      connected ? [button('능력치 자동 적용',() => applyCardAuto(),{ class:'primary',disabled:!!running }),
        cancelRequestButton('card-auto'),
        note('봇카드를 참고해 능력치와 직업·관심 기능을 채웁니다.')] : null);
  }

  async function loadLibrary() {
    try {
      library = await adapter.library();
      libraryError = '';
      const cardId = state.settings.cardId;
      if (cardId && !closed) {
        const card = await adapter.card(cardId).catch(() => null);
        if (card && !closed && state.settings.cardId === cardId &&
          ((!state.sheet.occupation && card.occupation) || JSON.stringify(card) !== JSON.stringify(state.card))) {
          await transact((next) => setCard(next,card));
        }
      }
    }
    catch (error) { libraryError = error.message; }
    libraryLoaded = true;
  }

  function sheetPanel() {
    const sheet = state.sheet;
    const photoKey = state.settings.cardId || 'local';
    const hasUpload = !!state.portraits[photoKey];
    const canRestoreCard = state.portraitChoices?.[photoKey] && safeImageUrl(state.card.avatar);
    return [
      investigatorCardPanel(),
      profilePanel('조사자 프로필',sheet,portrait(),undefined,
        form(async (values) => {
          const file = values.get('image');
          const verified = await assetFromFile(file, true);
          await transact((next, media) => {
            const key = next.settings.cardId || 'local';
            removeAsset(next, media, next.portraits[key]);
            next.portraits[key] = verified.meta.id;
            (next.portraitChoices ??= {})[key] = { upload:true };
            next.assets.push(verified.meta);
            media.add.push([verified.meta.id, verified.blob]);
          });
          announce('조사자 사진을 저장했습니다.','ok');
        }, field('프로필 이미지', input('image','',{ type:'file', accept:imageAccept, required:true })), '이미지 적용'),
        hasUpload || canRestoreCard ? row(
          canRestoreCard ? button('봇카드 사진으로 복원',setPortraitChoice(null)) : null,
          hasUpload ? button('업로드 제거', action((next, media) => {
          const key = next.settings.cardId || 'local';
          removeAsset(next, media, next.portraits[key]);
          delete next.portraits[key];
          if (next.portraitChoices?.[key]?.upload) delete next.portraitChoices[key];
        })) : null) : null,
        profileForm(sheet)),
      resourcePanel(sheet),skillPanel(sheet),creationPanel(sheet),
    ];
  }

  function profilePanel(title,sheet,photo,personaId,...content) {
    return section(title,row(photo,el('div',{},el('strong',{},sheet.name),note(sheet.occupation || '직업 미입력')),
      sheet.finalized ? button('캐릭터 시트 보기',() => showCharacterSheet(personaId)) : null),content);
  }

  function profileForm(sheet, personaId) {
    return form((values) => transact((next) => {
      const target = sheetFor(next,personaId);
      const name = textValue(values.get('name'),personaId ? 100 : 2000);
      if (personaId && !name) throw Error('페르소나 시트 이름을 입력하세요.');
      target.name = name;
      target.age = integer(values.get('age'),15,89,'나이');
      target.gender = textValue(values.get('gender'),2000);
    }),grid(field(personaId ? '페르소나 시트 이름' : '조사자 이름',input('name',sheet.name,required)),
      field('나이',input('age',sheet.age,numeric(15,89))),field('성별',input('gender',sheet.gender))),
    '프로필 저장','profile-form');
  }

  function personaSheetPanel() {
    const persona = playerPersona();
    const id = persona?.id;
    const sheet = personaSheet(state,id);
    const settings = section('페르소나 설정',personaConnectionForm(),
      !library.ready ? button('Marinara 목록 새로고침',() => void run(loadLibrary)) : null,
      sheet ? [button('능력치 자동 적용',() => applyCardAuto(id),{ class:'primary',disabled:!!running }),
        cancelRequestButton('persona-auto')] : null);
    if (!persona) return settings;
    const avatar = safeImageUrl(persona.avatarPath) ? sourceImage(persona.avatarPath,'',{ class:'avatar' }) : null;
    if (!sheet) return [settings,section('페르소나 시트',row(avatar,el('strong',{},persona.name)),
      button('페르소나 시트 만들기',() => void run(async (signal) => {
        const profile = await adapter.persona(id,signal);
        await transact((next) => {
          next.personaSheets = { ...next.personaSheets,[id]:createSheet(profile) };
          applyCardSheetValues(next,profile.sheetValues,id,profile.sheetValues);
          audit(next,`페르소나 시트 생성 · ${persona.name}`);
        });
        announce('페르소나 시트를 만들었습니다.','ok');
      }),{ class:'primary',disabled:!!running }))];
    const photoTitle = `${sheet.name} 페르소나 사진`;
    const photo = avatar ? button(avatar,() => showPreview(null,persona.avatarPath,photoTitle),
      { class:'portrait-button portrait-round','aria-label':`${photoTitle} 확대`,title:`${photoTitle} 확대` }) : null;
    return [settings,
      profilePanel('페르소나 프로필',sheet,photo,id,profileForm(sheet,id)),
      resourcePanel(sheet,id),skillPanel(sheet,id),creationPanel(sheet,id)];
  }

  function resourcePanel(sheet, personaId) {
    const maxima = derived(sheet);
    return section('능력치와 자원',
        el('div', { class:'resource-strip' }, [['HP',sheet.hp,maxima.hp],['SAN',sheet.san,maxima.san],['MP',sheet.mp,maxima.mp],['Luck',sheet.luck],['MOV',maxima.mov],['Build',maxima.build],['DB',maxima.db]].map(([label,value,max]) =>
          el('div', {}, el('span', {}, label), el('b', {}, `${value}${max !== undefined ? ` / ${max}` : ''}`)))),
        form((values) => transact((next) => {
          const target = sheetFor(next,personaId);
          for (const key of Object.keys(ATTR)) target.attributes[key] = integer(values.get(key),1,target.house ? 999 : 99,key);
          for (const key of ['hp','mp','san','luck']) target[key] = integer(values.get(key),0,999,key.toUpperCase());
          capResources(next,personaId);
        }), [
          grid(...Object.entries(ATTR).map(([key,label]) => field(`${key} · ${label}`,input(key,sheet.attributes[key],numeric(1,sheet.house ? 999 : 99))))),
          grid(...['hp','mp','san','luck'].map((key) => field(key.toUpperCase(),input(key,sheet[key],numeric(0,999))))),
        ], '능력치 저장'));
  }

  function skillPanel(sheet, personaId) {
    const sheetKey = personaId || 'investigator';
    const categories = Object.entries(SKILL_CATEGORIES);
    const rows = sheet.skills.map((skill) => {
      const category = skillCategory(skill);
      const growth = skillGrowthAmount(skill);
      return el('details', { class:'record','data-disclosure-id':skill.id }, el('summary', {}, [
        `${skill.name} · ${skill.value}`,SKILL_CATEGORIES[category],growth && `성장 +${growth}`,skill.experience && '경험 ✓',
      ].filter(Boolean).join(' · ')),
        form((values) => transact((next) => {
          const target = sheetFor(next,personaId);
          const found = target.skills.find((item) => item.id === skill.id);
          const name = textValue(values.get('name'),80);
          const duplicate = stat(next,name,personaId);
          if (!name || (duplicate && duplicate.skill?.id !== skill.id)) throw Error('기능 이름이 이미 사용 중입니다.');
          if (name !== found.name) {
            found.official = false;
            found.base = skillStartingValue(name,target) ?? 0;
          }
          const auto = values.has('auto');
          Object.assign(found,{ name,value:integer(values.get('value'),0,999,'기능치'),auto });
          if (auto) found.locked = false;
          if (found.growthPoints !== undefined) {
            found.growthPoints = Math.min(found.growthPoints,Math.max(0,found.value - found.base));
            if (found.cardGrowth !== undefined) found.cardGrowth = Math.min(found.cardGrowth,found.growthPoints);
          }
          setSkillCategory(found,String(values.get('category')));
          capResources(next,personaId);
        }), [
          grid(field('이름',input('name',skill.name,required)), field('현재 기능치',input('value',skill.value,numeric(0,999))),
            field('분류',select('category',categories,category))),
          toggle('자동 작성',check('auto',skill.auto && !skill.locked)),
          el('div',{ class:'row skill-actions' },button('기능 삭제', () => {
            if (window.confirm(`${skill.name} 기능을 삭제할까요?`)) action((next) => {
              const target = sheetFor(next,personaId);
              target.skills = target.skills.filter((item) => item.id !== skill.id);
              capResources(next,personaId);
            })();
          }),skill.experience ? button('성장 굴림', action((next) => {
            const result = advanceSkill(next,skill.id,personaId);
            announce(`성장 D100 ${result.result} · +${result.gain}`,'notice');
          })) : null),
        ], '기능 저장','skill-edit'));
    });
    const nameField = field('기능 이름',textarea('name','',{ rows:2, placeholder:'쉼표(,)로 구분 · 예: 관찰력, 심리학' }));
    const categoryField = field('분류',select('category',[['','표 기준 자동 분류'],...categories],''));
    return section('기능 목록', rows.length ? rows : note('필요한 기능을 직접 추가하세요.'),
      form(async (values, signal) => {
        const names = textValue(values.get('name')).split(/[,，]/).map((name) => name.trim()).filter(Boolean);
        if (!names.length) throw Error('추가할 기능 이름을 입력하세요.');
        const category = textValue(values.get('category'));
        const ids = new Set();
        await transact((next) => {
          for (const name of names) {
            ids.add(addSkill(next,name,undefined,false,personaId,category).id);
          }
        });
        if ((!personaId && !state.settings.cardId) || signal.aborted) return;
        skillAnalysisFor = sheetKey;
        render();
        try {
          const source = await autoSheetSource(personaId,signal);
          const targets = cardAutoTargets(source,personaId).filter(({ id }) => ids.has(id));
          if (!targets.length) return;
          const count = await applyCardTargets(source,targets,signal,personaId);
          if (count) announce(`새 기능 ${count}개의 수치를 자동 적용했습니다.`,'ok');
        } catch (error) {
          if (!signal.aborted) throw Error(`기능을 기본값으로 저장했습니다. AI 기능치 입력 실패 · ${error?.message ?? '요청을 완료하지 못했습니다.'}`);
        } finally {
          skillAnalysisFor = null;
        }
      },[nameField,categoryField],'+ 기능 추가'),
      skillAnalysisFor === sheetKey ? el('p',{ class:'quiet',role:'status' },'AI가 기능을 분석하는 중…') : null);
  }

  function creationPanel(sheet, personaId) {
    const age = ageRules(sheet.age);
    // Age adjustment is optional: it never blocks finalizing, it is only suggested while not applied.
    const issues = sheet.finalized ? [] : creationIssues(sheet,false);
    const ageHint = !sheet.finalized && !sheet.house && !sheet.ageApplied
      ? note(`연령 보정은 선택이에요 · ${sheet.age}세 규칙은 EDU 향상 ${age.eduChecks}회${age.physicalLoss ? ` · 신체 −${age.physicalLoss}` : ''}${age.eduLoss ? ` · EDU −${age.eduLoss}` : ''}. 적용하지 않아도 생성 확정할 수 있어요.`) : null;
    const warnings = issues.map((issue,index) => el('p',{ class:'warning',tabindex:index === 0 ? -1 : undefined },issue));
    const pointSummary = creationPointUsage(sheet).map(({ text, overBudget }) => note(overBudget ? `${text} · 넘었지만 생성 확정할 수 있어요` : text));
    const finishCreation = () => {
      // Say why the sheet cannot be finalized yet instead of only moving focus to a collapsed warning.
      if (warnings.length) {
        const panel = warnings[0].closest('details');
        if (panel) panel.open = true;
        announce(`생성 확정 전에 먼저 해결하세요 · ${issues.join(' / ')}`,'error');
        warnings[0].focus();
        return;
      }
      action((next) => {
        const target = sheetFor(next,personaId);
        if (target.finalized) { target.finalized = false; return; }
        target.finalized = true;
        capResources(next,personaId);
        if (!personaId) next.condition.sanAtStart = target.san;
      })();
    };
    const adjustment = sheet.ageApplied
      ? note(`연령 보정 기록 · ${sheet.ageApplied.age}세 · EDU 굴림 ${sheet.ageApplied.rolls.map((entry) => `${entry.result}/+${entry.gain}`).join(', ') || '없음'}`)
      : form((values) => transact((next) => {
        applyAge(sheetFor(next,personaId),Object.fromEntries(age.physical.map((key) => [key,values.get(key)])));
        capResources(next,personaId);
      }), [note(`${sheet.age}세 · 신체 감소점 ${age.physicalLoss} · EDU 향상 ${age.eduChecks}회`),
        age.physicalLoss ? grid(...age.physical.map((key) => field(`${key} 감소`,input(key,0,numeric(0,age.physicalLoss))))) : null],
      '연령 보정 적용','age-adjustment');
    if (!sheet.ageApplied) adjustment.prepend(adjustment.querySelector('button[type=submit]'));
    const panel = section('연령 보정 · 생성 확정',
      adjustment,
      row(button(sheet.finalized ? '생성 상태로 전환' : '생성 확정',finishCreation)),
      pointSummary,
      ageHint,
      warnings.length ? warnings : note(sheet.finalized ? '생성 확정됨 · 시트 수정 가능' : sheet.house ? '하우스 룰 사용 중' : '생성 검증 통과'));
    if (personaId) panel.dataset.disclosureId = '페르소나 생성 규칙';
    panel.open = false;
    return panel;
  }

  async function autoSheetSource(personaId,signal) {
    if (!personaId) {
      // 봇카드 설정을 바꾼 뒤에도 따라가도록 자동 적용할 때마다 카드를 새로 읽는다.
      const cardId = state.settings.cardId;
      const card = cardId ? await adapter.card(cardId).catch(() => null) : null;
      return card ? { ...state,card } : state;
    }
    const card = await adapter.persona(personaId,signal);
    return { ...state,card,settings:{ ...state.settings,cardId:'' } };
  }

  function applyCardAuto(personaId) {
    const label = personaId ? '페르소나 설정' : '캐릭터 카드';
    void run(async (signal) => {
      const source = await autoSheetSource(personaId,signal);
      const targets = cardAutoTargets(source,personaId);
      const response = await adapter.generate(source,suggestionInput(source,targets,true,true,personaId),() => announce(`${label} 분석 중…`),signal);
      if (closed || signal.aborted) return;
      let applied;
      let profileCount = 0;
      await transact((next) => {
        if (!personaId && next.settings.cardId === source.settings.cardId) next.card = source.card;
        profileCount = syncSheetProfile(sheetFor(next,personaId),source.card);
        const fixedCount = applyCardSheetValues(next,source.card.sheetValues,personaId,source.card.sheetValues);
        applied = applyCardProfile(next,source,targets,parseModelJson(response),personaId);
        applied.count += fixedCount;
      });
      const { count, added } = applied;
      const actions = [count ? `능력치·기능치 ${count}개를 자동 적용했습니다.` : `${label}에서 적용할 수치를 찾지 못했습니다.`,added ? `새 기능 ${added}개를 추가했습니다.` : '',
        profileCount ? `프로필 ${profileCount}개 항목(이름·나이·성별·직업)을 설정에 맞췄습니다.` : ''];
      announce(actions.filter(Boolean).join(' '),'ok');
    }, `${label} 분석 준비 중…`, personaId ? 'persona-auto' : 'card-auto');
  }

  async function applyCardTargets(source,targets,signal,personaId) {
    const result = await adapter.generate(source,suggestionInput(source,targets,true,false,personaId),() => {},signal);
    if (closed || signal.aborted) return 0;
    const proposal = evaluateProposal(source,targets,parseModelJson(result),true,personaId);
    await transact((next) => applyProposal(next,proposal,personaId,source.card.sheetValues));
    return proposal.rows.length;
  }

  function pendingRolls() {
    if (!state.keeperWait && !state.pending.length) return null;
    return section('대기 중인 주사위',
      state.keeperWait ? row(note('조사자가 행동 결과를 기다리고 있습니다.'),button('결과 대기 해제',action((next) => { next.keeperWait = null; }))) : null,
      state.pending.map((request) => el('article',{ class:'record' },el('strong',{},`${request.personaId ? `${sheetFor(state,request.personaId).name} · ` : ''}${request.name} · ${DIFFICULTY[request.difficulty]}`),
        row(button(state.settings.rollMode === 'approval' ? '승인하고 굴리기' : '키퍼가 굴리기',() => void run(() => executeRoll(request))),
          button('판정 요청 취소',action((next) => { next.pending = next.pending.filter((item) => item.id !== request.id); }))))));
  }

  async function executeRoll(request) {
    announce(`${sheetFor(state,request.personaId).name} · ${request.name} 주사위 굴리는 중…`);
    await new Promise((resolve) => setTimeout(resolve, 120));
    await transact((next) => {
      if (next.rollHistory.some((item) => item.requestId === request.id)) throw Error('이미 처리한 판정입니다.');
      const roll = rollCheck(next,request);
      roll.requestId = request.id;
      flashRoll = roll.id;
      next.pending = next.pending.filter((item) => item.id !== request.id);
      announce('판정 계산 중…');
    });
    announce(state.keeperWait ? '키퍼의 판정 결과를 기다리는 중' : '');
  }

  function macrosPanel() {
    const examples = [
      '/desc 장면',
      '/as "NPC 이름" 대사',
      '/em 행동',
      '/check 기능명  (페르소나 시트로 굴림)',
      '/check pc 기능명  (조사자 시트로 굴림)',
      '  /check 기능명 | hard 시, 어려움 기준 (기준치의 1/2)',
      '  /check 기능명 | extreme 시, 극단 기준 (기준치의 1/5)',
      '  /check 기능명 | hard | 1 시, 보너스 주사위 1개 (-1이면 페널티, -2~2)',
      '/roll 1d6',
      '/gmroll 1d6',
      '/toai 지시',
      '/w 키퍼 기록',
      '#이름 또는 %{이름}',
      '@{능력치/기능명}',
      '?{질문|선택지,값} · [[주사위 식]]',
    ];
    const guide = el('details',{},el('summary',{},'명령어 사용법'),
      el('div',{ class:'section quiet' },el('pre',{ class:'message-text' },el('code',{},examples.join('\n')))));
    const edit = (item = {}) => form((values) => transact((next) => {
      const name = textValue(values.get('name'),50);
      const body = textValue(values.get('body'),10000);
      if (!/^[\p{L}\p{N}_.-]+$/u.test(name) || !body) throw Error('공백 없는 이름과 실행 내용을 입력하세요.');
      if (next.macros.some((other) => other.id !== item.id && normalized(other.name) === normalized(name))) throw Error('이미 사용 중인 매크로 이름입니다.');
      const entry = { id:item.id ?? uid(), name, body, favorite:values.has('favorite') };
      if (item.id) next.macros = next.macros.map((other) => other.id === item.id ? entry : other);
      else next.macros.push(entry);
    }), [field('이름',input('name',item.name,required)),field('명령어',textarea('body',item.body,{ ...required, placeholder:'/check 관찰력 | hard | 1' })),
      toggle('즐겨찾기',check('favorite',item.favorite))], item.id ? '매크로 저장' : '매크로 추가');
    return [guide,section('명령어와 매크로',
      state.macros.filter((item) => item.favorite).length ? row(...state.macros.filter((item) => item.favorite).map((item) => button(`#${item.name}`, () => { draft = `#${item.name}`; send(); }))) : null,
      state.macros.map((item) => el('details', { class:'record','data-disclosure-id':item.id }, el('summary', {}, `#${item.name}`), edit(item),
        row(button('실행 미리보기', () => { draft = `#${item.name}`; send(); }), button('삭제', () => {
          if (window.confirm(`#${item.name}을 삭제할까요?`)) action((next) => { next.macros = next.macros.filter((other) => other.id !== item.id); })();
        })))),
      edit())];
  }

  function removeAsset(next, media, id) {
    if (!id) return;
    next.assets = next.assets.filter((asset) => asset.id !== id);
    media.remove.push(id);
  }

  function viewFile(item) {
    void run(async () => {
      const blob = await vault.blob(state.id,item.assetId);
      if (!blob) throw Error('저장된 원본 파일을 찾을 수 없습니다.');
      downloadFile(item.filename,blob);
    });
  }

  function handoutImage(item, asset = state.assets.find(({ id }) => id === item.assetId)) {
    if (!imageTypes.includes(asset?.type)) return null;
    return button(assetImage(item.assetId,item.title),() => showPreview(item.assetId,null,item.title),
      { class:'image-button','aria-label':`${item.title} 확대` });
  }

  function handoutRecord(item) {
    const asset = state.assets.find(({ id }) => id === item.assetId);
    const visual = imageTypes.includes(asset?.type);
    const togglePublic = button(item.public ? '공개 취소' : '공개',action((next) => {
      const target = next.handouts.find(({ id }) => id === item.id);
      if (target.public) {
        target.public = false;
        audit(next,`공개 회수 · ${target.title}`);
      } else handleHandoutDisclosure(next,target);
    }),{ title:item.public ? '채팅과 AI에서 공개 취소' : '채팅과 AI에 공개' });
    const deleteHandout = button('삭제',() => {
      if (!window.confirm(`${item.title}을 삭제할까요?`)) return;
      action((next,changes) => {
        next.handouts = next.handouts.filter(({ id }) => id !== item.id);
        next.timeline = next.timeline.filter((entry) => entry.handoutId !== item.id);
        removeAsset(next,changes,item.assetId);
      })();
    },{ 'aria-label':'핸드아웃 삭제',title:'핸드아웃 삭제' });
    return el('details',{ class:'record handout-record','data-handout-id':item.id },
      el('summary',{},`${item.public ? '공개' : '비공개'} · ${item.title}`),
      handoutImage(item,asset),
      asset ? el('div',{ class:'row handout-file-actions' },
        button('원본 다운로드',() => viewFile(item)),
        asset?.type === 'application/pdf' && adapter.extractPdf ? button('PDF 텍스트 추출',() => void run(async (signal) => {
          const blob = await vault.blob(state.id,item.assetId);
          if (!blob) throw Error('저장된 PDF 원본이 없습니다.');
          const result = await adapter.extractPdf(blob,signal);
          if (!result.text?.trim()) throw Error('추출할 텍스트를 찾지 못했습니다. 스캔 문서는 읽을 내용을 붙여 넣으세요.');
          extractPending = { id:item.id,...result };
          announce(result.truncated ? '앞 25페이지를 추출했습니다.' : 'PDF 텍스트를 추출했습니다.','ok');
        },'Marinara 서버에서 PDF 읽는 중…',true)) : null,
        visual && item.public && state.settings.analysisConnection ? button('설명 제안',() => void run(async (signal) => {
          const source = await vault.blob(state.id,item.assetId);
          if (!source) throw Error('이미지 원본이 없습니다.');
          const copy = structuredClone(state);
          copy.settings.connectionId = state.settings.analysisConnection;
          const result = await adapter.generate(copy,{ task:'vision',prompt:'Describe the supplied handout for Keeper review.',images:[await dataUrl(source)] },
            () => announce('이미지 설명 생성 중…'),signal);
          analyzePending = { id:item.id,result };
          announce('');
        },'이미지 분석 준비 중…',true)) : null) : null,
      form((values) => transact((next) => {
        const target = next.handouts.find(({ id }) => id === item.id);
        target.title = textValue(values.get('title'),150) || target.filename || target.title;
        target.description = textValue(values.get('description'),8000);
        target.text = textValue(values.get('text'),20000);
        if (target.public) {
          next.timeline = next.timeline.filter((entry) => entry.handoutId !== target.id || entry.seq <= next.through);
          handleHandoutDisclosure(next,target);
        }
        analyzePending = null;
      }), [
        el('div',{ class:'handout-fields' },field('제목',input('title',item.title,required)),
          field('키퍼 승인 설명',textarea('description',item.description)),
          field('문서 텍스트 · TXT 자동 추출 / PDF 내용 붙여넣기',textarea('text',item.text))),
        el('div',{ class:'row handout-edit-actions' },togglePublic,el('button',{ class:'button',type:'submit' },'수정 저장'),deleteHandout),
      ],null,'handout-edit'),
      analyzePending?.id === item.id ? form((values) => transact((next) => {
        const target = next.handouts.find((other) => other.id === item.id && other.public);
        if (!target) throw Error('이미지 설명을 사용하려면 핸드아웃을 먼저 공개하세요.');
        target.description = textValue(values.get('review'),8000);
        handleHandoutDisclosure(next,target);
        analyzePending = null;
      }),field('설명 미리보기 및 편집',textarea('review',analyzePending.result)),'키퍼 승인 후 설명 적용') : null,
      extractPending?.id === item.id ? form((values) => transact((next) => {
        const target = next.handouts.find(({ id }) => id === item.id);
        target.text = textValue(values.get('review'),20000);
        if (target.public) handleHandoutDisclosure(next,target);
        extractPending = null;
      }),field('추출한 텍스트 미리보기 및 편집',textarea('review',extractPending.text)),'키퍼 승인 후 문서 텍스트 적용') : null,
      item.deliveries?.length ? note(`AI에 ${item.deliveries.length}회 전달 · 최근 ${item.deliveries.at(-1).image ? '이미지 포함' : '텍스트 정보'}`) : null);
  }

  function handoutsPanel() {
    const title = input('title','',{ ...required,pattern:'.*\\S.*' });
    const file = input('file','',{ type:'file',accept:handoutAccept,onchange:(event) => {
      title.required = !event.currentTarget.files.length;
      if (title.required) title.pattern = '.*\\S.*';
      else title.removeAttribute('pattern');
    } });
    return section('핸드아웃',
      form(async (values) => {
        const selectedFile = values.get('file');
        const verified = selectedFile?.name ? await assetFromFile(selectedFile) : null;
        const text = verified?.meta.type === 'text/plain' ? textValue(await verified.blob.text(),20000) : '';
        const filename = verified?.meta.name ?? '';
        const item = { id:uid(), public:false, assetId:verified?.meta.id ?? null, filename,
          title:textValue(values.get('title'),150) || filename, description:textValue(values.get('description'),8000), text, deliveries:[] };
        await transact((next,media) => {
          if (verified) {
            next.assets.push(verified.meta);
            media.add.push([verified.meta.id,verified.blob]);
          }
          next.handouts.push(item);
          handleHandoutDisclosure(next,item);
        });
        revealHandout = item.id;
        smallPane = false;
      },[field('제목',title),field('공개할 설명',textarea('description')),field('파일',file)],'핸드아웃 등록','handout-upload'),
      state.handouts.map(handoutRecord));
  }

  function handleHandoutDisclosure(next,target) {
    target.public = true;
    append(next,'handout','',{ handoutId:target.id });
    audit(next,`공개 · ${target.title}`);
  }

  function artPanel(unattached) {
    const session = currentSession(state);
    const weather = Object.hasOwn(portraitWeather,session?.portraitWeather) ? session.portraitWeather : '';
    const choices = [...Object.entries(portraitWeather),['','꺼짐']];
    const weatherButtons = choices.map(([id,label]) => button(label,() => {
      if (id === weather) return;
      action((next) => {
        const current = currentSession(next);
        if (id) current.portraitWeather = id;
        else delete current.portraitWeather;
      })();
    },{ 'aria-pressed':String(weather === id),disabled:!!running || !session }));
    // Every illustration of the game, newest first, each with: use as the left photo, hide/show in chat, delete.
    const loose = new Set(unattached.map((art) => art.id));
    const arts = state.timeline.filter(visibleIllustration).reverse();
    const artCard = (art) => el('div',{ class:`art-card${art.hiddenInChat ? ' is-hidden' : ''}` },
      illustrationEntry(art),
      el('div',{ class:'art-card-meta' },
        el('span',{},sessionHeading(state.sessions.find((item) => item.number === art.session) ?? { number:art.session })),
        el('span',{ class:'art-card-state' },art.hiddenInChat ? '채팅에서 숨김' : loose.has(art.id) ? '연결된 메시지 없음' : '채팅에 표시 중')),
      el('div',{ class:'row art-card-actions' },
        art.assetId || art.remote?.startsWith('/api/gallery/') ? button('왼쪽 사진',
          setPortraitChoice(art.assetId ? { asset:art.assetId } : { remote:art.remote }),
          { title:leftPortraitAction,'aria-label':`${leftPortraitAction} · ${art.text}`,disabled:!!running }) : null,
        button(art.hiddenInChat ? '다시 보이기' : '숨기기',() => setIllustrationHidden(art,!art.hiddenInChat),
          { title:art.hiddenInChat ? '채팅에 다시 보이게 해요' : '채팅에서만 숨겨요 (지워지지 않아요)',disabled:!!running }),
        button('삭제',() => deleteIllustration(art),{ title:'갤러리 파일까지 완전히 지워요','aria-label':`삽화 삭제 · ${art.text}`,disabled:!!running })));
    return [row(button('왼쪽 사진 바꾸기',() => void choosePortrait(),{ 'aria-haspopup':'dialog',disabled:!!running })),
      portraitFramePanel(),
      section('왼쪽 사진 효과',el('div',{ class:'portrait-weather-controls',role:'group','aria-label':'왼쪽 사진 효과' },weatherButtons)),
      section(`이 게임의 삽화 · ${arts.length}장`,arts.length ? el('div',{ class:'art-cards' },arts.map(artCard)) : note('아직 그린 삽화가 없어요.'))];
  }

  /* Left photo framing: which part of the picture the tall frame shows, saved per investigator.
     The sliders move the picture live and save when released. */
  function portraitFrame(key = state.settings.cardId || 'local') {
    return { ...defaultFrame, ...(state.portraitFrames?.[key] ?? {}) };
  }

  function applyPortraitFrame(frame = portraitFrame()) {
    surface.style.setProperty('--portrait-x',`${frame.x}%`);
    surface.style.setProperty('--portrait-y',`${frame.y}%`);
  }

  function portraitFramePanel() {
    const frame = portraitFrame();
    const save = (value) => action((next) => {
      const key = next.settings.cardId || 'local';
      next.portraitFrames = { ...(next.portraitFrames ?? {}) };
      if (value.x === defaultFrame.x && value.y === defaultFrame.y) delete next.portraitFrames[key];
      else next.portraitFrames[key] = value;
    },'왼쪽 사진 위치를 저장했어요.')();
    const slider = (axis, label, ends) => {
      const control = input(`portrait-${axis}`,frame[axis],{ type:'range',min:0,max:100,step:1,'aria-label':label });
      control.addEventListener('input',() => applyPortraitFrame({ ...portraitFrame(),[axis]:Number(control.value) }));
      control.addEventListener('change',() => save({ ...portraitFrame(),[axis]:Number(control.value) }));
      return el('label',{ class:'frame-slider' },el('span',{},label),
        el('span',{ class:'frame-ends' },el('small',{},ends[0]),control,el('small',{},ends[1])));
    };
    return section('왼쪽 사진 위치',
      note('사진에서 보이는 부분을 옮겨요. 손을 떼면 저장돼요.'),
      slider('x','가로 위치',['왼쪽','오른쪽']),
      slider('y','세로 위치',['위','아래']),
      row(button('처음 위치로',() => save({ ...defaultFrame }),{ disabled:!!running || (frame.x === defaultFrame.x && frame.y === defaultFrame.y) })));
  }

  function npcPanel() {
    // The NPC's other actions sit inside its form: the two main ones in a row, then delete/photo
    // removal on the left of the save button, so the card ends in one tidy toolbar.
    const npcForm = (npc = {}, main = [], minor = []) => form(async (values) => {
      const name = textValue(values.get('name'),80);
      if (!name) throw Error('NPC 이름을 입력하세요.');
      const file = values.get('npc-image');
      const photo = file?.name ? await assetFromFile(file,true) : null;
      await transact((next,media) => {
        if (next.npcs.some((other) => other.id !== npc.id && normalized(other.name) === normalized(name))) throw Error('같은 이름의 NPC가 이미 있습니다.');
        const updated = npc.id ? next.npcs.find((item) => item.id === npc.id) : { id:uid() };
        if (!updated) throw Error('수정할 NPC를 찾을 수 없습니다.');
        Object.assign(updated,{ name, publicInfo:textValue(values.get('publicInfo'),5000),secret:textValue(values.get('secret'),10000) });
        if (photo) {
          removeAsset(next,media,updated.profileId);
          updated.profileId = photo.meta.id;
          next.assets.push(photo.meta);
          media.add.push([photo.meta.id,photo.blob]);
        }
        if (!npc.id) next.npcs.push(updated);
      });
    }, [field('이름',input('name',npc.name,required)),field('NPC 사진',input('npc-image','',{ type:'file',accept:imageAccept })),
      field('공개할 소개',textarea('publicInfo',npc.publicInfo)),
      field('키퍼 전용 메모',textarea('secret',npc.secret)),
      main.some(Boolean) ? el('div',{ class:'npc-actions-main' },main) : null,
      minor.some(Boolean) ? el('div',{ class:'npc-actions-minor' },minor) : null], npc.id ? '저장' : '+ NPC 추가','npc-form');
    return [
      section('NPC 관리', state.npcs.map((npc) => el('details', { class:'record','data-disclosure-id':npc.id }, el('summary', {}, npc.name),
        npc.profileId ? button(assetImage(npc.profileId,'',{ class:'avatar' }),() => showPreview(npc.profileId,null,`${npc.name} NPC 사진`),
          { class:'image-button','aria-label':`${npc.name} NPC 사진 확대` }) : null,
        npcForm(npc,[
          button('대사 쓰기', () => { draft = `/as "${npc.name.replaceAll('"','')}" `; if (smallPane) smallPane = false; render(); surface.querySelector('textarea[name=keeper]')?.focus(); },
            { title:`${npc.name}의 대사를 입력창에 준비해요` }),
          npc.publicInfo ? button('소개 공개', action((next) => handleInput(next,`/desc ${npc.name} · ${npc.publicInfo}`)),
            { title:'공개할 소개를 채팅에 장면으로 올려요' }) : null,
        ],[
          npc.profileId ? button('사진 제거',action((next,media) => {
            const target = next.npcs.find((other) => other.id === npc.id);
            removeAsset(next,media,target.profileId);
            delete target.profileId;
          }),{ class:'npc-minor' }) : null,
          button('삭제', () => { if (window.confirm(`${npc.name}을 삭제할까요?`)) action((next,media) => {
            removeAsset(next,media,npc.profileId);
            next.npcs = next.npcs.filter((item) => item.id !== npc.id);
          })(); },{ class:'npc-minor npc-delete','aria-label':`${npc.name} 삭제` }),
        ]))),
        npcForm()),
    ];
  }

  function notesPanel() {
    const saveNote = (values, id) => transact((next) => {
      const text = withShorthandNames(textValue(values.get('text'),12000));
      if (!text) throw Error('기록할 내용을 입력하세요.');
      const kind = String(values.get('kind'));
      if (id) {
        const record = next.notes.find((item) => item.id === id);
        if (!record) throw Error('수정할 조사 노트를 찾을 수 없습니다.');
        Object.assign(record,{ text,kind,keeperEdited:true });
      } else next.notes.push({ id:uid(),text,kind });
      if (kind === 'fact' && values.has('announce')) handleInput(next,`/desc 확인된 단서 · ${text}`);
    });
    const noteFields = (item = {}) => [field('분류',select('kind',Object.entries(noteLabels),item.kind ?? 'fact')),
      field('내용',textarea('text',item.text,{ ...required,maxlength:12000,autofocus:Boolean(item.id) })),
      toggle('확인된 사실이면 채팅에도 공개',check('announce'))];
    const notes = investigatorNotes(state).slice().reverse();
    const record = (item) => el('details', { class:'record','data-disclosure-id':item.id },el('summary', {}, `${noteLabels[item.kind]}${item.aiOff ? ' · AI가 안 봐요' : ''} · ${item.text.slice(0,70)}`),
      el('p',{ class:'message-text' },item.text),row(
        button('기록 수정',() => messageDialog('조사 노트 수정','수정 저장',noteFields(item),(values) => saveNote(values,item.id)),{ 'aria-haspopup':'dialog' }),
        button('기록 삭제', () => {
          if (window.confirm('이 기록을 삭제할까요?')) action((next) => { next.notes = next.notes.filter((other) => other.id !== item.id); })();
        })));
    const automatic = notes.filter((item) => item.source);
    return [aiNotePicker(notes),section('AI가 알게 된 내용',automatic.length ? automatic.map(record) : note('AI 답변 뒤 새로 알게 된 내용과 가설이 자동으로 갱신됩니다.')),
      section('직접 기록',form((values) => saveNote(values),noteFields(),'기록 추가'),notes.filter((item) => !item.source).map(record))];
  }

  /* Which notes the AI remembers: facts, AI summaries, hypotheses and session summaries, newest first. An unticked
     note stays in the notebook but is left out of every AI turn until it is ticked again. */
  function aiNotePicker(notes) {
    const shown = notes.filter((item) => ['fact','learned','hypothesis','summary'].includes(item.kind));
    if (!shown.length) return null;
    const kept = shown.filter((item) => !item.aiOff).length;
    const apply = (ids) => (next) => {
      for (const item of next.notes) if (shown.some((other) => other.id === item.id)) {
        if (ids === null || ids.has(item.id)) delete item.aiOff;
        else item.aiOff = true;
      }
    };
    // The form already runs inside run(), so it saves directly; the reset button goes through action().
    const saveNow = async (ids) => { await transact(apply(ids)); announce('AI가 기억할 조사 노트를 저장했어요.','ok'); };
    const boxes = shown.map((item) => {
      const box = check('noteId',!item.aiOff);
      box.value = item.id;
      return el('label',{ class:'preset-section' },box,
        el('span',{ class:'preset-section-name' },item.text.slice(0,90),el('small',{},noteLabels[item.kind].split(' · ')[0])));
    });
    // Quick picks so a long notebook is not unticked one by one: keep only the newest N, or clear every box.
    const newest = input('keepNewest',Math.min(20,shown.length),{ ...numeric(1,shown.length),'aria-label':'기억할 최신 노트 수',class:'keep-newest' });
    const keepNewest = () => {
      const count = Math.max(1,Math.min(shown.length,Math.trunc(Number(newest.value)) || 1));
      action(apply(new Set(shown.slice(0,count).map((item) => item.id))),`최신 노트 ${count}개만 AI가 기억해요.`)();
    };
    return el('details',{ class:'record','data-disclosure-id':'ai-note-picker' },
      el('summary',{},`AI가 기억할 조사 노트 · ${kept}/${shown.length}개`),
      note('맨 위가 최신이에요. 체크한 노트만 AI 답변에 보내요. 체크를 풀어도 노트는 지워지지 않아요. 세션 요약은 체크한 것 중 최근 5개까지 보내요.'),
      el('div',{ class:'row picker-actions' },newest,button('최신 노트만 기억',keepNewest,{ disabled:!!running })),
      pickerForm((values) => saveNow(new Set(values.getAll('noteId').map(String))),boxes,'고른 노트 저장',
        button('모두 해제',() => { for (const box of boxes) box.querySelector('input').checked = false; }),
        button('전부 기억',() => action(apply(null),'모든 조사 노트를 AI가 기억해요.')(),{ disabled:!!running || kept === shown.length })));
  }

  function privatePanel() {
    return [pendingRolls(),section('키퍼 전용 · 비공개 지시와 메모',
      form((values) => transact((next) => {
        const type = values.get('kind') === 'instruction' ? '/toai' : '/w';
        handleInput(next,`${type} ${withShorthandNames(textValue(values.get('content'),12000))}`);
      }), [field('저장 방식',select('kind',[['instruction','다음 AI 응답에만 전달'],['whisper','키퍼 전용 메모']])),
        field('내용',textarea('content','',required))], '비공개 기록 추가'),
      state.privateLog.slice(-80).reverse().map((item) => el('article', { class:'record' },
        el('strong',{}, item.type === 'instruction' ? (item.used ? 'AI 전용 · 사용됨' : 'AI 전용 · 대기 중') : '키퍼 메모'),
        el('div',{ class:'message-text' },item.text), item.type === 'instruction' && !item.used ? button('전달 취소', action((next) => {
          next.privateLog = next.privateLog.filter((other) => other.id !== item.id);
          audit(next,'대기 중인 비공개 지시를 취소함');
        })) : null)))];
  }

  function combatPanel() {
    const { condition, sheet } = state;
    const lastSecretRoll = state.rollHistory.findLast((roll) => roll.kind === 'dice' && roll.public === false && roll.session === state.session);
    const resource = (name, value = 0, max = 999) => input(name,value,numeric(0,max));
    // A combatant's own numbers. Health, fighting, dodge and damage are optional; the attack forms fill from them.
    const optionalNumber = (values, name, label) => {
      const text = String(values.get(name) ?? '').trim();
      return text ? integer(text,1,999,label) : null;
    };
    const combatantStats = (values) => {
      const stats = { fight:optionalNumber(values,'fight','근접전'), dodge:optionalNumber(values,'dodge','회피'),
        damage:textValue(values.get('damage'),40) || null };
      for (const key of Object.keys(stats)) if (stats[key] === null) delete stats[key];
      return stats;
    };
    const statFields = (item = {}) => [field('근접전 기능치',input('fight',item.fight ?? '',{ ...numeric(1,999),placeholder:'예: 35' })),
      field('회피',input('dodge',item.dodge ?? '',{ ...numeric(1,999),placeholder:'예: 30' })),
      field('피해 식',input('damage',item.damage ?? '',{ maxlength:40,placeholder:'예: 1d3' }))];
    const addCombatant = form((values) => transact((next) => {
      // Health is optional: a combatant added without it is not counted down.
      const hp = optionalNumber(values,'hp','체력');
      next.combat.push({ id:uid(), name:textValue(values.get('name'),80), dex:integer(values.get('dex'),1,999,'DEX'),
        ready:values.has('ready'), armor:integer(values.get('armor'),0,999,'방어구'), ammo:integer(values.get('ammo'),0,999,'탄약'),
        ...(hp ? { hp, maxHp:hp } : {}), ...combatantStats(values) });
    }), [grid(field('참가자 이름',input('name','',required)),field('DEX',input('dex',50,numeric(1,999))),
      field('체력',input('hp','',{ ...numeric(1,999),placeholder:'비우면 안 셈' })),
      field('방어구',resource('armor')),field('탄약',resource('ammo')),...statFields()), toggle('사격 준비 +50 DEX',check('ready'))], '참가자 추가');
    const editCombatant = (actor) => el('details',{ class:'record','data-disclosure-id':`combatant-${actor.id}` },el('summary',{},'능력치 수정'),
      form((values) => transact((next) => {
        const item = next.combat.find((other) => other.id === actor.id);
        if (!item) throw Error('전투 참가자를 찾을 수 없습니다.');
        const maxHp = optionalNumber(values,'maxHp','최대 체력');
        Object.assign(item,{ dex:integer(values.get('dex'),1,999,'DEX'), armor:integer(values.get('armor'),0,999,'방어구') });
        for (const key of ['fight','dodge','damage']) delete item[key];
        Object.assign(item,combatantStats(values));
        if (maxHp) {
          item.hp = Number.isInteger(item.maxHp) ? Math.min(item.hp,maxHp) : maxHp;
          item.maxHp = maxHp;
        } else { delete item.hp; delete item.maxHp; }
      }), [grid(field('DEX',input('dex',actor.dex,numeric(1,999))),field('최대 체력',input('maxHp',actor.maxHp ?? '',{ ...numeric(1,999),placeholder:'비우면 안 셈' })),
        field('방어구',resource('armor',actor.armor)),...statFields(actor))],'능력치 저장'));
    const health = (actor) => Number.isInteger(actor.maxHp) ? ` · 체력 ${actor.hp}/${actor.maxHp}${actor.hp === 0 ? ' · 쓰러짐' : ''}` : '';
    const stats = (actor) => [Number.isInteger(actor.fight) ? `근접전 ${actor.fight}` : '',Number.isInteger(actor.dodge) ? `회피 ${actor.dodge}` : '',
      actor.damage ? `피해 ${actor.damage}` : ''].filter(Boolean).map((text) => ` · ${text}`).join('');
    const enemies = state.combat.map((item) => [item.id,item.name]);
    // The investigator's defence: dodging uses 회피, fighting back a fighting skill, so the skill name follows the choice.
    const defenseSkill = input('defenseSkill','회피',{ required:true });
    const defense = select('defense',[['dodge','회피'],['counter','반격'],['none','대응 안 함']]);
    defense.addEventListener('change',() => {
      if (defense.value === 'dodge') defenseSkill.value = '회피';
      else if (defense.value === 'counter' && defenseSkill.value === '회피') defenseSkill.value = '근접전(격투)';
      defenseSkill.disabled = defense.value === 'none';
    });
    // Picking a combatant fills the attack forms with its own numbers; the Keeper can still change them.
    const combatant = (id) => state.combat.find((item) => item.id === id);
    const attackKind = select('kind',[['dodge','근접 · 상대 회피'],['counter','근접 · 상대 반격'],['firearm','사격']]);
    const attackTarget = select('target',[['','직접 정하기'],...enemies]);
    const opponentValue = resource('opp',40);
    const targetArmor = resource('armor');
    const fillTarget = () => {
      const target = combatant(attackTarget.value);
      if (!target) return;
      const value = attackKind.value === 'dodge' ? target.dodge : attackKind.value === 'counter' ? target.fight : null;
      if (Number.isInteger(value)) opponentValue.value = value;
      targetArmor.value = target.armor;
    };
    attackTarget.addEventListener('change',fillTarget);
    attackKind.addEventListener('change',fillTarget);
    const attacker = select('attacker',enemies);
    const enemyValue = input('value',50,numeric(1,999));
    const enemyDamage = input('damage','1d3',required);
    const fillAttacker = () => {
      const enemy = combatant(attacker.value);
      if (Number.isInteger(enemy?.fight)) enemyValue.value = enemy.fight;
      if (enemy?.damage) enemyDamage.value = enemy.damage;
    };
    attacker.addEventListener('change',fillAttacker);
    fillAttacker();
    const order = [{ id:'pc',name:sheet.name,dex:sheet.attributes.DEX,ready:false }, ...state.combat]
      .sort((a,b) => actionDex(b) - actionDex(a));
    return [
      section('비밀 다이스',
        form((values) => transact((next) => rollGeneric(next,String(values.get('expression')),false)),
          field('주사위 식',input('expression',lastSecretRoll?.expression ?? '1d6',required)), '굴리기','combat-inline-form'),
        lastSecretRoll ? rollCard(lastSecretRoll) : null),
      section('이성 판정과 광기',
        note(`SAN ${sheet.san} · 기준 SAN ${condition.sanAtStart}${condition.insanity ? ` · ${condition.insanity}` : ''}${condition.bout ? ` · 발작표 D10 ${condition.bout}` : ''}${condition.hours ? ` · ${condition.hours}시간` : ''}`),
        form((values) => transact((next) => {
          const result = sanity(next,String(values.get('success')),String(values.get('failure')));
          flashRoll = result.roll.id;
          append(next,'keeper',`이성 ${result.amount} 손실 · 현재 SAN ${next.sheet.san}`);
        }), grid(field('성공 시 손실',input('success','0',required)),field('실패 시 손실',input('failure','1d6',required))), '이성 판정'),
        row(condition.pendingIdea ? button('광기 확인 INT 판정',action((next) => { flashRoll = resolveIdea(next).id; })) : null,
          button('새 이성 손실 기준 기록',action((next) => { next.condition.sanAtStart = next.sheet.san; })),
          condition.insanity && condition.insanity !== '영구적 광기' ? button('키퍼가 광기 종료',action((next) => {
            Object.assign(next.condition,{ insanity:'', bout:0, hours:0, pendingIdea:false });
          })) : null),
        form((values) => transact((next) => {
          if (next.condition.insanity === '영구적 광기') throw Error('영구적 광기는 일반 회복으로 종료할 수 없습니다.');
          const gain = integer(values.get('gain'),1,99,'SAN 회복량');
          next.sheet.san = Math.min(derived(next.sheet).san,next.sheet.san + gain);
          audit(next,`SAN 회복 · ${gain}`);
        }), field('키퍼 승인 회복량',input('gain',1,numeric(1,99))), 'SAN 회복','combat-inline-form')),
      section('체력과 치료',
        note(`HP ${sheet.hp}/${derived(sheet).hp} · ${[['dead','사망'],['dying','빈사'],['unconscious','의식불명'],['wound','중상'],['stabilized','안정화']].filter(([key]) => condition[key]).map(([,label]) => label).join(' · ') || '부상 없음'}`),
        form((values) => transact((next) => {
          if (next.condition.dead) throw Error('조사자가 사망했습니다.');
          const hit = rollDice(String(values.get('damage')),derived(next.sheet).db);
          const damage = injury(next,hit.total,integer(values.get('armor'),0,999,'방어구'));
          audit(next,`피해 ${damage} · HP ${next.sheet.hp}`);
          append(next,'keeper',`피해 ${damage} · 현재 HP ${next.sheet.hp}`);
        }), grid(field('피해 식',input('damage','1d6',required)),field('방어구',resource('armor'))), '피해 적용'),
        row(button('빈사 CON 판정',action((next) => {
          flashRoll = resolveDying(next).id;
        })), button('자연 회복',action((next) => {
          flashRoll = heal(next,'natural')?.id ?? '';
        }))),
        note('자연 회복은 정상 상태에서 하루, 중상에서는 일주일 단위로 사용합니다.'),
        form((values) => transact((next) => {
          const kind = String(values.get('heal'));
          heal(next,kind);
          audit(next,`키퍼가 치료 성공 적용 · ${kind === 'aid' ? '응급처치' : '의학'}`);
        }), field('키퍼가 승인한 치료',select('heal',[['aid','응급처치'],['medicine','의학']])), '치료 적용','combat-inline-form')),
      section('교전과 행동 순서',
        el('ol',{ class:'combat-order' },order.map((actor) => el('li',{},
          el('strong',{},actor.name),note(`DEX ${actionDex(actor)}${actor.id !== 'pc' ? ` · 방어구 ${actor.armor} · 탄약 ${actor.ammo}${health(actor)}${stats(actor)}` : ''}`),
          actor.id !== 'pc' ? editCombatant(actor) : null,
          actor.id !== 'pc' && Number.isInteger(actor.maxHp) ? form((values) => transact((next) => changeCombatantHealth(next,actor.id,integer(values.get('amount'),-999,999,'체력 변화'))),
            field('체력 깎기 · 회복은 -',input('amount',1,numeric(-999,999))),'적용','combat-inline-form') : null,
          actor.id !== 'pc' ? row(button('탄약 1 소모',action((next) => {
            const item = next.combat.find((row) => row.id === actor.id);
            if (!item.ammo) throw Error('남은 탄약이 없습니다.');
            item.ammo--;
          })),button('참가자 제외',action((next) => { next.combat = next.combat.filter((item) => item.id !== actor.id); }))) : null))),
        addCombatant,
        form((values) => transact((next) => {
          const roll = attack(next,{ name:String(values.get('skill')), kind:String(values.get('kind')), difficulty:String(values.get('difficulty')),
            targetId:String(values.get('target') ?? '') || null,
            modifier:integer(values.get('modifier'),-2,2,'보너스/페널티'),
            opponent:integer(values.get('opp'),0,999,'방어 기능치'), damage:String(values.get('damage')),
            armor:integer(values.get('armor'),0,999,'방어구'), impaling:values.has('impale') });
          flashRoll = roll.id;
        }), [grid(field('공격 기능 이름',input('skill','',required)),field('공격 방식',attackKind),
          field('상대 기능치',opponentValue),field('요구 난이도',select('difficulty',Object.entries(DIFFICULTY))),
          field('보너스 / 페널티',input('modifier',0,numeric(-2,2))),field('피해 식',input('damage','1d6+db',required)),
          field('대상',attackTarget),field('대상 방어구 · 대상을 고르면 그 방어구',targetArmor)),
          toggle('관통 무기',check('impale'))], '조사자 공격 판정'),
        enemies.length ? form((values) => transact((next) => {
          const result = enemyAttack(next,{ attackerId:String(values.get('attacker')), value:integer(values.get('value'),1,999,'적 공격 기능치'),
            defense:String(values.get('defense')), defenseSkill:textValue(values.get('defenseSkill'),80),
            damage:String(values.get('damage')), counterDamage:String(values.get('counterDamage') || '1d3+db'),
            armor:integer(values.get('pcArmor'),0,999,'조사자 방어구') });
          if (result.roll) flashRoll = result.roll.id;
        }), [grid(field('공격하는 참가자',attacker),field('적 공격 기능치',enemyValue),
          field('조사자 대응',defense),field('대응 기능 이름',defenseSkill),
          field('적 피해 식',enemyDamage),field('반격 성공 시 피해 식',input('counterDamage','1d3+db')),
          field('조사자 방어구',resource('pcArmor')))], '적 공격 판정') : note('적이 조사자를 공격하는 판정은 참가자를 추가하면 나와요.')),
      section('추격 기록',
        state.chase.length ? note(`최저 MOV ${Math.min(...state.chase.map((item) => item.mov))} 기준으로 행동 수 계산`) : null,
        state.chase.map((item) => {
          const movement = chaseMoves(item,state.chase);
          return el('article',{ class:'record' },el('strong',{},item.name),
            note(`MOV ${item.mov} · 위치 ${item.position} · 남은 이동 ${Math.max(0,movement - item.used)} / ${movement}`),
            row(button('한 칸 이동',action((next) => {
              if (item.used >= movement) throw Error('이번 라운드 이동을 모두 사용했습니다.');
              const part = next.chase.find((other) => other.id === item.id);
              part.position++;
              part.used++;
            })),button('추격에서 제외',action((next) => { next.chase = next.chase.filter((other) => other.id !== item.id); }))));
        }),
        form((values) => transact((next) => {
          next.chase.push({ id:uid(), name:textValue(values.get('name'),80), mov:integer(values.get('mov'),1,999,'MOV'),
            position:integer(values.get('position'),-999,999,'위치'), used:0 });
        }), grid(field('참가자 이름',input('name','',required)),field('확정 MOV',input('mov',derived(sheet).mov || 1,numeric(1,999))),
          field('시작 위치',input('position',0,numeric(-999,999)))), '추격 참가자 추가'),
        button('추격 다음 라운드',action((next) => { for (const item of next.chase) item.used = 0; }))),
      section('MP와 마법 비용', form((values) => transact((next) => {
        const cost = integer(values.get('cost'),0,999,'MP');
        const reason = textValue(values.get('spell'),150);
        spendMagic(next,cost,values.has('overflow'),reason);
      }), [grid(field('주문·용도',input('spell','',required)),field('MP 비용',resource('cost',1))),toggle('초과 비용을 HP에서 지불',check('overflow'))], '비용 적용'),
      button('MP 1 회복',action((next) => { next.sheet.mp = Math.min(derived(next.sheet).mp,next.sheet.mp + 1); }))),
    ];
  }

  function openMemory() {
    active = 'memory';
    smallPane = true;
    render();
    if (!memoryRooms) refreshMemoryRooms();
  }

  function refreshMemoryRooms() {
    void run(async (signal) => {
      memoryRooms = await adapter.memoryRooms(signal);
      announce(`기억 서재 ${memoryRooms.length}개를 불러왔습니다.`,'ok');
    },'기억 서재 목록을 불러오는 중…',true);
  }

  function memoryModeSelect(current) {
    return select('memory-mode',Object.entries(memoryModes),current ?? 'detailed');
  }

  function memoryPanel() {
    const link = state.memoryLink;
    const live = currentMemoryLink(state);
    const legacy = state.memoryReference;
    const persona = playerPersona();
    const roomOptions = [['','서재 선택'], ...(memoryRooms ?? []).map(({ id, name }) => [id,name])];
    const syncing = state.settings.memorySync !== false;
    const roomName = library.chats[0]?.name || '이 게임';
    return [
      // This game's own room: the story is copied into the game chat so the memory library can organize it,
      // and a preset's {{기억}} brings that memory back; fewer messages then need to go word for word.
      section('이 게임 방을 기억 서재로',
        note(`공개된 대화가 이 게임 채팅("${roomName}")에 함께 저장돼서, 기억 서재 확장이 이 방의 기억을 정리할 수 있어요. 기억 서재에서 "${roomName}" 방의 기억을 켜고 정리하면, 프리셋의 {{기억}} 자리에 이 방의 기억이 들어가요.`),
        el('strong',{},syncing ? '기억 서재로 보내는 중' : '기억 서재로 보내지 않음'),
        row(button(syncing ? '보내기 끄기' : '보내기 켜기',action((next) => {
          if (syncing) next.settings.memorySync = false;
          else delete next.settings.memorySync;
        },syncing ? '기억 서재로 보내기를 껐어요.' : '기억 서재로 보내기를 켰어요. 다음 저장부터 복사돼요.'),{ disabled:!!running }),
          syncing ? button('지금 보내기',() => void run(async (signal) => {
            const result = await adapter.memorySync(signal);
            announce(`이 게임 채팅에 메시지 ${result.messages}개를 맞춰 두었어요. 기억 서재에서 정리하면 돼요.`,'ok');
          },'기억 서재로 보내는 중…'),{ disabled:!!running }) : null),
        form(async (values) => {
          const value = Number(values.get('history-limit'));
          if (!Number.isInteger(value) || value < 1 || value > 100) throw Error('1에서 100 사이의 숫자를 넣으세요.');
          await transact((next) => {
            if (value === defaultHistoryLimit) delete next.settings.historyLimit;
            else next.settings.historyLimit = value;
          });
          announce(`AI가 원문으로 읽는 최근 메시지를 ${value}개로 바꿨어요.`,'ok');
        },field('AI가 원문으로 읽을 최근 메시지 수',input('history-limit',historyLimit(state),{ type:'number',min:1,max:100,step:1,inputmode:'numeric' })),'저장'),
        note('그보다 오래된 이야기는 기억 서재의 기억과 조사 노트로 알려 줘요. 기억 서재 정리가 끝나기 전에는 너무 줄이지 마세요.'),
        syncing && adapter.memoryRoomStatus ? memoryRoomControls(state.settings.chatId || library.chats[0]?.id) : null),

      section('캠페인에 연결된 기억',
        link ? [
          el('strong',{},`${link.roomName} · ${link.person} · ${memoryModes[link.mode]}`),
          note(live ? 'AI가 답변할 때마다 이 서재를 다시 읽고, 지금 장면과 관련된 기억이 있을 때만 골라서 참고합니다.' : '조사자가 바뀌었습니다. 현재 조사자에 맞는 기억을 다시 연결하세요.'),
          link.mode === 'relationship' ? note(persona ? `관계를 볼 페르소나 · ${persona.name}` : '연결된 페르소나가 없어 관계 기억을 고를 수 없습니다. 페르소나 시트에서 먼저 연결하세요.') : null,
          form(async (values) => {
            const mode = String(values.get('memory-mode'));
            if (!Object.hasOwn(memoryModes,mode)) throw Error('참고 방식을 선택하세요.');
            await transact((next) => { next.memoryLink = { ...next.memoryLink, mode }; });
            announce(`기억 참고 방식을 '${memoryModes[mode]}'(으)로 바꿨습니다.`,'ok');
          },field('참고 방식',memoryModeSelect(link.mode)),'방식 저장'),
          button('기억 연결 해제',action((next) => { delete next.memoryLink; },'기억 연결을 해제했습니다.'),{ disabled:!!running }),
        ] : legacy ? [
          el('strong',{},`${legacy.roomName} · ${legacy.person} · 직접 고른 ${legacy.entries.length}개`),
          note('예전 방식으로 연결된 기억입니다. 고른 항목을 매번 그대로 전달합니다. 아래에서 다시 연결하면 필요할 때만 참고하는 방식으로 바뀝니다.'),
          button('기억 연결 해제',action((next) => { delete next.memoryReference; },'기억 연결을 해제했습니다.'),{ disabled:!!running }),
        ] : note('연결된 기억이 없습니다.')),
      section('참고할 기억 서재 선택',
        note('기억 서재 확장의 서재와 그 서재에서 이 조사자에 해당하는 인물을 고르세요. 답변할 때 지금 장면과 관련된 기억만 골라 참고합니다.'),
        button(memoryRooms ? '서재 목록 새로고침' : '서재 목록 불러오기',refreshMemoryRooms,{ disabled:!!running }),
        memoryRooms?.length ? form(async (values) => {
          const room = memoryRooms.find((item) => item.id === values.get('memory-room'));
          if (!room) throw Error('참고할 기억 서재를 선택하세요.');
          const data = await adapter.memoryRoom(room.id);
          memoryDraft = { room, people:memoryPeople(data) };
        }, field('참고할 서재',select('memory-room',roomOptions,memoryDraft?.room.id ?? link?.roomId ?? legacy?.roomId ?? '')), '서재 열기') :
          memoryRooms ? note('열 수 있는 기억 서재가 없습니다.') : null,
        memoryDraft ? memoryOptions() : null),
    ];
  }

  /* The memory library's own switch for this game room, through the extension's API: whether memory is on,
     where organizing stands (working, done, failed, stopped), an estimate of the model calls, and
     turn on / stop / turn off. While it works the status is checked every few seconds, on any tab, and the
     Keeper is told once when it finishes or fails. */
  let memoryPoll = null;
  let memoryStatus = null;
  let memoryWatch = '';

  // After an AI answer, like the memory library does after a reply in an ordinary chat: copy the new story into
  // the game chat and let the library continue organizing, when this room's memory is on and the Keeper left
  // "AI 답변마다 이어서 정리" on. Quiet unless it fails.
  function continueMemory() {
    if (state.settings.memorySync === false || state.settings.memoryAuto === false || !adapter.memoryRoomStatus) return;
    const roomId = state.settings.chatId || library.chats[0]?.id;
    if (!roomId) return;
    void (async () => {
      try {
        const status = await adapter.memoryRoomStatus(roomId);
        if (!status.enabled || status.job?.state === 'running') return;
        await adapter.memorySync();
        await adapter.memoryRoomAction(roomId,'start');
        memoryWatch = 'auto';
        pollMemoryRoom(roomId,2000);
      } catch (error) {
        if (!closed) announce(`기억 서재 이어서 정리를 시작하지 못했어요 · ${error.message}`,'error');
      }
    })();
  }

  function memoryPhase(status) {
    const job = status?.job ?? {};
    const scene = status?.sceneJob ?? {};
    const at = (iso) => (iso ? ` · ${new Date(iso).toLocaleString('ko-KR',{ month:'numeric',day:'numeric',hour:'numeric',minute:'2-digit' })}` : '');
    if (job.state === 'running') {
      return { kind:'running', title:'정리 중', detail:`${job.done ?? 0}/${job.total || '?'} 묶음${job.stage ? ` · ${job.stage}` : ''}` };
    }
    if (scene.state === 'running') return { kind:'running', title:'정리 중', detail:'장면으로 묶는 중' };
    if (job.state === 'error') return { kind:'error', title:'오류가 생겼어요', detail:job.error || '알 수 없는 오류' };
    if (scene.state === 'error') return { kind:'error', title:'오류가 생겼어요', detail:`장면 정리 · ${scene.error || '알 수 없는 오류'}` };
    if (job.state === 'done') {
      return { kind:'done', title:'정리 완료', detail:`메시지 ${status.lastNumber ?? 0}번까지 · 장면 ${status.scenes?.count ?? 0}개${at(job.finishedAt)}` };
    }
    if (job.finishedAt) return { kind:'stopped', title:'정리를 멈췄어요', detail:'"이어서 정리"를 누르면 멈춘 곳부터 계속해요.' };
    if (status?.lastNumber) return { kind:'done', title:'정리된 기억 있음', detail:`메시지 ${status.lastNumber}번까지 · 장면 ${status.scenes?.count ?? 0}개` };
    return { kind:'idle', title:'아직 정리하지 않았어요', detail:'' };
  }

  function drawMemoryRoom(host, roomId, status) {
    const phase = memoryPhase(status);
    const working = phase.kind === 'running';
    const call = (actionName, done, body) => void run(async (signal) => {
      if (actionName === 'start') await adapter.memorySync(signal);
      const result = await adapter.memoryRoomAction(roomId,actionName,signal,body);
      done?.(result);
    },{ estimate:'예상 호출 수를 계산하는 중…', start:'기억 서재 정리를 시작하는 중…', stop:'정리를 멈추는 중…', disable:'기억을 끄는 중…' }[actionName]);
    // Editing or deleting an old CoC message changes the copy the library already read; it then asks for a fresh pass.
    const rebuild = phase.kind === 'error' && /처음부터/.test(phase.detail)
      ? button('처음부터 다시 정리',() => call('start',() => {
        announce('기억 서재가 처음부터 다시 정리해요. 끝나면 알려 드릴게요.','ok');
        memoryWatch = 'manual';
        pollMemoryRoom(roomId,1500);
      },{ fresh:true }),{ class:'primary',disabled:!!running }) : null;
    // replaceChildren prints a null argument as the text "null", so absent parts are dropped first.
    host.replaceChildren(...[
      el('div',{ class:`memory-phase is-${phase.kind}`,role:'status' },
        el('span',{ class:'memory-phase-dot','aria-hidden':true }),
        el('div',{},el('strong',{},phase.title),phase.detail ? el('span',{},phase.detail) : null)),
      el('div',{ class:'memory-room-switch' },el('span',{ class:status.enabled ? 'ok' : 'quiet' },status.enabled ? '이 방의 기억 켜짐' : '이 방의 기억 꺼짐')),
      rebuild ? row(rebuild) : null,
      row(
        working ? button('정리 멈추기',() => call('stop',() => pollMemoryRoom(roomId,800)),{ disabled:!!running })
          : button(status.enabled ? '이어서 정리' : '기억 켜고 정리 시작',() => call('start',() => {
            announce('기억 서재가 정리를 시작했어요. 끝나면 알려 드릴게요.','ok');
            memoryWatch = 'manual';
            pollMemoryRoom(roomId,1500);
          }),{ class:'primary',disabled:!!running }),
        button('예상 호출 수',() => call('estimate',(result) => announce(`메시지 ${result.messages}개 · 정리 호출 약 ${result.calls + (result.sceneCalls ?? 0)}회 예상 (기억 서재의 AI 연결로 청구돼요)`,'notice')),{ disabled:!!running || working }),
        status.enabled && !working ? button('기억 끄기',() => call('disable',() => pollMemoryRoom(roomId,300)),{ disabled:!!running }) : null),
      status.enabled ? toggle('AI 답변마다 이어서 정리',(() => {
        const box = check('memory-auto',state.settings.memoryAuto !== false);
        box.addEventListener('change',() => action((next) => {
          if (box.checked) delete next.settings.memoryAuto;
          else next.settings.memoryAuto = false;
        },box.checked ? 'AI 답변이 끝날 때마다 기억 서재가 이어서 정리해요.' : '답변마다 자동으로 정리하지 않아요. 필요할 때 "이어서 정리"를 눌러 주세요.')());
        return box;
      })()) : null,
      note('정리는 기억 서재 확장의 설정에 있는 AI 연결로 돌아가고, 그쪽 비용이 들어요. 위 칸을 켜 두면 일반 채팅처럼 AI 답변마다 새 대화만 조금씩 정리해요.'),
    ].filter(Boolean));
  }

  // Checks the room, redraws its box if the memory tab shows it, and says once when work ends or fails.
  function pollMemoryRoom(roomId, delay = 0) {
    clearTimeout(memoryPoll);
    memoryPoll = setTimeout(() => {
      if (closed) return;
      adapter.memoryRoomStatus(roomId).then((status) => {
        if (closed) return;
        memoryStatus = { roomId, status };
        const phase = memoryPhase(status);
        // A run seen starting outside CoC is watched like one started here; the quiet run after each answer
        // speaks only if it fails.
        if (phase.kind === 'running' && !memoryWatch) memoryWatch = 'manual';
        if (memoryWatch && phase.kind !== 'running') {
          if (phase.kind === 'error') announce(`기억 서재 정리 중 오류가 생겼어요 · ${phase.detail}`,'error');
          else if (memoryWatch === 'manual' && phase.kind === 'done') announce(`기억 서재 정리가 끝났어요 · ${phase.detail}`,'ok');
          else if (memoryWatch === 'manual') announce('기억 서재 정리를 멈췄어요.','notice');
          memoryWatch = '';
        }
        const host = surface.querySelector(`.memory-room[data-room="${roomId}"]`);
        if (host) drawMemoryRoom(host,roomId,status);
        if (phase.kind === 'running') pollMemoryRoom(roomId,4000);
      }).catch((error) => {
        const host = surface.querySelector(`.memory-room[data-room="${roomId}"]`);
        host?.replaceChildren(note(`기억 서재 확장에 연결하지 못했어요. 확장이 켜져 있는지 확인하세요 · ${error.message}`));
      });
    },delay);
  }

  function memoryRoomControls(roomId) {
    if (!roomId) return note('이 게임 채팅을 찾지 못했어요.');
    const host = el('div',{ class:'memory-room','data-room':roomId });
    if (memoryStatus?.roomId === roomId) drawMemoryRoom(host,roomId,memoryStatus.status);
    else host.append(note('기억 서재 상태를 확인하는 중…'));
    pollMemoryRoom(roomId,0);
    return host;
  }

  function memoryOptions() {
    const { people, room } = memoryDraft;
    if (!people.length) return note(`${room.name}에 등록된 인물이 없습니다. 기억 서재에서 이 대화의 장면을 먼저 정리하세요.`);
    const current = state.memoryLink?.roomId === room.id ? state.memoryLink : null;
    return [headline(room.name),form(async (values) => {
      const person = people.find(({ name }) => name === values.get('memory-person'));
      const mode = String(values.get('memory-mode'));
      if (!person) throw Error('서재에서 조사자에 해당하는 인물을 선택하세요.');
      if (!Object.hasOwn(memoryModes,mode)) throw Error('참고 방식을 선택하세요.');
      await transact((next) => {
        next.memoryLink = createMemoryLink(next,room,person.name,mode);
        delete next.memoryReference;
      });
      memoryDraft = null;
      smallPane = false;
      announce('기억 서재를 연결했습니다. 답변할 때 필요한 기억만 참고합니다.','ok');
    }, [field('서재에서 조사자에 해당하는 인물',select('memory-person',[['','인물 선택'],...people.map(({ name }) => [name,name])],current?.person ?? '')),
      field('참고 방식',memoryModeSelect(current?.mode)),
      note('세세하게 · 관련 사건·사실·호칭을 구체적으로 반영 / 은은하게 · 말투와 태도에만 살짝 배어나게 / 현재 페르소나와의 관계만 · 연결된 페르소나와 얽힌 기록만')],
    '이 서재 연결')];
  }

  function editTitles(focus) {
    if (running) return;
    const session = currentSession(state) ?? { number:state.session };
    const dialog = el('dialog',{ class:'media-dialog title-editor','aria-label':'게임 제목 수정' });
    const campaign = input('campaignTitle',state.title,{ required:true,maxlength:200 });
    const subtitle = input('sessionTitle',sessionHeading(session),{ required:true,maxlength:150 });
    dialog.addEventListener('close',() => dialog.remove(),{ once:true });
    dialog.append(row(headline('게임 제목 수정'), button('닫기',() => dialog.close())),
      form(async (values) => {
        const title = textValue(values.get('campaignTitle'),200);
        const sessionTitle = textValue(values.get('sessionTitle'),150);
        if (!title || !sessionTitle) throw Error('큰 제목과 작은 제목을 모두 입력하세요.');
        await transact((next) => {
          next.title = title;
          const current = currentSession(next);
          if (current) Object.assign(current,{ title:sessionTitle,renamed:true });
          else next.sessions.push({ number:next.session,title:sessionTitle,renamed:true });
          audit(next,'게임 제목 수정');
        });
        announce('게임 제목을 저장했습니다.','ok');
      },[field('큰 제목',campaign),field('작은 제목',subtitle)],'제목 저장'));
    surface.append(dialog);
    dialog.showModal();
    (focus === 'session' ? subtitle : campaign).focus();
  }

  /* Scenario tab: the Keeper's scenario note and the investigator's secret handout (HO). */
  function scenarioPanel() {
    const scenario = state.scenario;
    const area = (key, rows = 4) => field(scenarioFields[key].label,textarea(key,scenario[key] ?? '',{ rows,maxlength:4000 }));
    const notePanel = section('시나리오 노트',
      note('시대 배경과 시나리오 개요는 AI 조사자에게 전달되어 말투·지식·소지품을 그 배경에 맞춥니다.'),
      form((values) => transact((next) => {
        for (const key of Object.keys(scenarioFields)) next.scenario[key] = withShorthandNames(textValue(values.get(key),key === 'era' ? 200 : 4000));
        next.scenario.savedAt = new Date().toISOString();
        audit(next,'시나리오 노트 저장');
      }), [
        field(scenarioFields.era.label,input('era',scenario.era ?? '',{ maxlength:200,placeholder:'예: 1920년대 미국 아컴' })),
        area('overview',5),
      ],'시나리오 저장'),
      scenario.savedAt
        ? el('p',{ class:'scenario-status open' },`마지막 저장 · ${new Date(scenario.savedAt).toLocaleString('ko-KR',{ month:'numeric',day:'numeric',hour:'numeric',minute:'2-digit' })} · 다음 AI 답변부터 반영돼요`)
        : note('아직 저장하지 않아 AI에 시대 배경이 전달되지 않습니다. 저장하면 다음 AI 답변부터 바로 반영돼요.'));

    const saved = state.investigatorSecret;
    const live = currentInvestigatorSecret(state);
    const secretPanel = section('조사자 비밀 설정 (HO)',
      note(`${state.sheet.name}만 아는 비밀 핸드아웃입니다. AI는 행동과 감정에 반영하되, 공개를 허락하기 전까지 스스로 털어놓지 않습니다.`),
      saved && !live ? note('다른 조사자에게 쓴 비밀이 남아 있어 지금 조사자에게는 전달되지 않습니다. 새로 저장하면 바뀝니다.') : null,
      form((values) => transact((next) => {
        const text = withShorthandNames(textValue(values.get('secret'),4000));
        if (!text) {
          delete next.investigatorSecret;
          audit(next,'조사자 비밀 삭제');
          return;
        }
        next.investigatorSecret = { text, revealed:values.has('revealed'), cardId:next.settings.cardId || '', investigator:next.sheet.name };
        audit(next,`조사자 비밀 저장 · ${values.has('revealed') ? '공개 허락' : '숨김'}`);
      }), [
        field('비밀 핸드아웃 내용',textarea('secret',live?.text ?? '',{ rows:5,maxlength:4000,placeholder:'예: 사실 너는 피해자의 동생이다. 이 사실을 아무에게도 말하지 않았다.' })),
        toggle('공개 허락 · 이제 조사자가 비밀을 드러내도 됨',check('revealed',live?.revealed)),
        note('내용을 비우고 저장하면 비밀이 삭제됩니다.'),
      ],'비밀 저장'),
      live ? el('p',{ class:`scenario-status${live.revealed ? ' open' : ''}` },live.revealed ? '현재 상태 · 공개 허락됨' : '현재 상태 · 숨기는 중') : null);
    return [notePanel,secretPanel];
  }

  /* Session wrap-up: growth rolls, SAN reward and an AI summary in one step. */
  function wrapUpPanel() {
    const persona = playerPersona();
    const personaSheetNow = persona ? personaSheet(state,persona.id) : null;
    const checked = (sheet) => sheet.skills.filter((skill) => skill.experience).length;
    const session = currentSession(state);
    // The newest wrapped-up session, which is the previous one right after "start the next session".
    const wrapped = [...state.sessions].reverse().find((item) => item.wrapUp);
    const last = wrapped?.wrapUp;
    const summaryText = last?.summary ? investigatorNotes(state).findLast((item) => item.kind === 'summary' && item.session === wrapped.number)?.text : '';
    const record = last ? el('details',{ class:'record',open:last.at === justWrappedAt },
      el('summary',{},`${sessionHeading(wrapped)} 마무리 기록 · ${new Date(last.at).toLocaleString('ko-KR')}`),
      last.growth.length ? el('ul',{ class:'scene-list' },last.growth.map((item) =>
        el('li',{},`${item.who} · ${item.skill} · D100 ${item.roll} · ${item.gain ? `+${item.gain} → ${item.value}` : '성장 없음'}`))) : note('성장 굴림 없음'),
      last.san.length ? el('ul',{ class:'scene-list' },last.san.map((item) => el('li',{},`${item.who} · SAN +${item.gain} → ${item.san}`))) : null,
      summaryText ? el('div',{ class:'section quiet' },note('AI 세션 요약 · 조사 노트에도 기록됨'),el('p',{ class:'message-text' },summaryText))
        : last.summary ? note('세션 요약은 조사 노트에 기록되었습니다.') : null) : null;
    return section('세션 마무리',
      note(`${sessionHeading(session ?? { number:state.session })}을(를) 한 번에 정리합니다.`),
      record,
      form(async (values, signal) => {
        const growthRolls = values.has('growth');
        const sanExpression = textValue(values.get('san'),40);
        const sanFor = values.getAll('sanFor').map(String);
        let summary = '';
        // The button says it is working, since the AI summary can take a while.
        wrappingUp = true;
        render();
        try {
        if (values.has('summary')) {
          summary = await summarizeSession(state,adapter,() => announce('AI가 이번 세션을 요약하는 중…'),signal);
          if (closed || signal?.aborted) return;
        }
        let result;
        await transact((next) => {
          result = wrapUpSession(next,{ growthRolls, sanExpression, sanFor, personaId:persona?.id ?? null, summary });
          if (values.has('next')) {
            next.session = Math.max(0,...next.sessions.map((item) => item.number)) + 1;
            next.sessions.push({ number:next.session, title:textValue(values.get('nextName'),150) || `세션 ${next.session}` });
            audit(next,'새 세션 시작');
          }
        });
        justWrappedAt = currentSession(state)?.wrapUp?.at ?? [...state.sessions].reverse().find((item) => item.wrapUp)?.wrapUp.at ?? null;
        } finally { wrappingUp = false; }
        const summaryNote = summary ? ' · 요약 기록' : values.has('summary') ? ' · 이번 세션에 공개 기록이 없어 요약은 건너뜀' : '';
        announce(`세션 마무리 완료 · 성장 굴림 ${result.growth.length}건 · SAN 회복 ${result.san.length}건${summaryNote}`,'ok');
      }, [
        toggle(`경험 체크된 기능 성장 굴림 · 조사자 ${checked(state.sheet)}개${personaSheetNow ? ` · 페르소나 ${checked(personaSheetNow)}개` : ''}`,check('growth',true)),
        field('시나리오 보상 SAN 회복 · 없으면 0',input('san','0',{ maxlength:40,placeholder:'예: 1d6, 1d10+2' })),
        el('div',{ class:'row' },
          toggle('조사자에게',el('input',{ type:'checkbox',name:'sanFor',value:'investigator',checked:true })),
          personaSheetNow ? toggle('페르소나에게',el('input',{ type:'checkbox',name:'sanFor',value:'persona',checked:true })) : null),
        toggle('AI가 이번 세션을 요약해 조사 노트에 기록',check('summary',true)),
        toggle('마무리 후 후속 세션 시작',check('next',false)),
        field('후속 세션 이름',input('nextName','',{ maxlength:150,placeholder:`세션 ${state.session + 1}` })),
      ],wrappingUp ? '마무리하는 중…' : '세션 마무리','wrap-up-form'));
  }

  /* Replay export: the public chat as a readable HTML document. */
  // Photos and illustrations are embedded as data URLs so the exported file shows them anywhere, offline too.
  // Images are scaled down before embedding (avatars to a small square, illustrations to reading width),
  // which keeps a replay with several pictures to a shareable size.
  async function shrinkImage(blob, maxSide) {
    try {
      const bitmap = await createImageBitmap(blob);
      const scale = Math.min(1,maxSide / Math.max(bitmap.width,bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1,Math.round(bitmap.width * scale));
      canvas.height = Math.max(1,Math.round(bitmap.height * scale));
      canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);
      bitmap.close?.();
      const webp = canvas.toDataURL('image/webp',.84);
      return webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/jpeg',.86);
    } catch {
      return dataUrl(blob);
    }
  }

  async function replayImages(session, includeArt) {
    const load = async (source, maxSide) => {
      try {
        let blob = null;
        if (source?.asset) blob = await vault.blob(state.id,source.asset);
        else if (source?.remote && safeImageUrl(source.remote)) {
          const response = await fetch(source.remote);
          if (response.ok) blob = await response.blob();
        }
        if (blob) return await shrinkImage(blob,maxSide);
      } catch { /* A missing photo falls back to the speaker's initial. */ }
      return '';
    };
    const persona = playerPersona();
    const illustrations = new Map();
    if (includeArt) {
      for (const entry of state.timeline) {
        if (!visibleIllustration(entry) || entry.hiddenInChat || (session != null && entry.session !== session)) continue;
        const src = await load({ asset:entry.assetId, remote:entry.remote },1400);
        if (src) illustrations.set(entry.id,src);
      }
    }
    return { investigator:await load(portraitSource(),240), persona:persona ? await load({ remote:persona.avatarPath },240) : '', illustrations };
  }

  function replayPanel() {
    return section('리플레이 내보내기',
      note('공개된 대화와 판정을 책처럼 읽기 좋은 문서(HTML)로 저장합니다. 사진과 삽화도 파일 안에 함께 담겨요. 키퍼 메모, 비공개 굴림, 조사자 비밀은 빠집니다.'),
      form(async (values) => {
        const scope = String(values.get('scope'));
        const session = scope === 'all' ? null : Number(scope);
        announce('리플레이를 만드는 중…');
        const accent = validAccent(state.sheet.accent) ? state.sheet.accent : '#3b3346';
        const html = buildReplayHtml(state,{ session, personaName:playerPersona()?.name ?? '', occupation:state.sheet.occupation,
          accent, accentText:accentTextColor(accent), images:await replayImages(session,values.has('art')) });
        const base = `${state.title}${session == null ? '' : `-${sessionHeading(state.sessions.find((item) => item.number === session) ?? { number:session })}`}`
          .replace(/[\\/:*?"<>|]+/g,' ').trim() || 'TRPG';
        downloadFile(`${base}-리플레이.html`,html,'text/html;charset=utf-8');
        announce('리플레이를 내보냈습니다.','ok');
      }, [field('범위',select('scope',[['all','전체 세션'],...state.sessions.map((item) => [String(item.number),sessionHeading(item)])],String(state.session))),
        toggle('삽화 넣기 · 삽화가 많으면 파일이 커져요',check('art',true)),
        note('표지 색은 조사자 캐릭터 시트의 포인트 색을 따라갑니다.')],
      '리플레이 내보내기'));
  }

  function sessionsPanel() {
    const panel = section('캠페인과 세션', note('캠페인과 첨부는 Marinara에 자동 저장됩니다.'),
      el('ol',{},state.sessions.map((item) => el('li',{},`${sessionHeading(item)}${state.session === item.number ? ' · 진행 중' : ''}`))),
      form((values) => transact((next) => {
        next.session = Math.max(0,...next.sessions.map((item) => item.number)) + 1;
        next.sessions.push({ number:next.session, title:textValue(values.get('name'),150) || `세션 ${next.session}` });
        audit(next,'새 세션 시작');
      }), field('새 세션 이름',input('name','',{ required:true,maxlength:150 })), '세션 추가', 'session-add'),
      el('div',{ class:'row session-file-actions' },button('지금 저장',action((next) => audit(next,'키퍼 수동 저장'),'저장했습니다.')),
        button('캠페인 백업 JSON',() => void run(async () => {
          downloadFile('TRPG-캠페인-백업.json',JSON.stringify(await makeBackup(state,vault)));
          announce('키퍼 전용 항목과 첨부를 포함한 백업을 내보냈습니다.','ok');
        })),
        button('공개 채팅 JSON',() => downloadFile('TRPG-공개-채팅.json',JSON.stringify(buildPublicContext(state),null,2)))),
      state.revision === 0 && !state.timeline.length && !state.assets.length && !state.audit.length ? form(async (values) => {
        const file = values.get('backup');
        if (file.size > 100_000_000) throw Error('100MB 이하 백업을 선택하세요.');
        state = await importBackup(JSON.parse(await file.text()),vault,options.gameChatId);
        resetDrafts();
        announce('이 게임에 백업을 복원했습니다.','ok');
      }, field('기존 캠페인 백업',input('backup','',{ type:'file',accept:'.json',required:true })), '이 게임에 백업 복원') : null);
    return [fieldSettings(),personaSettings(),panel,wrapUpPanel(),replayPanel(),
      section('게임 설정',form((values) => transact((next) => {
        next.settings.auto = values.has('auto');
        next.settings.vision = values.has('vision');
        next.settings.luckRule = values.has('luck');
        next.settings.rollMode = String(values.get('rollMode'));
      }), [
        toggle('키퍼 입력 후 자동 응답',check('auto',state.settings.auto)),
        toggle('응답 모델에 공개 이미지 첨부 · 모델이 이미지를 지원할 때',check('vision',state.settings.vision)),
        toggle('선택 규칙 · 행운 소비 허용',check('luck',state.settings.luckRule)),
        field('판정 방식',select('rollMode',[['auto','키퍼 요청 직후 자동 굴림'],['approval','키퍼 승인 후 굴림'],['manual','키퍼가 직접 굴림 버튼 사용'],['private','키퍼 비공개 굴림']],state.settings.rollMode)),
      ])),
    ];
  }

  function resetDrafts() {
    draft = '';
    memoryDraft = null;
    finishSceneSelection();
    analyzePending = null;
    extractPending = null;
    older = 120;
    revealArt = '';
    revealHandout = '';
    revokeUrls();
  }

  function jumpToMessage(entry) {
    const messages = groupTimeline().messages;
    const index = messages.findIndex((item) => item.id === entry.id);
    if (index < 0) return;
    older = Math.max(older,messages.length - index);
    smallPane = false;
    render();
    const message = document.getElementById(`coc7-message-${entry.id}`);
    message?.scrollIntoView({ block:'center' });
    message?.focus({ preventScroll:true });
  }

  function messageArchivePanel() {
    const bookmarks = state.timeline.filter((entry) => !entry.trashedAt && entry.bookmark).reverse();
    return section('북마크',bookmarks.length ? bookmarks.map((entry) => el('div',{ class:'record' },
      el('strong',{},entry.bookmark.label || messageSnippet(entry)), note(entry.speaker || roleLabels[entry.type]),
      button('메시지로 이동',() => jumpToMessage(entry)))) : note('북마크한 메시지가 없습니다.'));
  }

  const panels = { sheet:sheetPanel, persona:personaSheetPanel, macros:macrosPanel, handouts:handoutsPanel, art:artPanel, npcs:npcPanel,
    notes:notesPanel, scenario:scenarioPanel, memory:memoryPanel, combat:combatPanel, private:privatePanel, sessions:sessionsPanel, archive:messageArchivePanel };

  function groupTimeline() {
    const messages = [];
    const attachments = new Map();
    const unattached = [];
    const scenes = new Map();
    const latestScene = new Map();
    let featured;
    for (const entry of state.timeline) {
      if (entry.type !== 'illustration') {
        if (!entry.trashedAt) messages.push(entry);
        if (isIllustrationScene(entry)) {
          scenes.set(entry.id,entry);
          latestScene.set(entry.session,entry);
        }
        continue;
      }
      // Deleted illustrations are gone; hidden ones stay out of the chat and live on in the art tab.
      if (!visibleIllustration(entry) || entry.hiddenInChat) continue;
      const references = Array.isArray(entry.sceneIds) ? entry.sceneIds : [];
      let anchor = references.length ? null : latestScene.get(entry.session);
      for (const ref of references) {
        const candidate = scenes.get(ref);
        if (candidate && (!anchor || candidate.seq > anchor.seq)) anchor = candidate;
      }
      if (anchor && !anchor.trashedAt) {
        const images = attachments.get(anchor.id) ?? [];
        images.push(entry);
        attachments.set(anchor.id,images);
      } else unattached.push(entry);
      if (entry.session === state.session) featured = entry;
    }
    return { messages, attachments, unattached, featured };
  }

  function render() {
    if (closed || !state) return;
    if (selectedScenes.size) {
      const available = new Set(state.timeline.filter((entry) => !entry.trashedAt && isIllustrationScene(entry)).map((entry) => entry.id));
      for (const id of selectedScenes) if (!available.has(id)) selectedScenes.delete(id);
    }
    const layout = groupTimeline();
    const messages = layout.messages.slice(-older);
    const { attachments, unattached, featured } = layout;
    const oldTimeline = surface.querySelector('.timeline');
    const oldPanel = surface.querySelector('.panel-content');
    const oldComposer = surface.querySelector('#coc7-keeper-input');
    const caret = oldComposer === document.activeElement ? [oldComposer.selectionStart,oldComposer.selectionEnd] : null;
    const panelScroll = oldPanel?.dataset.tab === active ? oldPanel.scrollTop : 0;
    // Sending a message always shows it; otherwise the chat stays at the bottom only while the reader is there.
    const end = !oldTimeline || timelineAtEnd || followLatest;
    followLatest = false;
    const rollChanged = flashRoll && !surface.querySelector('.rolling');
    const oldScroll = oldTimeline?.scrollTop ?? 0;
    const artworkKey = featured?.assetId || featured?.remote;
    surface.style.setProperty('--scene-image-color',imageColors.get(artworkKey) || '');
    const featuredVisible = featured && messages.some((message) => attachments.get(message.id)?.includes(featured));
    const artworkProbe = featured && !featuredVisible && !imageColors.has(artworkKey) ? illustrationImage(featured) : null;
    if (artworkProbe) watchImageAccent(artworkProbe,artworkKey,(color) => surface.style.setProperty('--scene-image-color',color));
    // The chat is the costly part of a redraw (every message and its tools). When nothing it shows has changed —
    // switching a side tab, typing, opening a section — the previous chat element is reused as it is.
    const timelineKey = [state.revision, older, choosingScenes, [...selectedScenes].join(','), running ? 1 : 0, flashRoll,
      featured?.id ?? '', library.chats[0]?.personaId ?? '', library.personas?.length ?? 0].join('|');
    let descriptionSlots = [];
    let timeline;
    if (timelineCache?.key === timelineKey) ({ node:timeline, slots:descriptionSlots } = timelineCache);
    else {
      timeline = el('div',{ class:'timeline', role:'log', 'aria-label':'공개 채팅' },
        layout.messages.length > older ? button('이전 메시지 더 보기',() => { older += 120; render(); }) : null,
        messages.length ? withSessionDividers(messages,(entry) => entryView(entry,attachments.get(entry.id),featured,descriptionSlots)) : el('div',{ class:'empty' },headline('첫 장면을 열어 보세요'),
          note('장면을 적고 AI 답변을 누르면 조사자가 행동합니다.'),
          el('div',{ class:'start-actions' },
            !state.settings.cardId ? button('AI 조사자 설정',() => { active = 'sessions'; smallPane = true; render(); },{ class:'primary' }) : null,
            button((currentMemoryLink(state) || state.memoryReference) ? '연결된 기억 서재 보기' : '시작할 때 참고할 기억 서재 선택',openMemory,{ disabled:!!running }))));
      timelineCache = { key:timelineKey, node:timeline, slots:descriptionSlots };
      // Whether the chat follows the newest message is decided by the reader's own scrolling, so a chat area that
      // shrinks or grows (suggestions, a resized input, late images) does not count as scrolling away.
      timeline.addEventListener('scroll',() => {
        timelineAtEnd = timeline.scrollHeight - timeline.scrollTop - timeline.clientHeight < 75;
      },{ passive:true });
    }
    const availableTabs = Object.entries(tabs).filter(([key]) => key !== 'memory' || adapter.memoryRooms);
    const tabBar = el('nav',{ class:'tabs', 'aria-label':'캠페인 패널' },availableTabs.map(([key,label]) =>
      button(label,key === 'memory' ? openMemory : () => { active = key; render(); },{ 'aria-pressed':String(active === key) })));
    const panel = el('div',{ class:'panel-content', 'data-tab':active, 'data-investigator-sheet':active === 'sheet', tabindex:['sheet','persona'].includes(active) ? -1 : undefined },panels[active](unattached));
    restoreDisclosures(panel,oldPanel);
    const photo = portraitSource();
    surface.style.setProperty('--portrait-image-color', imageColors.get(photo?.asset || photo?.remote) || '');
    applyPortraitFrame();
    surface.classList.toggle('show-panel',smallPane);
    surface.classList.toggle('panel-folded',panelFolded);
    const foldLabel = panelFolded ? '패널 펼치기' : '패널 접기';
    const foldHandle = button(el('span',{ 'aria-hidden':true },panelFolded ? '‹' : '›'),() => {
      panelFolded = !panelFolded;
      try { window.localStorage.setItem('coc7.panelFolded',panelFolded ? '1' : '0'); } catch { /* Kept for this session only. */ }
      render();
    },{ class:'panel-fold',title:foldLabel,'aria-label':foldLabel,'aria-expanded':String(!panelFolded) });
    surface.setAttribute('aria-busy',String(!!running));
    surface.replaceChildren(
      el('div',{},
        el('header',{ class:'workspace-head' },el('div',{class:'game-heading'},
          el('h1',{},button(state.title,() => editTitles('campaign'),{ class:'heading-edit',title:'큰 제목 수정','aria-haspopup':'dialog' })),
          button(sessionHeading(currentSession(state) ?? { number:state.session }),
            () => editTitles('session'),{ class:'session-label heading-edit',title:'작은 제목 수정','aria-haspopup':'dialog' })),
          button(smallPane ? '채팅 보기' : '패널 보기',() => { smallPane = !smallPane; render(); },{ class:'mobile-only' })),
        el('div',{ class:'workspace-notice','data-status':true, role:'status', 'aria-live':'polite' })),
      el('div',{ class:'board' },
        investigatorBoard(),
        el('main',{ class:'chat-column','aria-label':'플레이 채팅' },
          el('div',{ class:'chat-heading' },
            row(portrait({},'heading'),investigatorName()),illustrationTools()),
          timeline,compose()),
        el('aside',{ class:'sidebar', 'aria-label':'캠페인 관리' },foldHandle,
          el('div',{ class:'sidebar-body', hidden:panelFolded || undefined },tabBar,panel))));
    // Phones show the tabs as one sideways row; keep the open tab in view.
    const pressedTab = tabBar.querySelector('[aria-pressed="true"]');
    if (pressedTab && tabBar.scrollWidth > tabBar.clientWidth) tabBar.scrollLeft = pressedTab.offsetLeft - (tabBar.clientWidth - pressedTab.offsetWidth) / 2;
    options.setHandoutDescriptions(descriptionSlots);
    updateNotice();
    if (artworkProbe) surface.append(el('div',{ hidden:true },artworkProbe));
    if (caret) {
      const composer = surface.querySelector('#coc7-keeper-input');
      composer.focus({ preventScroll:true });
      composer.setSelectionRange(...caret);
    }
    panel.scrollTop = panelScroll;
    const registeredHandout = revealHandout;
    revealHandout = '';
    if (active === 'handouts' && registeredHandout) {
      const registered = panel.querySelector(`[data-handout-id="${registeredHandout}"]`);
      if (registered) {
        registered.open = true;
        const preview = registered.querySelector('.image-button') ?? registered.querySelector('summary');
        preview?.scrollIntoView({ block:'nearest' });
      }
    }
    timeline.scrollTop = end || rollChanged ? timeline.scrollHeight : oldScroll;
    if (registeredHandout) timeline.querySelector(`[data-handout-id="${registeredHandout}"]`)?.scrollIntoView({ block:'nearest' });
    if (revealArt) {
      timeline.querySelector(`[data-illustration-id="${revealArt}"]`)?.scrollIntoView({ block:'nearest' });
      revealArt = '';
    }
    flashRoll = '';
  }

  const loaded = (async () => {
    try {
      vault = adapter.vault();
      state = await vault.get();
      if (!state && !closed) {
        state = createCampaign(options.gameTitle || '새 캠페인');
        state.settings.chatId = options.gameChatId;
        try { await vault.save(state,null); }
        catch (error) {
          if (error.status !== 409) throw error;
          state = await vault.get();
          if (!state) throw error;
        }
      }
      if (!closed) render();
      if (!libraryLoaded && !closed) { await loadLibrary(); render(); }
    } catch (error) {
      if (!closed) surface.replaceChildren(headline('캠페인을 열 수 없습니다.'),note(error.message));
    }
  })();
  return {
    async cleanup() {
      closed = true;
      clearTimeout(statusTimer);
      running?.controller.abort();
      await loaded;
      revokeUrls();
      vault?.close();
      surface.remove();
    },
  };
}
