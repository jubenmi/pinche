const EMPTY_SELECTION_MESSAGE = '没有可上传的图片或视频'
const MULTIPLE_MEDIA_MESSAGE = '图片可多选，视频请一次只选 1 个'

function invalidSelection(message) {
  return { kind: 'invalid', message }
}

export function classifyAlbumMediaSelection(result = {}) {
  const files = Array.isArray(result?.tempFiles) ? result.tempFiles : []

  if (files.length === 0) {
    return invalidSelection(EMPTY_SELECTION_MESSAGE)
  }

  const media = []

  for (const file of files) {
    const type = file?.fileType ?? file?.type ?? result?.type
    const rawPath = file?.tempFilePath ?? file?.path
    const path = typeof rawPath === 'string' ? rawPath.trim() : ''

    if ((type !== 'image' && type !== 'video') || !path) {
      return invalidSelection(EMPTY_SELECTION_MESSAGE)
    }

    media.push({ file, path, type })
  }

  const videos = media.filter((item) => item.type === 'video')

  if (videos.length > 0) {
    if (videos.length !== 1 || media.length !== 1) {
      return invalidSelection(MULTIPLE_MEDIA_MESSAGE)
    }

    return { kind: 'video', file: videos[0].file }
  }

  return {
    kind: 'images',
    paths: media.map((item) => item.path),
  }
}
