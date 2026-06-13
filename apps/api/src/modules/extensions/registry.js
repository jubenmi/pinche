import { sessionPseudoChatExtension } from "./session-pseudo-chat/index.js";

export const sessionExtensions = [sessionPseudoChatExtension];

export async function routeExtensions(context) {
  for (const extension of sessionExtensions) {
    const handled = await extension.route?.(context);
    if (handled) {
      return true;
    }
  }
  return false;
}

export async function runSessionExtensionHook(name, payload) {
  for (const extension of sessionExtensions) {
    const hook = extension.hooks?.[name];
    if (hook) {
      await hook(payload);
    }
  }
}
