function resolveProvider(getProvider) {
  if (typeof getProvider !== "function") {
    return null;
  }
  try {
    return getProvider() || null;
  } catch {
    return null;
  }
}

function callMaybe(callback, value) {
  if (typeof callback === "function") {
    callback(value);
  }
}

export function createSafeFeedback({
  getPreferredFeedback = () => null,
  getPlatformFeedback = () => null
} = {}) {
  function invoke(method, options = {}) {
    for (const getProvider of [getPreferredFeedback, getPlatformFeedback]) {
      const provider = resolveProvider(getProvider);
      if (!provider) {
        continue;
      }
      let feedbackMethod;
      try {
        feedbackMethod = provider[method];
      } catch {
        continue;
      }
      if (typeof feedbackMethod === "function") {
        return feedbackMethod.call(provider, options);
      }
    }

    const result = { errMsg: `${method}:fail unavailable` };
    callMaybe(options?.fail, result);
    callMaybe(options?.complete, result);
    return undefined;
  }

  return Object.freeze({
    showActionSheet(options) {
      return invoke("showActionSheet", options);
    },
    showModal(options) {
      return invoke("showModal", options);
    },
    showToast(options) {
      return invoke("showToast", options);
    }
  });
}
