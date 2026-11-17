/** ULID：時間排序的不重複 ID（26 個字元） */
const ENC = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function newId(now = Date.now()): string {
  let t = now;
  let time = '';
  for (let i = 0; i < 10; i++) {
    time = ENC[t % 32] + time;
    t = Math.floor(t / 32);
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let rand = '';
  for (let i = 0; i < 16; i++) rand += ENC[bytes[i] % 32];
  return time + rand;
}
