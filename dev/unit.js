'use strict';

const assert = require('assert');
const crypto = require('crypto');
const { parseFeed, decodeEntities } = require('../app/server/rss');
const { parseTorrentInfo, magnetInfoHash } = require('../app/server/bencode');
const { deriveHomeUrl, parseMikanHome, parseEpisodePage, parseSubgroups, parseSubgroupEpisodes, cleanFeedTitle } = require('../app/server/meta');
const { normalizeProxy, isNoProxy } = require('../app/server/proxy');
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

console.log(`\n单元测试全部通过（${passed} 项）`);
