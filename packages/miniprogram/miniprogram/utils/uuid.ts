/** RFC 4122 v4。用作 review 的 client_event_id（写队列补发的幂等键，§14.4 第 4 条）。
 *  小程序里没有稳定的 crypto.randomUUID，Math.random 的 122 位熵对「单用户幂等键」足够。 */
export function uuid(): string {
  const hex = '0123456789abcdef';
  let out = '';
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) out += '-';
    else if (i === 14) out += '4';
    else if (i === 19) out += hex[((Math.random() * 4) | 0) + 8] as string;
    else out += hex[(Math.random() * 16) | 0] as string;
  }
  return out;
}
