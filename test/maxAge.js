'use strict';

const assert = require('assert');
const promisifyAll = require('bluebird').promisifyAll;
const Catbox = require('catbox');
const Memory = require('catbox-memory');
const nock = require('nock');

const httpTransport = require('@bbc/http-transport');

const cache = require('../');

const api = nock('http://www.example.com');

const defaultHeaders = {
  'cache-control': 'max-age=60'
};

const defaultResponse = {
  body: 'I am a string!',
  url: 'http://www.example.com/path',
  statusCode: 200,
  elapsedTime: 40,
  headers: defaultHeaders
};

const alternateResponse = {
  body: 'clade',
  url: 'http://www.example.com/path',
  statusCode: 200,
  elapsedTime: 40,
  headers: defaultHeaders
};

const defaultBodySegment = {
  segment: 'http-transport:1.0.0:body',
  id: 'http://www.example.com/path'
};

const alternateBodySegment = {
  segment: 'http-transport:1.0.0:body',
  id: 'http://www.example.com/path?a=1'
};

nock.disableNetConnect();

function createCache() {
  const cache = new Catbox.Client(new Memory());
  promisifyAll(cache);

  return cache;
}

function requestWithCache(catbox, url, qs) {
  if (!url) url = 'http://www.example.com/path';

  return httpTransport
    .createClient()
    .use(cache.maxAge(catbox))
    .query(qs)
    .get(url)
    .asResponse();
}

describe('Max-Age', () => {
  afterEach(() => {
    nock.cleanAll();
  });

  it('sets the cache up ready for use', () => {
    const catbox = createCache();
    cache.maxAge(catbox);

    assert(catbox.isReady());
  });

  it('stores cached values for the max-age value', () => {
    const cache = createCache();
    api.get('/path').reply(200, defaultResponse.body, defaultHeaders);

    const expiry = Date.now() + 60000;

    return requestWithCache(cache)
      .then(() => cache.getAsync(defaultBodySegment))
      .then(cached => {
        const actualExpiry = cached.ttl + cached.stored;
        const differenceInExpires = actualExpiry - expiry;

        assert.deepEqual(cached.item.body, defaultResponse.body);
        assert(differenceInExpires < 1000);
      });
  });

  it('varies on query strings', () => {
    const cache = createCache();
    api.get('/path').reply(200, defaultResponse.body, defaultHeaders);
    api.get('/path?a=1').reply(200, alternateResponse.body, defaultHeaders);

    const pending = [];
    pending.push(requestWithCache(cache));
    pending.push(requestWithCache(cache, alternateResponse.url, { a: 1 }));

    return Promise.all(pending)
      .then(() => {
        const cached = [];
        cached.push(cache.getAsync(defaultBodySegment));
        cached.push(cache.getAsync(alternateBodySegment));
        return Promise.all(cached);
      })
      .then(results => {
        assert.equal(results[0].item.body, defaultResponse.body);
        assert.equal(results[1].item.body, alternateResponse.body);
      });
  });

  it('does not store if no cache-control', () => {
    const cache = createCache();
    api.get('/path').reply(200, defaultResponse);

    return requestWithCache(cache)
      .then(() => cache.getAsync(defaultBodySegment))
      .then(cached => assert(!cached));
  });

  it('does not store if max-age=0', () => {
    const cache = createCache();

    api.get('/path').reply(200, defaultResponse, {
      headers: {
        'cache-control': 'max-age=0'
      }
    });

    return requestWithCache(cache)
      .then(() => cache.getAsync(defaultBodySegment))
      .then(cached => assert(!cached));
  });

  it('returns a cached response when available', () => {
    const headers = {
      'cache-control': 'max-age=0'
    };

    const cachedResponse = {
      body: 'http-transport',
      headers,
      statusCode: 200,
      url: 'http://www.example.com/path',
      elapsedTime: 40
    };

    const cache = createCache();
    api.get('/path').reply(200, defaultResponse, {
      headers
    });

    return cache
      .startAsync()
      .then(() => cache.setAsync(defaultBodySegment, cachedResponse, 600))
      .then(() => requestWithCache(cache))
      .then(res => {
        assert.equal(res.body, cachedResponse.body);
        assert.deepEqual(res.headers, cachedResponse.headers);
        assert.equal(res.statusCode, cachedResponse.statusCode);
        assert.equal(res.url, cachedResponse.url);
        assert.equal(res.elapsedTime, cachedResponse.elapsedTime);

        return cache.drop(defaultBodySegment);
      });
  });
});
