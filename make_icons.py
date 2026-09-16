# 파란 바탕에 흰 십자가. 표준 라이브러리만 사용.
import zlib, struct, os

def png(size, path):
    bg, fg = (29, 78, 216), (255, 255, 255)
    rows = []
    for y in range(size):
        row = bytearray([0])
        for x in range(size):
            vert = size * .42 <= x < size * .58 and size * .18 <= y < size * .82
            horz = size * .26 <= x < size * .74 and size * .36 <= y < size * .52
            row += bytes(fg if vert or horz else bg)
        rows.append(bytes(row))
    def chunk(t, d):
        return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    data = (b'\x89PNG\r\n\x1a\n'
            + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(b''.join(rows), 9))
            + chunk(b'IEND', b''))
    with open(path, 'wb') as f:
        f.write(data)

os.makedirs('icons', exist_ok=True)
png(192, 'icons/icon-192.png')
png(512, 'icons/icon-512.png')
print('icons OK')
