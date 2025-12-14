export enum STATS {
  STR = "stat.strength",
  DEX = "stat.dexterity",
  INT = "stat.intelligence",
  LUK = "stat.luck",
  WIS = "stat.wisdom",
}

export interface StatFlat {
  stat: STATS;
  value: number; // always an integer
}

export interface StatMult {
  stat: STATS;
  value: number; // always a float
}
