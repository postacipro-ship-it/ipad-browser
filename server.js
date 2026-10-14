const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const { URL } = require('url');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Ana Sayfa (iPad için sade arama ekranı)
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="tr">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0">
        <title>iPad mini 1 Web Portalı</title>
        <style>
            body { font-family: -apple-system, Helvetica, Arial, sans-serif; background: #eef2f5; margin: 0; padding: 20px; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 80vh; }
            .card { background: #fff; padding: 30px; border-radius: 12px; box-shadow: 0 4px 15px rgba(0,0,0,0.08); width: 90%; max-width: 480px; text-align: center; }
            h1 { margin-top: 0; color: #1e293b; font-size: 22px; }
            p { color: #64748b; font-size: 14px; margin-bottom: 20px; }
            input[type="text"] { width: 100%; box-sizing: border-box; padding: 12px 14px; font-size: 16px; border: 2px solid #cbd5e1; border-radius: 8px; margin-bottom: 15px; outline: none; }
            input[type="text"]:focus { border-color: #0284c7; }
            button { width: 100%; padding: 12px; background: #0284c7; color: #fff; border: none; border-radius: 8px; font-size: 16px; font-weight: bold; cursor: pointer; }
            .links { margin-top: 20px; display: flex; justify-content: center; flex-wrap: wrap; }
            .links a { color: #0284c7; text-decoration: none; font-size: 14px; padding: 6px 12px; background: #f1f5f9; border-radius: 6px; margin: 4px; }
        </style>
    </head>
    <body>
        <div class="card">
            <h1>iPad Web Portalı</h1>
            <p>Gitmek istediğiniz site adresini veya arama terimini yazın:</p>
            <form method="GET" action="/proxy">
                <input type="text" name="url" placeholder="Örn: wikipedia.org veya arama" autofocus>
                <button type="submit">İnternette Aç</button>
            </form>
            <div class="links">
                <a href="/proxy?url=https://tr.wikipedia.org">Wikipedia</a>
                <a href="/proxy?url=https://lite.duckduckgo.com/lite/">DuckDuckGo Lite</a>
                <a href="/proxy?url=https://news.ycombinator.com">Hacker News</a>
            </div>
        </div>
    </body>
    </html>
  `);
});

// Proxy İşleyici (GET ve POST formları tam destekler)
async function handleProxy(req, res) {
  let targetUrl = req.query.url || req.body.url;
  if (!targetUrl) return res.redirect('/');

  // DuckDuckGo aramalarını veri merkezi IP engelini aşan 'lite.duckduckgo.com'a yönlendir
  if (targetUrl.includes('duckduckgo.com')) {
    targetUrl = targetUrl
      .replace('html.duckduckgo.com/html', 'lite.duckduckgo.com/lite/')
      .replace('duckduckgo.com/html', 'lite.duckduckgo.com/lite/')
      .replace(/^https?:\/\/duckduckgo\.com\/?$/i, 'https://lite.duckduckgo.com/lite/');
  }

  // Eğer doğrudan arama yapılmışsa (URL değilse)
  if (!/^https?:\/\//i.test(targetUrl)) {
    if (targetUrl.includes('.') && !targetUrl.includes(' ')) {
      targetUrl = 'https://' + targetUrl;
    } else {
      targetUrl = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(targetUrl)}`;
    }
  }

  // GET formlarından gelen ek parametreleri (?q=...&kl=...) hedef URL'e ekle
  if (req.method === 'GET') {
    try {
      const parsedUrl = new URL(targetUrl);
      for (const [key, val] of Object.entries(req.query)) {
        if (key !== 'url') {
          parsedUrl.searchParams.set(key, val);
        }
      }
      targetUrl = parsedUrl.href;
    } catch (e) {}
  }

  try {
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7'
    };

    let postData = undefined;
    if (req.method === 'POST') {
      const params = new URLSearchParams();
      for (const [key, val] of Object.entries(req.body)) {
        if (key !== 'url') {
          params.append(key, val);
        }
      }
      postData = params.toString();
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
    }

    const response = await axios({
      method: req.method,
      url: targetUrl,
      headers: headers,
      data: postData,
      responseType: 'arraybuffer',
      timeout: 15000,
      maxRedirects: 5,
      validateStatus: () => true
    });

    // Yönlendirme varsa (301, 302 vb.)
    if (response.headers['location']) {
      const redirectUrl = new URL(response.headers['location'], targetUrl).href;
      return res.redirect(`/proxy?url=${encodeURIComponent(redirectUrl)}`);
    }

    const contentType = response.headers['content-type'] || '';

    // HTML dışındaki dosyaları (resim, font, css vb.) doğrudan ilet
    if (!contentType.includes('text/html')) {
      res.set('Content-Type', contentType);
      return res.send(response.data);
    }

    const html = response.data.toString('utf-8');
    const $ = cheerio.load(html);
    const parsedBase = new URL(targetUrl);

    // 1. Linkleri (a href) proxy'ye yönlendir
    $('a').each((_, el) => {
      const href = $(el).attr('href');
      if (href && !href.startsWith('#') && !href.startsWith('javascript:') && !href.startsWith('mailto:')) {
        try {
          const absoluteUrl = new URL(href, parsedBase.origin).href;
          $(el).attr('href', `/proxy?url=${encodeURIComponent(absoluteUrl)}`);
        } catch (e) {}
      }
    });

    // 2. Resimlerin (img src) kırılmaması için mutlak adrese çevir
    $('img').each((_, el) => {
      const src = $(el).attr('src');
      if (src) {
        try {
          $(el).attr('src', new URL(src, parsedBase.origin).href);
        } catch (e) {}
      }
    });

    // 3. CSS dosyalarını mutlak adrese çevir
    $('link[rel="stylesheet"]').each((_, el) => {
      const href = $(el).attr('href');
      if (href) {
        try {
          $(el).attr('href', new URL(href, parsedBase.origin).href);
        } catch (e) {}
      }
    });

    // 4. Form gönderimlerini (POST ve GET) proxy'ye bağla
    $('form').each((_, el) => {
      const action = $(el).attr('action') || '';
      const method = ($(el).attr('method') || 'GET').toUpperCase();
      let absAction = targetUrl;
      try {
        absAction = new URL(action, targetUrl).href;
      } catch (e) {}

      $(el).attr('action', '/proxy');
      $(el).attr('method', method);
      $(el).find('input[name="url"]').remove();
      $(el).prepend(`<input type="hidden" name="url" value="${absAction}">`);
    });

    // 5. iOS 9 için Gezinme Çubuğu ve CSS Düzeltmeleri
    const retroBar = `
      <div id="retro-bar" style="position:fixed;top:0;left:0;right:0;height:42px;background:#1e293b;color:#fff;z-index:99999999;display:flex;align-items:center;padding:0 12px;box-shadow:0 2px 8px rgba(0,0,0,0.2);font-family:Helvetica,Arial,sans-serif;">
          <a href="/" style="color:#f8fafc;text-decoration:none;font-weight:bold;margin-right:12px;font-size:14px;">🏠 Ana Sayfa</a>
          <form method="GET" action="/proxy" style="display:flex;flex:1;margin:0;">
              <input type="text" name="url" value="${targetUrl}" style="flex:1;height:28px;padding:0 10px;border-radius:4px;border:none;font-size:13px;outline:none;" placeholder="Adres veya arama...">
              <button type="submit" style="margin-left:8px;height:28px;padding:0 14px;background:#0284c7;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:13px;">Git</button>
          </form>
      </div>
      <div style="height:44px;"></div>
      <style>
          /* iOS 9 Safari Düzeltmeleri */
          body { margin-top: 0 !important; font-family: -apple-system, Helvetica, Arial, sans-serif !important; }
          img { max-width: 100% !important; height: auto !important; }
      </style>
    `;

    $('body').prepend(retroBar);

    res.send($.html());
  } catch (error) {
    res.status(500).send(`
      <div style="font-family:sans-serif;padding:20px;text-align:center;">
        <h3>Sayfa Yüklenemedi</h3>
        <p style="color:red;">${error.message}</p>
        <a href="/">← Ana Sayfaya Dön</a>
      </div>
    `);
  }
}

app.get('/proxy', handleProxy);
app.post('/proxy', handleProxy);

app.listen(PORT, () => {
  console.log(`Sunucu http://localhost:${PORT} üzerinde çalışıyor.`);
});
