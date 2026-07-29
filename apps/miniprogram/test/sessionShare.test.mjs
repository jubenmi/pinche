import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { isBusinessDateTimeReached } from '@pinche/shared'

import {
  buildSessionSharePayload,
  resolveSessionShareMode,
  sessionSharePresentation,
} from '../src/utils/sessionShare.js'

const detailPageSource = readFileSync(
  new URL('../src/pages/session/detail.vue', import.meta.url),
  'utf8',
)
const adminWorkspaceSource = readFileSync(
  new URL('../../admin-web/src/components/MiniProgramWorkspace.vue', import.meta.url),
  'utf8',
)

function functionBody(source, signature) {
  const signatureIndex = source.indexOf(signature)
  assert.notEqual(signatureIndex, -1, `missing ${signature}`)
  const openBraceIndex = source.indexOf('{', signatureIndex)
  assert.notEqual(openBraceIndex, -1, `missing body for ${signature}`)
  let depth = 1
  for (let index = openBraceIndex + 1; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1
    if (source[index] === '}') depth -= 1
    if (depth === 0) {
      return source.slice(openBraceIndex + 1, index)
    }
  }
  assert.fail(`unterminated body for ${signature}`)
}

const lifecycleCases = [
  { has_started: true, start_at: '2026-07-28 15:00:01', expected: true },
  { has_started: false, start_at: '2026-07-28 14:59:59', expected: false },
  { start_at: '2026-07-28 15:00:00', expected: true },
  { start_at: '2026-07-28 15:00:01', expected: false },
]
const lifecycleNow = Date.parse('2026-07-28T07:00:00.000Z')
const reachedAtLifecycleNow = (value) => isBusinessDateTimeReached(value, lifecycleNow)

function evaluateDetailAlbumOpen(session) {
  const body = functionBody(detailPageSource, '    isAlbumOpen() {')
  const method = Function(
    'isBusinessDateTimeReached',
    `"use strict"; return function () {${body}}`,
  )(reachedAtLifecycleNow)
  return method.call({ session })
}

function evaluateAdminLifecycleFunction(signature, session) {
  const body = functionBody(adminWorkspaceSource, signature)
  if (signature === 'function isShareSessionStarted()') {
    return Function(
      'isBusinessDateTimeReached',
      'shareSession',
      `"use strict"; return function () {${body}}`,
    )(reachedAtLifecycleNow, { value: session })()
  }
  return Function(
    'isBusinessDateTimeReached',
    `"use strict"; return function (session) {${body}}`,
  )(reachedAtLifecycleNow)(session)
}

function assertAuthoritativeLifecycle(evaluate) {
  for (const session of lifecycleCases) {
    assert.equal(evaluate(session), session.expected)
  }
}

test('resolves the share mode from the server lifecycle state', () => {
  assert.equal(resolveSessionShareMode({ has_started: false }), 'join')
  assert.equal(resolveSessionShareMode({ has_started: true }), 'claim')
  assert.equal(resolveSessionShareMode({ start_at: '2000-01-01T00:00:00Z' }), 'claim')
  assert.equal(resolveSessionShareMode({ start_at: '2999-01-01T00:00:00Z' }), 'join')
})

test('legacy Beijing wall time resolves independently of process timezone', () => {
  const now = Date.parse('2026-07-28T07:00:00.000Z')
  assert.equal(
    resolveSessionShareMode({ status: 'locked', start_at: '2026-07-28 15:00:00' }, now),
    'claim',
  )
  assert.equal(
    resolveSessionShareMode({ status: 'locked', start_at: '2026-07-28 15:00:01' }, now),
    'join',
  )
})

test('detail album lifecycle preserves exact server booleans before fallback parsing', () => {
  assertAuthoritativeLifecycle(evaluateDetailAlbumOpen)
})

test('admin share lifecycle preserves exact server booleans before fallback parsing', () => {
  assertAuthoritativeLifecycle((session) =>
    evaluateAdminLifecycleFunction('function isShareSessionStarted()', session),
  )
})

test('admin album lifecycle preserves exact server booleans before fallback parsing', () => {
  assertAuthoritativeLifecycle((session) =>
    evaluateAdminLifecycleFunction('function isAlbumOpenForSession(session)', session),
  )
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
