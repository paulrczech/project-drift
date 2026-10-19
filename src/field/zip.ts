// A zip with nothing compressed ("stored"): MIDI and WAV hardly compress, and this needs no library.
// The files' bytes are not copied: the zip is a Blob made of the headers and the files themselves.

const TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < data.length; i++) c = TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

export interface ZipFile {
  name: string // UTF-8, with no folders needed
  data: Uint8Array
}

export function zipStored(files: ZipFile[], when = new Date()): Blob {
  // MS-DOS date and time (two-second steps, years from 1980)
  const time = (when.getHours() << 11) | (when.getMinutes() << 5) | (when.getSeconds() >> 1)
  const date = ((Math.max(1980, when.getFullYear()) - 1980) << 9) | ((when.getMonth() + 1) << 5) | when.getDate()
  const text = new TextEncoder()
  const parts: BlobPart[] = []
  const central: Uint8Array[] = []
  let offset = 0

  for (const f of files) {
    const name = text.encode(f.name)
    const crc = crc32(f.data)

    const local = new DataView(new ArrayBuffer(30))
    local.setUint32(0, 0x04034b50, true)
    local.setUint16(4, 20, true) // version needed
    local.setUint16(6, 0x0800, true) // names are UTF-8
    local.setUint16(8, 0, true) // stored
    local.setUint16(10, time, true)
    local.setUint16(12, date, true)
    local.setUint32(14, crc, true)
    local.setUint32(18, f.data.length, true)
    local.setUint32(22, f.data.length, true)
    local.setUint16(26, name.length, true)
    local.setUint16(28, 0, true)
    parts.push(local.buffer, name, f.data as BlobPart)

    const entry = new DataView(new ArrayBuffer(46 + name.length))
    entry.setUint32(0, 0x02014b50, true)
    entry.setUint16(4, 20, true) // version made by
    entry.setUint16(6, 20, true)
    entry.setUint16(8, 0x0800, true)
    entry.setUint16(10, 0, true)
    entry.setUint16(12, time, true)
    entry.setUint16(14, date, true)
    entry.setUint32(16, crc, true)
    entry.setUint32(20, f.data.length, true)
    entry.setUint32(24, f.data.length, true)
    entry.setUint16(28, name.length, true)
    // extra, comment, disk, internal and external attributes: 0
    entry.setUint32(42, offset, true)
    new Uint8Array(entry.buffer).set(name, 46)
    central.push(new Uint8Array(entry.buffer))

    offset += 30 + name.length + f.data.length
  }

  const size = central.reduce((n, c) => n + c.length, 0)
  const end = new DataView(new ArrayBuffer(22))
  end.setUint32(0, 0x06054b50, true)
  end.setUint16(8, files.length, true)
  end.setUint16(10, files.length, true)
  end.setUint32(12, size, true)
  end.setUint32(16, offset, true)
  parts.push(...(central as BlobPart[]), end.buffer)
  return new Blob(parts, { type: 'application/zip' })
}
