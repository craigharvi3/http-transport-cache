'use strict';

// const qs = require('qs');
const parseCacheControl = require('./parseCacheControl');
const getFromCache = require('./cache').getFromCache;
const storeInCache = require('./cache').storeInCache;

const noop = () => {};

const MAX_AGE = 'max-age';
const CACHE_CONTROL = 'cache-control';
const SEGMENT = 'body';

function stringify(obj) {
  const pairs = Object.keys(obj).map(key => {
    return key + '=' + obj[key];
  });
  return pairs.join('&');
}

function genereateId(req) {
  if (req.hasQueries()) {
    const queries = stringify(req.getQueries()); // TODO: or use qs.stringify()
    return `${req.getUrl()}?${queries}`;
  }
  return req.getUrl();
}

module.exports = cache => {
  cache.start(noop);

  return (ctx, next) => {
    return getFromCache(cache, SEGMENT, ctx.req.getUrl()).then(cached => {
      if (cached) {
        const res = cached.item;

        ctx.res = {
          body: res.body,
          headers: res.headers,
          statusCode: res.statusCode,
          elapsedTime: res.elapsedTime,
          url: res.url
        };

        return;
      }

      return next().then(() => {
        const cacheControl = parseCacheControl(ctx.res.headers[CACHE_CONTROL]);

        const id = genereateId(ctx.req);

        if (cacheControl[MAX_AGE]) {
          return storeInCache(
            cache,
            SEGMENT,
            id,
            ctx.res.toJSON(),
            cacheControl[MAX_AGE] * 1000
          );
        }
      });
    });
  };
};
