const PRESENTATIONS = Object.freeze({
  join: Object.freeze({
    pageTitle: '邀请上车',
    pageIntro: '邀请玩家加入本局，选择一个空位，和大家一起开局。',
    buttonText: '分享拼车邀请',
    cardTitleSuffix: '正在拼车',
    imageUrl: '/static/art/ticket-landscape.jpg',
  }),
  claim: Object.freeze({
    pageTitle: '邀请认领',
    pageIntro: '邀请本局玩家认领照片，选择自己玩过的角色。',
    buttonText: '分享给玩家认领',
    cardTitleSuffix: '照片待认领',
    imageUrl: '/static/art/photo-claim-share.jpg',
  }),
})

export function resolveSessionShareMode(session = {}) {
  if (typeof session.has_started === 'boolean') {
    return session.has_started ? 'claim' : 'join'
  }

  const startAt = Date.parse(session.start_at)
  return Number.isFinite(startAt) && startAt <= Date.now() ? 'claim' : 'join'
}

export function sessionSharePresentation(mode) {
  return PRESENTATIONS[mode === 'claim' ? 'claim' : 'join']
}

export function buildSessionSharePayload({
  sessionId,
  inviteToken,
  shareCode,
  scriptName,
  mode,
} = {}) {
  const normalizedSessionId = String(sessionId ?? '').trim()
  const normalizedInviteToken = String(inviteToken ?? '').trim()

  if (!normalizedSessionId || !normalizedInviteToken) {
    return null
  }

  const normalizedMode = mode === 'claim' ? 'claim' : 'join'
  const presentation = sessionSharePresentation(normalizedMode)
  const query = [
    ['id', normalizedSessionId],
    ['shareCode', String(shareCode ?? '')],
    ['inviteToken', normalizedInviteToken],
    ['entry', 'wechat_share'],
    ['source', normalizedMode],
  ]
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&')

  return Object.freeze({
    title: `《${scriptName || '本局'}》${presentation.cardTitleSuffix}`,
    path: `/pages/session/share?${query}`,
    imageUrl: presentation.imageUrl,
  })
}
