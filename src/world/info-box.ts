import { PacketAction, PacketFamily, type EoWriter } from 'eolib';
import type { OutgoingPacket } from '../net/packet-bus.ts';
import type { Player } from '../player/player.ts';

export class InfoBoxServerPacket implements OutgoingPacket {
  readonly family = PacketFamily.Message;
  readonly action = PacketAction.Accept;
  title = '';
  content = '';

  serialize(writer: EoWriter): void {
    const previous = writer.stringSanitizationMode;
    writer.stringSanitizationMode = true;
    try {
      writer.addString(this.title);
      writer.addByte(0xff);
      writer.addString(this.content);
    } finally {
      writer.stringSanitizationMode = previous;
    }
  }
}

const GLYPH_WIDTHS: readonly number[] = [
  3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3,
  3, 3, 5, 7, 6, 8, 6, 2, 3, 3, 4, 6, 3, 3, 3, 5, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 3, 3, 6, 6, 6, 6,
  11, 7, 7, 7, 8, 7, 6, 8, 8, 3, 5, 7, 6, 9, 8, 8, 7, 8, 8, 7, 7, 8, 7, 11, 7, 7, 7, 3, 5, 3, 6, 6,
  3, 6, 6, 6, 6, 6, 3, 6, 6, 2, 2, 6, 2, 8, 6, 6, 6, 6, 3, 5, 3, 6, 6, 8, 5, 5, 5, 4, 2, 4, 7, 3,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  3, 3, 6, 6, 6, 6, 2, 6, 3, 9, 4, 6, 6, 3, 8, 6, 4, 6, 3, 3, 3, 6, 6, 3, 3, 3, 4, 6, 8, 8, 8, 6,
  7, 7, 7, 7, 7, 7, 10, 7, 7, 7, 7, 7, 3, 3, 3, 3, 8, 8, 8, 8, 8, 8, 8, 6, 8, 8, 8, 8, 8, 7, 7, 6,
  6, 6, 6, 6, 6, 6, 10, 6, 6, 6, 6, 6, 2, 4, 4, 4, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 5, 6, 5,
];

const INFOBOX_WIDTH = 197;
const SPACE_WIDTH = 3;
const ELLIPSES = '..';

function glyphWidth(char: string): number {
  return GLYPH_WIDTHS[(char.codePointAt(0) ?? 0) & 0xff] ?? 0;
}

export function textWidth(text: string): number {
  let width = 0;
  for (const char of text) width += glyphWidth(char);
  return width;
}

function textCap(text: string, width: number): string {
  if (textWidth(text) <= width) return text;
  const budget = width - textWidth(ELLIPSES);
  let result = '';
  let used = 0;
  for (const char of text) {
    const next = used + glyphWidth(char);
    if (next > budget) break;
    used = next;
    result += char;
  }
  return `${result}${ELLIPSES}`;
}

function splitChunks(line: string): string[] {
  const chunks: string[] = [];
  let chunk = '';
  let leading = false;
  for (const char of line) {
    if (char === ' ') {
      if (chunks.length === 0) leading = true;
      if (leading) {
        chunk += char;
      } else if (chunk.length > 0) {
        chunks.push(chunk + char);
        chunk = '';
      }
      continue;
    }
    if (leading) {
      leading = false;
      chunks.push(chunk);
      chunk = '';
    }
    chunk += char;
  }
  if (chunks.length === 0 && chunk.length === 0) chunk = ' ';
  if (chunk.length > 0) chunks.push(chunk);
  return chunks;
}

export function formatInfoBox(lines: readonly string[]): string {
  let content = '';
  let current = '';
  let currentWidth = 0;
  const flush = (): void => {
    if (current.length === 0) return;
    let spaces = Math.floor((INFOBOX_WIDTH - currentWidth) / SPACE_WIDTH);
    if (current.startsWith(' ')) spaces++;
    content += current + ' '.repeat(Math.max(0, spaces));
    current = '';
    currentWidth = 0;
  };

  for (const line of lines) {
    current = '';
    currentWidth = 0;
    for (const chunk of splitChunks(line)) {
      const width = textWidth(chunk);
      if (currentWidth + width > INFOBOX_WIDTH) {
        flush();
        if (width >= INFOBOX_WIDTH) {
          content += textCap(chunk, INFOBOX_WIDTH);
          continue;
        }
      }
      current += chunk;
      currentWidth += width;
    }
    flush();
  }
  return content;
}

export function showInfoBox(player: Player, title: string, lines: readonly string[]): void {
  const packet = new InfoBoxServerPacket();
  packet.title = title;
  packet.content = formatInfoBox(lines);
  player.bus.send(packet);
}
