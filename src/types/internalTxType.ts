
export interface Sign {
  /** The key of the owner */
  owner: string;
  /** The hash of the object's signature signed by the owner */
  sig: string;
}


export enum InternalTXType {
  SetGlobalCodeBytes = 0, //Deprecated
  InitNetwork = 1,
  NodeReward = 2,   //Deprecated
  ChangeConfig = 3,
  ApplyChangeConfig = 4,
  SetCertTime = 5,
  Stake = 6,
  Unstake = 7,
  InitRewardTimes = 8,
  ClaimReward = 9,
  ChangeNetworkParam = 10,
  ApplyNetworkParam = 11,
  Penalty = 12,
  TransferFromSecureAccount = 13,
}

export enum DebugTXType {
  Create = 0,
  Transfer = 1,
}

