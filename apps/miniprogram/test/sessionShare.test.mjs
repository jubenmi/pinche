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
  const presentation = sessionSharePresentation('claim')
  assert.deepEqual(presentation, {
    pageTitle: '邀请认领',
    pageIntro: '邀请本局玩家认领照片，选择自己玩过的角色。',
    buttonText: '分享给玩家认领',
    cardTitleSuffix: '照片待认领',
    imageUrl: '/static/art/photo-claim-share.jpg',
  })
  assert.equal(Object.isFrozen(presentation), true)
})

test('provides the join share presentation and falls back to it for unknown modes', () => {
  const presentation = sessionSharePresentation('join')
  assert.deepEqual(presentation, {
    pageTitle: '邀请上车',
    pageIntro: '邀请玩家加入本局，选择一个空位，和大家一起开局。',
    buttonText: '分享拼车邀请',
    cardTitleSuffix: '正在拼车',
    imageUrl: '/static/art/ticket-landscape.jpg',
  })
  assert.equal(sessionSharePresentation('unexpected'), presentation)
  assert.equal(Object.isFrozen(presentation), true)
})

test('builds the claim share payload with encoded query fields', () => {
  const payload = buildSessionSharePayload({
    sessionId: 42,
    inviteToken: 'token value',
    shareCode: 's42-1',
    scriptName: '年轮',
    mode: 'claim',
  })
  assert.deepEqual(payload, {
    title: '《年轮》照片待认领',
    path: '/pages/session/share?id=42&shareCode=s42-1&inviteToken=token%20value&entry=wechat_share&source=claim',
    imageUrl: '/static/art/photo-claim-share.jpg',
  })
  assert.equal(Object.isFrozen(payload), true)
})

test('builds the join share payload and falls back to join for unknown modes', () => {
  const expected = {
    title: '《年轮》正在拼车',
    path: '/pages/session/share?id=42&shareCode=s42-2&inviteToken=token&entry=wechat_share&source=join',
    imageUrl: '/static/art/ticket-landscape.jpg',
  }
  assert.deepEqual(
    buildSessionSharePayload({
      sessionId: 42,
      inviteToken: 'token',
      shareCode: 's42-2',
      scriptName: '年轮',
      mode: 'join',
    }),
    expected,
  )
  assert.deepEqual(
    buildSessionSharePayload({
      sessionId: 42,
      inviteToken: 'token',
      shareCode: 's42-2',
      scriptName: '年轮',
      mode: 'unexpected',
    }),
    expected,
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

test('fails closed for null sessions and invalid or missing fallback dates', () => {
  assert.equal(resolveSessionShareMode(null), 'join')
  assert.equal(resolveSessionShareMode({}), 'join')
  assert.equal(resolveSessionShareMode({ start_at: 'not-a-date' }), 'join')
})

test('keeps an exact server lifecycle value authoritative over fallback dates', () => {
  assert.equal(
    resolveSessionShareMode({
      has_started: false,
      start_at: '2000-01-01T00:00:00Z',
    }),
    'join',
  )
  assert.equal(
    resolveSessionShareMode({
      has_started: true,
      start_at: '2999-01-01T00:00:00Z',
    }),
    'claim',
  )
})
