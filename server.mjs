import { createReadStream } from 'node:fs'
import { access, stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectDir = path.dirname(fileURLToPath(import.meta.url))
const distDir = path.join(projectDir, 'dist')
const indexFile = path.join(distDir, 'index.html')
const port = Number.parseInt(process.env.PORT || '3000', 10)
const host = '0.0.0.0'

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be a valid TCP port number')
}

const mimeTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.ico', 'image/x-icon'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.xml', 'application/xml; charset=utf-8'],
])

function setCommonHeaders(response) {
  response.setHeader('X-Content-Type-Options', 'nosniff')
  response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
}

function sendText(response, status, contentType, body, method) {
  setCommonHeaders(response)
  response.writeHead(status, {
    'Content-Type': contentType,
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  })
  response.end(method === 'HEAD' ? undefined : body)
}

async function sendFile(response, filePath, method, htmlFallback = false) {
  let fileInfo
  try {
    fileInfo = await stat(filePath)
  } catch {
    return false
  }
  if (!fileInfo.isFile()) return false

  const extension = path.extname(filePath).toLowerCase()
  const basename = path.basename(filePath)
  const hashedAsset = /-[A-Za-z0-9_-]{8,}\.[a-z0-9]+$/i.test(basename)
  const cacheControl = extension === '.html' || basename === 'manus-routes.json'
    ? 'no-cache'
    : hashedAsset
      ? 'public, max-age=31536000, immutable'
      : 'public, max-age=3600'

  setCommonHeaders(response)
  response.writeHead(200, {
    'Content-Type': mimeTypes.get(extension) || 'application/octet-stream',
    'Content-Length': fileInfo.size,
    'Cache-Control': cacheControl,
  })
  if (method === 'HEAD') {
    response.end()
    return true
  }

  const stream = createReadStream(filePath)
  stream.on('error', () => response.destroy())
  stream.pipe(response)
  return true
}

const server = createServer(async (request, response) => {
  const method = (request.method || 'GET').toUpperCase()
  if (method !== 'GET' && method !== 'HEAD') {
    response.setHeader('Allow', 'GET, HEAD')
    sendText(response, 405, 'text/plain; charset=utf-8', 'Method Not Allowed', method)
    return
  }

  let url
  try {
    url = new URL(request.url || '/', 'http://localhost')
  } catch {
    sendText(response, 400, 'text/plain; charset=utf-8', 'Bad Request', method)
    return
  }

  if (url.pathname === '/healthz') {
    sendText(response, 200, 'application/json; charset=utf-8', JSON.stringify({ status: 'ok' }), method)
    return
  }

  let decodedPath
  try {
    decodedPath = decodeURIComponent(url.pathname)
  } catch {
    sendText(response, 400, 'text/plain; charset=utf-8', 'Bad Request', method)
    return
  }
  if (decodedPath.includes('\0')) {
    sendText(response, 400, 'text/plain; charset=utf-8', 'Bad Request', method)
    return
  }

  const requestedFile = path.resolve(distDir, `.${decodedPath}`)
  if (requestedFile !== distDir && !requestedFile.startsWith(`${distDir}${path.sep}`)) {
    sendText(response, 403, 'text/plain; charset=utf-8', 'Forbidden', method)
    return
  }

  if (await sendFile(response, requestedFile, method)) return

  const acceptsHtml = (request.headers.accept || '').includes('text/html')
  const reservedPath = decodedPath === '/api' || decodedPath.startsWith('/api/') || decodedPath.startsWith('/assets/')
  if (acceptsHtml && !reservedPath && path.extname(decodedPath) === '' && await sendFile(response, indexFile, method, true)) return

  sendText(response, 404, 'text/plain; charset=utf-8', 'Not Found', method)
})

await access(indexFile)
server.listen(port, host, () => {
  console.log(`Solanero web server listening on ${host}:${port}`)
})
