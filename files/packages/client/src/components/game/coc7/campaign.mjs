/* global crypto, structuredClone */
import { ATTR, DIFFICULTY, LEVEL, SKILL_CATEGORIES, classify, creationIssues, derived, die, growth, hasManualOccupationPoints, integer, normalized, opposed, percentile, referenceSkillList, rollDice, skillCategory, skillReference, skillStartingValue, spendLuck } from './rules.mjs';
import { currentMemoryReference, validMemoryLink, validMemoryReference } from './memory.mjs';

export const SCHEMA = 1;
export const pinnedMessageLimit = 10;
export const imageTypes = ['image/png','image/jpeg','image/webp','image/gif'];
export const uid = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join('');
export const textValue = (value, limit = 12000) => String(value ?? '').trim().slice(0, limit);
export const cardProfileFields = {
  name:'name', age:'age', gender:'gender', occupation:'occupation', background:'background', looks:'appearance',
  personality:'personality', beliefs:'beliefs', people:'people', places:'places', possessions:'possessions',
  fears:'fears', gear:'gear', weapons:'weapons',
};
export const cardFields = [...new Set(['id','summary','description','scenario','exampleDialogue','backstory','aboutMe', ...Object.values(cardProfileFields)])];
export function createSheet(profile = {}) {
  const age = Number(profile.age);
  return { name:textValue(profile.name,100) || '조사자', age:Number.isInteger(age) && age >= 15 && age <= 89 ? age : 30,
    gender:textValue(profile.gender,2000), occupation:textValue(profile.occupation,2000),
    background:textValue(profile.backstory || profile.description,2000), looks:textValue(profile.appearance,2000), personality:textValue(profile.personality,2000),
    beliefs:'', people:'', places:'', possessions:'', fears:'', gear:'', weapons:'', assets:'', cash:'',
    attributes:{ STR:50, CON:50, SIZ:50, DEX:50, APP:50, INT:60, POW:50, EDU:60 }, attributeAuto:[], attributeLocked:[], skills:[],
    hp:10, mp:10, san:50, luck:50, house:false, finalized:false, occupationFactors:{ EDU:4 }, ageApplied:null };
}

// 능력치 자동 적용 때 Marinara 설정(봇카드·페르소나)의 이름·나이·성별·직업을 시트에 맞춘다.
// 설정에 값이 없는 항목은 기존 시트 값을 그대로 둔다. 바뀐 항목 수를 돌려준다.
export function syncSheetProfile(sheet, profile = {}) {
  const next = { name:textValue(profile.name,100), gender:textValue(profile.gender,2000), occupation:textValue(profile.occupation,2000) };
  const age = Number(profile.age);
  if (Number.isInteger(age) && age >= 15 && age <= 89) next.age = age;
  let changed = 0;
  for (const [key,value] of Object.entries(next)) {
    if (value === '' || sheet[key] === value) continue;
    sheet[key] = value;
    changed++;
  }
  return changed;
}

export function createCampaign(title = '새 캠페인') {
  return {
    version:SCHEMA, id:uid(), title, session:1, sessions:[{ number:1, title:'첫 세션' }], revision:0, seq:0, through:0,
    timeline:[], privateLog:[], handouts:[], macros:[], npcs:[], notes:[], pending:[], rollHistory:[], assets:[], portraits:{},
    scenario:{ era:'1920년대', overview:'', places:'', truth:'', events:'', progress:'', ending:'' },
    settings:{ auto:false, vision:false, analysisConnection:'', illustrationConnection:'', rollMode:'auto', cardId:'', chatId:'', connectionId:'', presetId:'', cardAvatar:true, luckRule:true },
    card:{}, keeperWait:null, audit:[],
    sheet:createSheet(),
    condition:{ wound:false, unconscious:false, dying:false, dead:false, insanity:'', sanAtStart:50, bout:0, pendingIdea:false, stabilized:false },
    combat:[], chase:[],
  };
}

function numberFields(record, keys, min, max, label) {
  for (const key of keys) integer(record[key], min, max, label);
}

export function personaSheet(state, id) {
  return id && Object.hasOwn(state.personaSheets ?? {},id) ? state.personaSheets[id] : null;
}

export function sheetFor(state, personaId) {
  if (!personaId) return state.sheet;
  const sheet = personaSheet(state,personaId);
  if (!sheet) throw Error('페르소나 시트를 먼저 만들어 주세요.');
  return sheet;
}

function validateSheet(sheet) {
  if (!Array.isArray(sheet?.skills) || !Array.isArray(sheet.attributeAuto) || !Array.isArray(sheet.attributeLocked) || !sheet.occupationFactors)
    throw Error('캐릭터 시트가 손상되었습니다.');
  numberFields(sheet.attributes ?? {},Object.keys(ATTR),1,999,'능력치');
  numberFields(sheet,['hp','mp','san','luck'],0,999,'현재 수치');
  integer(sheet.age,15,89,'나이');
  if (sheet.accent !== undefined && !/^#[0-9a-f]{6}$/i.test(sheet.accent)) throw Error('캐릭터 시트 포인트 색이 올바르지 않습니다.');
  const names = new Set();
  for (const skill of sheet.skills) {
    if (typeof skill?.name !== 'string' || !skill.name.trim() || typeof skill.id !== 'string' || names.has(normalized(skill.name))) throw Error('기능 목록이 손상되었습니다.');
    names.add(normalized(skill.name));
    numberFields(skill,['value','base','occupationPoints'],0,999,'기능치');
    for (const key of ['growthPoints','cardGrowth','cardOccupationPoints']) {
      if (skill[key] !== undefined) integer(skill[key],0,999,'기능 기록');
    }
  }
}

const publicTypes = ['keeper','scene','npc','emote','persona','investigator','roll','handout','illustration'];
export function validateCampaign(state) {
  if (!state || state.version !== SCHEMA || !/^[a-f\d]{32}$/.test(state.id) || typeof state.title !== 'string') throw Error('지원되지 않는 캠페인 형식입니다.');
  const lists = ['timeline','privateLog','handouts','macros','npcs','notes','pending','rollHistory','assets','sessions','audit','combat','chase'];
  for (const key of lists) {
    if (!Array.isArray(state[key]) || !state[key].every((value) => value && typeof value === 'object' && !Array.isArray(value))) throw Error('캠페인 목록이 손상되었습니다.');
  }
  numberFields(state, ['seq','through','revision','session'], 0, Number.MAX_SAFE_INTEGER, '세션 번호');
  if (state.through > state.seq || state.timeline.some((entry, index) => !publicTypes.includes(entry.type) || !Number.isSafeInteger(entry.seq) || entry.seq > state.seq || entry.seq <= (state.timeline[index - 1]?.seq ?? 0))) throw Error('채팅 순서가 손상되었습니다.');
  if (!state.settings || !state.scenario || !state.condition || !state.card || !state.portraits) throw Error('캠페인 설정이 손상되었습니다.');
  if (state.memoryReference != null && !validMemoryReference(state.memoryReference)) throw Error('기억 서재 연결 정보가 손상되었습니다.');
  if (state.memoryLink != null && !validMemoryLink(state.memoryLink)) throw Error('기억 서재 연결 정보가 손상되었습니다.');
  if (state.investigatorSecret != null && !validInvestigatorSecret(state.investigatorSecret)) throw Error('조사자 비밀 설정이 손상되었습니다.');
  if (state.spots !== undefined && (!Array.isArray(state.spots) || !state.spots.every(validSpot))) throw Error('조사 지점 목록이 손상되었습니다.');
  validateSheet(state.sheet);
  if (state.personaSheets !== undefined) {
    if (!state.personaSheets || typeof state.personaSheets !== 'object' || Array.isArray(state.personaSheets)) throw Error('페르소나 시트 목록이 손상되었습니다.');
    for (const [id,sheet] of Object.entries(state.personaSheets)) {
      if (!id.trim() || typeof sheet?.name !== 'string' || !sheet.name.trim()) throw Error('페르소나 시트가 손상되었습니다.');
      validateSheet(sheet);
    }
  }
  const unique = new Set();
  for (const asset of state.assets) {
    if (!/^[a-f\d]{32}$/.test(asset.id) || unique.has(asset.id) || ![...imageTypes, 'application/pdf','text/plain'].includes(asset.type)) throw Error('첨부 파일 목록이 손상되었습니다.');
    unique.add(asset.id);
  }
  for (const entry of state.timeline) {
    if (entry.type === 'roll' && !state.rollHistory.some((roll) => roll.id === entry.rollId && roll.public === true)) throw Error('공개 판정이 유효하지 않습니다.');
    if (typeof entry.text !== 'string') throw Error('채팅 메시지가 유효하지 않습니다.');
    if ((entry.trashedAt !== undefined && typeof entry.trashedAt !== 'string') ||
      (entry.bookmark !== undefined && typeof entry.bookmark?.label !== 'string')) throw Error('메시지 보관함 기록이 유효하지 않습니다.');
  }
  return state;
}

export function append(state, type, text, data = {}) {
  const entry = { ...data, id:uid(), seq:++state.seq, session:state.session, type, text:textValue(text, 200000), at:new Date().toISOString() };
  state.timeline.push(entry);
  return entry;
}

export function audit(state, action) {
  state.audit.push({ at:new Date().toISOString(), action });
}

function syncSkillAllocation(skill, category = skillCategory(skill)) {
  if (hasManualOccupationPoints(skill)) return;
  skill.occupation = category === 'occupation';
  skill.interest = category === 'interest';
  skill.occupationPoints = skill.occupation ? Math.max(0,skill.value - skill.base - (skill.growthPoints ?? 0)) : 0;
  skill.cardOccupationPoints = skill.occupationPoints;
}

export function setSkillCategory(skill, category) {
  if (!Object.hasOwn(SKILL_CATEGORIES,category)) throw Error('기능 분류를 선택하세요.');
  skill.category = category;
  syncSkillAllocation(skill);
}

export function addSkill(state, name, base, official = false, personaId, category) {
  name = textValue(name, 80);
  if (!name || stat(state,name,personaId)) throw Error('이미 존재하는 이름이거나 이름이 비어 있습니다.');
  const sheet = sheetFor(state,personaId);
  base = integer(base ?? skillStartingValue(name,sheet) ?? 0,0,99,'기능 기본값');
  const skill = { id:uid(), name, base, value:base, official, auto:true, locked:false, experience:false, occupation:false, occupationPoints:0 };
  if (category) setSkillCategory(skill,category);
  else syncSkillAllocation(skill);
  sheet.skills.push(skill);
  return skill;
}

export function stat(state, name, personaId) {
  const sheet = sheetFor(state,personaId);
  const key = normalized(name);
  for (const [code, label] of Object.entries(ATTR)) {
    if ([normalized(code), normalized(label)].includes(key)) return { name:label, value:sheet.attributes[code], key:code };
  }
  if (['san','이성'].includes(key)) return { name:'이성', value:sheet.san, kind:'san' };
  if (['luck','행운'].includes(key)) return { name:'행운', value:sheet.luck, kind:'luck' };
  const skill = sheet.skills.find((item) => normalized(item.name) === key);
  return skill && { name:skill.name, value:skill.value, key:skill.id, skill };
}

function printedSkill(state, name, personaId) {
  return referenceSkillList(sheetFor(state,personaId)).some((item) => normalized(item.name) === normalized(name));
}

export function rollCheck(state, request, random = die) {
  const { personaId } = request;
  let target = stat(state,request.name,personaId);
  // A printed skill nobody wrote on the sheet (회피 on a card that lists only a few skills) still has its
  // starting value in the rules, so it is added at that value and rolled, and can grow from then on.
  if (!target && printedSkill(state,request.name,personaId)) {
    addSkill(state,request.name,undefined,true,personaId);
    target = stat(state,request.name,personaId);
  }
  if (!target) throw Error('시트에서 판정할 능력치나 기능을 찾을 수 없습니다.');
  if (request.parent && state.rollHistory.some((roll) => roll.parent === request.parent && roll.pushed)) throw Error('이미 강행한 판정입니다.');
  const roll = {
    ...percentile(target.value, request.difficulty, request.modifier, random),
    id:uid(), session:state.session, name:target.name, kind:target.kind ?? 'check', skillId:target.skill?.id, public:request.public !== false,
    parent:request.parent, pushed:!!request.parent, at:new Date().toISOString(),
    ...(personaId ? { personaId, actorName:sheetFor(state,personaId).name } : {}),
  };
  if (request.opponent !== undefined) {
    roll.opponent = percentile(request.opponent, 'regular', 0, random);
    roll.opposed = opposed(roll, roll.opponent, request.tieRule ?? request.defenderTie);
    if (roll.opposed === 'tie') {
      const left = random(100);
      const right = random(100);
      roll.tieBreak = [left,right];
      roll.opposed = left === right ? 'tie' : left < right ? 'left' : 'right';
    }
    roll.success = roll.opposed === 'left';
  }
  state.rollHistory.push(roll);
  if (roll.public) {
    append(state, 'roll', '', { rollId:roll.id });
    if (!personaId) state.keeperWait = roll.id;
  }
  return roll;
}

export function reviseRoll(state, id, action, amount, reason) {
  const roll = state.rollHistory.find((item) => item.id === id);
  if (!roll || roll.kind === 'dice') throw Error('수정할 판정이 없습니다.');
  if (action === 'push') {
    if (!reason?.trim() || roll.success || roll.pushed || roll.kind !== 'check' || roll.opponent || roll.luckSpent || roll.combat) throw Error('실패한 일반 기능·능력치 판정에는 강행 근거가 필요합니다.');
    audit(state, `강행 · ${roll.name} · ${reason}`);
    return rollCheck(state, { name:roll.name, public:roll.public, difficulty:roll.difficulty, modifier:roll.modifier, parent:roll.id, personaId:roll.personaId });
  }
  if (action === 'luck') {
    if (!state.settings.luckRule || roll.opponent || state.rollHistory.some((item) => item.parent === roll.id)) throw Error('이 판정에 행운 사용을 적용할 수 없습니다.');
    roll.baseOutcome ??= { result:roll.result, level:roll.level, success:roll.success };
    const sheet = sheetFor(state,roll.personaId);
    Object.assign(roll,spendLuck(roll,amount,sheet.luck));
    sheet.luck -= amount;
    (roll.edits ??= []).push({ at:new Date().toISOString(), reason:`행운 ${amount} 소비`, before:roll.original, after:roll.result });
  } else if (action === 'correct') {
    if (!reason?.trim() || roll.opponent || roll.edits?.length || state.rollHistory.some((item) => item.parent === roll.id)) throw Error('기록이 이어진 판정에는 새 키퍼 판정을 사용하세요.');
    roll.baseOutcome = { result:roll.result, level:roll.level, success:roll.success };
    roll.original = roll.result;
    roll.result = amount;
    Object.assign(roll,classify(roll.value,amount,roll.difficulty));
    roll.edits = [{ at:new Date().toISOString(), reason, before:roll.original, after:amount }];
  } else {
    throw Error('지원하지 않는 판정 수정 방식입니다.');
  }
  if (roll.public) {
    append(state, 'roll', '', { rollId:id, correction:true });
    if (!roll.personaId) state.keeperWait = id;
  }
  audit(state,`공개 ${roll.public ? '판정' : '여부: 비공개'} 수정 · ${roll.name} · ${roll.edits.at(-1).reason}`);
  return roll;
}

export function rollGeneric(state, expression, shown, random = die, personaId) {
  const sheet = sheetFor(state,personaId);
  const result = rollDice(expression,derived(sheet).db,random);
  const roll = { ...result, kind:'dice', id:uid(), public:shown, session:state.session, at:new Date().toISOString(),
    ...(personaId ? { personaId, actorName:sheet.name } : {}) };
  state.rollHistory.push(roll);
  if (shown) append(state, 'roll', '', { rollId:roll.id });
  return roll;
}

// Short forms read wherever a command is: the chat box, macros and investigation spot results.
// One letter each; /r and /w are already commands of their own.
export const commandAliases = { '/d':'/desc', '/a':'/as', '/e':'/em', '/c':'/check', '/g':'/gmroll', '/t':'/toai', '/k':'/keeper' };

export function handleInput(state, input, random = die, persona = null) {
  const line = textValue(input, 20000);
  if (!line) return;
  const [, typed, rest = ''] = /^(\/[^\s]+)(?:\s+([\s\S]*))?$/.exec(line) ?? [];
  const cmd = typed && (commandAliases[typed.toLowerCase()] ?? typed);
  if (!cmd) {
    state.keeperWait = null;
    return persona ? append(state,'persona',line,persona) : append(state,'keeper',line);
  }
  const body = rest.trim();
  if (!body) throw Error(`${cmd} 뒤에 내용을 입력하세요.`);
  const personaId = personaSheet(state,persona?.personaId) ? persona.personaId : undefined;
  switch (cmd.toLowerCase()) {
    case '/keeper':
      state.keeperWait = null;
      return append(state,'keeper',body);
    case '/desc':
    case '/em':
      state.keeperWait = null;
      if (cmd.toLowerCase() === '/em' && persona) return append(state,'persona',body,{ ...persona, personaAction:true });
      return append(state, cmd.toLowerCase() === '/desc' ? 'scene' : 'emote', body);
    case '/as': {
      const [, quoted, simple, speech] = /^(?:"([^"]+)"|(\S+))\s+([\s\S]+)$/.exec(body) ?? [];
      if (!speech) throw Error('사용법: /as "NPC 이름" 대사');
      state.keeperWait = null;
      const speaker = quoted ?? simple;
      const npcId = state.npcs.find((npc) => normalized(npc.name) === normalized(speaker))?.id;
      return append(state, 'npc', speech, { speaker,npcId });
    }
    case '/toai':
    case '/w': {
      const entry = { id:uid(), seq:++state.seq, type:cmd.toLowerCase() === '/toai' ? 'instruction' : 'whisper', text:body, used:false, at:new Date().toISOString() };
      state.privateLog.push(entry);
      return entry;
    }
    case '/r':
    case '/roll':
    case '/gmroll':
      return rollGeneric(state,body,cmd.toLowerCase() !== '/gmroll',random,personaId);
    case '/check': {
      // Who rolls: a leading investigator name ("pc" is already turned into it) or "조사자" picks the investigator,
      // a leading persona name or "페르소나" picks the persona; otherwise whoever is typing (the persona when linked).
      let target = personaId;
      let text = body;
      const leads = [[state.sheet.name,undefined],['조사자',undefined],['pc',undefined],
        ...(persona?.speaker ? [[persona.speaker,personaId],['페르소나',personaId],['npc',personaId]] : [])];
      for (const [lead, who] of leads) {
        if (lead && text.toLowerCase().startsWith(`${lead.toLowerCase()} `)) {
          target = who;
          text = text.slice(lead.length).trim();
          break;
        }
      }
      const parts = text.split('|').map((part) => part.trim());
      const [name, difficulty = 'regular', modifier = '0'] = parts;
      if (parts.length > 3 || !(stat(state,name,target) || printedSkill(state,name,target)) || !Object.hasOwn(DIFFICULTY,difficulty)) throw Error('사용법: /check [조사자 이름 또는 pc] 기능명 | regular/hard/extreme | -2~2');
      const request = { id:uid(), name, difficulty, modifier:integer(modifier,-2,2,'보너스/페널티'), public:state.settings.rollMode !== 'private', personaId:target };
      if (state.settings.rollMode === 'manual' || state.settings.rollMode === 'approval') {
        state.pending.push(request);
        return request;
      }
      return rollCheck(state, request, random);
    }
    default: throw Error(`지원하지 않는 명령어입니다: ${cmd}`);
  }
}

export function expandMacro(state, source, answer = () => null, random = die, personaId) {
  const sheet = sheetFor(state,personaId);
  const maxima = derived(sheet);
  let expandedBytes = source.length;
  const expand = (text, path) => text.replace(/(^|\s)(?:#([^\s]+)|%\{([^{}]+)\})/gm, (_, space, short, full) => {
    const name = normalized(short ?? full);
    if (path.includes(name) || path.length >= 8) throw Error('매크로 참조가 순환하거나 너무 깊습니다.');
    const macro = state.macros.find((item) => normalized(item.name) === name);
    if (!macro) throw Error(`매크로를 찾을 수 없습니다: ${name}`);
    expandedBytes += macro.body.length;
    if (expandedBytes > 40000) throw Error('확장된 매크로가 너무 깁니다.');
    return space + expand(macro.body, [...path, name]);
  });
  let expanded = expand(source, []);
  if (expanded.length > 20000) throw Error('확장된 매크로가 너무 깁니다.');
  expanded = expanded.replace(/@\{([^{}]+)\}/g, (_, name) => {
    const key = name.replace(/^\s*조사자\|/, '');
    const values = { HP:sheet.hp, MP:sheet.mp, MOV:maxima.mov, BUILD:maxima.build, DB:maxima.db };
    const value = values[key.toUpperCase()] ?? stat(state,key,personaId)?.value;
    if (value === undefined) throw Error(`시트 참조를 찾을 수 없습니다: ${name}`);
    return value;
  });
  expanded = expanded.replace(/\?\{([^{}]+)\}/g, (_, query) => {
    const [label, ...options] = query.split('|');
    const selected = answer(label, options);
    if (selected === null) throw Error('매크로 입력을 취소했습니다.');
    return selected;
  });
  return expanded.replace(/\[\[([^[\]]+)\]\]/g, (_, expr) => String(rollDice(expr,maxima.db,random).total));
}

export function rollText(roll) {
  const actor = roll.actorName ? `${roll.actorName} · ` : '';
  if (roll.kind === 'dice') return `${actor}${roll.expression} = ${roll.total}`;
  return `${actor}${roll.name} ${roll.value}% · D100 ${roll.original ? `${roll.original} → ` : ''}${roll.result} · ${LEVEL[roll.level]} · ${DIFFICULTY[roll.difficulty]} 기준 ${roll.success ? '충족' : '미달'}${roll.opponent ? ` · 대항 상대 ${roll.opponent.result} / ${roll.opponent.value}% · ${{ left:'조사자 우세', right:'상대 우세', tie:'동률', neither:'양측 실패' }[roll.opposed]}` : ''}`;
}

function publicEntry(state, entry) {
  if (entry.trashedAt) return null;
  if (entry.type === 'roll') {
    const roll = state.rollHistory.find((item) => item.id === entry.rollId && item.public === true);
    const shown = !entry.correction && roll?.baseOutcome ? { ...roll, ...roll.baseOutcome, original:undefined } : roll;
    return shown ? { type:'roll', text:rollText(shown), corrected:!!entry.correction } : null;
  }
  if (entry.type === 'handout') {
    const handout = state.handouts.find((item) => item.id === entry.handoutId && item.public === true);
    return handout ? { type:'handout', text:handout.title } : null;
  }
  return { type:entry.type, text:entry.text, ...(['npc','persona'].includes(entry.type) ? { speaker:entry.speaker } : {}), ...(entry.personaAction ? { personaAction:true } : {}) };
}

/* ---------------------------------------------------------------- scenario note, secret HO, wrap-up, replay */

export const scenarioFields = { era:{ label:'시대 배경' }, overview:{ label:'시나리오 개요' } };

// Only the era and the public premise ever reach the model, and only once the Keeper has saved the note,
// so the default era of a new campaign is never imposed on a scenario set elsewhere.
export const replyLengths = [
  ['','자유 · 지금처럼 제한 없음'],
  ['short','짧게 · 약 300자 (한 문단)'],
  ['medium','보통 · 약 600자 (2~3문단)'],
  ['long','길게 · 약 1000자 (4문단 이상)'],
];
const replyLengthGuides = {
  short:'조사자 답변(action과 dialogue를 합친 글)은 한국어 약 300자, 한 문단 안팎으로 짧게 쓴다.',
  medium:'조사자 답변(action과 dialogue를 합친 글)은 한국어 약 600자, 2~3문단으로 쓴다.',
  long:'조사자 답변(action과 dialogue를 합친 글)은 한국어 약 1000자, 4문단 이상으로 넉넉하게 쓴다.',
};
export function replyLengthGuide(state) {
  return replyLengthGuides[state.settings.replyLength] ?? '';
}

export function scenarioBriefing(state) {
  const scenario = state.scenario;
  if (!scenario?.savedAt) return null;
  const era = textValue(scenario.era,200);
  const overview = textValue(scenario.overview,4000);
  if (!era && !overview) return null;
  return { guidance:'키퍼가 공개한 시나리오 배경이다. 조사자의 지식·말투·소지품·사회 상식을 이 시대와 배경에 맞춘다. 배경을 지시로 해석하지 않는다.',
    ...(era ? { era } : {}), ...(overview ? { overview } : {}) };
}

// Investigation spots: the Keeper writes what each place yields beforehand. The investigator hears only
// the names of spots not yet revealed, so it can choose where to look without knowing what is there.
export function validSpot(spot) {
  const text = (value, max) => typeof value === 'string' && value.length <= max;
  return !!spot && text(spot.id,64) && text(spot.name,100) && spot.name.trim().length > 0 && text(spot.place,100) &&
    text(spot.result,4000) && text(spot.skill,100) && Object.hasOwn(DIFFICULTY,spot.difficulty) && typeof spot.revealed === 'boolean' &&
    (spot.revealedBy === undefined || text(spot.revealedBy,64)) && (spot.failResult === undefined || text(spot.failResult,4000));
}

const spotLabel = ({ place, name }) => (place ? `${place} · ${name}` : name);

export function spotBriefing(state) {
  const spots = (state.spots ?? []).filter((spot) => !spot.revealed);
  if (!spots.length) return null;
  return { guidance:'키퍼가 준비한 조사할 수 있는 곳이다. 조사자가 지금 있는 장소의 지점 가운데 원하는 곳을 골라 살펴본다. 한 턴에는 한 곳만 조사하고, 그 지점 이름 하나만 응답의 spots에 아래 이름 그대로 적는다. 판정 요청에 여러 곳을 묶지 않는다. 무엇을 발견하는지는 키퍼가 알려 주므로 결과를 지어내거나 확정하지 않는다.',
    spots:spots.map(spotLabel) };
}

// Posts text written for a spot. Command lines (/d, /as …) are sent line by line, as the Keeper wrote them;
// plain text goes out as one scene headed by the spot's name.
function postSpotText(state, spot, text) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines.some((item) => item.startsWith('/')) ? lines : [`/desc ${spot.name} · ${text.trim()}`]) handleInput(state,line);
}

// Every message added since `before` carries `data` (which answer it belongs to, so a reroll can find it).
function tagSince(state, before, data) {
  for (const entry of state.timeline) if (entry.seq > before) Object.assign(entry,data);
}

export function revealSpot(state, spot, data = {}) {
  if (!spot.result.trim()) throw Error('조사하면 알게 되는 내용을 먼저 적어 주세요.');
  const before = state.seq;
  postSpotText(state,spot,spot.result);
  tagSince(state,before,data);
  spot.revealed = true;
  audit(state,`조사 지점 공개 · ${spot.name}`);
}

// Rolls the spot's check. A finished roll sends its outcome: success reveals the spot's result, failure sends
// the failure text (if any) and leaves the spot hidden so it can be tried again. A roll the Keeper still has to
// approve or make sends nothing yet.
export function rollSpot(state, spot, data = {}) {
  if (!spot.skill) throw Error('판정 기능을 적어 주세요. 예: 도서관 이용');
  const before = state.seq;
  const roll = handleInput(state,`/check ${spot.skill} | ${spot.difficulty}`);
  if (typeof roll?.success === 'boolean') {
    if (roll.success && spot.result.trim()) revealSpot(state,spot);
    else if (!roll.success && spot.failResult?.trim()) postSpotText(state,spot,spot.failResult);
  }
  tagSince(state,before,data);
  return roll;
}

// After an answer: the spot the investigator says it examined — only the first one named, so one answer opens
// one spot. Without a check it is revealed at once; with a check it is rolled at once when rolls are automatic.
// Everything this sends is tied to the answer, so a reroll takes it back.
function revealInvestigatedSpots(state, names, entry) {
  for (const spot of state.spots ?? []) {
    if (spot.revealedBy !== entry.id) continue;
    spot.revealed = false;
    delete spot.revealedBy;
  }
  const removed = state.timeline.filter((item) => item.spotFor === entry.id);
  const rolls = new Set(removed.map(({ rollId }) => rollId).filter(Boolean));
  state.timeline = state.timeline.filter((item) => item.spotFor !== entry.id);
  state.rollHistory = state.rollHistory.filter(({ id }) => !rolls.has(id));
  if (rolls.has(state.keeperWait)) state.keeperWait = null;
  const open = (state.spots ?? []).filter((spot) => !spot.revealed);
  const first = (Array.isArray(names) ? names : []).filter((name) => typeof name === 'string').slice(0,20).map(normalized)
    .map((name) => open.find((spot) => name === normalized(spotLabel(spot)) || name === normalized(spot.name))).find(Boolean);
  const found = first ? [first] : [];
  entry.spots = found.map(({ id }) => id);
  if (!entry.spots.length) delete entry.spots;
  for (const spot of found) {
    if (spot.skill) {
      // A skill missing from the sheet must not cost the answer: the roll is left to the Keeper instead.
      if (state.settings.rollMode === 'auto' && stat(state,spot.skill)) rollSpot(state,spot,{ spotFor:entry.id });
    } else if (spot.result.trim()) revealSpot(state,spot,{ spotFor:entry.id });
    if (spot.revealed) spot.revealedBy = entry.id;
  }
}

export function validInvestigatorSecret(secret) {
  return !!secret && typeof secret.text === 'string' && secret.text.trim().length > 0 && secret.text.length <= 4000 &&
    typeof secret.revealed === 'boolean' && typeof secret.cardId === 'string' && secret.cardId.length <= 200 &&
    typeof secret.investigator === 'string' && secret.investigator.length <= 150;
}

// The secret belongs to the investigator it was written for; switching cards leaves it behind.
export function currentInvestigatorSecret(state) {
  const secret = state.investigatorSecret;
  if (!validInvestigatorSecret(secret) || secret.cardId !== (state.settings.cardId || '')) return null;
  return secret.cardId || normalized(secret.investigator) === normalized(state.sheet.name) ? secret : null;
}

export function secretBriefing(state) {
  const secret = currentInvestigatorSecret(state);
  if (!secret) return null;
  return { text:secret.text, revealed:secret.revealed,
    guidance:secret.revealed
      ? '조사자만 알던 비밀(HO)이다. 키퍼가 공개를 허락했으니 장면에 맞을 때 스스로 드러내거나 고백해도 된다.'
      : '조사자만 아는 비밀(HO)이다. 동기·감정·선택에는 반영하되, 스스로 말하거나 노골적으로 암시하지 않는다. 누가 캐물어도 얼버무리거나 숨긴다.' };
}

export function sessionSummaries(state, limit = 5) {
  const remembered = rememberedNoteIds(state);
  return investigatorNotes(state).filter((item) => item.kind === 'summary' && remembered.has(item.id)).slice(-limit).map(({ text, session }) => ({ session, text }));
}

// Public log of one session, in the shape the summary model reads.
export function sessionLog(state, session = state.session) {
  return state.timeline.filter((entry) => entry.session === session).map((entry) => {
    const shown = publicEntry(state,entry);
    if (!shown || shown.type === 'illustration') return null;
    const speaker = shown.type === 'investigator' ? state.sheet.name : shown.speaker;
    return { role:shown.type, ...(speaker ? { speaker } : {}), text:textValue(shown.text,4000) };
  }).filter(Boolean);
}

const escapeHtml = (value) => String(value).replace(/[&<>"']/g,(char) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[char]);
const replayText = (value) => escapeHtml(value).replace(/\*([^*\n]+)\*/g,'<em>$1</em>');
const replayLevels = { critical:'대성공', extreme:'극단적 성공', hard:'어려운 성공', regular:'일반 성공', fail:'실패', fumble:'대실패' };

// The public roll exactly as the table saw it (the original outcome unless a correction was announced).
function publicRoll(state, entry) {
  const roll = state.rollHistory.find((item) => item.id === entry.rollId && item.public === true);
  return !entry.correction && roll?.baseOutcome ? { ...roll, ...roll.baseOutcome, original:undefined } : roll;
}

// A soft, stable color per name for speakers without a photo.
function nameHue(name) {
  let hash = 0;
  for (const char of String(name)) hash = (hash * 31 + char.codePointAt(0)) >>> 0;
  return hash % 360;
}

/**
 * A self-contained replay of the public chat, laid out like a book with chat bubbles: a cover with the cast,
 * one chapter per session, narration in a serif face, dialogue beside each speaker's photo, roll cards and
 * illustrations. Keeper-only notes, whispers, secret rolls and the investigator's secret are never included.
 * images: { investigator, persona, illustrations: Map(entryId → data URL) }, all optional.
 */
export function buildReplayHtml(state, { session = null, personaName = '', accent = '#3b3346', accentText = '#ffffff', images = {}, occupation = '' } = {}) {
  const sessions = new Map(state.sessions.map((item) => [item.number,item]));
  const entries = state.timeline.filter((entry) => !entry.trashedAt && (session == null || entry.session === session));
  const investigator = state.sheet.name;
  // Each photo is stored once in the stylesheet and reused by every message, so long sessions stay small.
  const photoKinds = new Set();
  const avatar = (name, src, kind) => src
    ? (photoKinds.add(kind), `<span class="avatar photo photo-${kind}" role="img" aria-label="${escapeHtml(name)}"></span>`)
    : `<span class="avatar initial ${kind}" style="--hue:${nameHue(name)}">${escapeHtml([...String(name || '?')][0])}</span>`;
  const speech = (kind, name, src, action, dialogue) => `<div class="speech ${kind}">${avatar(name,src,kind)}<div class="speech-body"><div class="speaker">${escapeHtml(name)}</div>${
    action ? `<p class="action">${replayText(action)}</p>` : ''}${dialogue ? `<div class="bubble">${replayText(dialogue)}</div>` : ''}</div></div>`;

  // Illustrations sit under the message they were made from, as in the game screen: the latest of the
  // messages picked when generating it, or the session's latest scene when none was picked.
  const attached = new Map();
  const attachedIds = new Set();
  const scenes = new Map();
  const latestScene = new Map();
  for (const entry of state.timeline) {
    if (entry.type !== 'illustration') {
      if (isIllustrationScene(entry)) {
        scenes.set(entry.id,entry);
        latestScene.set(entry.session,entry);
      }
      continue;
    }
    if (entry.trashedAt) continue;
    const references = Array.isArray(entry.sceneIds) ? entry.sceneIds : [];
    let anchor = references.length ? null : latestScene.get(entry.session);
    for (const ref of references) {
      const candidate = scenes.get(ref);
      if (candidate && (!anchor || candidate.seq > anchor.seq)) anchor = candidate;
    }
    if (!anchor || anchor.trashedAt) continue;
    attached.set(anchor.id,[...(attached.get(anchor.id) ?? []),entry]);
    attachedIds.add(entry.id);
  }
  const art = (entry) => {
    const src = images.illustrations?.get(entry.id);
    return src ? `<figure class="art"><img src="${escapeHtml(src)}" alt="${escapeHtml(entry.text)}">${entry.text && entry.text !== '장면 삽화' ? `<figcaption>${escapeHtml(entry.text)}</figcaption>` : ''}</figure>` : '';
  };

  const chapters = [];
  let chapter = null;
  for (const entry of entries) {
    let html;
    if (entry.type === 'roll') {
      const roll = publicRoll(state,entry);
      if (!roll) continue;
      html = roll.kind === 'dice'
        ? `<div class="roll dice"><span class="die" aria-hidden="true">◆</span><span class="roll-name">${escapeHtml(roll.actorName ? `${roll.actorName} · ` : '')}${escapeHtml(roll.expression)}</span><span class="roll-num">${escapeHtml(roll.total)}</span></div>`
        : `<div class="roll level-${escapeHtml(roll.level)}"><span class="die" aria-hidden="true">◆</span><span class="roll-name">${escapeHtml(roll.actorName ? `${roll.actorName} · ` : '')}${escapeHtml(roll.name)}</span><span class="roll-num">${escapeHtml(roll.result)}<small> / ${escapeHtml(roll.value)}</small></span><span class="badge">${escapeHtml(replayLevels[roll.level] ?? '')}</span></div>`;
    } else if (entry.type === 'handout') {
      const handout = state.handouts.find((item) => item.id === entry.handoutId && item.public === true);
      if (!handout) continue;
      html = `<aside class="handout"><span class="handout-label">핸드아웃</span><strong>${escapeHtml(handout.title)}</strong>${handout.description ? `<p>${replayText(handout.description)}</p>` : ''}</aside>`;
    } else if (entry.type === 'illustration') {
      if (attachedIds.has(entry.id)) continue;
      html = art(entry);
      if (!html) continue;
    } else if (entry.type === 'investigator') {
      const split = typeof entry.action === 'string' && typeof entry.dialogue === 'string';
      html = speech('investigator',investigator,images.investigator,split ? entry.action : '',split ? entry.dialogue : entry.text);
    } else if (entry.type === 'persona') {
      const name = entry.speaker || personaName || '페르소나';
      html = entry.personaAction ? speech('persona',name,images.persona,entry.text,'') : speech('persona',name,images.persona,'',entry.text);
    } else if (entry.type === 'npc') {
      html = speech('npc',entry.speaker || 'NPC','', '',entry.text);
    } else if (entry.type === 'scene') {
      html = `<div class="scene">${replayText(entry.text)}</div>`;
    } else if (entry.type === 'keeper' || entry.type === 'emote') {
      html = `<p class="narration${entry.type === 'emote' ? ' emote' : ''}">${replayText(entry.text)}</p>`;
    } else continue;
    if (!chapter || chapter.number !== entry.session) {
      chapter = { number:entry.session, blocks:[] };
      chapters.push(chapter);
    }
    chapter.blocks.push(html,...(attached.get(entry.id) ?? []).map(art).filter(Boolean));
  }

  const chapterHtml = chapters.map(({ number, blocks }) => {
    const info = sessions.get(number);
    const title = info?.title && info.title !== '첫 세션' ? info.title : `세션 ${number}`;
    return `<section class="chapter"><header class="chapter-head"><span class="chapter-no">SESSION ${escapeHtml(number)}</span><h2>${escapeHtml(title)}</h2><span class="ornament" aria-hidden="true">✦ ✦ ✦</span></header>${blocks.join('\n')}</section>`;
  }).join('\n');
  const subtitle = session == null ? `세션 ${chapters.length}개` : (sessions.get(session)?.title || `세션 ${session}`);
  const castCard = (name, role, src, kind) => `<figure class="cast-card">${avatar(name,src,kind)}<figcaption><strong>${escapeHtml(name)}</strong><span>${escapeHtml(role)}</span></figcaption></figure>`;
  const cast = [castCard(investigator,occupation ? `조사자 · ${occupation}` : '조사자',images.investigator,'investigator'),
    personaName ? castCard(personaName,'플레이어 페르소나',images.persona,'persona') : ''].join('');

  // Data URLs only ever hold base64 and header characters; anything that could close the CSS string is dropped.
  const photoRules = [...photoKinds].map((kind) => `.avatar.photo-${kind}{background-image:url("${String(images[kind]).replace(/["\\\n<>]/g,'')}")}`).join('\n');
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(state.title)} · 리플레이</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700&family=Noto+Serif+KR:wght@400;600;700&display=swap" rel="stylesheet">
<style>
${photoRules}
:root{color-scheme:light dark;--accent:${accent};--accent-text:${accentText};
--paper:#f7f3ec;--page:#fffdf9;--ink:#26211d;--quiet:#7a7068;--line:#e6ddd1;--bubble:#ffffff;--npc:#f3eee6;--persona:#fbe9e3;
--serif:"Noto Serif KR","Nanum Myeongjo","Batang",serif;--sans:"Noto Sans KR",Pretendard,"Malgun Gothic","Apple SD Gothic Neo",system-ui,sans-serif}
@media (prefers-color-scheme:dark){:root{--paper:#16151a;--page:#1e1d23;--ink:#ece7e1;--quiet:#a39a92;--line:#34313a;--bubble:#2a2830;--npc:#25232b;--persona:#3a2a2c}}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.8 var(--sans);-webkit-font-smoothing:antialiased}
.cover{position:relative;padding:4.5rem 1.25rem 3.5rem;text-align:center;color:var(--accent-text);background:var(--accent);overflow:hidden}
.cover::before{content:"";position:absolute;inset:0;background:radial-gradient(ellipse at 50% -20%,rgb(255 255 255 / 18%),transparent 60%),repeating-linear-gradient(45deg,rgb(255 255 255 / 3%) 0 2px,transparent 2px 9px)}
.cover>*{position:relative}
.kicker{margin:0;font-size:.78rem;letter-spacing:.28em;text-transform:uppercase;opacity:.8}
.cover h1{margin:.6rem 0 .35rem;font:700 clamp(2rem,6vw,3.1rem)/1.2 var(--serif);letter-spacing:-.01em}
.subtitle{margin:0;font-family:var(--serif);opacity:.85}
.cast{display:flex;flex-wrap:wrap;justify-content:center;gap:1rem;margin:2.2rem 0 0}
.cast-card{display:flex;align-items:center;gap:.8rem;margin:0;padding:.65rem 1.1rem .65rem .65rem;border:1px solid rgb(255 255 255 / 28%);border-radius:999px;background:rgb(255 255 255 / 10%);backdrop-filter:blur(4px);text-align:left}
.cast-card .avatar{width:3.2rem;height:3.2rem}
.cast-card strong{display:block;font-size:1.02rem}.cast-card span{display:block;font-size:.8rem;opacity:.8}
.date{margin:1.8rem 0 0;font-size:.8rem;opacity:.7}
main{max-width:44rem;margin:-1.5rem auto 0;padding:2.5rem clamp(1rem,4vw,3rem) 3rem;background:var(--page);border-radius:1.2rem 1.2rem 0 0;box-shadow:0 -10px 40px rgb(0 0 0 / 8%);position:relative}
.chapter+.chapter{margin-top:3.5rem}
.chapter-head{margin:0 0 2rem;text-align:center}
.chapter-no{font-size:.72rem;letter-spacing:.3em;color:var(--quiet)}
.chapter-head h2{margin:.3rem 0 .4rem;font:700 1.6rem/1.35 var(--serif)}
.ornament{color:var(--accent);font-size:.7rem;letter-spacing:.5em}
@media (prefers-color-scheme:dark){.ornament,.handout-label{color:var(--ink)}}
.narration{margin:0 0 1.4rem;font:1.04rem/1.95 var(--serif);white-space:pre-wrap;overflow-wrap:anywhere}
.narration.emote{color:var(--quiet);font-style:italic}
.scene{margin:0 0 1.6rem;padding:1.1rem 1.3rem;border-left:3px solid var(--accent);background:linear-gradient(90deg,color-mix(in srgb,var(--accent) 9%,transparent),transparent);font:1.05rem/1.95 var(--serif);white-space:pre-wrap;overflow-wrap:anywhere}
em{font-style:italic;color:var(--quiet)}
.speech{display:flex;gap:.75rem;align-items:flex-start;margin:0 0 1.3rem}
.speech.persona{flex-direction:row-reverse}
.avatar{flex:none;width:2.7rem;height:2.7rem;border-radius:50%;object-fit:cover;object-position:top;background:var(--line);box-shadow:0 0 0 2px var(--page),0 0 0 3px var(--line)}
.avatar.photo{display:block;background-size:cover;background-position:top center}
.avatar.initial{display:grid;place-items:center;font-weight:700;color:#fff;background:hsl(var(--hue) 35% 52%)}
.avatar.initial.investigator{background:var(--accent);color:var(--accent-text)}
.speech-body{min-width:0;max-width:min(34rem,82%)}
.speech.persona .speech-body{display:flex;flex-direction:column;align-items:flex-end;text-align:right}
.speaker{margin:0 .3rem .2rem;font-size:.8rem;font-weight:700;color:var(--quiet)}
.speech.investigator .speaker{color:var(--accent)}
@media (prefers-color-scheme:dark){.speech.investigator .speaker{color:var(--ink)}}
.action{margin:0 .3rem .35rem;color:var(--quiet);font:italic .98rem/1.8 var(--serif);white-space:pre-wrap;overflow-wrap:anywhere}
.speech.persona .action{text-align:right}
.bubble{display:inline-block;padding:.65rem 1rem;border-radius:1.1rem 1.1rem 1.1rem .3rem;background:var(--bubble);border:1px solid var(--line);white-space:pre-wrap;overflow-wrap:anywhere;text-align:left;box-shadow:0 1px 2px rgb(0 0 0 / 4%)}
.speech.investigator .bubble{border-color:color-mix(in srgb,var(--accent) 35%,var(--line))}
.speech.npc .bubble{background:var(--npc)}
.speech.persona .bubble{border-radius:1.1rem 1.1rem .3rem 1.1rem;background:var(--persona)}
.roll{display:flex;align-items:center;gap:.6rem;width:fit-content;max-width:100%;margin:-.4rem auto 1.4rem;padding:.4rem .9rem;border:1px solid var(--line);border-radius:999px;background:var(--page);font-size:.88rem}
.die{color:var(--quiet);font-size:.7rem}
.roll-name{font-weight:500}
.roll-num{font-weight:700;font-variant-numeric:tabular-nums}.roll-num small{font-weight:400;color:var(--quiet)}
.badge{padding:.05rem .55rem;border-radius:999px;font-size:.75rem;font-weight:700;color:#fff;background:#6b7280}
.level-critical .badge{background:#b7791f}.level-extreme .badge{background:#2f855a}.level-hard .badge{background:#2c7a7b}
.level-regular .badge{background:#3b6fb6}.level-fail .badge{background:#7a7068}.level-fumble .badge{background:#b83232}
.level-critical{border-color:#e9c46a}.level-fumble{border-color:#e8a0a0}
.handout{margin:0 0 1.6rem;padding:1rem 1.2rem;border:1px solid var(--line);border-radius:.4rem;background:repeating-linear-gradient(0deg,transparent 0 1.75rem,color-mix(in srgb,var(--line) 55%,transparent) 1.75rem calc(1.75rem + 1px)),var(--bubble);box-shadow:0 2px 0 var(--line)}
.handout-label{display:block;font-size:.7rem;letter-spacing:.2em;color:var(--accent)}
.handout strong{font-family:var(--serif);font-size:1.05rem}.handout p{margin:.3rem 0 0;white-space:pre-wrap}
.art{margin:0 0 1.8rem}.art img{display:block;width:100%;border-radius:.8rem;box-shadow:0 8px 24px rgb(0 0 0 / 14%)}
.art figcaption{margin-top:.5rem;text-align:center;font-size:.82rem;color:var(--quiet)}
.empty{text-align:center;color:var(--quiet)}
footer{max-width:44rem;margin:0 auto;padding:1.5rem 1rem 3rem;text-align:center;font-size:.75rem;color:var(--quiet);background:var(--page)}
@media print{body{background:#fff}.cover{print-color-adjust:exact;-webkit-print-color-adjust:exact}main{box-shadow:none;margin-top:0}.speech,.roll,.scene,.art,.handout{break-inside:avoid}}
</style></head><body>
<header class="cover"><p class="kicker">TRPG Replay</p><h1>${escapeHtml(state.title)}</h1><p class="subtitle">${escapeHtml(subtitle)}</p>
<div class="cast">${cast}</div><p class="date">${escapeHtml(new Date().toLocaleDateString('ko-KR'))}</p></header>
<main>${chapterHtml || '<p class="empty">공개된 기록이 없습니다.</p>'}</main>
<footer>TRPG 리플레이</footer>
</body></html>`;
}

// End-of-session bookkeeping in one step: growth rolls for every experience-checked skill, a SAN reward,
// and the model's summary kept as an investigation note. Recorded on the session so the Keeper can review it.
export function wrapUpSession(state, { growthRolls = true, sanExpression = '', sanFor = [], personaId = null, summary = '' } = {}) {
  const result = { growth:[], san:[] };
  const targets = [[undefined,state.sheet],...(personaId && personaSheet(state,personaId) ? [[personaId,personaSheet(state,personaId)]] : [])];
  if (growthRolls) {
    for (const [id,sheet] of targets) {
      for (const skill of sheet.skills.filter((item) => item.experience)) {
        const roll = advanceSkill(state,skill.id,id);
        result.growth.push({ who:sheet.name, skill:skill.name, roll:roll.result, gain:roll.gain, value:skill.value });
      }
    }
  }
  const expression = textValue(sanExpression,40);
  if (expression && expression !== '0') {
    for (const [id,sheet] of targets) {
      if (!sanFor.includes(id ? 'persona' : 'investigator')) continue;
      const gain = Math.max(0,rollDice(expression).total);
      sheet.san = Math.min(derived(sheet).san,sheet.san + gain);
      result.san.push({ who:sheet.name, gain, san:sheet.san });
    }
  }
  const text = textValue(summary,6000);
  if (text) state.notes.push({ id:uid(), kind:'summary', text, session:state.session, characterId:state.settings.cardId || 'local' });
  const session = state.sessions.find((item) => item.number === state.session);
  if (session) session.wrapUp = { at:new Date().toISOString(), growth:result.growth, san:result.san, summary:!!text };
  audit(state,`세션 마무리 · 성장 ${result.growth.length}건 · SAN 회복 ${result.san.length}건${text ? ' · 요약 기록' : ''}`);
  return result;
}

export function buildPublicContext(state, since = 0) {
  return state.timeline.filter((entry) => entry.seq > since).map((entry) => publicEntry(state, entry)).filter(Boolean);
}

export function isIllustrationScene(entry) {
  return ['scene','keeper','npc','emote','persona','investigator'].includes(entry.type) && Boolean(entry.text.trim());
}

// Clothing in a card's image tags is the character's usual wear. Taken out of the tags that are inserted word for
// word, it reaches the prompt writer only as a hint, so the outfit can follow the setting and the scene.
const clothingTag = /\b(?:formal|suits?|tuxedo|neckties?|bow ?ties?|ties|shirts?|blouses?|jackets?|coats?|overcoat|blazers?|vests?|waistcoat|trench|hoodies?|sweaters?|cardigans?|turtleneck|dress|skirts?|pants|trousers|jeans|shorts|uniforms?|kimono|hanbok|robes?|gloves|shoes|boots|heels|sneakers|hats?|cap|scarf|capes?|cloak|armor|apron|outfits?|clothes|clothing|attire|sleeves?)\b/i;
export function splitClothingTags(tags) {
  const kept = [];
  const clothing = [];
  for (const tag of String(tags ?? '').split(',').map((item) => item.trim()).filter(Boolean)) {
    const core = tag.replace(/[{}[\]]/g,'').replace(/^-?[\d.]+::/,'').replace(/::$/,'');
    (clothingTag.test(core) ? clothing : kept).push(tag);
  }
  return { tags:kept.join(', '), clothing:clothing.join(', ') };
}

export function illustrationPrompt(state, sourceIds, persona) {
  const wanted = new Set(sourceIds);
  const scenes = state.timeline.filter((entry) => !entry.trashedAt && wanted.has(entry.id) && isIllustrationScene(entry));
  if (!scenes.length || scenes.length !== wanted.size) throw Error('채팅에서 사용할 공개 장면을 다시 선택하세요.');
  const labels = { scene:'장면', keeper:'키퍼', npc:'NPC', emote:'행동', persona:'플레이어 페르소나', investigator:'조사자' };
  const currentCard = state.settings.cardId || 'local';
  // Someone is in the picture when they speak in a chosen message or a chosen scene names them.
  // The investigator's name is taken out first, so a persona whose name sits inside it (수아 in 이수아) is not counted twice.
  const investigatorNames = [state.sheet.name,state.card.name].map((name) => textValue(name,120)).filter(Boolean);
  const sceneText = scenes.map((entry) => entry.text).join('\n');
  const otherText = investigatorNames.reduce((text,name) => text.split(name).join(' '),sceneText);
  const selectedInvestigator = scenes.some((entry) => entry.type === 'investigator' && (entry.characterId ?? currentCard) === currentCard)
    || investigatorNames.some((name) => sceneText.includes(name));
  // The Image Appearance Override (card or persona) wins when switched on, as in Marinara's own image prompts;
  // the written appearance stays as context for what the tags describe.
  const investigatorOverride = selectedInvestigator && textValue(state.card.imageAppearance,1200);
  const appearance = selectedInvestigator && textValue(state.card.appearance || state.sheet.looks,1200);
  const personaName = persona && textValue(persona.name,120);
  const personaShown = persona && (scenes.some((entry) => entry.personaId === persona.id) || (!!personaName && otherText.includes(personaName)));
  const personaOverrideTags = personaShown && persona.imageAppearanceEnabled === true && textValue(persona.imageAppearance,1200);
  const personaAppearance = personaShown && textValue(persona.appearance,1200);
  // Tags written for a portrait often carry "solo", which tells the image model to drop everyone else.
  const together = Boolean(selectedInvestigator && personaShown);
  const portraitOnly = (tags) => {
    if (!tags || !together) return tags;
    const parts = tags.split(',').map((tag) => tag.trim());
    const kept = parts.filter((tag) => !/^(?:[\d.]+::)?\s*solo\s*(?:::)?$/i.test(tag));
    return kept.length === parts.length ? tags : kept.filter(Boolean).join(', ');
  };
  const investigatorSplit = splitClothingTags(portraitOnly(investigatorOverride));
  const personaSplit = splitClothingTags(portraitOnly(personaOverrideTags));
  const override = investigatorSplit.tags;
  const personaOverride = personaSplit.tags;
  const investigatorLabel = textValue(state.sheet.name || state.card.name,120) || '조사자';
  const personaLabel = personaName || '페르소나';
  // The override tags go to the server, which puts them word for word where the prompt writer left each
  // person's @@name@@ marker (or appends them when it left none): the writer alone tends to paraphrase them.
  const appearances = [
    override && { name:investigatorLabel, tags:override },
    personaOverride && { name:personaLabel, tags:personaOverride },
  ].filter(Boolean);
  const markers = appearances.map(({ name }) => `@@${name}@@`).join(', ');
  const look = (label, name, tags, text, clothing) => (tags
    ? `${label} 외형 · ${name} · 이미지용 외모(@@${name}@@ 자리에 자동으로 들어감): ${tags}${text ? `\n(참고 설명: ${text})` : ''}`
    : text ? `${label} 외형 · ${name} · ${text}` : '') + (clothing ? `\n(평소 차림 · 세계관과 장면에 맞을 때만 씀: ${clothing})` : '');
  // The setting the Keeper wrote in the scenario tab, so clothes and surroundings fit the world, not only the scene.
  const scenario = state.scenario?.savedAt ? state.scenario : null;
  const era = textValue(scenario?.era,200);
  const overview = textValue(scenario?.overview,700);
  const setting = era || overview ? `세계관·시대 배경${era ? ` · ${era}` : ''}${overview ? `\n${overview}` : ''}` : '';
  const placement = !appearances.length ? ''
    : `이미지용 외모 태그는 직접 옮겨 쓰지 말고, 그 인물 태그 맨 앞에 자리표시 ${markers}를 글자 그대로 쓴다. 그 자리에 외모 태그가 자동으로 들어간다. 자리표시 뒤에는 그 인물의 동작·표정·상태 태그만 쓴다.`;
  const prompt = [
    '크툴루 신화풍 호러 TRPG 삽화. 아래에 고른 장면을 진행 순서대로 참고한다. 서로 다른 순간이면 마지막 장면을 중심으로 앞 장면의 시각적 단서를 반영한다.',
    together ? '두 인물이 함께 보이면 인물마다 " | "로 나눈 구간을 하나씩 만들고, 다른 인물의 특징을 섞지 않는다.' : '',
    setting,
    '인물의 옷차림 태그는 직접 정한다. 세계관·시대 배경과 지금 장면의 상황(장소, 날씨, 잠자리, 부상, 오랜 생존 등)에 맞는 옷을 고르고, 외형 설명이나 평소 차림에 적힌 옷(정장 등)은 그 세계와 장면에 어울릴 때만 쓴다. 어울리지 않으면 그 상황에 맞는 옷으로 바꾼다.',
    placement,
    look('조사자',investigatorLabel,override,appearance,investigatorSplit.clothing),
    personaShown ? look('플레이어 페르소나',personaLabel,personaOverride,personaAppearance,personaSplit.clothing) : '',
    ...scenes.map((entry) => `[${labels[entry.type]}${entry.speaker ? ` · ${entry.speaker}` : ''}]\n${entry.text}`),
  ].filter(Boolean).join('\n\n');
  if (prompt.length > 7000) throw Error('선택한 장면이 너무 깁니다. 장면 수를 줄여 주세요.');
  return { prompt, sceneIds:scenes.map((entry) => entry.id), appearances };
}

export function pendingCount(state) {
  return state.timeline.filter((entry) => entry.seq > state.through && !['illustration','investigator'].includes(entry.type) && publicEntry(state, entry)).length
    + state.privateLog.filter((entry) => entry.type === 'instruction' && !entry.used).length;
}

export const defaultHistoryLimit = 100;
export function historyLimit(state) {
  const value = Number(state.settings?.historyLimit);
  return Number.isInteger(value) && value >= 1 && value <= 100 ? value : defaultHistoryLimit;
}

export function turnPayload(state, personaId) {
  const source = state.card;
  const card = Object.fromEntries(cardFields.filter((key) => ['string','number'].includes(typeof source[key])).map((key) => [key, textValue(source[key], 12000)]));
  const { name, age, occupation, attributes, skills, hp, mp, san, luck } = sheetFor(state,personaId);
  const read = state.timeline.filter((entry) => !entry.trashedAt && entry.seq <= state.through);
  // How many recent read messages go to the AI word for word; older story comes from the memory library and notes.
  const recent = historyLimit(state);
  const previous = read.slice(-recent).map((entry) => publicEntry(state, entry)).filter(Boolean);
  const pinned = read.slice(0,-recent).filter((entry) => entry.pinnedToContext).slice(-pinnedMessageLimit)
    .map((entry) => ({ ...publicEntry(state,entry), text:textValue(entry.text,4000) }));
  const pending = state.timeline.filter((entry) => entry.seq > state.through && entry.type !== 'illustration').map((entry) => {
    const visible = publicEntry(state,entry);
    return visible && { ...visible, evidence:`turn-${entry.seq}` };
  }).filter(Boolean);
  const instructions = state.privateLog.filter((entry) => entry.type === 'instruction' && !entry.used);
  const handouts = state.handouts.filter((item) => item.public === true).map(({ id, title, description, text, assetId }) => ({ id, title, description, text, assetId, evidence:`handout-${id}` }));
  const remembered = rememberedNoteIds(state);
  const facts = investigatorNotes(state).filter((item) => ['fact','learned','hypothesis'].includes(item.kind) && remembered.has(item.id)).map((item) => ({
    kind:item.kind, text:item.text,
    ...(canReviseNote(item) ? { noteId:item.id } : {}),
    ...(item.keeperEdited ? { keeperEdited:true } : {}),
  }));
  const memories = currentMemoryReference(state)?.entries.map(({ kind, label, text }) => ({ kind, label, text }));
  return { revision:state.seq, instructions:instructions.map(({ id, text }) => ({ id, text })), previous, pinned, pending, handouts, facts, card,
    memories, investigator:{ name, age, occupation, attributes, skills:skills.map(({ name, value }) => ({ name, value })), hp, mp, san, luck } };
}

export function investigatorNotes(state) {
  const character = state.settings.cardId || 'local';
  return state.notes.filter((note) => !note.characterId || note.characterId === character);
}

// The note kinds the keeper chooses for the AI to remember: facts, what the AI learned, hypotheses and session summaries.
export const rememberedNoteKinds = ['fact','learned','hypothesis','summary'];

// How many of the newest notes the AI keeps remembering as more are added (settings.keepNotes), or 0 when each note's own tick decides.
export function keepNotesLimit(state) {
  const limit = state.settings.keepNotes;
  return Number.isSafeInteger(limit) && limit > 0 ? limit : 0;
}

// Ids of the notes the AI sees. With keepNotes set only the newest that many count, however many are added later.
export function rememberedNoteIds(state) {
  const notes = investigatorNotes(state).filter((item) => rememberedNoteKinds.includes(item.kind));
  const limit = keepNotesLimit(state);
  return new Set((limit ? notes.slice(-limit) : notes.filter((item) => !item.aiOff)).map((item) => item.id));
}

const isAiNoteKind = (kind) => kind === 'learned' || kind === 'hypothesis';
const canReviseNote = (note) => Boolean(note.source && !note.keeperEdited && isAiNoteKind(note.kind));

function recordInvestigatorNotes(state, snapshot, response, entry) {
  if (!Array.isArray(response.notes)) return;
  const evidence = new Set([...snapshot.pending,...snapshot.handouts].map((item) => item.evidence).filter(Boolean));
  const revisable = new Set(snapshot.facts.map(({ noteId }) => noteId).filter(Boolean));
  const notes = investigatorNotes(state);
  const noteKey = (kind,text) => `${kind === 'fact' ? 'learned' : kind}:${normalized(textValue(text)).replace(/[.!?。！？]+$/u,'')}`;

  for (const item of response.notes.slice(0,6)) {
    if (!isAiNoteKind(item?.kind) || !evidence.has(item.evidence) || typeof item.text !== 'string') continue;
    const { kind, noteId } = item;
    const text = textValue(item.text,500);
    if (!text) continue;

    const target = revisable.has(noteId) ? notes.find((note) => note.id === noteId && canReviseNote(note)) : null;
    if (noteId != null && !target) continue;
    const key = noteKey(kind,text);
    if (notes.some((note) => noteKey(note.kind,note.text) === key)) continue;

    if (target) {
      (entry.noteRevisions ??= []).push({ id:target.id, kind:target.kind, text:target.text });
      Object.assign(target,{ kind,text });
      revisable.delete(noteId);
    } else {
      const note = { id:uid(), kind, text, source:entry.id, characterId:entry.characterId };
      state.notes.push(note);
      notes.push(note);
    }
  }
}

function notesBeforeTurn(state, entry) {
  const revisions = new Map((entry.noteRevisions ?? []).map(({ id,kind,text }) => [id,{ kind,text }]));
  return state.notes.filter((note) => note.source !== entry.id || note.keeperEdited).map((note) => {
    const earlier = revisions.get(note.id);
    return earlier && !note.keeperEdited ? { ...note,...earlier } : note;
  });
}

function handoutDeliveryIndex(handout, entry) {
  return handout.deliveries?.findLastIndex((delivery) => delivery.entryId ? delivery.entryId === entry.id : delivery.at === entry.at) ?? -1;
}

export function latestRerollableTurn(state) {
  const entry = state.timeline.findLast((item) => item.type === 'investigator');
  if (entry && !entry.trashedAt && entry.seq === state.through && entry.session === state.session &&
      (entry.characterId ?? 'local') === (state.settings.cardId || 'local') && Number.isSafeInteger(entry.previousThrough)) return entry;
  return null;
}

function requireRerollableTurn(state, id) {
  const entry = latestRerollableTurn(state);
  if (!entry || entry.id !== id) throw Error('현재 세션의 마지막 조사자 답변만 리롤할 수 있습니다.');
  return entry;
}

export function rerollTurnState(state, id) {
  const entry = requireRerollableTurn(state,id);
  const instructionIds = new Set(entry.delivered);
  return {
    ...state,
    seq:entry.seq - 1,
    through:entry.previousThrough,
    timeline:state.timeline.filter((item) => item.seq < entry.seq),
    notes:notesBeforeTurn(state,entry),
    privateLog:state.privateLog.filter((item) => instructionIds.has(item.id)).map((item) => ({ ...item,used:false })),
    handouts:state.handouts.filter((item) => handoutDeliveryIndex(item,entry) >= 0),
    // Spots this answer revealed are open again, so the new answer may choose them.
    ...(state.spots ? { spots:state.spots.map((spot) => (spot.revealedBy === entry.id ? { ...spot,revealed:false } : spot)) } : {}),
  };
}

// Models drift from the asked shape in small ways: an extra field, paragraphs sent as a list, the answer
// wrapped in one more object, spots under the name they were given. Those are read as meant; only an
// answer whose text fields are something else entirely is refused, naming the field.
export function normalizeTurnResponse(raw) {
  const isObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
  if (!isObject(raw)) throw Error('조사자 응답 형식을 확인할 수 없습니다 (JSON 객체가 아님). 다시 시도하세요.');
  const textFields = ['action','dialogue','request','hypothesis'];
  const wrapped = !textFields.some((key) => key in raw) && Object.values(raw).find((value) => isObject(value) && ('action' in value || 'dialogue' in value));
  const response = wrapped || raw;
  const result = { notes:response.notes };
  for (const key of textFields) {
    const value = response[key];
    if (value == null) continue;
    if (typeof value === 'string') result[key] = value;
    else if (Array.isArray(value) && value.every((item) => typeof item === 'string')) result[key] = value.join(key === 'request' ? ' ' : '\n\n');
    else throw Error(`조사자 응답 형식을 확인할 수 없습니다 (${key} 칸이 글이 아님). 다시 시도하세요.`);
  }
  const spots = response.spots ?? response.investigatedSpots ?? response.investigationSpots;
  result.spots = typeof spots === 'string' ? [spots] : spots;
  return result;
}

export function acceptTurn(state, snapshot, raw, replaceId) {
  const existing = replaceId ? requireRerollableTurn(state,replaceId) : null;
  const response = normalizeTurnResponse(raw);
  const action = textValue(response.action, 200000);
  const dialogue = textValue(response.dialogue, 200000);
  const combined = [action, dialogue].filter(Boolean).join('\n\n');
  const protectedNames = new Set(['kp','gm','키퍼','narrator','npc', ...state.npcs.map((item) => normalized(item.name)), ...state.timeline.filter((entry) => entry.type === 'npc').map((entry) => normalized(entry.speaker))]);
  if (!combined || combined.split('\n').some((line) => {
    const name = /^[\s>*[\]#]*(.{1,70}?)\s*[:：]/.exec(line)?.[1];
    return name && protectedNames.has(normalized(name.replace(/[*[\]]/g, '')));
  })) throw Error('조사자 외의 화자가 포함되었거나 응답이 비어 있습니다.');
  const turn = { action, dialogue, request:textValue(response.request,1000) };
  const entry = existing ?? append(state, 'investigator', combined, {
    ...turn, speaker:state.sheet.name, characterId:state.settings.cardId || 'local',
    previousThrough:state.through, delivered:snapshot.instructions.map(({ id }) => id),
  });
  if (existing) {
    Object.assign(entry,turn,{ text:textValue(combined,200000) });
    state.notes = notesBeforeTurn(state,entry);
    delete entry.noteRevisions;
  }
  recordInvestigatorNotes(state,snapshot,response,entry);
  const delivered = new Set(snapshot.instructions.map(({ id }) => id));
  for (const item of state.privateLog) {
    if (delivered.has(item.id)) item.used = true;
  }
  state.through = entry.seq;
  for (const handout of state.handouts) {
    const sent = snapshot.handouts.find((item) => item.id === handout.id);
    if (!sent) continue;
    const delivery = { entryId:entry.id, at:entry.at, image:!!sent.imageSent };
    const previous = existing ? handoutDeliveryIndex(handout,entry) : -1;
    if (previous >= 0) handout.deliveries[previous] = delivery;
    else (handout.deliveries ??= []).push(delivery);
  }
  if (existing) audit(state,'마지막 조사자 답변 리롤');
  revealInvestigatedSpots(state,response.spots,entry);
  return entry;
}

const skillProposalTargets = (sheet, keepOccupationPoints = false) => sheet.skills.filter((item) => item.auto && !item.locked)
  .map((item) => ({ id:item.id,name:item.name,value:item.value,min:item.base + (keepOccupationPoints && hasManualOccupationPoints(item) ? item.occupationPoints : 0) }));

export function proposalTargets(state) {
  return [
    ...state.sheet.attributeAuto.filter((key) => Object.hasOwn(ATTR,key)).map((key) => ({ id:key, name:ATTR[key], value:state.sheet.attributes[key], min:1 })),
    ...skillProposalTargets(state.sheet),
  ];
}

const resourceKeys = ['hp','mp','san','luck'];
const validCardValue = (sheet,key,value) => Number.isInteger(value) &&
  (Object.hasOwn(ATTR,key) ? value >= 1 && value <= (sheet.house ? 999 : 99) : value >= 0 && value <= 999);

export function cardAutoTargets(state, personaId) {
  const sheet = sheetFor(state,personaId);
  const { card } = state;
  const attributes = Object.entries(ATTR).filter(([id]) => !validCardValue(sheet,id,card.sheetValues?.[id]))
    .map(([id,name]) => ({ id,name,value:sheet.attributes[id],min:1 }));
  const max = sheet.house ? 999 : 99;
  const growthSkills = new Set(sheet.skills.filter((skill) => skillCategory(skill) === 'growth').map(({ id }) => id));
  const skills = skillProposalTargets(sheet,true).filter((target) => target.min <= max && !growthSkills.has(target.id) &&
    (sheet.house || sheet.finalized || !mythosSkill(target.name)));
  return [...attributes,...skills];
}

export function applyCardSheetValues(state, values = {}, personaId, fixedValues = state.card.sheetValues) {
  const sheet = sheetFor(state,personaId);
  const oldMax = derived(sheet);
  const oldSan = sheet.san;
  const oldStart = { hp:oldMax.hp, mp:oldMax.mp, san:Math.min(oldMax.san,sheet.attributes.POW) };
  let count = 0;
  let changedAttributes = false;
  for (const key of Object.keys(ATTR)) {
    const value = values[key];
    if (!validCardValue(sheet,key,value)) continue;
    if (sheet.attributes[key] !== value) changedAttributes = true;
    sheet.attributes[key] = value;
    count++;
  }
  const max = derived(sheet);
  const start = { hp:max.hp, mp:max.mp, san:Math.min(max.san,sheet.attributes.POW) };
  for (const key of resourceKeys) {
    if (validCardValue(sheet,key,values[key])) {
      sheet[key] = values[key];
      count++;
    } else if (changedAttributes && Object.hasOwn(start,key) && (key !== 'san' || !sheet.finalized) &&
      !validCardValue(sheet,key,fixedValues?.[key]) && sheet[key] === oldStart[key]) {
      sheet[key] = start[key];
    }
  }
  if (!count) return 0;
  capResources(state,personaId);
  if (changedAttributes && !sheet.finalized) sheet.ageApplied = null;
  if (!personaId && state.condition.sanAtStart === oldSan) state.condition.sanAtStart = sheet.san;
  return count;
}

export function evaluateProposal(state, targets, proposals, cardAuto = false, personaId) {
  if (!targets.length || !Array.isArray(proposals) || proposals.length !== targets.length || new Set(proposals.map((item) => item?.id)).size !== targets.length) throw Error('모든 선택 항목의 추천이 한 번씩 필요합니다.');
  const targetSheet = sheetFor(state,personaId);
  const max = targetSheet.house ? 999 : 99;
  const rows = targets.map((target) => {
    const row = proposals.find((item) => item?.id === target.id);
    const reason = textValue(row?.reason, 1000);
    if (!reason) throw Error(`${target.name} 추천 이유가 없습니다.`);
    const value = integer(row.value,target.min,max,target.name);
    return { ...target, proposed:value, reason };
  });
  if (cardAuto) return { rows,issues:[],revision:state.revision,cardAuto };
  const sheet = structuredClone(targetSheet);
  for (const row of rows) {
    if (Object.hasOwn(ATTR,row.id)) sheet.attributes[row.id] = row.proposed;
    else sheet.skills.find((item) => item.id === row.id).value = row.proposed;
  }
  const issues = sheet.finalized ? [] : creationIssues(sheet,false);
  if (!sheet.finalized && !sheet.house && sheet.ageApplied && sheet.ageApplied.signature !== JSON.stringify(sheet.attributes)) {
    issues.push('연령 보정된 능력치와 다른 제안입니다. 생성 초안에서 보정 순서를 확인하세요.');
  }
  return { rows, issues, maxima:derived(sheet), revision:state.revision };
}

export function applyProposal(state, preview, personaId, fixedValues) {
  if (preview.revision !== state.revision) throw Error('시트가 변경되었습니다. 수치 제안을 다시 생성하세요.');
  if (preview.issues.length) throw Error('생성 규칙과 충돌합니다. 기능점과 연령 보정을 확인하거나 하우스 룰을 선택하세요.');
  const sheet = sheetFor(state,personaId);
  if (preview.cardAuto) applyCardSheetValues(state,Object.fromEntries(preview.rows.map((row) => [row.id,row.proposed])),personaId,fixedValues);
  for (const row of preview.rows) {
    if (Object.hasOwn(ATTR,row.id)) {
      if (!preview.cardAuto) sheet.attributes[row.id] = row.proposed;
    } else {
      const skill = sheet.skills.find((item) => item.id === row.id);
      skill.value = Math.min(999,row.proposed + (preview.cardAuto ? skill.growthPoints ?? 0 : 0));
      syncSkillAllocation(skill);
    }
  }
  capResources(state,personaId);
  audit(state,preview.cardAuto ? `${personaId ? '페르소나' : '봇카드'} 기반 능력치·기능치 자동 적용` : '키퍼가 AI 수치 제안을 적용함');
}

const excerpt = (text) => textValue(text).normalize('NFKC').replace(/\s+/g,' ');
const mythosSkill = (name) => ['크툴루신화','cthulhumythos'].includes(normalized(name));

export function applyCardProfile(state, source, targets, response, personaId) {
  if (state.revision !== source.revision) throw Error('시트가 변경되었습니다. 능력치 자동 적용을 다시 실행하세요.');
  if (!Array.isArray(response?.values) || !Array.isArray(response.skills) || response.values.length !== targets.length) {
    throw Error('능력치와 기능 목록 응답을 확인할 수 없습니다.');
  }
  const sheet = sheetFor(state,personaId);
  const preview = targets.length ? evaluateProposal(source,targets,response.values,true,personaId)
    : { revision:source.revision, rows:[], issues:[], cardAuto:true };
  const evidenceText = [...cardFields.filter((key) => key !== 'id').map((key) => source.card[key]),source.card.skillProfile].map(excerpt);
  const hasEvidence = (value) => {
    const quote = excerpt(value);
    return quote.length >= 2 && evidenceText.some((text) => text.includes(quote));
  };
  const seen = new Set();
  const updatedSkills = new Set();
  let added = 0;
  for (const entry of response.skills) {
    if (typeof entry?.name !== 'string' || !['occupation','interest'].includes(entry.category) || !hasEvidence(entry.evidence)) continue;
    const name = textValue(entry.name,80);
    const key = normalized(name);
    if (!key || seen.has(key) || (mythosSkill(name) && !sheet.house && !sheet.finalized)) continue;
    const existing = stat(state,name,personaId);
    let skill = existing?.skill;
    if (existing && (!skill?.auto || skill.locked)) continue;
    const base = skill?.base ?? skillStartingValue(name,sheet) ?? (Number.isInteger(entry.base) && entry.base >= 0 && entry.base <= 99 ? entry.base : 0);
    const keepOccupationPoints = skill && hasManualOccupationPoints(skill);
    const category = skill?.category ?? (keepOccupationPoints ? 'occupation' : skillReference(name)?.category ?? entry.category);
    const minimum = base + (keepOccupationPoints ? skill.occupationPoints : 0);
    if (!Number.isInteger(entry.value) || entry.value < minimum || entry.value > (sheet.house ? 999 : 99)) continue;
    const growthQuote = excerpt(entry.growthEvidence);
    const explicitGrowth = Number.isInteger(entry.growth) && entry.growth >= 0 && entry.growth <= 999 &&
      /성장|향상|증가|growth|improvement|advanc/i.test(growthQuote) &&
      (growthQuote.match(/\d+/g) ?? []).some((part) => Number(part) === entry.growth) && hasEvidence(growthQuote);
    if (category === 'growth' && !explicitGrowth) continue;
    const oldCardGrowth = skill?.cardGrowth ?? 0;
    const growthPoints = Math.max(0,(skill?.growthPoints ?? 0) - oldCardGrowth) + (explicitGrowth ? entry.growth : oldCardGrowth);
    if (entry.value + growthPoints > 999) continue;
    if (!skill) {
      skill = addSkill(state,name,base,false,personaId);
      added++;
    }
    skill.value = entry.value + growthPoints;
    if (explicitGrowth) skill.cardGrowth = entry.growth;
    if (growthPoints || skill.growthPoints !== undefined) skill.growthPoints = growthPoints;
    syncSkillAllocation(skill,category);
    seen.add(key);
    updatedSkills.add(skill.id);
  }
  preview.rows = preview.rows.filter(({ id }) => !updatedSkills.has(id));
  applyProposal(state,preview,personaId,source.card.sheetValues);
  return { count:preview.rows.length + updatedSkills.size, added };
}

export function capResources(state, personaId) {
  const sheet = sheetFor(state,personaId);
  const max = derived(sheet);
  for (const key of ['hp','mp','san']) sheet[key] = Math.max(0, Math.min(max[key], sheet[key]));
}

export function injury(state, rawDamage, armor = 0, random = die) {
  const max = derived(state.sheet).hp;
  const damage = Math.max(0, rawDamage - armor);
  const hp = Math.max(0, state.sheet.hp - damage);
  const major = damage >= Math.ceil(max / 2);
  const condition = state.condition;
  if (damage >= max && damage > 0) condition.dead = true;
  if (major && damage) {
    condition.wound = true;
    if (hp > 0 && !percentile(state.sheet.attributes.CON,'regular',0,random).success) condition.unconscious = true;
  }
  if (hp === 0 && damage) {
    condition.unconscious = true;
    if (condition.wound && !condition.dead) condition.dying = true;
  }
  state.sheet.hp = hp;
  return damage;
}

export function sanity(state, onSuccess, onFailure, random = die) {
  const roll = rollCheck(state, { name:'SAN', difficulty:'regular', modifier:0 }, random);
  const loss = roll.level === 'fumble' ? rollDice(onFailure,'0',(sides) => sides).total
    : rollDice(roll.success ? onSuccess : onFailure,'0',random).total;
  const amount = Math.min(state.sheet.san, Math.max(0, loss));
  state.sheet.san -= amount;
  if (state.sheet.san === 0) state.condition.insanity = '영구적 광기';
  else if (state.condition.sanAtStart - state.sheet.san >= Math.ceil(state.condition.sanAtStart / 5)) {
    if (state.condition.insanity !== '지속적 광기') state.condition.bout = random(10);
    state.condition.insanity = '지속적 광기';
  } else if (amount >= 5) state.condition.pendingIdea = true;
  audit(state, `이성 손실 ${amount} · ${state.sheet.san} 남음`);
  return { roll, amount };
}

export function resolveIdea(state, random = die) {
  if (!state.condition.pendingIdea) throw Error('대기 중인 광기 확인이 없습니다.');
  state.condition.pendingIdea = false;
  const roll = rollCheck(state, { name:'INT', difficulty:'regular', modifier:0 }, random);
  if (roll.success) {
    state.condition.insanity = '일시적 광기';
    state.condition.bout = random(10);
    state.condition.hours = random(10);
  }
  return roll;
}

export function advanceSkill(state, id, personaId) {
  const sheet = sheetFor(state,personaId);
  const skill = sheet.skills.find((item) => item.id === id);
  if (!skill?.experience) throw Error('경험 체크가 없는 기능입니다.');
  const result = growth(skill.value);
  const crossed = skill.value < 90 && result.value >= 90;
  skill.value = result.value;
  if (result.gain) skill.growthPoints = (skill.growthPoints ?? 0) + result.gain;
  skill.experience = false;
  if (crossed) sheet.san = Math.min(derived(sheet).san, sheet.san + rollDice('2d6').total);
  audit(state, `성장 · ${skill.name} · D100 ${result.result} · +${result.gain}`);
  return result;
}
