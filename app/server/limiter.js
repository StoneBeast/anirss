'use strict';

/**
 * 按站点（origin）的并发闸门。
 *
 * 实测 Mikan 对同时打开的连接数很敏感：单集页 4 并发时稳定，8/12 并发会出现
 * 20s 级慢响应；单集页和字幕组 RSS 混在一起打过去时，整体并发一高每条都变慢。
 * 所以一次搜索的所有出站请求排进同一个队列，固定最多 N 条在飞：
 * 既不会一次打爆站点，也能让「单集页 → 主页 → 字幕组 RSS」自然流水起来。
 */
function createLimiter(max) {
  const limit = Math.max(1, Number(max) || 4);
  // 两条队列：high 给「卡住整体进度」的请求（站点搜索、番组主页），normal 给其余抓取
  const queue = { high: [], normal: [] };
  let active = 0;

  const takeNext = () => (queue.high.length ? queue.high.shift() : queue.normal.shift());

  const pump = () => {
    while (active < limit) {
      const item = takeNext();
      if (!item) return;
      active++;
      Promise.resolve()
        .then(item.fn)
        .then(item.resolve, item.reject)
        .finally(() => {
          active--;
          pump();
        });
    }
  };

  return {
    /** 排队执行；resolve / reject 跟随 fn。priority='high' 时插到普通队列前面 */
    run(fn, opts) {
      const priority = opts && opts.priority === 'high' ? 'high' : 'normal';
      return new Promise((resolve, reject) => {
        queue[priority].push({ fn, resolve, reject, priority });
        pump();
      });
    },
    stats() {
      return {
        active,
        queued: queue.high.length + queue.normal.length,
        highQueued: queue.high.length,
        limit,
      };
    },
  };
}

module.exports = { createLimiter };
