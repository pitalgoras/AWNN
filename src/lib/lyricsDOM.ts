import type { ParsedLine, TagPreviewMode } from './lyricsCore';
import { applyTagToWord, applyTagToSelection } from './lyricsCore';
import { TAG_COLOR_MAP, getContrastColor, getTagLabel } from './utils';

interface ZoneGroup { colorId: string; elements: ParsedLine['elements'] }

function buildVoiceZones(elements: ParsedLine['elements']): ZoneGroup[] {
  const zones: ZoneGroup[] = [];
  let current: ZoneGroup | null = null;

  const flush = () => {
    if (current && current.elements.length > 0) {
      zones.push(current);
      current = null;
    }
  };

  for (const el of elements) {
    if (el.type === 'section-tag' || el.type === 'time-tag') {
      flush();
      zones.push({ colorId: 'none', elements: [el] });
      continue;
    }
    const effectiveColor = el.colorId || 'transparent';
    if (!current) {
      current = { colorId: effectiveColor, elements: [el] };
    } else if (effectiveColor === current.colorId) {
      current.elements.push(el);
    } else {
      flush();
      current = { colorId: effectiveColor, elements: [el] };
    }
  }
  flush();
  return zones;
}

function renderElement(el: ParsedLine['elements'][0], tagPreviewMode: TagPreviewMode): Node {
  if (el.type === 'time-tag') {
    const span = document.createElement('span');
    span.setAttribute('data-raw', el.text);
    span.style.cssText = 'display:none';
    return span;
  }

  if (el.type === 'voice-tag') {
    const span = document.createElement('span');
    span.setAttribute('data-raw', el.text);
    span.contentEditable = 'false';
    const bg = el.colorId || TAG_COLOR_MAP[el.text] || 'transparent';
    if (tagPreviewMode === 'hidden') {
      span.style.cssText = 'display:none';
    } else if (tagPreviewMode === 'chip') {
      const label = getTagLabel(el.text);
      span.textContent = label;
      span.style.cssText = `display:inline-flex;align-items:center;padding:0 6px;border-radius:4px;font-size:11px;font-weight:700;line-height:1.4;cursor:default;background:${bg};color:${getContrastColor(bg)};margin:0 1px;`;
    } else {
      span.textContent = el.text;
      span.style.cssText = `display:inline;cursor:default;color:${bg};`;
    }
    return span;
  }

  if (el.type === 'section-tag') {
    const span = document.createElement('span');
    span.setAttribute('data-raw', el.text);
    span.contentEditable = 'false';
    span.textContent = tagPreviewMode === 'full' ? el.text : el.text.slice(1, -1);
    span.className = 'block section-tag text-[10px] font-bold text-zinc-500 italic tracking-[0.15em] mb-1 mt-2 select-none';
    return span;
  }

  if (el.type === 'word') {
    const span = document.createElement('span');
    span.textContent = el.text;
    const bg = el.colorId || 'transparent';
    if (bg !== 'transparent') {
      span.style.backgroundColor = bg;
      span.style.color = getContrastColor(bg);
    }
    span.className = 'inline-block transition-colors text-sm md:text-base h-[1.5rem] leading-[1.5rem] align-top';
    return span;
  }

  if (el.type === 'space') {
    if (el.colorId && el.colorId !== 'transparent') {
      const span = document.createElement('span');
      span.textContent = el.text;
      span.className = 'inline-block transition-colors h-[1.5rem] leading-[1.5rem] align-top';
      span.style.cssText = `background:${el.colorId};white-space:pre;`;
      return span;
    }
    return document.createTextNode(el.text);
  }

  return document.createTextNode('');
}

export function renderRawToDOM(container: HTMLElement, parsedLines: ParsedLine[], tagPreviewMode: TagPreviewMode): void {
  const frag = document.createDocumentFragment();

  for (const line of parsedLines) {
    if (line.elements.length === 0) {
      const emptyDiv = document.createElement('div');
      emptyDiv.setAttribute('data-line', String(line.id));
      emptyDiv.className = 'w-full leading-[1.5rem] min-h-[1.5rem]';
      frag.appendChild(emptyDiv);
      continue;
    }

    const lineDiv = document.createElement('div');
    lineDiv.setAttribute('data-line', String(line.id));
    lineDiv.className = 'w-full leading-[1.5rem] min-h-[1.5rem]';

    const zones = buildVoiceZones(line.elements);
    let hasContent = false;

    for (const zone of zones) {
      if (zone.colorId === 'none' || zone.colorId === 'transparent') {
        for (const el of zone.elements) {
          lineDiv.appendChild(renderElement(el, tagPreviewMode));
          hasContent = true;
        }
      } else {
        const wrapper = document.createElement('span');
        wrapper.className = 'inline voice-zone';
        wrapper.style.cssText = `background:${zone.colorId};color:${getContrastColor(zone.colorId)};`;
        for (const el of zone.elements) {
          const child = renderElement(el, tagPreviewMode);
          if (child instanceof HTMLElement && child.hasAttribute('data-raw')) {
            child.style.cssText += `;background:${zone.colorId};color:${getContrastColor(zone.colorId)};`;
          }
          wrapper.appendChild(child);
          hasContent = true;
        }
        lineDiv.appendChild(wrapper);
      }
    }

    if (hasContent) frag.appendChild(lineDiv);
  }

  container.innerHTML = '';
  container.appendChild(frag);
}

function serializeNode(node: Node): string {
  let text = '';
  for (const child of node.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      text += child.nodeValue ?? '';
    } else if (child instanceof HTMLElement) {
      if (child.tagName === 'BR') {
        text += '\n';
      } else if (child.hasAttribute('data-raw')) {
        text += child.getAttribute('data-raw') ?? '';
      } else {
        text += serializeNode(child);
      }
    }
  }
  return text;
}

export function serializeEditor(root: HTMLElement): string {
  let text = '';
  let first = true;
  for (const child of root.childNodes) {
    let s = '';
    if (child.nodeType === Node.TEXT_NODE) {
      s = child.nodeValue ?? '';
    } else if (child instanceof HTMLElement) {
      s = serializeNode(child);
    }
    if (s || (child instanceof HTMLElement && child.hasAttribute('data-line'))) {
      if (!first) text += '\n';
      text += s;
      first = false;
    }
  }
  return text;
}

function getNodeSerializedLen(node: Node): number {
  if (node.nodeType === Node.TEXT_NODE) return (node.nodeValue ?? '').length;
  if (node instanceof HTMLElement) {
    if (node.hasAttribute('data-raw')) return (node.getAttribute('data-raw') ?? '').length;
    let sum = 0;
    for (const c of node.childNodes) sum += getNodeSerializedLen(c);
    return sum;
  }
  return 0;
}

export function getSelectedCharRange(root: HTMLElement, expandWords = true): { start: number; end: number } | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;

  const range = sel.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return null;

  const charMap: { node: Node; offset: number; charIndex: number }[] = [];
  let charIndex = 0;
  let seenLine = false;

  const walk = (node: Node) => {
    if (node instanceof HTMLElement && node.hasAttribute('data-line')) {
      if (seenLine) {
        charIndex += 1; // newline between line divs
      }
      seenLine = true;
    }
    if (node.nodeType === Node.TEXT_NODE) {
      const len = node.nodeValue?.length ?? 0;
      if (len > 0) {
        charMap.push({ node, offset: 0, charIndex });
        charIndex += len;
      }
    } else if (node instanceof HTMLElement) {
      if (node.hasAttribute('data-raw')) {
        const raw = node.getAttribute('data-raw')!;
        charMap.push({ node, offset: 0, charIndex });
        charIndex += raw.length;
        return; // don't walk children of tag spans
      }
      for (let i = 0; i < node.childNodes.length; i++) {
        walk(node.childNodes[i]);
      }
    }
  };
  walk(root);

  const anchorNode = range.startContainer;
  const anchorOffset = range.startOffset;
  const focusNode = range.endContainer;
  const focusOffset = range.endOffset;

  let start = 0;
  let end = 0;

  for (const entry of charMap) {
    if (entry.node === anchorNode) {
      if (entry.node.nodeType === Node.TEXT_NODE) {
        start = entry.charIndex + anchorOffset;
      } else if (entry.node instanceof HTMLElement && entry.node.hasAttribute('data-raw')) {
        start = entry.charIndex;
      }
    }
    if (entry.node === focusNode) {
      if (entry.node.nodeType === Node.TEXT_NODE) {
        end = entry.charIndex + focusOffset;
      } else if (entry.node instanceof HTMLElement && entry.node.hasAttribute('data-raw')) {
        end = entry.charIndex + (entry.node.getAttribute('data-raw')!.length);
      }
    }
  }

  // CharMap lookup failed — anchor/focus is a container node (e.g. root on Ctrl+A).
  // Use full serialized text length for non-collapsed selections.
  if (start === 0 && end === 0 && !range.collapsed) {
    const fullText = serializeEditor(root);
    end = fullText.length;
  }

  if (expandWords && start === end) {
    const fullText = serializeEditor(root);
    const textBefore = fullText.slice(0, start);
    const textAfter = fullText.slice(end);
    const wordStart = textBefore.match(/(\S+)\s*$/);
    const wordEnd = textAfter.match(/^(\S+)/);
    if (wordStart) {
      start = Math.max(0, start - wordStart[1].length);
    }
    if (wordEnd) {
      end = end + wordEnd[1].length;
    }
  }

  return { start, end };
}

export function lineTag(lineEl: HTMLElement): string | null {
  const tagSpan = lineEl.querySelector('[data-raw]');
  if (tagSpan instanceof HTMLElement) {
    return tagSpan.getAttribute('data-raw');
  }
  return null;
}

export function setTagOnLine(lineEl: HTMLElement, tagId: string, tagPreviewMode: TagPreviewMode): void {
  const existing = lineEl.querySelector('[data-raw]');
  if (existing instanceof HTMLElement && existing.hasAttribute('data-raw')) {
    existing.setAttribute('data-raw', tagId);
    if (tagPreviewMode === 'chip') {
      const label = getTagLabel(tagId);
      existing.textContent = label;
      const bg = TAG_COLOR_MAP[tagId] || 'transparent';
      (existing as HTMLElement).style.cssText = `display:inline-flex;align-items:center;padding:0 6px;border-radius:4px;font-size:11px;font-weight:700;line-height:1.4;cursor:default;background:${bg};color:${getContrastColor(bg)};margin:0 1px;`;
    } else if (tagPreviewMode === 'full') {
      existing.textContent = tagId;
    }
    return;
  }
  const span = document.createElement('span');
  span.setAttribute('data-raw', tagId);
  span.contentEditable = 'false';
  const bg = TAG_COLOR_MAP[tagId] || 'transparent';
  if (tagPreviewMode === 'hidden') {
    span.style.display = 'none';
  } else if (tagPreviewMode === 'chip') {
    const label = getTagLabel(tagId);
    span.textContent = label;
    span.style.cssText = `display:inline-flex;align-items:center;padding:0 6px;border-radius:4px;font-size:11px;font-weight:700;line-height:1.4;cursor:default;background:${bg};color:${getContrastColor(bg)};margin:0 1px;`;
  } else {
    span.textContent = tagId;
    span.style.cssText = `display:inline;cursor:default;color:${bg};`;
  }
  lineEl.insertBefore(span, lineEl.firstChild);
}

export function isSectionTagNode(root: HTMLElement): boolean {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return false;
  let node: Node | null = sel.anchorNode;
  while (node && node !== root) {
    if (node instanceof HTMLElement && node.classList.contains('section-tag')) return true;
    node = node.parentNode;
  }
  return false;
}

export function findNextWord(raw: string, fromPos: number): { start: number; end: number } | null {
  for (let i = fromPos; i < raw.length; i++) {
    if (raw[i] === '[') {
      const close = raw.indexOf(']', i);
      if (close === -1) break;
      i = close;
      continue;
    }
    if (/\s/.test(raw[i])) continue;
    const start = i;
    while (i < raw.length && /\S/.test(raw[i])) i++;
    return { start, end: i };
  }
  return null;
}

// Module-level editor ref for synchronous paint from TrackBar
let _editorRef: HTMLElement | null = null;
let _pendingPaint = false;

export function setEditorRef(el: HTMLElement | null) { _editorRef = el; }
export function getEditorRef() { return _editorRef; }
export function isPaintPending() { return _pendingPaint; }
export function clearPaintPending() { _pendingPaint = false; }

export function paintAtCursor(
  tagId: string,
  tagColorMap: Record<string, string>
): string | null {
  if (!_editorRef) return null;
  const range = getSelectedCharRange(_editorRef);
  if (!range) {
    _pendingPaint = true;
    return null;
  }
  const currentRaw = serializeEditor(_editorRef);

  if (isSectionTagNode(_editorRef)) {
    const closeBracket = currentRaw.indexOf(']', range.end);
    if (closeBracket === -1) return null;
    const nextWord = findNextWord(currentRaw, closeBracket + 1);
    if (!nextWord) return null;
    return applyTagToWord(currentRaw, nextWord.start, nextWord.end, tagId, tagColorMap);
  }

  if (range.start === range.end) {
    return applyTagToWord(currentRaw, range.start, range.end, tagId, tagColorMap);
  } else {
    return applyTagToSelection(currentRaw, range.start, range.end, tagId, tagColorMap);
  }
}
