import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import test from 'node:test'

const helperUrl = new URL('../src/utils/albumMediaOperation.js', import.meta.url)

assert.equal(
  existsSync(fileURLToPath(helperUrl)),
  true,
  'album media operation helper must exist',
)

const { runExclusiveAlbumMediaTask } = await import(helperUrl)

test('locks synchronously and rejects reentry until the first task completes', async () => {
  let busy = false
  let releaseFirstTask
  let secondTaskRan = false
  const events = []
  const firstTaskGate = new Promise((resolve) => {
    releaseFirstTask = resolve
  })

  const firstResult = runExclusiveAlbumMediaTask({
    isBusy: () => busy,
    setBusy(value) {
      busy = value
      events.push(`busy:${value}`)
    },
    task: async () => {
      events.push('task:start')
      assert.equal(busy, true)
      await firstTaskGate
      events.push('task:end')
    },
  })

  assert.equal(busy, true)
  assert.deepEqual(events, ['busy:true', 'task:start'])

  const secondResult = await runExclusiveAlbumMediaTask({
    isBusy: () => busy,
    setBusy(value) {
      busy = value
    },
    task: async () => {
      secondTaskRan = true
    },
  })

  assert.equal(secondResult, false)
  assert.equal(secondTaskRan, false)

  releaseFirstTask()

  assert.equal(await firstResult, true)
  assert.equal(busy, false)
  assert.deepEqual(events, ['busy:true', 'task:start', 'task:end', 'busy:false'])
})

test('rethrows task errors and releases the busy state in finally', async () => {
  const expectedError = new Error('video preparation failed')
  const busyTransitions = []
  let busy = false

  const result = runExclusiveAlbumMediaTask({
    isBusy: () => busy,
    setBusy(value) {
      busy = value
      busyTransitions.push(value)
    },
    task: () => {
      assert.equal(busy, true)
      throw expectedError
    },
  })

  await assert.rejects(result, (error) => error === expectedError)
  assert.equal(busy, false)
  assert.deepEqual(busyTransitions, [true, false])
})
