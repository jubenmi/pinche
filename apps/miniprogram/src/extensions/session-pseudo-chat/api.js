export function chatApi({ dataOf, request }) {
  return {
    async loadChat(sessionId) {
      const response = await request({ url: `/api/sessions/${sessionId}/chat` });
      return dataOf(response) || {};
    },
    async sendMessage(sessionId, content) {
      const response = await request({
        url: `/api/sessions/${sessionId}/messages`,
        method: "POST",
        data: { content }
      });
      return dataOf(response);
    },
    async updatePinnedMessage(sessionId, pinnedMessageText) {
      const response = await request({
        url: `/api/sessions/${sessionId}/chat/pin`,
        method: "PATCH",
        data: { pinnedMessageText }
      });
      return dataOf(response) || {};
    }
  };
}
