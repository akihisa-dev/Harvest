function uniqueEvidence(previous, next) {
    return [...new Map([...previous, ...next].map(item => [JSON.stringify(item), item])).values()];
}
/** Keep the latest list order, retaining unseen posts beside their known neighbours. */
export function mergeBookmarkSnapshots(previous, next) {
    const posts = new Map(previous.posts.map(post => [post.key, post]));
    for (const post of next.posts) {
        const old = posts.get(post.key);
        posts.set(post.key, old ? { ...post,
            observed: uniqueEvidence(old.observed, post.observed),
            roots: uniqueEvidence(old.roots, post.roots),
        } : post);
    }
    const current = new Set(next.posts.map(post => post.key));
    const before = new Map();
    let pending = [];
    for (const post of previous.posts) {
        if (current.has(post.key)) {
            before.set(post.key, pending);
            pending = [];
        }
        else
            pending.push(post.key);
    }
    const keys = before.size
        ? [...next.posts.flatMap(post => [...(before.get(post.key) ?? []), post.key]), ...pending]
        : [...pending, ...next.posts.map(post => post.key)];
    return { ...next, limited: previous.limited || next.limited,
        posts: [...new Set(keys)].map(key => posts.get(key)) };
}
/** A retry supplements only the requested posts; disappearing DOM cannot erase evidence. */
export function supplementXSnapshot(previous, retry) {
    const replacements = new Map(retry.posts.map(post => [post.key, post]));
    return { ...previous, limited: retry.limited,
        posts: previous.posts.map(post => {
            const replacement = replacements.get(post.key);
            if (!replacement)
                return post;
            return { ...post, observed: uniqueEvidence(post.observed, replacement.observed),
                roots: [...post.roots, ...replacement.roots] };
        }) };
}
