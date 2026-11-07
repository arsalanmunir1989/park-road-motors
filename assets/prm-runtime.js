/* Park Road Motors – tiny template runtime.
   Renders the page template inside <x-dc>, supports {{holes}}, <sc-for>, <sc-if>,
   event attributes (onClick / onChange) and a small component class with
   setState(). No dependencies. */
(function () {
  'use strict';

  class DCLogic {
    constructor(props) { this.props = props || {}; this.state = {}; }
    setState(patch) {
      const p = typeof patch === 'function' ? patch(this.state, this.props) : patch;
      this.state = Object.assign({}, this.state, p);
      schedule();
    }
    forceUpdate() { schedule(); }
  }
  window.DCLogic = DCLogic;

  let comp = null, tpl = null, root = null, queued = false;
  const HOLE = /\{\{\s*([^}]+?)\s*\}\}/g;
  const WHOLE = /^\s*\{\{\s*([^}]+?)\s*\}\}\s*$/;

  function schedule() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; render(); });
  }

  function lookup(path, scope) {
    path = path.trim();
    if (path === 'true') return true;
    if (path === 'false') return false;
    if (path === 'null') return null;
    if (/^-?\d+(\.\d+)?$/.test(path)) return Number(path);
    if (/^'.*'$|^".*"$/.test(path)) return path.slice(1, -1);
    const parts = path.split('.');
    let v;
    for (let i = scope.length - 1; i >= 0; i--) {
      if (scope[i] && Object.prototype.hasOwnProperty.call(scope[i], parts[0])) { v = scope[i][parts[0]]; break; }
    }
    for (let k = 1; k < parts.length && v != null; k++) v = v[parts[k]];
    return v;
  }
  const interp = (str, scope) => str.replace(HOLE, (_, p) => { const v = lookup(p, scope); return v == null ? '' : String(v); });

  function build(node, scope, out) {
    if (node.nodeType === 3) { out.push(document.createTextNode(interp(node.nodeValue, scope))); return; }
    if (node.nodeType !== 1) return;
    const tag = node.localName;
    if (tag === 'sc-for') {
      const list = lookup((node.getAttribute('list').match(WHOLE) || [])[1] || '', scope) || [];
      const as = node.getAttribute('as') || 'item';
      list.forEach((item, i) => {
        const frame = { $index: i }; frame[as] = item;
        node.childNodes.forEach((c) => build(c, scope.concat([frame]), out));
      });
      return;
    }
    if (tag === 'sc-if') {
      const v = lookup((node.getAttribute('value').match(WHOLE) || [])[1] || '', scope);
      if (v) node.childNodes.forEach((c) => build(c, scope, out));
      return;
    }
    const el = node.namespaceURI && node.namespaceURI !== 'http://www.w3.org/1999/xhtml'
      ? document.createElementNS(node.namespaceURI, node.tagName)
      : document.createElement(tag);
    el.__h = {}; el.__p = {};
    for (const a of Array.from(node.attributes)) {
      const name = a.name;
      if (name.startsWith('hint-')) continue;
      const whole = a.value.match(WHOLE);
      if (/^on(click|change|input|submit)$/i.test(name)) {
        const fn = whole ? lookup(whole[1], scope) : null;
        if (typeof fn === 'function') el.__h[name.slice(2).toLowerCase()] = fn;
        continue;
      }
      if (whole && (name === 'checked' || name === 'value')) {
        el.__p[name] = lookup(whole[1], scope);
        continue;
      }
      if (name === 'checked' && !whole) { el.__p.checked = true; }
      el.setAttribute(name, interp(a.value, scope));
    }
    const kids = [];
    (tag === 'template' ? node.content : node).childNodes.forEach((c) => build(c, scope, kids));
    kids.forEach((k) => el.appendChild(k));
    out.push(el);
  }

  function eventName(el, ev) {
    if (ev === 'change' && el.localName === 'input' && !/^(checkbox|radio)$/i.test(el.type)) return 'input';
    return ev;
  }
  function wire(el, handlers) {
    el.__cur = handlers;
    if (!el.__wired) el.__wired = {};
    Object.keys(handlers).forEach((ev) => {
      const name = eventName(el, ev);
      if (el.__wired[name]) return;
      el.__wired[name] = true;
      el.addEventListener(name, (e) => {
        const h = el.__cur && (el.__cur[ev] || el.__cur[name]);
        if (h) h(e);
      });
    });
  }
  function applyProps(el, props) {
    if ('checked' in props) el.checked = !!props.checked;
    if ('value' in props && el.value !== String(props.value ?? '')) el.value = props.value ?? '';
  }

  function sameKind(a, b) {
    return a.nodeType === b.nodeType && (a.nodeType !== 1 || (a.namespaceURI === b.namespaceURI && a.localName === b.localName));
  }
  function patch(parent, fresh) {
    const old = Array.from(parent.childNodes);
    fresh.forEach((n, i) => {
      const o = old[i];
      if (!o) { parent.appendChild(n); if (n.nodeType === 1) hydrate(n); return; }
      if (!sameKind(o, n)) { parent.replaceChild(n, o); if (n.nodeType === 1) hydrate(n); return; }
      if (n.nodeType === 3) { if (o.nodeValue !== n.nodeValue) o.nodeValue = n.nodeValue; return; }
      for (const a of Array.from(o.attributes)) if (!n.hasAttribute(a.name)) o.removeAttribute(a.name);
      for (const a of Array.from(n.attributes)) if (o.getAttribute(a.name) !== a.value) o.setAttribute(a.name, a.value);
      wire(o, n.__h); applyProps(o, n.__p);
      patch(o, Array.from(n.childNodes));
    });
    for (let i = old.length - 1; i >= fresh.length; i--) parent.removeChild(old[i]);
  }
  function hydrate(el) {
    wire(el, el.__h || {}); applyProps(el, el.__p || {});
    Array.from(el.children).forEach(hydrate);
  }

  function render() {
    const vals = comp.renderVals ? comp.renderVals() : {};
    const out = [];
    tpl.content.childNodes.forEach((c) => build(c, [vals], out));
    patch(root, out);
  }

  function boot() {
    const host = document.querySelector('x-dc');
    if (!host) return;
    tpl = document.createElement('template');
    const inner = host.querySelector(':scope > template');
    tpl.innerHTML = inner ? inner.innerHTML : host.innerHTML;
    const helmet = tpl.content.querySelector('helmet');
    if (helmet) { Array.from(helmet.childNodes).forEach((n) => document.head.appendChild(document.importNode(n, true))); helmet.remove(); }
    const script = document.querySelector('script[data-dc-script]');
    const defs = script ? JSON.parse(script.getAttribute('data-props') || '{}') : {};
    const props = {};
    Object.keys(defs).forEach((k) => { if (k[0] !== '$' && defs[k] && 'default' in defs[k]) props[k] = defs[k].default; });
    const Component = script ? new Function('DCLogic', script.textContent + '\n;return Component;')(DCLogic) : class extends DCLogic {};
    root = document.createElement('div');
    root.className = 'dc-root';
    host.replaceWith(root);
    comp = new Component(props);
    render();
    if (comp.componentDidMount) comp.componentDidMount();
    window.addEventListener('beforeunload', () => comp.componentWillUnmount && comp.componentWillUnmount());
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
