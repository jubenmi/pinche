import { readFile } from "node:fs/promises";
import { computed, ref } from "vue";

// Exercise the component's real setup code with controlled IO and lifecycle hooks.
export async function loadScriptSetup(url, bindings, exposed) {
  const source = await readFile(url, "utf8");
  const script = source.match(/<script setup>([\s\S]*?)<\/script>/)[1]
    .replace(/^import\s[\s\S]*?;\s*$/gm, "");
  const mounted = [];
  const unmounted = [];
  const context = {
    computed, ref,
    onMounted: (callback) => mounted.push(callback),
    onBeforeUnmount: (callback) => unmounted.push(callback),
    defineProps: () => ({}),
    ...bindings
  };
  const state = new Function(...Object.keys(context), `${script}\nreturn { ${exposed.join(", ")} };`)(
    ...Object.values(context)
  );
  return {
    ...state,
    mount: () => Promise.all(mounted.map((callback) => callback())),
    unmount: () => unmounted.forEach((callback) => callback())
  };
}

export function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
