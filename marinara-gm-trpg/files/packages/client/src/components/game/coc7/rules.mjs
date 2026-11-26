/* global crypto */
export const ATTR = { STR:'근력', CON:'건강', SIZ:'크기', DEX:'민첩성', APP:'외모', INT:'지능', POW:'정신력', EDU:'교육' };
export const DIFFICULTY = { regular:'일반', hard:'어려움', extreme:'극단적' };
export const LEVEL = { fumble:'대실패', fail:'실패', regular:'일반 성공', hard:'어려운 성공', extreme:'극단적 성공', critical:'대성공' };
const rank = Object.keys(LEVEL);
export const normalized = (value) => value.normalize('NFKC').toLowerCase().replace(/\s+/g, '');
export const SKILL_CATEGORIES = { occupation:'직업 기능', interest:'개인 관심 기능', growth:'스킬 성장치' };
const referenceSkills = {
  occupation:{ 감정:5, 고고학:1, 관찰력:25, '근접전(격투)':25, 기계수리:10, 도약:20, 듣기:20,
    말재주:5, 매혹:15, 법률:5, 변장:5, '사격(권총)':20, '사격(라/산)':25, 설득:10, 손놀림:10, 수영:20, 승마:5, 심리학:10 },
  interest:{ '언어(모국어)':'EDU', 역사:5, 열쇠공:1, 오르기:20, 오컬트:5, 위협:15, 은밀행동:20, 응급처치:30,
    의료:1, 인류학:1, '자동차 운전':20, 자료조사:20, 자연:10, 재력:0, 전기수리:10, 정신분석:1, '중장비 조작':1, 추적:10 },
  growth:{ '크툴루 신화':0, 투척:20, 항법:10, 회계:5, 회피:'DEX' },
};
const skillAliases = { '격투(권투)':'근접전(격투)', '격투(격투)':'근접전(격투)', '사격(라이플/산탄총)':'사격(라/산)',
  모국어:'언어(모국어)', 의학:'의료', 협박:'위협', cthulhumythos:'크툴루 신화' };
const referenceByName = new Map(Object.entries(referenceSkills).flatMap(([category,skills]) =>
  Object.entries(skills).map(([name,base]) => [normalized(name),{ category,base }])));

export function skillReference(name) {
  const key = normalized(name);
  return referenceByName.get(normalized(Object.hasOwn(skillAliases,key) ? skillAliases[key] : key));
}

// Every printed skill with its starting value for this sheet, in printed order.
export function referenceSkillList(sheet) {
  return Object.entries(referenceSkills).flatMap(([category, skills]) => Object.keys(skills).map((name) => ({ name, category, base:skillStartingValue(name,sheet) })));
}

export function skillStartingValue(name, sheet) {
  const base = skillReference(name)?.base;
  if (base === 'EDU') return Math.min(99,sheet.attributes.EDU);
  if (base === 'DEX') return Math.min(99,Math.floor(sheet.attributes.DEX / 2));
  return base;
}

export const hasManualOccupationPoints = (skill) => !skill.category &&
  skill.occupationPoints > 0 && skill.occupationPoints !== (skill.cardOccupationPoints ?? 0);

export function skillCategory(skill) {
  if (Object.hasOwn(SKILL_CATEGORIES,skill.category)) return skill.category;
  if (hasManualOccupationPoints(skill)) return 'occupation';
  return skillReference(skill.name)?.category ?? (skill.occupation ? 'occupation' : 'interest');
}

export function skillGrowthAmount(skill) {
  const increase = Math.max(0,skill.value - skill.base);
  return skillCategory(skill) === 'growth' ? increase : Math.min(increase,skill.growthPoints ?? 0);
}
export function integer(value, min, max, label) {
  const parsed = typeof value === 'number' ? value : /^-?\d+$/.test(value?.trim?.() ?? '') ? Number(value) : NaN;
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) throw Error(`${label}은(는) ${min}~${max}의 정수여야 합니다.`);
  return parsed;
}

export function die(sides) {
  const word = new Uint32Array(1);
  const limit = Math.floor(2 ** 32 / sides) * sides;
  do { crypto.getRandomValues(word); } while (word[0] >= limit);
  return word[0] % sides + 1;
}

export function damageBonus(total) {
  if (total <= 64) return { build:-2, db:'-2' };
  if (total <= 84) return { build:-1, db:'-1' };
  if (total <= 124) return { build:0, db:'0' };
  if (total <= 164) return { build:1, db:'+1d4' };
  if (total <= 204) return { build:2, db:'+1d6' };
  const dice = 2 + Math.floor((total - 205) / 80);
  return { build:dice + 1, db:`+${dice}d6` };
}

export function derived(sheet) {
  const { STR, CON, SIZ, DEX, POW } = sheet.attributes;
  const { build, db } = damageBonus(STR + SIZ);
  const mov = STR < SIZ && DEX < SIZ ? 7 : STR > SIZ && DEX > SIZ ? 9 : 8;
  const mythos = sheet.skills.find((skill) => normalized(skill.name) === '크툴루신화' || normalized(skill.name) === 'cthulhumythos');
  return { hp:Math.floor((CON + SIZ) / 10), mp:Math.floor(POW / 5), san:Math.max(0, 99 - (mythos?.value ?? 0)), mov:Math.max(0, mov - Math.max(0, Math.floor(sheet.age / 10) - 3)), build, db };
}

export function rollDice(expression, db = '0', random = die) {
  const clean = expression.toLowerCase().replace(/\bdb\b/g, () => db.replace(/^\+/, '')).replace(/\s+/g, '').replace(/\+-/g, '-').replace(/--/g, '+');
  if (!/^[+-]?(?:\d*d\d+|\d+)(?:[+-](?:\d*d\d+|\d+)){0,19}$/.test(clean)) throw Error('주사위 식을 확인하세요. 예: 2d6+1, 1d8+db');
  let diceCount = 0;
  const terms = clean.match(/[+-]?[^+-]+/g).map((term) => {
    const sign = term.startsWith('-') ? -1 : 1;
    const [amount, sidesText] = term.replace(/^[+-]/, '').split('d');
    if (sidesText === undefined) return { sign, value:integer(amount, 0, 9999, '상수') };
    const count = integer(amount || '1', 1, 100, '주사위 개수');
    const sides = integer(sidesText, 2, 1000, '주사위 면');
    diceCount += count;
    if (diceCount > 100) throw Error('한 식에 주사위를 100개까지 사용할 수 있습니다.');
    return { sign, sides, count };
  });
  for (const term of terms) {
    if (term.sides) {
      term.faces = Array.from({ length:term.count }, () => random(term.sides));
      term.value = term.faces.reduce((sum, face) => sum + face, 0);
    }
  }
  return { expression, total:terms.reduce((sum, term) => sum + term.value * term.sign, 0), terms };
}

export function classify(value, result, difficulty = 'regular') {
  integer(value, 0, 999, '판정 기준');
  integer(result, 1, 100, 'D100');
  if (!Object.hasOwn(DIFFICULTY, difficulty)) throw Error('잘못된 난이도입니다.');
  const thresholds = { regular:value, hard:Math.floor(value / 2), extreme:Math.floor(value / 5) };
  const level = result === 1 ? 'critical' : result === 100 || (thresholds[difficulty] < 50 && result >= 96) ? 'fumble'
    : result <= thresholds.extreme ? 'extreme' : result <= thresholds.hard ? 'hard' : result <= value ? 'regular' : 'fail';
  return { level, thresholds, success:rank.indexOf(level) >= rank.indexOf(difficulty) };
}

export function percentile(value, difficulty = 'regular', modifier = 0, random = die) {
  integer(modifier, -2, 2, '보너스/페널티');
  const unit = random(10) % 10;
  const tens = Array.from({ length:1 + Math.abs(modifier) }, () => random(10) % 10);
  const candidates = tens.map((digit) => digit * 10 + unit || 100);
  const result = modifier < 0 ? Math.max(...candidates) : Math.min(...candidates);
  return { value, result, difficulty, modifier, unit, tens, candidates, ...classify(value, result, difficulty) };
}

export function opposed(left, right, tieRule = 'skill') {
  const combat = ['attacker','defender'].includes(tieRule) || tieRule === true;
  if (combat && !left.success && !right.success) return 'neither';
  const difference = rank.indexOf(left.level) - rank.indexOf(right.level);
  if (difference) return difference > 0 ? 'left' : 'right';
  if (tieRule === 'attacker') return 'left';
  if (tieRule === 'defender' || tieRule === true) return 'right';
  return left.value === right.value ? 'tie' : left.value > right.value ? 'left' : 'right';
}

export function spendLuck(roll, amount, balance) {
  integer(amount, 1, balance, '행운 소비');
  if (roll.level === 'fumble' || roll.level === 'critical' || roll.pushed || roll.kind === 'san' || roll.kind === 'luck' || roll.original) throw Error('이 판정에는 행운을 사용할 수 없습니다.');
  const result = roll.result - amount;
  if (result < 2) throw Error('행운으로 대성공을 만들 수 없습니다.');
  return { ...roll, result, ...classify(roll.value, result, roll.difficulty), original:roll.result, luckSpent:amount };
}

export function rolledAttributes(random = die) {
  return Object.fromEntries(Object.keys(ATTR).map((key) => {
    const highStart = ['SIZ','INT','EDU'].includes(key);
    return [key, (random(6) + random(6) + (highStart ? 6 : random(6))) * 5];
  }));
}

export function ageRules(age) {
  integer(age, 15, 89, '나이');
  if (age < 20) return { eduChecks:0, eduLoss:5, physicalLoss:5, physical:['STR','SIZ'], appearanceLoss:0, luckTwice:true };
  if (age < 40) return { eduChecks:1, eduLoss:0, physicalLoss:0, physical:[], appearanceLoss:0, luckTwice:false };
  const decade = Math.floor(age / 10) - 4;
  return { eduChecks:[2,3,4,4,4][decade], eduLoss:0, physicalLoss:[5,10,20,40,80][decade], physical:['STR','CON','DEX'], appearanceLoss:[5,10,15,20,25][decade], luckTwice:false };
}

const skillValueBeforeGrowth = (skill) => skill.value - skillGrowthAmount(skill);
const assignedOccupationPoints = (skill) => {
  if (skillCategory(skill) !== 'occupation') return 0;
  const available = Math.max(0,skillValueBeforeGrowth(skill) - skill.base);
  return hasManualOccupationPoints(skill) ? Math.min(skill.occupationPoints,available) : available;
};

export function creationPointUsage(sheet) {
  const occupation = Object.entries(sheet.occupationFactors).reduce((sum, [key, factor]) => sum + (sheet.attributes[key] ?? 0) * factor, 0);
  const interest = sheet.attributes.INT * 2;
  const totals = { occupation:0, interest:0 };
  for (const skill of sheet.skills) {
    const assigned = assignedOccupationPoints(skill);
    totals.occupation += assigned;
    totals.interest += Math.max(0,skillValueBeforeGrowth(skill) - skill.base - assigned);
  }
  return [['직업 기능점',occupation,totals.occupation],['개인 관심 기능점',interest,totals.interest]]
    .map(([label, budget, used]) => ({ label, budget, used, text:`${label} ${used}/${budget}점 사용`, overBudget:used > budget }));
}

export function creationIssues(sheet, requireAge = true) {
  if (sheet.house) return [];
  const age = ageRules(sheet.age);
  const issues = [];
  if (Object.values(sheet.occupationFactors).reduce((sum, factor) => sum + factor, 0) !== 4) issues.push('직업별 능력치 배수 합은 4여야 합니다.');
  if (Object.values(sheet.attributes).some((value) => value < 1 || value > 99)) issues.push('생성 능력치는 1~99 범위여야 합니다.');
  for (const skill of sheet.skills) {
    if (['크툴루신화','cthulhumythos'].includes(normalized(skill.name)) && skill.value !== 0) issues.push('초기 크툴루 신화는 0이어야 합니다.');
    const startingValue = skillValueBeforeGrowth(skill);
    if (startingValue > 99 || startingValue < skill.base) issues.push(`${skill.name}의 생성 수치가 기본값~99 범위를 벗어났습니다.`);
    if (hasManualOccupationPoints(skill) && assignedOccupationPoints(skill) !== skill.occupationPoints) issues.push(`${skill.name}에 할당한 직업점이 유효하지 않습니다.`);
  }
  // Going over the skill point budget is only shown, never blocks finalizing (Keeper's choice).
  if (requireAge && (!sheet.ageApplied || sheet.ageApplied.age !== sheet.age || sheet.ageApplied.signature !== JSON.stringify(sheet.attributes))) {
    issues.push(`연령 보정 확인 필요 · EDU 향상 ${age.eduChecks}회, EDU −${age.eduLoss}, 신체 −${age.physicalLoss}, APP −${age.appearanceLoss}`);
  }
  return issues;
}

export function applyAge(sheet, losses, random = die) {
  const age = ageRules(sheet.age);
  if (sheet.ageApplied) throw Error('연령 보정은 능력치를 새로 굴린 뒤 다시 적용할 수 있습니다.');
  const next = { ...sheet.attributes };
  let points = 0;
  for (const key of age.physical) {
    const loss = integer(losses[key] ?? 0, 0, next[key] - 1, ATTR[key]);
    next[key] -= loss;
    points += loss;
  }
  if (points !== age.physicalLoss) throw Error(`신체 감소점을 ${age.physicalLoss}점 배분하세요.`);
  next.APP = Math.max(1, next.APP - age.appearanceLoss);
  next.EDU = Math.max(1, next.EDU - age.eduLoss);
  const rolls = [];
  for (let i = 0; i < age.eduChecks; i++) {
    const result = random(100);
    const gain = result > next.EDU ? Math.min(99 - next.EDU, random(10)) : 0;
    next.EDU += gain;
    rolls.push({ result, gain });
  }
  sheet.attributes = next;
  if (age.luckTwice) sheet.luck = Math.max(sheet.luck, (random(6) + random(6) + random(6)) * 5);
  sheet.ageApplied = { age:sheet.age, signature:JSON.stringify(next), rolls };
  return rolls;
}

export function growth(value, random = die) {
  const result = random(100);
  const gain = result > value || result >= 96 ? random(10) : 0;
  return { result, gain, value:value + gain };
}
