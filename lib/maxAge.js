'use strict';

const _ = require('lodash');
const parseCacheControl = require('./parseCacheControl');
const getFromCache = require('./cache').getFromCache;
const storeInCache = require('./cache').storeInCache;
const toResponse = require('./toResponse');

const MAX_AGE = 'max-age';
const STALE_WHILST_REVALIDATE = 'stale-while-revalidate';
const CACHE_CONTROL = 'cache-control';
const SEGMENT = 'body';

const refreshing = new Map();

function revalidate(cached, url, cache, opts) {
  if (cached.item.revalidate && cached.item.revalidate < new Date().getTime()) {
    if (!refreshing.has(url)) {
      refreshing.set(url, true);

      const fresh = _.get(opts, 'refresh', _.noop);
      fresh(url)
        .catch(() => {
          refreshing.delete(url);
        }) // ignore - adds stats
        .then((res) => {
          storeInCache(cache, SEGMENT, url, res.toJSON(), 60 * 1000);
          refreshing.delete(url);
        });
    }
  }
}

module.exports = (cache, opts) => {
  cache.start(() => { });

  const staleWhilstRevalidate = _.get(opts, STALE_WHILST_REVALIDATE, false);

  return (ctx, next) => {
    return getFromCache(cache, SEGMENT, ctx.req.getUrl(), opts).then((cached) => {
      if (cached) {
        if (staleWhilstRevalidate) {
          revalidate(cached, ctx.req.getUrl(), cache, opts);
        }
        const res = cached.item;
        ctx.res = toResponse(res);
        return;
      }

      return next().then(() => {
        if (ctx.isStale || ctx.res.statusCode >= 400) return;

        const cacheControl = parseCacheControl(ctx.res.headers[CACHE_CONTROL]);
        let maxAge = cacheControl[MAX_AGE] * 1000;
        const swr = (cacheControl[STALE_WHILST_REVALIDATE] || 0) * 1000;

        if (maxAge && !ctx.res.fromCache) {
          const cacheItem = ctx.res.toJSON();
          if (staleWhilstRevalidate && swr > 0) {
            cacheItem.revalidate = new Date().getTime() + maxAge;
            maxAge = maxAge + swr;
          }
          return storeInCache(cache, SEGMENT, ctx.req.getUrl(), cacheItem, maxAge);
        }
      });
    });
  };
};
