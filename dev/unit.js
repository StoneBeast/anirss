'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseFeed, decodeEntities } = require('../app/server/rss');
const { parseTorrentInfo, magnetInfoHash } = require('../app/server/bencode');
const {
  deriveHomeUrl, parseMikanHome, parseMikanSearch, parseEpisodePage, parseSubgroups, parseSubgroupEpisodes, cleanFeedTitle,
  parseSizeText, classifySizeItem, sizeStats,
} = require('../app/server/meta');
const { normalizeProxy, isNoProxy } = require('../app/server/proxy');
const { extractArchive, archiveKind } = require('../app/server/archive');
const { buildZip } = require('./zip-builder');
const zlib = require('zlib');
const {
  compileFilters, matchTitle, composeUrl, normalizeBaseUrl,
  isHttpUrl, filenameFromUrl, formatBytes, httpError, guessEpisode, episodeRanges,
} = require('../app/server/util');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('✓ ' + name);
  } catch (e) {
    console.error('✗ ' + name);
    throw e;
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    passed++;
    console.log('✓ ' + name);
  } catch (e) {
    console.error('✗ ' + name);
    throw e;
  }
}

test('RSS 2.0：CDATA、实体、相对 enclosure、guid', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
  <rss version="2.0"><channel>
    <title>测试 &amp; 番剧</title>
    <item>
      <title><![CDATA[[Sub] 测试番剧 - 01 [1080p] & 简日]]></title>
      <link>/post/1</link>
      <guid isPermaLink="false">guid-1</guid>
      <pubDate>Sat, 18 Oct 2026 01:00:00 +0800</pubDate>
      <description><![CDATA[<p>hello &amp; world</p>]]></description>
      <enclosure url="/t/1.torrent" length="123456" type="application/x-bittorrent" />
    </item>
    <item>
      <title>测试番剧 - 02 [720p]</title>
      <link>https://example.com/post/2</link>
      <guid>guid-2</guid>
      <enclosure url="https://cdn.example.com/2.torrent" type="application/x-bittorrent" />
    </item>
  </channel></rss>`;
  const feed = parseFeed(xml, 'https://example.com/rss');
  assert.strictEqual(feed.title, '测试 & 番剧');
  assert.strictEqual(feed.items.length, 2);
  const one = feed.items[0];
  assert.strictEqual(one.title, '[Sub] 测试番剧 - 01 [1080p] & 简日');
  assert.strictEqual(one.key, 'guid-1');
  assert.strictEqual(one.link, 'https://example.com/post/1');
  assert.strictEqual(one.torrentUrl, 'https://example.com/t/1.torrent');
  assert.strictEqual(one.size, 123456);
  assert.ok(one.pubDate > 0);
  assert.strictEqual(feed.items[1].torrentUrl, 'https://cdn.example.com/2.torrent');
});

test('Atom：link rel=alternate / enclosure、id、时间', () => {
  const xml = `<?xml version="1.0" encoding="utf-8"?>
  <feed xmlns="http://www.w3.org/2005/Atom">
    <title>Atom 番剧</title>
    <entry>
      <title>Atom Show - 03 [1080p]</title>
      <id>urn:uuid:abc-3</id>
      <updated>2026-10-18T02:30:00Z</updated>
      <link rel="alternate" href="/post/3" />
      <link rel="enclosure" type="application/x-bittorrent" href="/torrents/3.torrent" length="98765" />
      <summary type="html">&lt;b&gt;简介&lt;/b&gt;</summary>
    </entry>
  </feed>`;
  const feed = parseFeed(xml, 'https://atom.example.com/feed.xml');
  assert.strictEqual(feed.title, 'Atom 番剧');
  assert.strictEqual(feed.items.length, 1);
  const item = feed.items[0];
  assert.strictEqual(item.title, 'Atom Show - 03 [1080p]');
  assert.strictEqual(item.key, 'urn:uuid:abc-3');
  assert.strictEqual(item.link, 'https://atom.example.com/post/3');
  assert.strictEqual(item.torrentUrl, 'https://atom.example.com/torrents/3.torrent');
  assert.strictEqual(item.size, 98765);
  assert.ok(item.pubDate > 0);
});

test('条目正文里的 magnet 兜底', () => {
  const xml = `<rss><channel><title>M</title><item>
    <title>Magnet Show 01</title>
    <link>https://example.com/post/9</link>
    <description><![CDATA[<a href="magnet:?xt=urn:btih:abcdef&dn=test">magnet</a>]]></description>
  </item></channel></rss>`;
  const feed = parseFeed(xml, 'https://example.com/feed');
  assert.ok(feed.items[0].torrentUrl.startsWith('magnet:?xt=urn:btih:abcdef'));
});

test('HTML 实体解码（命名 + 十进制 + 十六进制）', () => {
  const out = decodeEntities('A &amp; B &lt; C &#65; &#x42; &nbsp;');
  assert.ok(out.includes('A & B < C A B'));
});

test('包含 / 排除正则与忽略大小写', () => {
  const filters = compileFilters('1080p\n简日', '合集', true);
  assert.deepStrictEqual(matchTitle('[Sub] Show - 01 [1080P][简日]', filters), { matched: true, reason: 'match' });
  assert.deepStrictEqual(matchTitle('[Sub] Show - 01 [720p][繁日]', filters), { matched: false, reason: 'include' });
  assert.deepStrictEqual(matchTitle('[Sub] Show 合集 [1080p]', filters), { matched: false, reason: 'exclude' });
  const all = compileFilters('', '', true);
  assert.strictEqual(matchTitle('anything', all).matched, true);
});

test('非法正则报错', () => {
  assert.throws(() => compileFilters('[', '', true), /正则表达式无效/);
});

test('基础地址 + 路径拼接', () => {
  assert.strictEqual(
    composeUrl('https://mikanime.tv/', '/RSS/Bangumi?bangumiId=3870&subgroupid=203'),
    'https://mikanime.tv/RSS/Bangumi?bangumiId=3870&subgroupid=203'
  );
  assert.strictEqual(composeUrl('https://mikanime.tv', 'RSS/x'), 'https://mikanime.tv/RSS/x');
  assert.strictEqual(composeUrl('https://mikanime.tv', 'https://other/x'), 'https://other/x');
  assert.strictEqual(composeUrl('https://mikanime.tv', ''), 'https://mikanime.tv');
});

test('URL 规范化与校验', () => {
  assert.strictEqual(normalizeBaseUrl('127.0.0.1:8080'), 'http://127.0.0.1:8080');
  assert.strictEqual(normalizeBaseUrl('https://mikanime.tv/'), 'https://mikanime.tv');
  assert.strictEqual(isHttpUrl('https://a/b'), true);
  assert.strictEqual(isHttpUrl('magnet:?xt=1'), false);
  assert.throws(() => normalizeBaseUrl('ftp://x'), /http/);
});

test('文件名与大小格式化', () => {
  assert.strictEqual(filenameFromUrl('https://x/a/b.torrent?x=1'), 'b.torrent');
  assert.ok(filenameFromUrl('https://x/').endsWith('.torrent'));
  assert.strictEqual(formatBytes(1024), '1.0 KB');
  assert.strictEqual(formatBytes(1024 * 1024), '1.0 MB');
});

test('torrent infohash 解析', () => {
  const info = 'd4:name4:test6:lengthi1024ee';
  const raw = Buffer.from('d8:announce3:url4:info' + info + 'e', 'utf8');
  const expected = crypto.createHash('sha1').update(info).digest('hex');
  const parsed = parseTorrentInfo(raw);
  assert.ok(parsed);
  assert.strictEqual(parsed.hash, expected);
  assert.strictEqual(parseTorrentInfo(Buffer.from('not-bencode')), null);
  assert.strictEqual(parseTorrentInfo(Buffer.alloc(0)), null);
});

test('magnet infohash（hex / base32）', () => {
  const hex = '0123456789abcdef0123456789abcdef01234567';
  assert.strictEqual(magnetInfoHash('magnet:?xt=urn:btih:' + hex), hex);
  assert.strictEqual(
    magnetInfoHash('magnet:?xt=urn:btih:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA&dn=x'),
    '0'.repeat(40)
  );
  assert.strictEqual(magnetInfoHash('not-a-magnet'), '');
});

test('Mikan 追番地址推导番组主页', () => {
  assert.strictEqual(
    deriveHomeUrl('https://mikanime.tv/RSS/Bangumi?bangumiId=4059&subgroupid=203'),
    'https://mikanime.tv/Home/Bangumi/4059'
  );
  assert.strictEqual(
    deriveHomeUrl('https://mikanani.me/Home/Bangumi/4059'),
    'https://mikanani.me/Home/Bangumi/4059'
  );
  assert.strictEqual(deriveHomeUrl('https://example.com/feed.xml'), '');
});

test('解析 Mikan 番组主页封面 / bgm 链接 / 放送信息', () => {
  const html = `
    <div class="bangumi-poster" style="background-image: url('/images/Bangumi/202610/abc.jpg?width=400&amp;height=560');"></div>
    <p class="bangumi-title">FX&#x6218;&#x58EB;&#x4E45;&#x7559;&#x7F8E; <a href="/RSS/Bangumi?bangumiId=4059">RSS</a></p>
    <p class="bangumi-info">放送日期：星期四</p>
    <p class="bangumi-info">总集数：12</p>
    <p class="bangumi-info">放送开始：10/1/2026</p>
    <p class="bangumi-info">官方网站：<br /><a href="https://fxkurumi-info.com/">官网</a></p>
    <p class="bangumi-info">Bangumi番组计划链接：<br /><a href="https://bgm.tv/subject/622288">https://bgm.tv/subject/622288</a></p>`;
  const meta = parseMikanHome(html, 'https://mikanime.tv/Home/Bangumi/4059');
  assert.strictEqual(meta.cover, 'https://mikanime.tv/images/Bangumi/202610/abc.jpg?width=400&height=560');
  assert.strictEqual(meta.title, 'FX战士久留美');
  assert.strictEqual(meta.bgmUrl, 'https://bgm.tv/subject/622288');
  assert.strictEqual(meta.bgmId, '622288');
  assert.strictEqual(meta.airWeekday, '星期四');
  assert.strictEqual(meta.episodes, '12');
  assert.strictEqual(meta.startDate, '10/1/2026');
  assert.strictEqual(meta.officialSite, 'https://fxkurumi-info.com/');
});

test('解析 Mikan 搜索页：多部作品、去重、排除导航链接', () => {
  // RSS/Search 只有近期更新的条目，搜索页才是完整作品列表（搜「死神」时 RSS 只有 1 部，页面有 4 部）
  const html = `
    <ul class="list-inline an-ul">
      <li><a href="/Home/Bangumi/4032" target="_blank">
        <span data-src="/images/Bangumi/202607/a7ad9c81.jpg?width=400&amp;height=400&amp;format=webp" class="b-lazy"></span>
        <div class="an-info"><div class="an-info-group">
          <div class="an-text" title="&#x6B7B;&#x795E; &#x5343;&#x5E74;&#x8840;&#x6218;&#x7BC7;-&#x7978;&#x8FDB;&#x8C2D;-" style="width:170px;">&#x6B7B;&#x795E; &#x5343;&#x5E74;&#x8840;&#x6218;&#x7BC7;-&#x7978;&#x8FDB;&#x8C2D;-</div>
        </div></div></a></li>
      <li><a href="/Home/Bangumi/2841" target="_blank">
        <span data-src="/images/Bangumi/202210/2b4d3c36.jpg?width=400" class="b-lazy"></span>
        <div class="an-info"><div class="an-info-group">
          <div class="an-text" title="&#x6B7B;&#x795E; &#x5343;&#x5E74;&#x8840;&#x6218;&#x7BC7;" style="width:170px;">&#x6B7B;&#x795E; &#x5343;&#x5E74;&#x8840;&#x6218;&#x7BC7;</div>
        </div></div></a></li>
      <li><a href="https://mikanime.tv/Home/Bangumi/4032" target="_blank">
        <div class="an-info"><div class="an-info-group">
          <div class="an-text" title="重复的一条">重复的一条</div>
        </div></div></a></li>
    </ul>
    <div class="nav"><a href="/Home/Bangumi/9999">导航里的其他番组</a></div>`;

  const works = parseMikanSearch(html, 'https://mikanime.tv/Home/Search?searchStr=%E6%AD%BB%E7%A5%9E');
  assert.strictEqual(works.length, 2);
  assert.deepStrictEqual(works.map((w) => w.bangumiId), ['4032', '2841']);
  assert.strictEqual(works[0].title, '死神 千年血战篇-祸进谭-');
  // 缩略图参数被去掉，拿原图
  assert.strictEqual(works[0].cover, 'https://mikanime.tv/images/Bangumi/202607/a7ad9c81.jpg');
  assert.strictEqual(works[1].title, '死神 千年血战篇');
  assert.strictEqual(works[0].homeUrl, 'https://mikanime.tv/Home/Bangumi/4032');
});

test('代理配置规范化与 noProxy', () => {
  const http = normalizeProxy({ enabled: true, host: 'http://127.0.0.1:7890', username: 'u', password: 'p' });
  assert.strictEqual(http.type, 'http');
  assert.strictEqual(http.host, '127.0.0.1');
  assert.strictEqual(http.port, 7890);
  const socks = normalizeProxy({ enabled: true, type: 'socks5', host: 'proxy.local:1080' });
  assert.strictEqual(socks.type, 'socks5');
  assert.strictEqual(socks.host, 'proxy.local');
  assert.strictEqual(socks.port, 1080);
  assert.strictEqual(isNoProxy({ noProxy: 'localhost, .lan' }, 'nas.lan'), true);
  assert.strictEqual(isNoProxy({ noProxy: 'localhost, .lan' }, 'mikanime.tv'), false);
});

test('追番标题清理', () => {
  assert.strictEqual(cleanFeedTitle('Mikan Project - FX战士久留美'), 'FX战士久留美');
  assert.strictEqual(cleanFeedTitle('蜜柑计划 - 某番剧'), '某番剧');
  assert.strictEqual(cleanFeedTitle('SubsPlease - Show Name - RSS'), 'SubsPlease - Show Name');
});

test('解析 Mikan 单集页：番剧与字幕组', () => {
  const html = `
    <div class="bangumi-poster" style="background-image: url('/images/Bangumi/202610/fd74ed32.jpg?width=400');"></div>
    <p class="bangumi-title"><a class="w-other-c" href="/Home/Bangumi/4059#71">FX&#x6218;&#x58EB;&#x4E45;&#x7559;&#x7F8E;</a>
      <a href="/RSS/Bangumi?bangumiId=4059&subgroupid=71" class="mikan-rss">RSS</a></p>`;
  const ep = parseEpisodePage(html, 'https://mikanani.me/Home/Episode/' + 'a'.repeat(40));
  assert.strictEqual(ep.bangumiId, '4059');
  assert.strictEqual(ep.subgroupId, '71');
  assert.strictEqual(ep.title, 'FX战士久留美');
  assert.strictEqual(ep.cover, 'https://mikanani.me/images/Bangumi/202610/fd74ed32.jpg?width=400');
  assert.strictEqual(ep.homeUrl, 'https://mikanani.me/Home/Bangumi/4059');
  assert.ok(ep.rssUrl.includes('subgroupid=71'));
});

test('解析番组主页字幕组列表', () => {
  const html = `
    <div class="subgroup-text" id="71"><a href="/Home/PublishGroup/70" style="color:#3bc0c3;">TSDM&#x5B57;&#x5E55;&#x7EC4;</a>
      <a href="/RSS/Bangumi?bangumiId=4059&subgroupid=71" class="mikan-rss">RSS</a></div>
    <div class="subgroup-text" id="203"><a href="/Home/PublishGroup/12">桜都字幕组</a>
      <a href="/RSS/Bangumi?bangumiId=4059&subgroupid=203" class="mikan-rss">RSS</a></div>`;
  const list = parseSubgroups(html, 'https://mikanani.me/Home/Bangumi/4059', '4059');
  assert.strictEqual(list.length, 2);
  assert.strictEqual(list[0].id, '71');
  assert.strictEqual(list[0].name, 'TSDM字幕组');
  assert.strictEqual(list[1].name, '桜都字幕组');
  assert.ok(list[1].rssUrl.includes('subgroupid=203'));
});

test('集数识别：常见命名', () => {
  assert.strictEqual(guessEpisode('[猎户压制部] 矢野同学的普通日常 / Yano-kun no Futsuu no Hibi [12] [1080p] [繁日内嵌] [2025年10月番]').episode, 12);
  assert.strictEqual(guessEpisode('[LoliHouse] 矢野同学的普通日常 - 12 [WebRip 1080p HEVC-10bit AAC][简繁内封][END]').episode, 12);
  assert.strictEqual(guessEpisode('[黒ネズミたち] 矢野同学的普通日常 - 11 (ABEMA 1920x1080 AVC AAC MP4)').episode, 11);
  assert.strictEqual(guessEpisode('[ANi] 矢野同学的普通日常 - 07 [1080P][Baha][WEB-DL]').episode, 7);
  assert.strictEqual(guessEpisode('某番剧 第12集 [1080p]').episode, 12);
  assert.strictEqual(guessEpisode('Show S02E05 1080p WEB-DL').episode, 5);
  assert.strictEqual(guessEpisode('Show EP12 1080p').episode, 12);
  const range = guessEpisode('[Sub] 某番剧 [01-12合集][1080p]');
  assert.strictEqual(range.kind, 'range');
  assert.strictEqual(range.from, 1);
  assert.strictEqual(range.to, 12);
  const special = guessEpisode('[Sub] 某番剧 NCOP [1080p]');
  assert.strictEqual(special.kind, 'special');
  assert.strictEqual(guessEpisode('[Sub] 某番剧 [1080p][HEVC-10bit]'), null);
  assert.strictEqual(episodeRanges([1, 2, 3, 5, 6, 12]), '1-3, 5-6, 12');
});

test('番组主页：按字幕组统计真实集数', () => {
  const row = (t) => `<tr><td><input type="checkbox" class="js-episode-select" /></td><td><a class="magnet-link-wrap" href="/Home/Episode/${'a'.repeat(40)}">${t}</a></td></tr>`;
  const html = `
    <div class="subgroup-text" id="597"><a href="/Home/PublishGroup/373">猎户发布组</a>
      <a href="/RSS/Bangumi?bangumiId=3735&subgroupid=597" class="mikan-rss">RSS</a></div>
    <div class="episode-table">${row('[猎户] 某番剧 [12] [1080p]')}${row('[猎户] 某番剧 [11] [1080p]')}${row('[猎户] 某番剧 [10] [1080p]')}</div>
    <div class="subgroup-text" id="370"><a href="/Home/PublishGroup/12">LoliHouse</a>
      <a href="/RSS/Bangumi?bangumiId=3735&subgroupid=370" class="mikan-rss">RSS</a></div>
    <div class="episode-table">${row('[LoliHouse] 某番剧 - 01 [WebRip]')}${row('[LoliHouse] 某番剧 - 02 [WebRip]')}</div>`;
  const map = parseSubgroupEpisodes(html);
  assert.strictEqual(map.get('597').episodes.length, 3);
  assert.strictEqual(map.get('597').episodes[0], 10);
  assert.strictEqual(map.get('597').rows, 3);
  assert.strictEqual(map.get('370').rows, 2);
  assert.deepStrictEqual(map.get('370').episodes, [1, 2]);
  const home = parseMikanHome(html, 'https://mikanani.me/Home/Bangumi/3735');
  assert.strictEqual(home.subgroups.length, 2);
  assert.strictEqual(home.subgroups[0].episodeCount, 3);
  assert.strictEqual(home.subgroups[0].name, '猎户发布组');
});

test('体积文本解析与单集/合集分类', () => {
  assert.strictEqual(parseSizeText('48.5 GB'), Math.round(48.5 * 1024 ** 3));
  assert.strictEqual(parseSizeText('[466.82 MB]'), Math.round(466.82 * 1024 ** 2));
  assert.strictEqual(parseSizeText('1,024 MB'), 1024 * 1024 ** 2);
  assert.strictEqual(parseSizeText('1024 B'), 1024);
  assert.strictEqual(parseSizeText('1080p HEVC-10bit'), 0);
  assert.strictEqual(parseSizeText(''), 0);
  assert.strictEqual(classifySizeItem('[Sub] 某番剧 [01-12][合集][1080p]').kind, 'batch');
  assert.strictEqual(classifySizeItem('[Sub] 某番剧 - 03 [1080p]').kind, 'single');
  assert.strictEqual(classifySizeItem('[Sub] 某番剧 NCOP [1080p]').kind, 'special');
  assert.strictEqual(classifySizeItem('[Sub] 某番剧 全集 [BDRip]').kind, 'batch');
  const stats = sizeStats([
    { size: 300, kind: 'single' },
    { size: 320, kind: 'single' },
    { size: 9999, kind: 'batch', label: '第 1–12 集' },
    { size: 400, kind: 'special' },
    { size: 0, kind: 'single' },
  ]);
  assert.deepStrictEqual(stats, {
    sizeMin: 300, sizeMax: 320, sizeCount: 2, batchSize: 9999, batchLabel: '第 1–12 集', batchCount: 1,
  });
});

test('番组主页：字幕组单集体积范围与合集合计', () => {
  const row = (t, size) => `<tr><td><input type="checkbox" class="js-episode-select" /></td><td><a class="magnet-link-wrap" href="/Home/Episode/${'a'.repeat(40)}">${t}</a></td><td>${size}</td></tr>`;
  const html = `
    <div class="subgroup-text" id="597"><a href="/Home/PublishGroup/373">猎户发布组</a>
      <a href="/RSS/Bangumi?bangumiId=3735&subgroupid=597" class="mikan-rss">RSS</a></div>
    <div class="episode-table">
      ${row('[猎户] 某番剧 [12] [1080p]', '520.5 MB')}
      ${row('[猎户] 某番剧 [11] [1080p]', '530 MB')}
      ${row('[猎户] 某番剧 [10] [1080p]', '540.25 MB')}
    </div>
    <div class="subgroup-text" id="370"><a href="/Home/PublishGroup/12">LoliHouse</a>
      <a href="/RSS/Bangumi?bangumiId=3735&subgroupid=370" class="mikan-rss">RSS</a></div>
    <div class="episode-table">
      ${row('[LoliHouse] 某番剧 - 01 [WebRip]', '300 MB')}
      ${row('[LoliHouse] 某番剧 - 02 [WebRip]', '310 MB')}
      ${row('[LoliHouse] 某番剧 [01-12][合集] [BDRip]', '6.02 GB')}
    </div>`;
  const home = parseMikanHome(html, 'https://mikanani.me/Home/Bangumi/3735');
  const a = home.subgroups.find((s) => s.id === '597');
  const b = home.subgroups.find((s) => s.id === '370');
  assert.strictEqual(a.sizeCount, 3);
  assert.strictEqual(a.sizeMin, Math.round(520.5 * 1024 ** 2));
  assert.strictEqual(a.sizeMax, Math.round(540.25 * 1024 ** 2));
  assert.strictEqual(a.batchSize, 0);
  assert.strictEqual(b.sizeCount, 2);
  assert.strictEqual(b.sizeMin, 300 * 1024 ** 2);
  assert.strictEqual(b.sizeMax, 310 * 1024 ** 2);
  assert.strictEqual(b.batchSize, Math.round(6.02 * 1024 ** 3));
  assert.strictEqual(b.batchLabel, '第 1–12 集');
  assert.strictEqual(b.episodeCount, 12);
  assert.strictEqual(b.batch, true);
});

test('硬链接：正片/字幕识别与规划', () => {
  const { parseExtensions, extensionOf, safeRelPath, planSeason, planMirror, probePath } = require('../app/server/hardlink');
  assert.deepStrictEqual([...parseExtensions('MKV, mp4、.ts  srt\n.avi')].sort(), ['avi', 'mkv', 'mp4', 'srt', 'ts']);
  assert.strictEqual(extensionOf('a/b/C.MKV'), 'mkv');
  assert.strictEqual(extensionOf('README'), '');
  assert.strictEqual(safeRelPath('../../etc/passwd'), 'etc/passwd');
  assert.strictEqual(safeRelPath('a//b/./c.mkv'), 'a/b/c.mkv');

  const files = [
    { name: 'Show/[VCB-Studio] Show [01][Ma10p_1080p][x265_flac].mkv', size: 100 },
    { name: 'Show/[VCB-Studio] Show [01][Ma10p_1080p][x265_flac].ass', size: 1 },
    { name: 'Show/[VCB-Studio] Show [02][Ma10p_1080p][x265_flac].mkv', size: 100 },
    { name: 'Show/subs/[VCB-Studio] Show [02].ass', size: 1 },
    { name: 'Show/CDs/[241106] Single/01. flac', size: 10 },
    { name: 'Show/Scans/01.webp', size: 2 },
    { name: 'Show/[VCB-Studio] Show [NCOP][Ma10p_1080p].mkv', size: 100 },
    { name: 'Show/SP/[VCB-Studio] Show [SP01].mkv', size: 100 },
    { name: 'Show/1080p/[VCB-Studio] Show [01][Ma10p_1080p].mkv', size: 90 },
  ];
  const plan = planSeason({ files });
  assert.deepStrictEqual(plan.episodes, [1, 2]);
  assert.strictEqual(plan.mains, 2);
  assert.deepStrictEqual(plan.files.filter((f) => f.kind === 'video').map((f) => f.dest), [
    '[VCB-Studio] Show [01][Ma10p_1080p][x265_flac].mkv',
    '[VCB-Studio] Show [02][Ma10p_1080p][x265_flac].mkv',
  ]);
  assert.strictEqual(plan.files.filter((f) => f.kind === 'sub').length, 2);
  assert.strictEqual(plan.stats.excludedDir, 1);
  assert.strictEqual(plan.stats.excludedTag, 1);
  assert.strictEqual(plan.stats.duplicate, 1);

  // 剧场版：没有集数时取最浅一层的视频
  const movie = planSeason({ files: [{ name: 'Movie/xxx 2024/movie.mkv', size: 5 }, { name: 'Movie/xxx 2024/fonts/a.ttf', size: 1 }] });
  assert.strictEqual(movie.mains, 1);
  assert.deepStrictEqual(movie.files.map((f) => f.dest), ['movie.mkv']);

  // 镜像模式保持旧行为（包含 NCOP、SP 等全部匹配扩展名的文件）
  const mirror = planMirror({ files, extensions: 'mkv', stripRoot: true });
  assert.strictEqual(mirror.prefix, 'Show');
  assert.ok(mirror.files.some((f) => f.dest === '[VCB-Studio] Show [NCOP][Ma10p_1080p].mkv'));

  // 关掉字幕扩展名后不再链接字幕
  const noSubs = planSeason({ files, subExts: '' });
  assert.strictEqual(noSubs.subs, 0);

  // 集数偏移 + 重命名：视频 01–02 偏移到 13–14，字幕 13–14 按目标集数配对
  const shiftedFiles = [
    { name: 'Show/[G] Show [01][1080p].mkv', size: 1 },
    { name: 'Show/[G] Show [02][1080p].mkv', size: 1 },
    { name: 'Show/[G] Show 13.ass', size: 1 },
    { name: 'Show/[G] Show 14.ass', size: 1 },
  ];
  const shifted = planSeason({
    files: shiftedFiles,
    name: '某番剧',
    rename: true,
    renamePattern: '${name} - ${episode2}',
    offset: 12,
    subOffset: 0, // 显式 0：字幕已按目标集数（13–24）命名，不再平移
  });
  assert.deepStrictEqual(shifted.episodes, [13, 14]);
  assert.deepStrictEqual(shifted.files.filter((f) => f.kind === 'video').map((f) => f.dest),
    ['某番剧 - 13.mkv', '某番剧 - 14.mkv']);
  assert.deepStrictEqual(shifted.files.filter((f) => f.kind === 'sub').map((f) => f.dest),
    ['某番剧 - 13.ass', '某番剧 - 14.ass']);

  // 字幕偏移缺省 = 跟随整体偏移：视频 +12，同编号的字幕一起平移并按目标集数配对
  const bothShifted = planSeason({
    files: [
      { name: 'Show/[G] Show [01].mkv', size: 1 },
      { name: 'Show/[G] Show [02].mkv', size: 1 },
      { name: 'Show/[G] Show [01].ass', size: 1 },
    ],
    name: '某番剧',
    rename: true,
    offset: 12,
  });
  assert.strictEqual(bothShifted.subOffsetFollows, true);
  assert.deepStrictEqual(bothShifted.files.filter((f) => f.kind === 'sub').map((f) => f.dest),
    ['某番剧 - 13.ass']);

  // 多份字幕：按语言后缀区分，避免重名冲突
  const multiSub = planSeason({
    files: [
      { name: 'Show/[G] Show [01].mkv', size: 1 },
      { name: 'Show/[G] Show [01].CHS.ass', size: 1 },
      { name: 'Show/[G] Show [01].CHT.ass', size: 1 },
    ],
    name: '某番剧',
    rename: true,
  });
  assert.deepStrictEqual(multiSub.files.filter((f) => f.kind === 'sub').map((f) => f.dest),
    ['某番剧 - 01.zh.ass', '某番剧 - 01.zh-Hant.ass']);

  // 字幕重命名与偏移无关：没开重命名、字幕文件名和剧集完全不同时，
  // 按集数配对后字幕仍会重命名成与剧集最终文件名对应（含目录语言标签）
  const renamedSubs = planSeason({
    files: [
      { name: 'Show/[G] Show [01][1080p].mkv', size: 1 },
      { name: 'Show/[G] Show [02][1080p].mkv', size: 1 },
      { name: 'Show/subs/第01话.ass', size: 1 },
      { name: 'Show/chs/02.ass', size: 1 },
      { name: 'Show/cht/02.ass', size: 1 },
    ],
  });
  assert.deepStrictEqual(renamedSubs.files.filter((f) => f.kind === 'sub').map((f) => f.dest), [
    '[G] Show [01][1080p].ass',
    '[G] Show [02][1080p].zh.ass',
    '[G] Show [02][1080p].zh-Hant.ass',
  ]);

  // 目录权限诊断：不存在的深层路径要报到最近的真实目录
  const probeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'anirss-probe-'));
  const probe = probePath(path.join(probeRoot, 'a', 'b'));
  assert.strictEqual(probe.nearest, path.resolve(probeRoot));
  assert.strictEqual(probe.writable, true, JSON.stringify(probe));
  assert.ok(/可写/.test(probe.message), probe.message);
  fs.rmSync(probeRoot, { recursive: true, force: true });
});

(async () => {
  await testAsync('硬链接：季目录真实文件、幂等与冲突', async () => {
    const { runHardlink } = require('../app/server/hardlink');
    const dl = fs.mkdtempSync(path.join(os.tmpdir(), 'anirss-dl-'));
    const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'anirss-hl-'));
    try {
      const show = path.join(dl, 'Show');
      fs.mkdirSync(path.join(show, 'CDs'), { recursive: true });
      fs.mkdirSync(path.join(show, 'subs'), { recursive: true });
      fs.writeFileSync(path.join(show, '[G] Show [01][1080p].mkv'), Buffer.alloc(1024, 1));
      fs.writeFileSync(path.join(show, '[G] Show [01][1080p].ass'), 'ass1');
      fs.writeFileSync(path.join(show, '[G] Show [02][1080p].mkv'), Buffer.alloc(2048, 2));
      fs.writeFileSync(path.join(show, 'subs', '[G] Show [02].ass'), 'ass2');
      fs.writeFileSync(path.join(show, 'CDs', '01.flac'), 'flac');
      const files = [
        { name: 'Show/[G] Show [01][1080p].mkv', size: 1024 },
        { name: 'Show/[G] Show [01][1080p].ass', size: 4 },
        { name: 'Show/[G] Show [02][1080p].mkv', size: 2048 },
        { name: 'Show/subs/[G] Show [02].ass', size: 4 },
        { name: 'Show/CDs/01.flac', size: 4 },
      ];
      const first = await runHardlink({ savePath: dl, destRoot: dest, files });
      assert.strictEqual(first.ok, true, JSON.stringify(first));
      assert.strictEqual(first.videos, 2);
      assert.strictEqual(first.subs, 2);
      assert.strictEqual(first.linked, 4);
      assert.ok(fs.existsSync(path.join(dest, '[G] Show [01][1080p].mkv')));
      assert.ok(fs.existsSync(path.join(dest, '[G] Show [01][1080p].ass')));
      assert.ok(fs.existsSync(path.join(dest, '[G] Show [02][1080p].ass')), 'subs/ 里的字幕应跟随剧集命名');
      assert.ok(!fs.existsSync(path.join(dest, '[G] Show [02].ass')), '不应保留与剧集不一致的旧字幕名');
      assert.ok(!fs.existsSync(path.join(dest, '01.flac')));
      assert.strictEqual(fs.statSync(path.join(dl, 'Show', '[G] Show [01][1080p].mkv')).nlink, 2);

      const second = await runHardlink({ savePath: dl, destRoot: dest, files });
      assert.strictEqual(second.ok, true);
      assert.strictEqual(second.linked, 0);
      assert.strictEqual(second.existed, 4);

      // 目标被别的文件占用时不覆盖（先删掉硬链接，再放一个独立文件）
      const target = path.join(dest, '[G] Show [01][1080p].mkv');
      fs.rmSync(target);
      fs.writeFileSync(target, 'other');
      const third = await runHardlink({ savePath: dl, destRoot: dest, files });
      assert.strictEqual(third.conflicts, 1);
      assert.strictEqual(fs.readFileSync(target, 'utf8'), 'other');

      // 目标目录不存在时自动建多层
      const deep = path.join(dest, 'Lib', 'Show', 'Season 1');
      const fourth = await runHardlink({ savePath: dl, destRoot: deep, files });
      assert.strictEqual(fourth.ok, true, JSON.stringify(fourth));
      assert.ok(fs.existsSync(path.join(deep, '[G] Show [02][1080p].mkv')));

      // 源目录不存在时给出可读错误
      const bad = await runHardlink({ savePath: path.join(dl, 'nope'), destRoot: dest, files });
      assert.strictEqual(bad.ok, false);
      assert.ok(/不存在/.test(bad.error), bad.error);

      // 镜像模式走同一执行器
      const mirror = await runHardlink({
        savePath: dl, destRoot: path.join(dest, 'mirror'), files, mode: 'mirror', extensions: 'mkv,ass', stripRoot: true,
      });
      assert.strictEqual(mirror.ok, true, JSON.stringify(mirror));
      assert.ok(fs.existsSync(path.join(dest, 'mirror', 'subs', '[G] Show [02].ass')));
    } finally {
      fs.rmSync(dl, { recursive: true, force: true });
      fs.rmSync(dest, { recursive: true, force: true });
    }
  });

  // ---------- 字幕压缩包解压 ----------

  test('字幕包：zip（store/deflate/GBK 文件名/目录层级）', () => {
    const utf8Zip = buildZip([
      { name: 'subs/', data: Buffer.alloc(0) },
      { name: 'subs/[G] Show - 01.chs.ass', data: Buffer.from('简体字幕'), utf8Name: true },
      { name: 'subs/[G] Show - 01.cht.ass', data: Buffer.from('繁體字幕'), method: 8, utf8Name: true },
      { name: 'fonts/MSYaHei.ttf', data: Buffer.from('fontdata'), utf8Name: true },
    ]);
    const out = extractArchive('subs.zip', utf8Zip);
    assert.strictEqual(out.kind, 'zip');
    assert.strictEqual(out.entries.length, 3, JSON.stringify(out.entries.map((e) => e.name)));
    assert.strictEqual(out.entries[0].name, 'subs/[G] Show - 01.chs.ass');
    assert.strictEqual(out.entries[0].data.toString(), '简体字幕');
    assert.strictEqual(out.entries[1].data.toString(), '繁體字幕');
    assert.strictEqual(out.entries[2].name, 'fonts/MSYaHei.ttf');
  });

  test('字幕包：zip GBK 文件名按 GBK 解码', () => {
    // "中文.ass" 的 GBK 字节（Buffer 原生不支持 gbk 编码，用已知字节序列）
    const gbkName = Buffer.from([0xd6, 0xd0, 0xce, 0xc4, 0x2e, 0x61, 0x73, 0x73]);
    const zip = buildZip([{ name: gbkName.toString('latin1'), data: Buffer.from('sub') }]);
    const out = extractArchive('a.zip', zip);
    assert.strictEqual(out.entries.length, 1);
    assert.strictEqual(out.entries[0].name, '中文.ass');
  });

  test('字幕包：zip 路径穿越被清洗', () => {
    const zip = buildZip([
      { name: '../evil.ass', data: Buffer.from('x') },
      { name: 'ok/../../ok2.ass', data: Buffer.from('x') },
      { name: 'C:/abs/path.ass', data: Buffer.from('x') },
    ]);
    const out = extractArchive('a.zip', zip);
    // .. 段被直接丢弃（不会越界），其余保持可见层级
    assert.deepStrictEqual(out.entries.map((e) => e.name), ['evil.ass', 'ok/ok2.ass', 'abs/path.ass']);
  });

  test('字幕包：tar.gz 与 rar/7z 识别', () => {
    const tarBuf = (() => {
      const blocks = [];
      const add = (name, data, type) => {
        const h = Buffer.alloc(512);
        h.write(name.slice(0, 99), 0, 'utf8');
        h.write('0000644\0', 100, 'utf8');
        h.write(data.length.toString(8).padStart(11, '0') + '\0', 124, 'utf8');
        h.write(type, 156, 'utf8');
        h.write('ustar\0', 257, 'utf8');
        h.write('00', 263, 'utf8');
        let sum = 0;
        for (const b of h) sum += b;
        h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 'utf8');
        blocks.push(h, data, Buffer.alloc((512 - (data.length % 512)) % 512));
      };
      add('subs/01.ass', Buffer.from('tar sub'), '0');
      add('subs/02.ass', Buffer.from('tar sub2'), '0');
      blocks.push(Buffer.alloc(1024));
      return Buffer.concat(blocks);
    })();
    const tgz = extractArchive('a.tar.gz', zlib.gzipSync(tarBuf));
    assert.strictEqual(tgz.kind, 'tar.gz');
    assert.strictEqual(tgz.entries.length, 2);
    assert.strictEqual(tgz.entries[1].name, 'subs/02.ass');
    assert.strictEqual(tgz.entries[1].data.toString(), 'tar sub2');

    assert.throws(() => extractArchive('a.rar', Buffer.from('Rar!\x1a\x07\x01\x00')), /RAR/);
    assert.throws(() => extractArchive('a.7z', Buffer.from('7z\xbc\xaf\x27\x1c')), /7z/);
    assert.strictEqual(extractArchive('plain.ass', Buffer.from('x')), null);
    assert.strictEqual(archiveKind('a.rar', Buffer.from('Rar!')), 'rar');
    assert.strictEqual(archiveKind('a.7z', Buffer.from('7z\xbc\xaf\x27\x1c')), '7z');
    assert.strictEqual(archiveKind('plain.ass', Buffer.from('x')), '');
  });

  test('字幕包：加密 zip 与超大文件报错', () => {
    const zip = buildZip([{ name: 'a.ass', data: Buffer.from('x') }]);
    // 手工置上加密位（bit 0）
    const encrypted = Buffer.from(zip);
    encrypted.writeUInt16LE(encrypted.readUInt16LE(6) | 0x0001, 6); // local flags
    // central 的 flags 偏移随条目走，直接找 central 签名
    for (let i = 0; i < encrypted.length - 4; i++) {
      if (encrypted.readUInt32LE(i) === 0x02014b50) {
        encrypted.writeUInt16LE(0x0001, i + 8);
        break;
      }
    }
    assert.throws(() => extractArchive('a.zip', encrypted), /加密/);

    const big = Buffer.alloc(65 * 1024 * 1024);
    assert.throws(() => extractArchive('a.zip', buildZip([{ name: 'big.ass', data: big }])), /64MB/);
  });

  await testAsync('偏移迁移：videoOffset/subOffset → offset + 跟随语义', async () => {
    const { Store } = require('../app/server/store');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anirss-mig-'));
    try {
      const cfg = {
        qb: { baseUrl: 'http://127.0.0.1:8080', username: 'u', password: '' },
        extras: [
          // 旧记录 A：两个偏移相同（同编号字幕整体平移）→ subOffset 应迁移为跟随（null）
          { id: 'x_a', name: 'A', source: 'magnet', hash: 'a'.repeat(40), createdAt: 1, hardlink: { dest: '/x/${name}', season: 1, videoOffset: 12, subOffset: 12 } },
          // 旧记录 B：字幕本身已是目标编号（偏移 0 与视频不同）→ 显式保留 0
          { id: 'x_b', name: 'B', source: 'magnet', hash: 'b'.repeat(40), createdAt: 1, hardlink: { dest: '/y/${name}', season: 1, videoOffset: 12, subOffset: 0 } },
          // 旧记录 C：无偏移 → 全部跟随/0
          { id: 'x_c', name: 'C', source: 'magnet', hash: 'c'.repeat(40), createdAt: 1, hardlink: { dest: '', videoOffset: 0, subOffset: 0 } },
        ],
      };
      fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(cfg), 'utf8');
      const store = new Store(path.join(dir, 'config.json'));
      const [a, b, c] = store.data.extras;
      assert.strictEqual(a.hardlink.offset, 12);
      assert.strictEqual(a.hardlink.subOffset, null, '字幕偏移与视频相同 → 跟随');
      assert.strictEqual(b.hardlink.offset, 12);
      assert.strictEqual(b.hardlink.subOffset, 0, '字幕偏移与视频不同 → 显式保留');
      assert.strictEqual(c.hardlink.offset, 0);
      assert.strictEqual(c.hardlink.subOffset, null);
      assert.ok(!('videoOffset' in a.hardlink), '旧字段应被清除');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  console.log(`\n单元测试全部通过（${passed} 项）`);
})().catch((e) => {
  console.error(e && e.stack ? e.stack : e);
  process.exitCode = 1;
});
