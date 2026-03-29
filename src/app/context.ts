export interface AppContext {
  appName: string;
  phase: "scaffold";
}

export function createAppContext(): AppContext {
  return {
    appName: "ralph-research",
    phase: "scaffold",
  };
}
