// 小程序码。给 §5.9 L4 的成果海报用，网关端点是 `POST /wx/wxacode`
// （`packages/gateway/wx_blueprint.py`，那边的四个坑都写在注释里了）。
//
// 为什么要绕一圈存成本地文件：canvas 2d 的 `drawImage` 只吃 `canvas.createImage()`，
// 而它的 `src` **不接受 data: URI**（基础库跨版本行为不一致，真机上多半是静默不画）。
// 所以拿到 base64 之后必须 `writeFile` 落到 USER_DATA_PATH，再把文件路径喂给它。
//
// scene 的两条硬规矩（服务端也会再校验一次，这里先挡是为了少打一次接口）：
//   · **最长 32 个可见字符**
//   · 字符集白名单：数字、大小写字母，加 `!#$&'()*+,/:;=?@-._~` ——
//     中文、空格、`%`、`{}` 全部非法。§14.4 的归因参数要按这个拼，别用 JSON。

import * as gw from './gateway';
import * as store from './storage';

/** 与服务端 `WXACODE_SCENE_CHARS` 同源。改一处必须改两处。 */
const SCENE_RE = /^[0-9A-Za-z!#$&'()*+,/:;=?@\-._~]{1,32}$/;

export function isValidScene(scene: string): boolean {
  return SCENE_RE.test(scene);
}

/**
 * 拼一个合法 scene。**不做 encodeURIComponent** —— 百分号本身就不在白名单里，
 * 编码只会让它更长更非法。取而代之：非法字符直接剔掉，超长直接截断。
 * 归因丢一点精度可以接受，拼出个 400 不行。
 */
export function buildScene(parts: Record<string, string | number>): string {
  const raw = Object.keys(parts)
    .map((k) => `${k}=${parts[k]}`)
    .join(',');
  const cleaned = raw.replace(/[^0-9A-Za-z!#$&'()*+,/:;=?@\-._~]/g, '');
  return cleaned.slice(0, 32);
}

interface CacheEntry {
  /** USER_DATA_PATH 下的文件路径 */
  path: string;
  savedAt: number;
}

const TTL_MS = 7 * 24 * 3600 * 1000;

function cache(): Record<string, CacheEntry> {
  return store.read<Record<string, CacheEntry>>(store.SK.WXACODE, {});
}

function fileName(scene: string): string {
  // scene 里有 `/` `:` 这类字符，不能直接当文件名
  let h = 5381;
  for (let i = 0; i < scene.length; i++) h = ((h * 33) ^ scene.charCodeAt(i)) >>> 0;
  return `wxacode_${h.toString(36)}.png`;
}

/**
 * 取一张小程序码，返回**本地文件路径**；拿不到就返回 null。
 *
 * 🔴 **拿不到是常态，不是异常**：小程序首次发布之前 `getwxacodeunlimit` 一定失败
 * （41030），而活词现在还卡在 ICP 备案 → 微信认证 → 首次发布这条链上。
 * 所以调用方必须能**在没有码的情况下把海报画完**，不能等它、更不能因此报错。
 */
export async function qrFile(scene: string, page = 'pages/today/today'): Promise<string | null> {
  if (!isValidScene(scene)) {
    console.warn('[wxacode] scene 不合法，跳过：', scene);
    return null;
  }

  const fs = wx.getFileSystemManager();
  const all = cache();
  const hit = all[scene];
  if (hit && Date.now() - hit.savedAt < TTL_MS) {
    try {
      // 缓存记的是路径，文件本身可能被系统清掉了 —— 必须真的 stat 一次再信它
      fs.accessSync(hit.path);
      return hit.path;
    } catch {
      delete all[scene];
      store.write(store.SK.WXACODE, all);
    }
  }

  let image: string;
  try {
    const res = await gw.wxApi<{ image: string }>('/wxacode', { scene, page });
    image = res.image;
  } catch (e) {
    console.warn('[wxacode] 取码失败，海报按无码版画：', e);
    return null;
  }

  const comma = image.indexOf(',');
  const b64 = comma >= 0 ? image.slice(comma + 1) : image;
  const path = `${wx.env.USER_DATA_PATH}/${fileName(scene)}`;
  try {
    fs.writeFileSync(path, b64, 'base64');
  } catch (e) {
    console.warn('[wxacode] 写本地文件失败：', e);
    return null;
  }

  all[scene] = { path, savedAt: Date.now() };
  store.write(store.SK.WXACODE, all);
  return path;
}
