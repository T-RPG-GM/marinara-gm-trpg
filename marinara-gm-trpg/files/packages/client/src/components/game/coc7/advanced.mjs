import { audit, append, injury, rollCheck } from './campaign.mjs';
import { derived, die, percentile, rollDice } from './rules.mjs';

export const actionDex = (actor) => actor.dex + (actor.ready ? 50 : 0);
export const chaseMoves = (actor, roster) => 1 + actor.mov - Math.min(...roster.map((participant) => participant.mov));

export function heal(state, kind, random = die) {
  const condition = state.condition;
  const max = derived(state.sheet).hp;
  if (condition.dead) throw Error('조사자가 사망했습니다.');
  const restore = (amount) => {
    state.sheet.hp = Math.min(max,state.sheet.hp + amount);
    if (state.sheet.hp > 0) {
      condition.unconscious = false;
      condition.stabilized = false;
    }
  };
  if (kind === 'natural') {
    if (condition.dying) throw Error('빈사 상태에서 자연 회복할 수 없습니다.');
    if (!condition.wound) {
      restore(1);
      return null;
    }
    const roll = rollCheck(state,{ name:'CON' },random);
    const extreme = ['extreme','critical'].includes(roll.level);
    if (roll.success) restore(rollDice(extreme ? '2d3' : '1d3','0',random).total);
    if (roll.success && (extreme || state.sheet.hp >= Math.ceil(max / 2))) condition.wound = false;
    return roll;
  }
  if (kind === 'aid' && condition.dying) {
    condition.dying = false;
    condition.stabilized = true;
  } else if (condition.dying) throw Error('빈사 상태에는 응급처치가 먼저 필요합니다.');
  else if (kind === 'medicine' && condition.stabilized && state.sheet.hp === 0) audit(state,'안정화 후 의학 성공 · 다음 주 CON 회복 판정');
  else restore(kind === 'aid' ? 1 : random(3));
  return null;
}

export function resolveDying(state, random = die) {
  if (!state.condition.dying || state.condition.dead) throw Error('빈사 상태에서만 판정합니다.');
  const roll = rollCheck(state,{ name:'CON' },random);
  if (!roll.success) {
    state.condition.dead = true;
    state.condition.dying = false;
  }
  return roll;
}

export function attack(state, request, random = die) {
  const { kind, name, difficulty, modifier, opponent, damage, impaling } = request;
  // A picked target from the combat order brings its own armor and takes the damage on its health.
  const target = request.targetId ? state.combat.find((item) => item.id === request.targetId) : null;
  if (request.targetId && !target) throw Error('공격 대상을 찾을 수 없습니다.');
  const armor = target ? target.armor : request.armor;
  const roll = rollCheck(state,{ name, difficulty, modifier,
    ...(kind !== 'firearm' ? { opponent, tieRule:kind === 'dodge' ? 'defender' : 'attacker' } : {}) },random);
  roll.combat = true;
  if (!roll.success) return roll;
  const db = derived(state.sheet).db;
  const extreme = ['extreme','critical'].includes(roll.level);
  const impale = impaling && (kind !== 'firearm' || difficulty !== 'extreme' || roll.level === 'critical');
  const dealt = extreme
    ? rollDice(damage,db,(sides) => sides).total + (impale ? rollDice(damage,'0',random).total : 0)
    : rollDice(damage,db,random).total;
  roll.dealt = Math.max(0,dealt - armor);
  if (target && hasHealth(target)) {
    const before = target.hp;
    target.hp = Math.max(0,target.hp - roll.dealt);
    append(state,'keeper',`${target.name}에게 피해 ${roll.dealt} · 체력 ${before} → ${target.hp}/${target.maxHp}${target.hp === 0 ? ' · 쓰러짐' : ''}`);
  } else append(state,'keeper',`공격 피해 계산 ${roll.dealt} · 키퍼가 결과를 결정합니다.`);
  return roll;
}

const hasHealth = (actor) => Number.isInteger(actor?.maxHp);
const extremeLevel = (level) => level === 'extreme' || level === 'critical';

// The Keeper changes a combatant's health by hand: a positive amount is damage, a negative one healing.
export function changeCombatantHealth(state, id, amount) {
  const target = state.combat.find((item) => item.id === id);
  if (!target) throw Error('전투 참가자를 찾을 수 없습니다.');
  if (!hasHealth(target)) throw Error(`${target.name}의 체력이 정해지지 않았습니다.`);
  target.hp = Math.min(target.maxHp,Math.max(0,target.hp - amount));
  return target;
}

/* An enemy from the combat order attacks the investigator. Dodging or fighting back is an opposed roll with the
   investigator's skill (a tie goes to the dodger, or to the attacker against a fight-back); without a defence the
   enemy only rolls its own skill. A hit damages the investigator (maximum damage on an extreme success); a won
   fight-back damages the enemy with the investigator's weapon, damage bonus included. */
export function enemyAttack(state, request, random = die) {
  const { attackerId, value, defense, defenseSkill, damage, counterDamage = '1d3+db', armor = 0 } = request;
  const attacker = state.combat.find((item) => item.id === attackerId);
  if (!attacker) throw Error('공격하는 참가자를 고르세요.');
  let roll = null;
  let enemy;
  let outcome;
  if (defense === 'none') {
    enemy = percentile(value,'regular',0,random);
    outcome = enemy.success ? 'hit' : 'miss';
  } else {
    roll = rollCheck(state,{ name:defenseSkill, opponent:value, tieRule:defense === 'dodge' ? 'attacker' : 'defender' },random);
    roll.combat = true;
    roll.enemyAttack = attacker.name;
    enemy = roll.opponent;
    outcome = roll.opposed === 'right' ? 'hit' : roll.opposed === 'left' && defense === 'counter' ? 'counter' : 'miss';
  }
  const lines = [`${attacker.name}의 공격 · D100 ${enemy.result} / ${value}%`];
  if (outcome === 'hit') {
    const raw = rollDice(damage,'0',extremeLevel(enemy.level) ? (sides) => sides : random).total;
    const before = state.sheet.hp;
    const dealt = injury(state,raw,armor,random);
    lines.push(`명중 · 조사자 피해 ${dealt} · HP ${before} → ${state.sheet.hp}`);
  } else if (outcome === 'counter') {
    const raw = rollDice(counterDamage,derived(state.sheet).db,extremeLevel(roll.level) ? (sides) => sides : random).total;
    const dealt = Math.max(0,raw - attacker.armor);
    if (hasHealth(attacker)) {
      const before = attacker.hp;
      attacker.hp = Math.max(0,attacker.hp - dealt);
      lines.push(`반격 성공 · ${attacker.name} 피해 ${dealt} · 체력 ${before} → ${attacker.hp}/${attacker.maxHp}${attacker.hp === 0 ? ' · 쓰러짐' : ''}`);
    } else lines.push(`반격 성공 · ${attacker.name} 피해 ${dealt}`);
  } else lines.push(defense === 'dodge' && roll?.opposed === 'left' ? '회피 성공 · 피해 없음' : '빗나감 · 피해 없음');
  append(state,'keeper',lines.join(' · '));
  return { roll, enemy, outcome };
}

export function spendMagic(state, cost, allowOverflow, reason) {
  const deficit = Math.max(0,cost - state.sheet.mp);
  if (deficit && !allowOverflow) throw Error('MP가 부족합니다. 허용되는 주문에 한해 HP 지출을 승인하세요.');
  if (deficit >= state.sheet.hp && deficit) throw Error('HP가 충분하지 않습니다.');
  state.sheet.mp = Math.max(0,state.sheet.mp - cost);
  state.sheet.hp -= deficit;
  audit(state,`마법 비용 · ${reason} · MP ${cost - deficit} / HP ${deficit}`);
}
