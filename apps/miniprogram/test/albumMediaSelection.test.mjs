import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import test from 'node:test'

const helperUrl = new URL('../src/utils/albumMediaSelection.js', import.meta.url)

assert.equal(
  existsSync(fileURLToPath(helperUrl)),
  true,
  'album media selection helper must exist',
)

const { classifyAlbumMediaSelection } = await import(helperUrl)

test('returns every image path for a multi-image selection', () => {
  const result = classifyAlbumMediaSelection({
    tempFiles: [
      { fileType: 'image', tempFilePath: ' /tmp/first.jpg ' },
      { fileType: 'image', path: '/tmp/second.jpg' },
    ],
  })

  assert.deepEqual(result, {
    kind: 'images',
    paths: ['/tmp/first.jpg', '/tmp/second.jpg'],
  })
})

test('returns the original file object for a single video selection', () => {
  const file = {
    fileType: 'video',
    tempFilePath: '/tmp/clip.mp4',
    duration: 8,
  }
  const result = classifyAlbumMediaSelection({ tempFiles: [file] })

  assert.deepEqual(result, { kind: 'video', file })
  assert.strictEqual(result.file, file)
})

test('uses the result-level type when a file has no file type', () => {
  const result = classifyAlbumMediaSelection({
    type: 'image',
    tempFiles: [{ tempFilePath: '/tmp/fallback.jpg' }],
  })

  assert.deepEqual(result, {
    kind: 'images',
    paths: ['/tmp/fallback.jpg'],
  })
})

test('rejects a mixed image and video selection', () => {
  const result = classifyAlbumMediaSelection({
    tempFiles: [
      { fileType: 'image', tempFilePath: '/tmp/photo.jpg' },
      { fileType: 'video', tempFilePath: '/tmp/clip.mp4' },
    ],
  })

  assert.deepEqual(result, {
    kind: 'invalid',
    message: '图片可多选，视频请一次只选 1 个',
  })
})

test('rejects a selection containing multiple videos', () => {
  const result = classifyAlbumMediaSelection({
    tempFiles: [
      { fileType: 'video', tempFilePath: '/tmp/first.mp4' },
      { fileType: 'video', tempFilePath: '/tmp/second.mp4' },
    ],
  })

  assert.deepEqual(result, {
    kind: 'invalid',
    message: '图片可多选，视频请一次只选 1 个',
  })
})

test('rejects empty, unknown, or pathless selections', () => {
  const invalidSelections = [
    {},
    {
      tempFiles: [
        { fileType: 'image', tempFilePath: '/tmp/photo.jpg' },
        { fileType: 'document', tempFilePath: '/tmp/file.pdf' },
      ],
    },
    { tempFiles: [{ fileType: 'image', tempFilePath: '   ' }] },
  ]

  for (const selection of invalidSelections) {
    assert.deepEqual(classifyAlbumMediaSelection(selection), {
      kind: 'invalid',
      message: '没有可上传的图片或视频',
    })
  }
})
