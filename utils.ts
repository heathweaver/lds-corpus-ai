import { createDefine } from "fresh";
import type { TwiglitUser } from "./lib/twiglit/auth.ts";

// Shape of `ctx.state`, shared among middleware, layouts and routes.
export interface State {
  /** The gated Twiglit user, when the Twiglit session gate is active. */
  user?: TwiglitUser | null;
}

export const define = createDefine<State>();
