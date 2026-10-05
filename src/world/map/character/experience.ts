import { LevelUpStats } from 'eolib';
import type { Character } from '../../../character/character.ts';
import type { GameMap } from '../game-map.ts';
import { broadcastPartyHp } from '../party-hp.ts';

export function giveExperience(map: GameMap, character: Character, amount: number): boolean {
  const { formulas, pubData, config } = map.deps;
  const leveled = character.addExperience(
    amount,
    formulas,
    config.world.statPointsPerLevel,
    config.world.skillPointsPerLevel,
  );
  if (leveled) {
    const hp = character.row.hp;
    const maxHp = character.maxHp;
    character.calculateStats(formulas, pubData, config.combat);
    if (character.row.hp !== hp || character.maxHp !== maxHp) broadcastPartyHp(map, character);
  }
  return leveled;
}

export function levelUpStats(character: Character): LevelUpStats {
  const levelUp = new LevelUpStats();
  levelUp.level = character.row.level;
  levelUp.statPoints = character.row.stat_points;
  levelUp.skillPoints = character.row.skill_points;
  levelUp.maxHp = character.maxHp;
  levelUp.maxTp = character.maxTp;
  levelUp.maxSp = character.maxSp;
  return levelUp;
}
