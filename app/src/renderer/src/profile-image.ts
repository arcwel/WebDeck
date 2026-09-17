/**
 * The picture the user chose for the profile button.
 *
 * Chromium's own profile avatar is one of its illustrations, and a photo only
 * arrives with a signed-in Google account — which this build cannot have. So
 * WebDeck keeps its own: the user picks any image, it is cropped square and
 * scaled down here in the renderer, and stored as a small PNG data URL in the
 * app settings. Nothing large is written and no file path leaves the page.
 */

/** The stored size. Big enough for a retina 32px button, small as a setting. */
const SIZE = 128

/** Read a chosen image file and return a square PNG data URL, or null. */
export async function squarePngFromFile(file: File): Promise<string | null> {
  if (!file.type.startsWith('image/')) return null
  const url = URL.createObjectURL(file)
  try {
    return await squarePngFromUrl(url)
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** The same crop and resize, from any URL the page can load (a data: URL). */
export async function squarePngFromUrl(url: string): Promise<string | null> {
  try {
    const image = await loadImage(url)
    const canvas = document.createElement('canvas')
    canvas.width = SIZE
    canvas.height = SIZE
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    // Centre crop: a portrait or landscape photo becomes the middle square
    // rather than a squashed one.
    const side = Math.min(image.width, image.height)
    ctx.drawImage(
      image,
      (image.width - side) / 2,
      (image.height - side) / 2,
      side,
      side,
      0,
      0,
      SIZE,
      SIZE
    )
    return canvas.toDataURL('image/png')
  } catch {
    return null
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('not an image this browser can read'))
    image.src = src
  })
}

/** Show the file chooser and return the picked image, already square. */
/**
 * Choose a picture.
 *
 * On the fork the page is `chrome://webdeck`, where `<input type=file>` opens
 * nothing at all — the file chooser is not offered to a WebUI page, so the
 * button did nothing and said nothing. The browser runs the panel instead and
 * hands back the image's bytes (Shell.PickImage); the scaling still happens
 * here, in the renderer, where decoding an unknown image belongs. Off that
 * host the plain input still works.
 */
export async function pickProfileImage(): Promise<string | null> {
  if (typeof window.agweb.pickImage === 'function') {
    const dataUrl = await window.agweb.pickImage()
    return dataUrl ? squarePngFromUrl(dataUrl) : null
  }
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/*'
  const file = await new Promise<File | null>((resolve) => {
    input.onchange = () => resolve(input.files?.[0] ?? null)
    input.oncancel = () => resolve(null)
    input.click()
  })
  return file ? squarePngFromFile(file) : null
}
