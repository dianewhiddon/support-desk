/** Validate the ZIP directory and local entries without inflating user content.
 * This rejects macros, traversal, encryption, ZIP64 and ambiguous archives.
 * It is structural validation, not a malware scanner. */
export function validOffice(bytes, extension) {
  const main = { docx: 'word/document.xml', xlsx: 'xl/workbook.xml', pptx: 'ppt/presentation.xml' }[
    extension
  ];
  if (!main || bytes.length < 22) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  const floor = Math.max(0, end - 65535);
  while (end >= floor && view.getUint32(end, true) !== 0x06054b50) end--;
  if (end < floor || end + 22 + view.getUint16(end + 20, true) !== bytes.length) return false;
  if (view.getUint16(end + 4, true) || view.getUint16(end + 6, true)) return false;
  const count = view.getUint16(end + 10, true);
  if (!count || count === 65535 || count !== view.getUint16(end + 8, true)) return false;
  const directorySize = view.getUint32(end + 12, true);
  const directory = view.getUint32(end + 16, true);
  if (directory + directorySize !== end) return false;
  const names = new Set();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let offset = directory;
  let inflated = 0;
  try {
    for (let i = 0; i < count; i++) {
      if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50) return false;
      const flags = view.getUint16(offset + 8, true);
      const method = view.getUint16(offset + 10, true);
      const packed = view.getUint32(offset + 20, true);
      inflated += view.getUint32(offset + 24, true);
      const length = view.getUint16(offset + 28, true);
      const next =
        offset + 46 + length + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
      if (next > end || flags & 1 || ![0, 8].includes(method) || inflated > 100 * 1024 * 1024) return false;
      const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + length));
      const normalized = name.toLowerCase();
      if (
        !name ||
        /[\x00-\x1f\\]/.test(name) ||
        name.startsWith('/') ||
        name.split('/').includes('..') ||
        names.has(normalized) ||
        /vbaproject|\.bin$|activex\//i.test(name)
      )
        return false;
      const local = view.getUint32(offset + 42, true);
      if (local + 30 > directory || view.getUint32(local, true) !== 0x04034b50) return false;
      const localLength = view.getUint16(local + 26, true);
      const dataStart = local + 30 + localLength + view.getUint16(local + 28, true);
      if (
        dataStart + packed > directory ||
        view.getUint16(local + 6, true) !== flags ||
        view.getUint16(local + 8, true) !== method ||
        decoder.decode(bytes.subarray(local + 30, local + 30 + localLength)) !== name
      )
        return false;
      names.add(normalized);
      offset = next;
    }
  } catch {
    return false;
  }
  return offset === end && names.has('[content_types].xml') && names.has(main);
}
