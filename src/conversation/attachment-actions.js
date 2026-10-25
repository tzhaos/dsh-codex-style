/**
 * Attachment action menu.
 *
 * DSH renders attachments in three separate places — the composer's draft rail,
 * message bubbles (including tool results and the trajectory), and the
 * document-level original-image lightbox — and none of them offers a right-click
 * gesture. This feature adds one shared context menu:
 *
 *   - composer draft images/files and durable message images/files;
 *   - image previews opened by the shared `ImageLightbox` primitive;
 *   - gallery thumbnails in messages, tool results and the trajectory.
 *
 * Images can be copied to the clipboard, have their address copied (a data URL
 * for session-local `blob:` previews, the original URL otherwise), be saved as
 * the original bytes, or open the host lightbox. Draft files add "save as" and,
 * when the desktop shell can resolve the browser file back to a host path, copy
 * path / reveal / open with the default application. Composer drafts can also be
 * removed from the rail.
 *
 * The feature only reads the host DOM; it never re-renders or re-parents
 * React-owned nodes. Menus and notices reuse the host `Menu` and `Toast`
 * primitives, so theme tokens, keyboard behavior and animations stay native.
 */
__DSH_FEATURE('dsh-attachment-actions', function (require, env) {
  const React = require('react')
  const primitives = require('@deepseek-ai/dsh-client-ui-primitives')
  const {
    Menu,
    Toast,
    writeClipboard,
    IconCopyOutlineRegular,
    IconLinkOutlineRegular,
    IconDownloadOutlineRegular,
    IconFullscreenOutlineRegular,
    IconFolderOpenRegular,
    IconRightUpOutlineRegular,
    IconTrashOutlineRegular,
    IconWarningOutlineRegular,
    IconCloseOutlineRegular,
  } = primitives
  const { useEffect, useRef, useState } = React
  const h = React.createElement

  /** Locale namespace owned by this feature. */
  const NS = 'attachmentActions'

  const zh = {
    'label.image': '图片',
    'label.file': '附件',
    'menu.copyImage': '复制图片',
    'menu.copyAddress': '复制图片地址',
    'menu.saveImage': '图片另存为…',
    'menu.viewImage': '查看大图',
    'menu.copyFileName': '复制文件名',
    'menu.copyFileInfo': '复制文件名和大小',
    'menu.saveFile': '文件另存为…',
    'menu.copyFilePath': '复制文件路径',
    'menu.revealFile': '在文件夹中显示',
    'menu.openFile': '用默认应用打开',
    'menu.removeAttachment': '移除附件',
    'menu.closePreview': '关闭预览',
    'menu.downloadSession': '下载 Session 日志',
    'toast.imageCopied': '已复制图片',
    'toast.addressCopied': '已复制图片地址',
    'toast.addressData': '已复制图片 Data URL（本地预览没有固定地址）',
    'toast.copyFallback': '无法写入图片剪贴板，已改复制图片地址',
    'toast.nameCopied': '已复制文件名',
    'toast.infoCopied': '已复制文件名和大小',
    'toast.pathCopied': '已复制文件路径',
    'toast.saved': '已开始下载 {name}',
    'toast.sessionExporting': '正在准备 Session 日志…',
    'toast.sessionExported': '已开始下载 Session 日志',
    'toast.revealed': '已在文件夹中显示',
    'toast.opened': '已交给默认应用',
    'toast.removed': '已移除附件',
    'toast.failed': '操作失败：{message}',
  }

  const en = {
    'label.image': 'Image',
    'label.file': 'Attachment',
    'menu.copyImage': 'Copy image',
    'menu.copyAddress': 'Copy image address',
    'menu.saveImage': 'Save image as…',
    'menu.viewImage': 'View image',
    'menu.copyFileName': 'Copy file name',
    'menu.copyFileInfo': 'Copy name and size',
    'menu.saveFile': 'Save file as…',
    'menu.copyFilePath': 'Copy file path',
    'menu.revealFile': 'Show in folder',
    'menu.openFile': 'Open with default app',
    'menu.removeAttachment': 'Remove attachment',
    'menu.closePreview': 'Close preview',
    'menu.downloadSession': 'Download session log',
    'toast.imageCopied': 'Image copied',
    'toast.addressCopied': 'Image address copied',
    'toast.addressData': 'Copied a data URL (local previews have no stable address)',
    'toast.copyFallback': 'Could not write the image clipboard; copied its address instead',
    'toast.nameCopied': 'File name copied',
    'toast.infoCopied': 'Name and size copied',
    'toast.pathCopied': 'File path copied',
    'toast.saved': 'Downloading {name}',
    'toast.sessionExporting': 'Preparing the session log…',
    'toast.sessionExported': 'Session log download started',
    'toast.revealed': 'Shown in folder',
    'toast.opened': 'Opened with the default application',
    'toast.removed': 'Attachment removed',
    'toast.failed': 'Action failed: {message}',
  }

  /** Clipboard images are written as PNG; known media types keep a matching extension. */
  const IMAGE_EXTENSIONS = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/svg+xml': 'svg',
    'image/avif': 'avif',
    'image/bmp': 'bmp',
    'image/x-icon': 'ico',
    'image/tiff': 'tiff',
  }
  /** Longest data URL copied as an image "address" before falling back to the blob URL. */
  const MAX_DATA_URL_BYTES = 4 * 1024 * 1024
  /** Characters Windows/macOS reject in download names. */
  const INVALID_NAME_CHARS = /[\\/:*?"<>|\u0000-\u001f]/g

  /** @param {unknown} value @returns {string} one-line error text. */
  function messageOf(value) {
    if (value instanceof Error) return value.message
    if (typeof value === 'string') return value
    if (value !== null && typeof value === 'object' && typeof value.message === 'string')
      return value.message
    return String(value)
  }

  /** @param {unknown} node @returns {Element|null} the event target element. */
  function elementOf(node) {
    if (node === null || node === undefined) return null
    if (node.nodeType === 3) return node.parentElement ?? null
    if (node.nodeType === 1) return node
    if (typeof node.closest === 'function') return node
    return null
  }

  /** @param {unknown} node @param {string} name @returns {string|null} attribute text. */
  function attributeOf(node, name) {
    try {
      const value = node?.getAttribute?.(name)
      return typeof value === 'string' && value !== '' ? value : null
    } catch {
      return null
    }
  }

  /** @param {unknown} node @returns {string} class attribute text. */
  function classOf(node) {
    const value = node?.className
    return typeof value === 'string' ? value : ''
  }

  /** @param {unknown} node @returns {string} trimmed text content. */
  function textOf(node) {
    const value = node?.textContent
    return typeof value === 'string' ? value.trim() : ''
  }

  /**
   * Find the first descendant whose class carries one of several name fragments.
   * CSS module class names keep their authored suffix but host packages spell
   * some of them camelCase (`fileName`, `fileMeta`), so both spellings are tried.
   * @param {Element|null} root - search root.
   * @param {string[]} fragments - case variants of the authored class suffix.
   * @returns {Element|null} first match.
   */
  function descendantWithClass(root, fragments) {
    if (root === null || root === undefined || typeof root.querySelector !== 'function') return null
    for (const fragment of fragments) {
      const found = root.querySelector('[class*="' + fragment + '"]')
      if (found !== null && found !== undefined) return found
    }
    return null
  }

  /**
   * Rendered URL of one image. `currentSrc` is the resource the browser picked
   * (blob:, data: or absolute http), while the attribute stays the source React
   * wrote — the composer draft map is keyed by that exact string.
   * @param {Element} image - rendered image.
   * @returns {{url: string, rawUrl: string}} resolved and authored URLs.
   */
  function imageSources(image) {
    const rawUrl = attributeOf(image, 'src') ?? ''
    const url = image?.currentSrc || image?.src || rawUrl
    return { url: typeof url === 'string' ? url : rawUrl, rawUrl }
  }

  /**
   * Whether a dialog is the shared original-image lightbox. The primitive keeps
   * the readable class suffixes and renders a stage with a mask, so a host
   * upgrade that changes hashes still matches.
   * @param {Element} dialog - role=dialog element.
   * @returns {boolean} whether this is the image lightbox.
   */
  function isLightboxDialog(dialog) {
    if (classOf(dialog).includes('backdrop')) return true
    if (typeof dialog.querySelector !== 'function') return false
    const stage = dialog.querySelector('[class*="stage"]')
    const mask = dialog.querySelector('[class*="mask"]')
    return stage !== null && mask !== null && dialog.querySelector('img') !== null
  }

  /**
   * Describe the lightbox behind an event target.
   * @param {Element} node - event target element.
   * @returns {object|null} image hit, or null outside the lightbox image.
   */
  function lightboxHit(node) {
    const dialog = node.closest?.('[role="dialog"][aria-modal="true"]')
    if (dialog === null || dialog === undefined) return null
    const image = node.tagName === 'IMG' ? node : node.closest?.('img')
    if (image === null || image === undefined) return null
    if (!isLightboxDialog(dialog)) return null
    const sources = imageSources(image)
    if (sources.url === '') return null
    const close = dialog.querySelector?.('button[class*="close"]') ?? null
    return {
      kind: 'image',
      surface: 'lightbox',
      element: image,
      url: sources.url,
      name: attributeOf(image, 'alt') ?? attributeOf(image, 'title') ?? '',
      close,
    }
  }

  /**
   * Whether a button is the attachment remove control of one rail item.
   * @param {Element} button - candidate button.
   * @returns {boolean} whether it carries the remove role.
   */
  function isRemoveControl(button) {
    if (classOf(button).includes('remove')) return true
    const aria = attributeOf(button, 'aria-label')
    return aria !== null && /remove|移除/i.test(aria)
  }

  /**
   * Find the remove control of one composer rail item.
   * @param {Element|null} container - image item or file card.
   * @returns {Element|null} remove button.
   */
  function removeControlOf(container) {
    if (container === null || container === undefined) return null
    const buttons = [...(container.querySelectorAll?.('button') ?? [])]
    const marked = buttons.find(isRemoveControl)
    if (marked !== undefined) return marked
    // The rail renders the remove control last, after any retry or host action.
    return buttons.length > 0 ? buttons[buttons.length - 1] : null
  }

  /**
   * Describe a composer rail image thumbnail.
   * @param {Element} node - event target element.
   * @param {Element} card - owning composer card.
   * @returns {object|null} image hit, or null.
   */
  function composerImageHit(node, card) {
    const button = node.closest?.('button')
    if (button === null || button === undefined || card.contains(button) !== true) return null
    if (!classOf(button).includes('thumbnail')) return null
    const image = button.querySelector?.('img')
    if (image === null || image === undefined) return null
    const sources = imageSources(image)
    if (sources.url === '') return null
    const item = button.closest?.('[class*="imageItem"]') ?? button.parentElement
    return {
      kind: 'image',
      surface: 'composer',
      element: image,
      opener: button,
      remove: removeControlOf(item),
      url: sources.url,
      rawUrl: sources.rawUrl,
      name: attributeOf(image, 'alt') ?? attributeOf(image, 'title') ?? '',
    }
  }

  /**
   * Describe a composer rail file card.
   * @param {Element} node - event target element.
   * @param {Element} card - owning composer card.
   * @returns {object|null} file hit, or null.
   */
  function composerFileHit(node, card) {
    if (node.closest?.('button') !== null && node.closest?.('button') !== undefined) return null
    const fileCard = node.closest?.('[class*="fileCard"]') ?? node.closest?.('[class*="_card"]') ?? null
    if (fileCard === null || fileCard === card) return null
    if (fileCard.closest?.('[data-composer-card]') !== card) return null
    const name = attributeOf(fileCard, 'title')
    if (name === null) return null
    const meta = textOf(descendantWithClass(fileCard, ['meta', 'Meta']))
    return {
      kind: 'file',
      surface: 'composer',
      element: fileCard,
      remove: removeControlOf(fileCard),
      name: name.trim(),
      meta,
    }
  }

  /**
   * Describe a durable file card inside one message's attachment row.
   * @param {Element} node - event target element.
   * @param {Element} row - `[data-message-attachments]` owner.
   * @returns {object|null} file hit, or null.
   */
  function messageFileHit(node, row) {
    const card = node.closest?.('[class*="fileCard"]')
    if (card !== null && card !== undefined && row.contains(card) === true) {
      const name =
        attributeOf(card, 'title') ?? textOf(descendantWithClass(card, ['name', 'Name']))
      if (name !== null && name.trim() !== '') {
        const meta = textOf(descendantWithClass(card, ['meta', 'Meta']))
        return { kind: 'file', surface: 'message', element: card, name: name.trim(), meta }
      }
    }
    // The card is a span carrying the file name in `title`; keep a titled span
    // only when it is a direct child of the attachment row.
    const titled = node.closest?.('span[title]')
    if (titled !== null && titled !== undefined && titled.parentElement === row) {
      const name = attributeOf(titled, 'title')
      if (name !== null) {
        const meta = textOf(descendantWithClass(titled, ['meta', 'Meta']))
        return { kind: 'file', surface: 'message', element: titled, name: name.trim(), meta }
      }
    }
    return null
  }

  /**
   * Describe a gallery image frame: message images, tool results and the
   * trajectory all render the shared `button[data-variant]` frame.
   * @param {Element} node - event target element.
   * @returns {object|null} image hit, or null.
   */
  function galleryImageHit(node) {
    const frame = node.closest?.('button[data-variant]')
    if (frame === null || frame === undefined) return null
    const image = frame.querySelector?.('img')
    if (image === null || image === undefined) return null
    const sources = imageSources(image)
    if (sources.url === '') return null
    const occurrence = frame.closest?.('[data-message-attachments]')
    return {
      kind: 'image',
      surface: occurrence === null || occurrence === undefined ? 'gallery' : 'message',
      element: image,
      opener: frame,
      url: sources.url,
      rawUrl: sources.rawUrl,
      name: attributeOf(image, 'alt') ?? attributeOf(image, 'title') ?? '',
    }
  }

  /**
   * Describe one queue-dock image thumbnail. Queue rows render plain `<img>`
   * thumbs instead of gallery frames; clicking one is routed to the Host
   * lightbox by the queue feature, so the image itself is the opener.
   * @param {Element} node - event target element.
   * @returns {object|null} image hit, or null.
   */
  function queueImageHit(node) {
    const row = node.closest?.('li')
    const dock = row?.closest?.('[data-queue-dock]')
    if (row === null || row === undefined || dock === null || dock === undefined) return null
    const image = node.tagName === 'IMG' ? node : node.closest?.('img')
    if (image === null || image === undefined || row.contains(image) !== true) return null
    const sources = imageSources(image)
    if (sources.url === '') return null
    return {
      kind: 'image',
      surface: 'queue',
      element: image,
      opener: image,
      url: sources.url,
      rawUrl: sources.rawUrl,
      name: attributeOf(image, 'alt') ?? attributeOf(image, 'title') ?? '',
    }
  }

  /**
   * Describe one queue-dock file chip. The Host renders the file name as the
   * chip's `title` and the size as its meta line.
   * @param {Element} node - event target element.
   * @returns {object|null} file hit, or null.
   */
  function queueFileHit(node) {
    const row = node.closest?.('li')
    const dock = row?.closest?.('[data-queue-dock]')
    if (row === null || row === undefined || dock === null || dock === undefined) return null
    const titled = node.closest?.('[title]')
    if (titled === null || titled === undefined || row.contains(titled) !== true) return null
    if (!classOf(titled).includes('file')) return null
    const name = attributeOf(titled, 'title')
    if (name === null || name.trim() === '') return null
    const meta = textOf(descendantWithClass(titled, ['size', 'Size']))
    return { kind: 'file', surface: 'queue', element: titled, name: name.trim(), meta }
  }

  /**
   * Classify one context-menu target. Only rendered attachment surfaces match;
   * markdown images, plain text and host controls keep their native menu.
   * @param {unknown} target - context-menu event target.
   * @returns {object|null} attachment hit, or null.
   */
  function findSurface(target) {
    const node = elementOf(target)
    if (node === null || typeof node.closest !== 'function') return null
    const lightbox = lightboxHit(node)
    if (lightbox !== null) return lightbox
    const card = node.closest?.('[data-composer-card]')
    if (card !== null && card !== undefined) {
      const image = composerImageHit(node, card)
      if (image !== null) return image
      const file = composerFileHit(node, card)
      if (file !== null) return file
      return null
    }
    const queueDock = node.closest?.('[data-queue-dock]')
    if (queueDock !== null && queueDock !== undefined) {
      const queueImage = queueImageHit(node)
      if (queueImage !== null) return queueImage
      return queueFileHit(node)
    }
    const image = galleryImageHit(node)
    if (image !== null) return image
    const row = node.closest?.('[data-message-attachments]')
    if (row !== null && row !== undefined) return messageFileHit(node, row)
    return null
  }

  /**
   * Resolve the conversation Session under one context-menu target. Returns
   * an empty string for sidebars, editors, the composer card and our own UI.
   * @param {unknown} target - context-menu event target.
   * @returns {string} conversation Session id, or ''.
   */
  function conversationSessionOf(target) {
    const node = elementOf(target)
    if (node === null || typeof node.closest !== 'function') return ''
    if (node.closest('textarea') !== null || node.closest('input') !== null) return ''
    if (node.closest('select') !== null || node.closest('[contenteditable="true"]') !== null) return ''
    if (node.closest('[data-dshaa-menu]') !== null) return ''
    if (node.closest('[data-composer-card]') !== null) return ''
    if (node.closest('[data-queue-dock]') !== null) return ''
    const root = node.closest('[data-conversation-session]')
    const id = root?.getAttribute?.('data-conversation-session') ?? ''
    return typeof id === 'string' ? id : ''
  }

  /**
   * Resolve a browser file back to its host path through the desktop preload.
   * The web build has no such bridge, so path actions stay hidden there.
   * @param {unknown} file - browser File of a draft attachment.
   * @returns {string|undefined} absolute host path.
   */
  function hostPathOf(file) {
    try {
      const bridge = globalThis.__DSH_HOST_PATHS__
      if (bridge === null || typeof bridge !== 'object') return undefined
      if (typeof bridge.pathFor !== 'function') return undefined
      const value = bridge.pathFor(file)
      return typeof value === 'string' && value.trim() !== '' ? value : undefined
    } catch {
      return undefined
    }
  }

  /**
   * Sanitize one download name without changing its extension.
   * @param {string} name - preferred name.
   * @param {string} fallback - localized fallback stem.
   * @returns {string} safe download file name.
   */
  function safeFileName(name, fallback) {
    const raw = typeof name === 'string' ? name.trim() : ''
    const clean = raw.replace(INVALID_NAME_CHARS, '_').replace(/\s+/g, ' ').slice(0, 120)
    if (clean === '' || clean === '.' || clean === '..') {
      return (fallback || 'attachment') + '-' + String(Date.now())
    }
    return clean
  }

  /**
   * Sanitize a download name and append a media-type extension when missing.
   * @param {string} name - preferred name (attachment name or alt text).
   * @param {string} mediaType - blob media type.
   * @param {string} fallback - localized fallback stem.
   * @returns {string} safe image download file name.
   */
  function imageFileName(name, mediaType, fallback) {
    const extension = IMAGE_EXTENSIONS[mediaType] ?? 'png'
    const clean = safeFileName(name, fallback || 'image')
    if (/[.]\w{1,8}$/.test(clean)) return clean
    return clean + '.' + extension
  }

  /**
   * Read one remote/blob URL into a blob.
   * @param {string} url - image URL.
   * @returns {Promise<Blob>} fetched bytes.
   */
  async function fetchBlob(url) {
    if (typeof url !== 'string' || url === '') throw new Error('missing image source')
    const response = await fetch(url)
    if (response?.ok === false) throw new Error('HTTP ' + String(response.status))
    const blob = await response.blob()
    if (blob === null || blob === undefined) throw new Error('empty image response')
    return blob
  }

  /**
   * Encode a blob as a data URL without a FileReader round-trip.
   * @param {Blob} blob - source bytes.
   * @returns {Promise<string>} data URL.
   */
  async function dataUrlOf(blob) {
    const bytes = new Uint8Array(await blob.arrayBuffer())
    let binary = ''
    const chunk = 0x8000
    for (let index = 0; index < bytes.length; index += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(index, index + chunk))
    }
    return 'data:' + (blob.type || 'application/octet-stream') + ';base64,' + btoa(binary)
  }

  /**
   * Normalize one image blob to PNG, which is the only image type Chromium's
   * async clipboard accepts.
   * @param {Blob} blob - source image.
   * @returns {Promise<Blob>} PNG bytes.
   */
  async function pngBlobOf(blob) {
    if (blob.type === 'image/png') return blob
    const source = URL.createObjectURL(blob)
    try {
      const image = new Image()
      image.src = source
      if (typeof image.decode === 'function') await image.decode()
      else
        await new Promise((resolve, reject) => {
          image.onload = resolve
          image.onerror = () => reject(new Error('image decode failed'))
        })
      const width = image.naturalWidth || image.width
      const height = image.naturalHeight || image.height
      if (!width || !height) throw new Error('image has no dimensions')
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const context = canvas.getContext?.('2d')
      if (context === null || context === undefined) throw new Error('canvas unavailable')
      context.drawImage(image, 0, 0)
      return await new Promise((resolve, reject) => {
        canvas.toBlob(
          (value) => {
            if (value === null || value === undefined) reject(new Error('PNG encode failed'))
            else resolve(value)
          },
          'image/png',
        )
      })
    } finally {
      URL.revokeObjectURL(source)
    }
  }

  /** @param {unknown} value @returns {boolean} whether the value is a browser File-like blob. */
  function isBlobLike(value) {
    return (
      value !== null &&
      value !== undefined &&
      typeof value === 'object' &&
      typeof value.arrayBuffer === 'function' &&
      typeof value.type === 'string'
    )
  }

  /**
   * Trigger a browser download for an owned blob and release the object URL.
   * @param {Blob} blob - bytes to save.
   * @param {string} name - download name.
   */
  function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = name
    anchor.rel = 'noopener'
    anchor.style.display = 'none'
    document.body.append(anchor)
    try {
      anchor.click()
    } finally {
      anchor.remove?.()
      setTimeout(() => URL.revokeObjectURL(url), 10000)
    }
  }

  /**
   * Copy one clipboard text and fail loudly when the host refuses it.
   * @param {string} text - text to copy.
   * @returns {Promise<void>} settles after the clipboard accepts the text.
   */
  async function copyText(text) {
    const copied = await writeClipboard(text)
    if (copied === false) throw new Error('clipboard unavailable')
  }

  /**
   * Menu descriptor for one attachment hit. Entries are ordered by cost: the
   * copy actions first, then preview/save, then desktop path actions, then the
   * destructive controls.
   * @param {object} hit - resolved attachment hit.
   * @param {Function} t - feature translator.
   * @returns {object[]} host Menu items.
   */
  function menuItems(hit, t) {
    const label =
      typeof hit.name === 'string' && hit.name.trim() !== ''
        ? hit.name.trim()
        : t(hit.kind === 'image' ? 'label.image' : 'label.file')
    const items = [{ type: 'label', id: 'attachment', text: label }]
    const icon = (type) => h(type, { size: 14 })
    if (hit.kind === 'image') {
      items.push({ id: 'copy-image', label: t('menu.copyImage'), icon: icon(IconCopyOutlineRegular) })
      items.push({
        id: 'copy-address',
        label: t('menu.copyAddress'),
        icon: icon(IconLinkOutlineRegular),
      })
      items.push({
        id: 'save-image',
        label: t('menu.saveImage'),
        icon: icon(IconDownloadOutlineRegular),
      })
      if (hit.opener !== undefined && hit.opener !== null) {
        items.push({
          id: 'view-image',
          label: t('menu.viewImage'),
          icon: icon(IconFullscreenOutlineRegular),
        })
      }
      if (hit.path !== undefined) {
        items.push({ type: 'separator', id: 'separator-path' })
        items.push({
          id: 'copy-path',
          label: t('menu.copyFilePath'),
          icon: icon(IconCopyOutlineRegular),
        })
        items.push({
          id: 'reveal-file',
          label: t('menu.revealFile'),
          icon: icon(IconFolderOpenRegular),
        })
      }
      if (hit.surface === 'composer' && hit.remove !== null && hit.remove !== undefined) {
        items.push({ type: 'separator', id: 'separator-remove' })
        items.push({
          id: 'remove-attachment',
          label: t('menu.removeAttachment'),
          icon: icon(IconTrashOutlineRegular),
        })
      }
      if (hit.surface === 'lightbox' && hit.close !== null && hit.close !== undefined) {
        items.push({ type: 'separator', id: 'separator-close' })
        items.push({
          id: 'close-preview',
          label: t('menu.closePreview'),
          icon: icon(IconCloseOutlineRegular),
        })
      }
      return items
    }
    items.push({
      id: 'copy-name',
      label: t('menu.copyFileName'),
      icon: icon(IconCopyOutlineRegular),
    })
    if (
      (hit.surface === 'message' || hit.surface === 'queue') &&
      typeof hit.meta === 'string' &&
      hit.meta.trim() !== ''
    ) {
      items.push({
        id: 'copy-info',
        label: t('menu.copyFileInfo'),
        icon: icon(IconCopyOutlineRegular),
      })
    }
    if (hit.file !== undefined && hit.file !== null) {
      items.push({ id: 'save-file', label: t('menu.saveFile'), icon: icon(IconDownloadOutlineRegular) })
    }
    if (hit.path !== undefined) {
      items.push({ type: 'separator', id: 'separator-path' })
      items.push({ id: 'copy-path', label: t('menu.copyFilePath'), icon: icon(IconCopyOutlineRegular) })
      items.push({ id: 'reveal-file', label: t('menu.revealFile'), icon: icon(IconFolderOpenRegular) })
      items.push({ id: 'open-file', label: t('menu.openFile'), icon: icon(IconRightUpOutlineRegular) })
    }
    if (hit.surface === 'composer' && hit.remove !== null && hit.remove !== undefined) {
      items.push({ type: 'separator', id: 'separator-remove' })
      items.push({
        id: 'remove-attachment',
        label: t('menu.removeAttachment'),
        icon: icon(IconTrashOutlineRegular),
      })
    }
    return items
  }

  /**
   * One attachment context menu plus its transient host toast.
   * @param {object} props - injected actions and feature translator.
   * @returns {object|null} the open menu and notice portal.
   */
  function AttachmentMenu({ actions, t }) {
    const [menu, setMenu] = useState(null)
    const [notice, setNotice] = useState(null)
    const noticeId = useRef(0)

    /** @param {string} text - localized notice. @param {boolean} [failure] - error tone. */
    const report = (text, failure = false) => {
      noticeId.current += 1
      setNotice({ id: noticeId.current, text, failure })
    }

    useEffect(() => {
      if (typeof document === 'undefined' || typeof document.addEventListener !== 'function')
        return undefined
      const onContextMenu = (event) => {
        const hit = findSurface(event.target)
        const sessionId = hit === null ? conversationSessionOf(event.target) : ''
        if (hit === null && sessionId === '') return
        event.preventDefault?.()
        event.stopPropagation?.()
        event.stopImmediatePropagation?.()
        let point = { x: event.clientX ?? 0, y: event.clientY ?? 0 }
        if (
          typeof point.x !== 'number' ||
          typeof point.y !== 'number' ||
          (point.x === 0 && point.y === 0)
        ) {
          const rect = (hit?.element ?? event.target)?.getBoundingClientRect?.()
          point = rect === undefined || rect === null ? point : { x: rect.left, y: rect.bottom }
        }
        setNotice(null)
        setMenu({ point, hit: hit === null ? null : actions.describe(hit), sessionId })
      }
      document.addEventListener('contextmenu', onContextMenu, true)
      return () => {
        document.removeEventListener('contextmenu', onContextMenu, true)
      }
    }, [actions])

    /**
     * One transient host toast. It must survive the menu closing, because every
     * action result is reported after the selected item already dismissed it.
     * @returns {object|null} toast element.
     */
    const renderToast = () =>
      notice === null
        ? null
        : h(Toast, {
            key: 'dshaa-toast-' + String(notice.id),
            text: notice.text,
            ...(notice.failure
              ? { icon: h(IconWarningOutlineRegular, { size: 16 }) }
              : { tone: 'success' }),
            onDone: () => setNotice(null),
          })

    if (menu === null) return renderToast()

    const hit = menu.hit
    const rect = {
      left: menu.point.x,
      top: menu.point.y,
      right: menu.point.x,
      bottom: menu.point.y,
      width: 0,
      height: 0,
      x: menu.point.x,
      y: menu.point.y,
      toJSON() {
        return this
      },
    }
    const fallbackName = hit === null ? '' : t(hit.kind === 'image' ? 'label.image' : 'label.file')
    const notify = (text, failure = false) => {
      report(text, failure)
    }
    const run = (id, current) => {
      const fail = (error) => notify(t('toast.failed', { message: messageOf(error) }), true)
      if (id === 'download-session') {
        notify(t('toast.sessionExporting'))
        Promise.resolve(actions.downloadSession(menu.sessionId)).then(
          () => notify(t('toast.sessionExported')),
          fail,
        )
        return
      }
      if (id === 'copy-image') {
        Promise.resolve()
          .then(() => actions.copyImage(current))
          .then(
            () => notify(t('toast.imageCopied')),
            () =>
              Promise.resolve()
                .then(() => actions.copyAddress(current))
                .then(
                  (kind) =>
                    notify(kind === 'data' ? t('toast.addressData') : t('toast.copyFallback')),
                  (error) => fail(error),
                ),
          )
        return
      }
      if (id === 'copy-address') {
        Promise.resolve(actions.copyAddress(current)).then(
          (kind) => notify(kind === 'data' ? t('toast.addressData') : t('toast.addressCopied')),
          fail,
        )
        return
      }
      if (id === 'save-image') {
        Promise.resolve(actions.saveImage(current, fallbackName)).then(
          (name) => notify(t('toast.saved', { name })),
          fail,
        )
        return
      }
      if (id === 'save-file') {
        Promise.resolve(actions.saveFile(current, fallbackName)).then(
          (name) => notify(t('toast.saved', { name })),
          fail,
        )
        return
      }
      if (id === 'view-image') {
        current.opener?.click?.()
        return
      }
      if (id === 'close-preview') {
        current.close?.click?.()
        return
      }
      if (id === 'remove-attachment') {
        current.remove?.click?.()
        notify(t('toast.removed'))
        return
      }
      if (id === 'copy-name') {
        Promise.resolve(actions.copyName(current)).then(
          () => notify(t('toast.nameCopied')),
          fail,
        )
        return
      }
      if (id === 'copy-info') {
        Promise.resolve(actions.copyInfo(current)).then(
          () => notify(t('toast.infoCopied')),
          fail,
        )
        return
      }
      if (id === 'copy-path') {
        Promise.resolve(actions.copyPath(current)).then(
          () => notify(t('toast.pathCopied')),
          fail,
        )
        return
      }
      if (id === 'reveal-file') {
        Promise.resolve(actions.reveal(current)).then(
          () => notify(t('toast.revealed')),
          fail,
        )
        return
      }
      if (id === 'open-file') {
        Promise.resolve(actions.open(current)).then(
          () => notify(t('toast.opened')),
          fail,
        )
      }
    }

    const items = hit === null
      ? [{ id: 'download-session', label: t('menu.downloadSession'), icon: h(IconDownloadOutlineRegular, { size: 14 }) }]
      : menuItems(hit, t)
    const toast = renderToast()
    if (items.length === 0) return toast
    return h(
      React.Fragment,
      null,
      h(Menu, {
        key: 'dshaa-menu',
        open: true,
        onClose: () => {
          setMenu(null)
        },
        portal: true,
        align: 'start',
        side: 'bottom',
        anchor: h('span', { className: 'dshaa-anchor' }),
        getAnchorRect: () => rect,
        items,
        onSelect: (id) => {
          const current = menu.hit
          setMenu(null)
          try {
            run(id, current)
          } catch (error) {
            report(t('toast.failed', { message: messageOf(error) }), true)
          }
        },
      }),
      toast,
    )
  }

  /** Presentation only: the invisible Menu anchor. */
  const CSS = `
.dshaa-anchor {
  display: none;
}
`

  /**
   * Register the attachment context menu and the actions it calls.
   * @param {object} ctx - Client root context.
   */
  function apply(ctx) {
    const sessions = ctx.get('sessions')
    const remote = ctx.get('remote')
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'attachment-actions: dictionaries')
    ctx.effect(() => {
      if (typeof document === 'undefined' || typeof document.createElement !== 'function')
        return () => {}
      const style = document.createElement('style')
      style.dataset.dshPlugin = 'dsh-attachment-actions'
      style.textContent = CSS
      document.head.appendChild(style)
      return () => {
        style.remove?.()
      }
    }, 'attachment-actions: styles')

    /**
     * Resolve the draft attachment behind one composer hit so the menu can save
     * original bytes and, on desktop, resolve the host path. Navigation that no
     * longer retains the session simply yields undefined.
     * @param {object} hit - composer attachment hit.
     * @returns {object} hit plus `file` and `path` when available.
     */
    function describe(hit) {
      if (hit.surface !== 'composer') return hit
      try {
        const occurrence = hit.element?.closest?.('[data-conversation-session]')
        const sessionId = attributeOf(occurrence, 'data-conversation-session')
        if (sessionId === null) return hit
        const actx = sessions?.scope?.(sessionId)
        if (actx === undefined || actx === null) return hit
        const conversation = actx.get?.('conversation')
        const shell = conversation?.input?.for?.(actx)
        const ids = shell?.snapshot?.attachmentIds
        if (!Array.isArray(ids)) return hit
        const drafts = conversation.resolveDraftAttachments?.(ids) ?? []
        let draft
        for (const candidate of drafts) {
          if (hit.kind === 'file' && candidate.kind === 'file' && candidate.file?.name === hit.name) {
            draft = candidate
            break
          }
          if (
            hit.kind === 'image' &&
            candidate.kind === 'image' &&
            (candidate.previewUrl === hit.url || candidate.previewUrl === hit.rawUrl)
          ) {
            draft = candidate
            break
          }
        }
        if (draft === undefined) return hit
        const path = hostPathOf(draft.file)
        return { ...hit, file: draft.file, ...(path === undefined ? {} : { path }) }
      } catch {
        return hit
      }
    }

    /** @param {object} hit - resolved image hit. @returns {Promise<Blob>} image bytes. */
    async function imageBlobOf(hit) {
      if (isBlobLike(hit.file) && hit.file.type.startsWith('image/')) return hit.file
      return await fetchBlob(hit.url)
    }

    /**
     * Copy one attachment image to the clipboard as PNG.
     * @param {object} hit - resolved image hit.
     * @returns {Promise<void>} settles after the clipboard accepts the image.
     */
    async function copyImage(hit) {
      const png = await pngBlobOf(await imageBlobOf(hit))
      const clipboard = globalThis.navigator?.clipboard
      if (typeof globalThis.ClipboardItem !== 'function' || typeof clipboard?.write !== 'function') {
        throw new Error('image clipboard unavailable')
      }
      await clipboard.write([new globalThis.ClipboardItem({ 'image/png': png })])
    }

    /**
     * Copy one image address. Session-local blob previews become data URLs so the
     * copied text still resolves elsewhere; larger images keep their blob URL.
     * @param {object} hit - resolved image hit.
     * @returns {Promise<'url'|'data'>} which form was copied.
     */
    async function copyAddress(hit) {
      const url = typeof hit.url === 'string' ? hit.url : ''
      if (url === '') throw new Error('missing image source')
      if (!/^blob:/i.test(url)) {
        await copyText(url)
        return 'url'
      }
      const blob = await imageBlobOf(hit)
      if (blob.size > MAX_DATA_URL_BYTES) {
        await copyText(url)
        return 'url'
      }
      await copyText(await dataUrlOf(blob))
      return 'data'
    }

    /**
     * Save one image with its original bytes and a readable name.
     * @param {object} hit - resolved image hit.
     * @param {string} fallback - localized fallback name stem.
     * @returns {Promise<string>} the download name.
     */
    async function saveImage(hit, fallback) {
      const blob = await imageBlobOf(hit)
      const name = imageFileName(hit.name, blob.type, fallback)
      downloadBlob(blob, name)
      return name
    }

    /**
     * Save one composer draft file.
     * @param {object} hit - resolved file hit.
     * @param {string} fallback - localized fallback name stem.
     * @returns {Promise<string>} the download name.
     */
    async function saveFile(hit, fallback) {
      if (!isBlobLike(hit.file)) throw new Error('file bytes unavailable')
      const name = safeFileName(hit.file.name, fallback || 'attachment')
      downloadBlob(hit.file, name)
      return name
    }

    /**
     * Copy the name of one attachment.
     * @param {object} hit - resolved attachment hit.
     * @returns {Promise<void>} settles after the clipboard accepts the text.
     */
    async function copyName(hit) {
      const name = typeof hit.name === 'string' ? hit.name.trim() : ''
      if (name === '') throw new Error('missing file name')
      await copyText(name)
    }

    /**
     * Copy one file descriptor as "name (size)" text.
     * @param {object} hit - resolved file hit.
     * @returns {Promise<void>} settles after the clipboard accepts the text.
     */
    async function copyInfo(hit) {
      const name = typeof hit.name === 'string' ? hit.name.trim() : ''
      if (name === '') throw new Error('missing file name')
      const meta = typeof hit.meta === 'string' ? hit.meta.trim() : ''
      await copyText(meta === '' ? name : name + ' (' + meta + ')')
    }

    /**
     * Copy the resolved host path of one draft attachment.
     * @param {object} hit - resolved attachment hit.
     * @returns {Promise<void>} settles after the clipboard accepts the path.
     */
    async function copyPath(hit) {
      if (typeof hit.path !== 'string' || hit.path === '') throw new Error('missing file path')
      await copyText(hit.path)
    }

    /**
     * Ask the Host to show one absolute path in the OS file manager.
     * @param {object} hit - resolved attachment hit.
     * @returns {Promise<void>} settles after the Host accepts the gesture.
     */
    async function reveal(hit) {
      if (typeof hit.path !== 'string' || hit.path === '') throw new Error('missing file path')
      const result = await remote.session.openWorkspacePath({ path: hit.path, action: 'reveal' })
      if (result !== null && typeof result === 'object' && result.ok === false) {
        throw new Error(result.error?.message ?? result.error?.code ?? 'reveal failed')
      }
    }

    /**
     * Ask the Host to open one absolute path with its default application.
     * @param {object} hit - resolved attachment hit.
     * @returns {Promise<void>} settles after the Host accepts the gesture.
     */
    async function open(hit) {
      if (typeof hit.path !== 'string' || hit.path === '') throw new Error('missing file path')
      const result = await remote.session.openWorkspacePath({ path: hit.path })
      if (result !== null && typeof result === 'object' && result.ok === false) {
        throw new Error(result.error?.message ?? result.error?.code ?? 'open failed')
      }
    }

    /**
     * Download one conversation Session archive through the Host route.
     * @param {string} sessionId - active conversation Session id.
     * @returns {Promise<void>} settles after the browser starts the download.
     */
    async function downloadSession(sessionId) {
      if (typeof sessionId !== 'string' || sessionId === '') throw new Error('missing session id')
      const route = '/api/session.export?' + new URLSearchParams({
        sessionId,
        includeDescendants: 'true',
      }).toString()
      const response = await fetch(route, { method: 'HEAD' })
      if (response.ok !== true) {
        const detail = await response.text().catch(() => '')
        throw new Error('Export failed: HTTP ' + String(response.status) + (detail === '' ? '' : ' ' + detail))
      }
      const safe = sessionId.replace(/[^0-9A-Za-z._-]/g, '_')
      const anchor = document.createElement('a')
      anchor.href = route
      anchor.download = 'dsh-session-' + safe + '.zip'
      document.body.append(anchor)
      anchor.click()
      anchor.remove()
    }

    const actions = {
      describe,
      downloadSession,
      copyImage,
      copyAddress,
      saveImage,
      saveFile,
      copyName,
      copyInfo,
      copyPath,
      reveal,
      open,
    }

    ctx.slots.inject('shell.overlay', () =>
      ctx.slots.register(
        {
          name: 'shell.overlay',
          id: 'attachment-actions.menu',
          locale: NS,
          inject: () => ({ actions }),
        },
        AttachmentMenu,
      ),
    )
  }

  return {
    /** Services this Client plugin waits for before applying. */
    inject: ['slots', 'locale', 'sessions', 'remote', 'remote.session'],
    apply,
    __test: { findSurface, conversationSessionOf, menuItems, imageFileName, isLightboxDialog, hostPathOf },
  }
})
