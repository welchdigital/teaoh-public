import type { Formulas } from '../../../data/formulas.ts';

export interface HitRoll {
  minDamage: number;
  maxDamage: number;
  critical: boolean;
  accuracy: number;
  targetArmor: number;
  targetEvade: number;
  targetSitting: boolean;
  targetHp: number;
}

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

export function rollHit(formulas: Formulas, roll: HitRoll): number {
  const targetHp = Math.max(0, Math.trunc(finiteOrZero(roll.targetHp)));
  const minDamage = Math.max(0, Math.trunc(finiteOrZero(roll.minDamage)));
  const maxDamage = Math.max(0, Math.trunc(finiteOrZero(roll.maxDamage)));
  const low = Math.min(minDamage, maxDamage);
  const high = Math.max(minDamage, maxDamage);
  const rawDamage = low + Math.floor(Math.random() * (high - low + 1));
  const vars = {
    critical: roll.critical ? 1 : 0,
    damage: rawDamage,
    target_armor: finiteOrZero(roll.targetArmor),
    target_sitting: roll.targetSitting ? 1 : 0,
    accuracy: finiteOrZero(roll.accuracy),
    target_evade: finiteOrZero(roll.targetEvade),
  };
  const hitRate = formulas.eval('hit_rate', vars, 0.8);
  let damage = 0;
  if (Math.random() < hitRate) {
    damage = Math.max(0, Math.floor(formulas.eval('damage', vars, rawDamage)));
  }
  return Math.min(finiteOrZero(damage), targetHp);
}
