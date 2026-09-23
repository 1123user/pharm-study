/* 药学知识 · 离线缓存 Service Worker */
const CACHE = "pharm-study-v28";
// 资源版本号：与 index.html 中的 ?v= 保持一致，变更前端代码时同步 +1
const VER = "28";
// 只预缓存无需鉴权的应用外壳；数据内容通过 Supabase Edge Function 鉴权后获取，
// 由运行时 fetch 分支在登录后按需缓存，避免 install 阶段因未鉴权 401 而失败。
const CORE = [
  "./", "./index.html", "./css/app.css?v=" + VER,
  "./js/app.js?v=" + VER, "./js/supabase.js?v=" + VER,
  "./manifest.webmanifest", "./icon.svg", "./icon-180.png", "./icon-192.png", "./icon-512.png"
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.allSettled(CORE.map((u) => c.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // 云端同步接口不拦截：直连后端，避免鉴权异常与数据被缓存污染
  if (url.pathname.indexOf("/api/") >= 0) return;

  // 页面导航：网络优先，离线时回退缓存的 index.html。
  // 外壳已匿名放行、登录改用前端表单（不再依赖 401 挑战），拦截导航是安全的，
  // 这样添加到主屏幕后即便离线也能打开应用外壳，而不是「网络无法连接」。
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req).then(function (res) {
        if (res && res.ok) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put("./index.html", copy); });
        }
        return res;
      }).catch(function () {
        return caches.match("./index.html");
      })
    );
    return;
  }

  // 结构式图片变化少，缓存优先，避免反复下载
  if (url.pathname.indexOf("/img/") >= 0) {
    e.respondWith(
      caches.match(req).then((hit) =>
        hit || fetch(req).then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }).catch(() => hit)
      )
    );
    return;
  }

  // 其余静态资源网络优先，仅缓存成功响应；网络失败时回退缓存
  e.respondWith(
    fetch(req).then((res) => {
      if (res && res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
      }
      return res;
    }).catch(() =>
      caches.match(req).then((hit) => hit || caches.match("./index.html"))
    )
  );
});
