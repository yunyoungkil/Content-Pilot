// Utility functions for merging channel lists
function genId(b) {
  if (!b) return null;
  if (b.id) return b.id;
  if (b.apiUrl) return btoa(b.apiUrl).replace(/=/g, '');
  if (b.inputUrl || b.url) return btoa((b.inputUrl || b.url).replace(/\/$/, '')).replace(/=/g, '');
  return null;
}

function mergeBlogsPreservePlatform(existingBlogs = [], incomingBlogs = []) {
  const existingMap = new Map();
  existingBlogs.forEach((b) => {
    const id = genId(b);
    if (id) existingMap.set(id, b);
  });

  return (incomingBlogs || []).map((b) => {
    const id = genId(b);
    const existingB = id ? existingMap.get(id) : null;
    return Object.assign({}, existingB || {}, b, {
      platformType: b.platformType || (existingB && existingB.platformType) || 'naver',
    });
  });
}

module.exports = { genId, mergeBlogsPreservePlatform };
