/**
 * Platforms.gs — one adapter per channel.
 *
 * Every adapter exposes the same shape so Code.gs never needs to know which network a
 * message came from:
 *
 *   fetchComments()            -> [ {id, text, author, platform, postId, kind:'comment'} ]
 *   fetchDMs()                 -> [ {id, text, author, platform, threadId,  kind:'dm'} ]
 *   postReply(id, text)        -> posts a public reply to a comment
 *   sendDM(threadId, text)     -> sends a private message
 *
 * Adapters that a network genuinely doesn't support are simply absent, and Code.gs
 * skips them. Nothing here pretends to do something the platform can't.
 */

const GRAPH = 'https://graph.facebook.com/v21.0/';

// ===========================================================================
// Shared HTTP helpers
// ===========================================================================

function httpGetJson_(url, headers) {
  const res = UrlFetchApp.fetch(url, {
    muteHttpExceptions: true,
    headers: headers || {},
  });
  const body = res.getContentText();
  if (res.getResponseCode() !== 200) {
    throw new Error('GET ' + res.getResponseCode() + ': ' + body.slice(0, 300));
  }
  return JSON.parse(body);
}

function httpPost_(url, payload, headers, asJson) {
  const opts = {
    method: 'post',
    muteHttpExceptions: true,
    headers: headers || {},
  };
  if (asJson) {
    opts.contentType = 'application/json';
    opts.payload = JSON.stringify(payload);
  } else {
    opts.payload = payload;
  }
  const res = UrlFetchApp.fetch(url, opts);
  if (res.getResponseCode() !== 200) {
    throw new Error('POST ' + res.getResponseCode() + ': ' +
      res.getContentText().slice(0, 300));
  }
  return res.getContentText();
}

// ===========================================================================
// INSTAGRAM  — comments ✅  DMs ✅
// ===========================================================================

const Instagram = {
  fetchComments() {
    const cfg = PLATFORMS.instagram;
    if (!cfg.igUserId) return [];
    const token = getSecret_(PROP.META_TOKEN);
    const out = [];

    const media = httpGetJson_(GRAPH + cfg.igUserId + '/media?fields=id&limit=' +
      CONFIG.MEDIA_TO_SCAN + '&access_token=' + encodeURIComponent(token)).data || [];

    for (const m of media) {
      const comments = httpGetJson_(GRAPH + m.id +
        '/comments?fields=id,text,username&limit=25&access_token=' +
        encodeURIComponent(token)).data || [];
      for (const c of comments) {
        if (!c.text) continue;
        out.push({
          id: c.id, text: c.text, author: c.username || 'unknown',
          platform: 'instagram', postId: m.id, kind: 'comment',
        });
      }
    }
    return out;
  },

  fetchDMs() {
    const cfg = PLATFORMS.instagram;
    if (!cfg.dm || !cfg.igUserId) return [];
    const token = getSecret_(PROP.META_TOKEN);
    const out = [];

    // Instagram DM threads live on the linked Page's conversations edge.
    const url = GRAPH + cfg.igUserId +
      '/conversations?platform=instagram&fields=participants,messages.limit(1)' +
      '{id,message,from,created_time}&limit=20&access_token=' + encodeURIComponent(token);

    const threads = httpGetJson_(url).data || [];
    for (const t of threads) {
      const msgs = (t.messages && t.messages.data) || [];
      for (const m of msgs) {
        // Skip our own messages — only reply to what the customer sent.
        if (!m.message || (m.from && m.from.id === cfg.igUserId)) continue;
        out.push({
          id: m.id, text: m.message,
          author: (m.from && (m.from.username || m.from.name)) || 'unknown',
          platform: 'instagram', threadId: (m.from && m.from.id) || t.id, kind: 'dm',
        });
      }
    }
    return out;
  },

  postReply(commentId, text) {
    return httpPost_(GRAPH + commentId + '/replies',
      { message: text, access_token: getSecret_(PROP.META_TOKEN) });
  },

  sendDM(recipientId, text) {
    return httpPost_(GRAPH + PLATFORMS.instagram.igUserId + '/messages', {
      recipient: JSON.stringify({ id: recipientId }),
      message: JSON.stringify({ text: text }),
      access_token: getSecret_(PROP.META_TOKEN),
    });
  },

  /** Instagram allows ONE private message in response to a comment. Highest-converting move. */
  privateReplyToComment(commentId, text) {
    return httpPost_(GRAPH + PLATFORMS.instagram.igUserId + '/messages', {
      recipient: JSON.stringify({ comment_id: commentId }),
      message: JSON.stringify({ text: text }),
      access_token: getSecret_(PROP.META_TOKEN),
    });
  },
};

// ===========================================================================
// FACEBOOK  — comments ✅  DMs ✅
// ===========================================================================

const Facebook = {
  fetchComments() {
    const cfg = PLATFORMS.facebook;
    if (!cfg.pageId) return [];
    const token = getSecret_(PROP.META_TOKEN);
    const out = [];

    const posts = httpGetJson_(GRAPH + cfg.pageId + '/posts?fields=id&limit=' +
      CONFIG.MEDIA_TO_SCAN + '&access_token=' + encodeURIComponent(token)).data || [];

    for (const p of posts) {
      const comments = httpGetJson_(GRAPH + p.id +
        '/comments?fields=id,message,from&limit=25&access_token=' +
        encodeURIComponent(token)).data || [];
      for (const c of comments) {
        if (!c.message) continue;
        // Don't reply to our own Page's comments.
        if (c.from && c.from.id === cfg.pageId) continue;
        out.push({
          id: c.id, text: c.message,
          author: (c.from && c.from.name) || 'unknown',
          platform: 'facebook', postId: p.id, kind: 'comment',
        });
      }
    }
    return out;
  },

  fetchDMs() {
    const cfg = PLATFORMS.facebook;
    if (!cfg.dm || !cfg.pageId) return [];
    const token = getSecret_(PROP.META_TOKEN);
    const out = [];

    const url = GRAPH + cfg.pageId +
      '/conversations?fields=participants,messages.limit(1){id,message,from}' +
      '&limit=20&access_token=' + encodeURIComponent(token);

    const threads = httpGetJson_(url).data || [];
    for (const t of threads) {
      const msgs = (t.messages && t.messages.data) || [];
      for (const m of msgs) {
        if (!m.message || (m.from && m.from.id === cfg.pageId)) continue;
        out.push({
          id: m.id, text: m.message,
          author: (m.from && m.from.name) || 'unknown',
          platform: 'facebook', threadId: (m.from && m.from.id) || t.id, kind: 'dm',
        });
      }
    }
    return out;
  },

  postReply(commentId, text) {
    return httpPost_(GRAPH + commentId + '/comments',
      { message: text, access_token: getSecret_(PROP.META_TOKEN) });
  },

  sendDM(recipientId, text) {
    return httpPost_(GRAPH + PLATFORMS.facebook.pageId + '/messages', {
      recipient: JSON.stringify({ id: recipientId }),
      message: JSON.stringify({ text: text }),
      messaging_type: 'RESPONSE',
      access_token: getSecret_(PROP.META_TOKEN),
    });
  },
};

// ===========================================================================
// YOUTUBE  — comments ✅  DMs: do not exist on YouTube
// ===========================================================================

const YouTube = {
  fetchComments() {
    const cfg = PLATFORMS.youtube;
    if (!cfg.channelId || !hasSecret_(PROP.YOUTUBE_TOKEN)) return [];
    const headers = { Authorization: 'Bearer ' + getSecret_(PROP.YOUTUBE_TOKEN) };
    const out = [];

    const url = 'https://www.googleapis.com/youtube/v3/commentThreads' +
      '?part=snippet&allThreadsRelatedToChannelId=' + encodeURIComponent(cfg.channelId) +
      '&order=time&maxResults=25';

    const items = httpGetJson_(url, headers).items || [];
    for (const it of items) {
      const top = it.snippet && it.snippet.topLevelComment;
      if (!top) continue;
      const s = top.snippet || {};
      // Skip our own channel's comments.
      if (s.authorChannelId && s.authorChannelId.value === cfg.channelId) continue;
      out.push({
        id: top.id, text: s.textOriginal || '',
        author: s.authorDisplayName || 'unknown',
        platform: 'youtube', postId: it.snippet.videoId, kind: 'comment',
      });
    }
    return out.filter(c => c.text);
  },

  postReply(commentId, text) {
    return httpPost_(
      'https://www.googleapis.com/youtube/v3/comments?part=snippet',
      { snippet: { parentId: commentId, textOriginal: text } },
      { Authorization: 'Bearer ' + getSecret_(PROP.YOUTUBE_TOKEN) },
      true);
  },
};

// ===========================================================================
// TIKTOK  — comments ✅ (official Business API only)  DMs: no API exists
//
// Requires approved access to business-api.tiktok.com. If your application isn't
// approved, leave tiktok.enabled = false — the system simply skips it.
// NEVER drive TikTok with a browser bot: it violates their terms and gets the
// account banned, which would cost far more than the automation is worth.
// ===========================================================================

const TIKTOK_API = 'https://business-api.tiktok.com/open_api/v1.3/';

const TikTok = {
  fetchComments() {
    const cfg = PLATFORMS.tiktok;
    if (!cfg.businessId || !hasSecret_(PROP.TIKTOK_TOKEN)) return [];
    const headers = { 'Access-Token': getSecret_(PROP.TIKTOK_TOKEN) };
    const out = [];

    const url = TIKTOK_API + 'business/comment/list/?business_id=' +
      encodeURIComponent(cfg.businessId) + '&max_count=25';

    const body = httpGetJson_(url, headers);
    const comments = (body.data && body.data.comments) || [];
    for (const c of comments) {
      if (!c.text) continue;
      out.push({
        id: c.comment_id, text: c.text,
        author: c.username || 'unknown',
        platform: 'tiktok', postId: c.video_id, kind: 'comment',
      });
    }
    return out;
  },

  postReply(commentId, text) {
    return httpPost_(TIKTOK_API + 'business/comment/reply/', {
      business_id: PLATFORMS.tiktok.businessId,
      comment_id: commentId,
      text: text,
    }, { 'Access-Token': getSecret_(PROP.TIKTOK_TOKEN) }, true);
  },
};

// ===========================================================================
// Registry
// ===========================================================================

const ADAPTERS = {
  instagram: Instagram,
  facebook: Facebook,
  youtube: YouTube,
  tiktok: TikTok,
};

function adapterFor_(platform) {
  const a = ADAPTERS[platform];
  if (!a) throw new Error('Unknown platform: ' + platform);
  return a;
}
