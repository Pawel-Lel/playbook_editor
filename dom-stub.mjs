// Minimal, purpose-built DOM shim so xmlImport.js's real code can run under
// plain Node for testing. Handles the well-formed, namespace-free,
// CDATA-free XML our own xmlExport.js produces — not a general XML parser.

function decodeEntities(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}
function encodeEntities(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

class NodeBase {
  constructor(nodeType) {
    this.nodeType = nodeType
    this.previousSibling = null
    this.nextSibling = null
    this.parentNode = null
  }
}
class TextNode extends NodeBase {
  constructor(text) { super(3); this._text = text }
  get textContent() { return this._text }
}
class CommentNode extends NodeBase {
  constructor(text) { super(8); this._text = text }
  get textContent() { return this._text }
}
class ElementNode extends NodeBase {
  constructor(tagName) {
    super(1)
    this.tagName = tagName
    this.attrs = {}
    this.childNodes = []
  }
  get children() { return this.childNodes.filter((n) => n.nodeType === 1) }
  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null
  }
  get textContent() {
    return this.childNodes.map((n) => (n.nodeType === 1 || n.nodeType === 3 ? n.textContent : '')).join('')
  }
  appendChild(node) {
    if (this.childNodes.length) {
      const last = this.childNodes[this.childNodes.length - 1]
      last.nextSibling = node
      node.previousSibling = last
    }
    node.parentNode = this
    this.childNodes.push(node)
  }
}

function parseXmlToRoot(xmlText) {
  const xml = xmlText.replace(/^\uFEFF/, '').replace(/<\?xml[^>]*\?>/, '')
  const tokenRe = /<!--[\s\S]*?-->|<\/[a-zA-Z0-9_.:-]+\s*>|<[a-zA-Z0-9_.:-]+(?:\s+[^<>]*?)?\/?>|[^<]+/g
  const tokens = xml.match(tokenRe) || []
  const rootHolder = new ElementNode('#root')
  let current = rootHolder
  const stack = [rootHolder]

  for (const tok of tokens) {
    if (tok.startsWith('<!--')) {
      current.appendChild(new CommentNode(tok.slice(4, -3)))
    } else if (tok.startsWith('</')) {
      stack.pop()
      current = stack[stack.length - 1]
    } else if (tok.startsWith('<')) {
      const selfClosing = /\/>$/.test(tok)
      const inner = tok.slice(1, selfClosing ? -2 : -1).trim()
      const spaceIdx = inner.search(/\s/)
      const tagName = spaceIdx === -1 ? inner : inner.slice(0, spaceIdx)
      const attrsStr = spaceIdx === -1 ? '' : inner.slice(spaceIdx)
      const el = new ElementNode(tagName)
      const attrRe = /([a-zA-Z0-9_.:-]+)\s*=\s*"([^"]*)"/g
      let m
      while ((m = attrRe.exec(attrsStr))) {
        el.attrs[m[1]] = decodeEntities(m[2])
      }
      current.appendChild(el)
      if (!selfClosing) {
        stack.push(el)
        current = el
      }
    } else {
      current.appendChild(new TextNode(decodeEntities(tok)))
    }
  }
  return rootHolder.children[0]
}

class FakeDocument {
  constructor(root) { this.documentElement = root }
  querySelector() { return null } // we never feed it malformed XML in tests
}

globalThis.DOMParser = class {
  parseFromString(text) {
    return new FakeDocument(parseXmlToRoot(text))
  }
}

globalThis.XMLSerializer = class {
  serializeToString(node) {
    if (node.nodeType === 8) return `<!--${node.textContent}-->`
    if (node.nodeType === 3) return encodeEntities(node.textContent)
    if (node.nodeType === 1) {
      const attrs = Object.entries(node.attrs)
        .map(([k, v]) => ` ${k}="${String(v).replace(/"/g, '&quot;')}"`)
        .join('')
      const inner = node.childNodes.map((n) => this.serializeToString(n)).join('')
      return `<${node.tagName}${attrs}>${inner}</${node.tagName}>`
    }
    return ''
  }
}
