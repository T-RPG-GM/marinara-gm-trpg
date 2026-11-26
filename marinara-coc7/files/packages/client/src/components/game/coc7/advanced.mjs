import { audit, append, rollCheck } from './campaign.mjs';
import { derived, die, rollDice } from './rules.mjs';

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
  const { kind, name, difficulty, modifier, opponent, damage, armor, impaling } = request;
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
  append(state,'keeper',`공격 피해 계산 ${Math.max(0,dealt - armor)} · 키퍼가 결과를 결정합니다.`);
  return roll;
}

export function spendMagic(state, cost, allowOverflow, reason) {
  const deficit = Math.max(0,cost - state.sheet.mp);
  if (deficit && !allowOverflow) throw Error('MP가 부족합니다. 허용되는 주문에 한해 HP 지출을 승인하세요.');
  if (deficit >= state.sheet.hp && deficit) throw Error('HP가 충분하지 않습니다.');
  state.sheet.mp = Math.max(0,state.sheet.mp - cost);
  state.sheet.hp -= deficit;
  audit(state,`마법 비용 · ${reason} · MP ${cost - deficit} / HP ${deficit}`);
}
