export const ClientState = {
  Uninitialized: 0,
  Initialized: 1,
  Accepted: 2,
  LoggedIn: 3,
  EnteringGame: 4,
  InGame: 5,
} as const;

export type ClientState = (typeof ClientState)[keyof typeof ClientState];
