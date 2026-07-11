export async function runExclusiveAlbumMediaTask({ isBusy, setBusy, task }) {
  if (isBusy()) {
    return false
  }

  setBusy(true)
  try {
    await task()
    return true
  } finally {
    setBusy(false)
  }
}
