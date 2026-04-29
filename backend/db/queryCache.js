const crypto = require('crypto');

class QueryCache {
    constructor() {
        this.cache = new Map();

        setInterval(() => {
            this._cleanup();
        }, 5 * 60 * 1000);
    }

    generateKey(sql, params = []) {
        const stringifiedData = JSON.stringify({ sql, params });
        return crypto.createHash('sha256').update(stringifiedData).digest('hex');
    }
    get(key) {
        const item = this.cache.get(key);

        if (!item) return null;

        if (Date.now() > item.expiry) {
            this.cache.delete(key);
            return null;
        }

        return item.value;
    }
    set(key, value, ttlMs) {
        const expiry = Date.now() + ttlMs;
        this.cache.set(key, { value, expiry });
    }

    clearCache() {
        this.cache.clear();
        console.log('Query cache cleared.');
    }

    _cleanup() {
        const now = Date.now();
        let deleted = 0;
        for (const [key, item] of this.cache.entries()) {
            if (now > item.expiry) {
                this.cache.delete(key);
                deleted++;
            }
        }
        if (deleted > 0) {
            console.log(`Cache cleanup: removed ${deleted} expired entries.`);
        }
    }
}

const queryCache = new QueryCache();
module.exports = queryCache;
