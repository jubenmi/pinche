import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildSessionSharePayload,
  resolveSessionShareMode,
  sessionSharePresentation,
} from '../src/utils/sessionShare.js'

test('resolves the share mode from the server lifecycle state', () => {
  assert.equal(resolveSessionShareMode({ has_started: false }), 'join')
  assert.equal(resolveSessionShareMode({ has_started: true }), 'claim')
  assert.equal(resolveSessionShareMode({ start_at: '2000-01-01T00:00:00Z' }), 'claim')
  assert.equal(resolveSessionShareMode({ start_at: '2999-01-01T00:00:00Z' }), 'join')
})

test('does not allow route or source data to override server lifecycle state', () => {
  assert.equal(
    resolveSessionShareMode(
      { has_started: false },
      { route: { source: 'claim' }, source: 'claim' },
    ),
    'join',
  )
  assert.equal(
    resolveSessionShareMode(
      { has_started: true },
      { route: { source: 'join' }, source: 'join' },
    ),
    'claim',
  )
})

test('provides the claim share presentation', () => {
  assert.deepEqual(sessionSharePresentation('claim'), {
    pageTitle: '邀请认领',
    pageIntro: '邀请本局玩家认领照片，选择自己玩过的角色。',
    buttonText: '分享给玩家认领',
    cardTitleSuffix: '照片待认领',
    imageUrl: '/static/art/photo-claim-share.jpg',
  })
})

test('builds the claim share payload with encoded query fields', () => {
  assert.deepEqual(
    buildSessionSharePayload({
      sessionId: 42,
      inviteToken: 'token value',
      shareCode: 's42-1',
      scriptName: '年轮',
      mode: 'claim',
    }),
    {
      title: '《年轮》照片待认领',
      path: '/pages/session/share?id=42&shareCode=s42-1&inviteToken=token%20value&entry=wechat_share&source=claim',
      imageUrl: '/static/art/photo-claim-share.jpg',
    },
  )
})

test('returns null when the session id or invite token is missing', () => {
  assert.equal(
    buildSessionSharePayload({
      sessionId: '',
      inviteToken: 'token',
      mode: 'join',
    }),
    null,
  )
  assert.equal(
    buildSessionSharePayload({
      sessionId: 42,
      inviteToken: ' ',
      mode: 'claim',
    }),
    null,
  )
})
