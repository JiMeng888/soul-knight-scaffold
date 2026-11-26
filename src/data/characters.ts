/** 角色配置表。原作里几十个角色的差异全部落在这种表里。 */

export interface CharacterData {
  id: string;
  name: string;
  hp: number;
  armor: number;
  energy: number;
  /** 暴击率 0~1 */
  crit: number;
  speed: number;
  startWeapon: string;
  color: string;
  skillName: string;
}

export const CHARACTERS: Record<string, CharacterData> = {
  // P1：能量池收紧（原 200/180/260）。8 局实测战斗中能量条 97.6% 时间贴满，
  // 大缓冲 + 满地补给球让能量从不是决策变量。缩池后「持续开火会打下去、
  // 清房间隙才回满」形成节奏；回能维持 9.5 作为不熄火的安全地板，不碰消耗端。
  knight: {
    id: 'knight', name: '骑士', hp: 7, armor: 6, energy: 110,
    crit: 0.05, speed: 1, startWeapon: 'pistol', color: '#f0c98a', skillName: '火力全开',
  },
  ranger: {
    id: 'ranger', name: '游侠', hp: 6, armor: 4, energy: 100,
    crit: 0.2, speed: 1.12, startWeapon: 'smg', color: '#8fd6a0', skillName: '翻滚强化',
  },
  wizard: {
    id: 'wizard', name: '法师', hp: 5, armor: 5, energy: 145,
    crit: 0.1, speed: 0.95, startWeapon: 'railgun', color: '#a99cf0', skillName: '奥术闪电',
  },
};

export const CHARACTER_IDS = Object.keys(CHARACTERS);
export const getCharacter = (id: string): CharacterData => CHARACTERS[id] ?? CHARACTERS.knight;
