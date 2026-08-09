import { createDefine } from "fresh";

// Shape of `ctx.state`, shared among middleware, layouts and routes.
// The research UI is read-only and unauthenticated for now; kept minimal.
export interface State {
  requestId: string;
}

export const define = createDefine<State>();
