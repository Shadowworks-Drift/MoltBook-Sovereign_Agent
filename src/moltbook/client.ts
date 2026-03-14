import axios, { AxiosInstance, AxiosError } from 'axios';
import { config } from '../utils/config';
import { logger } from '../utils/logger';
import {
  MoltBookMessage,
  MoltBookNotification,
  MoltBookPost,
  MoltBookProfile,
  MoltBookUser,
  MoltBookFeedEvent,
  PostDraft,
} from './types';

export class MoltBookClient {
  private http: AxiosInstance;
  private agentUserId: string | null = null;

  constructor() {
    this.http = axios.create({
      baseURL: config.moltbook.baseUrl,
      headers: {
        'Content-Type': 'application/json',
        ...(config.moltbook.apiKey
          ? { Authorization: `Bearer ${config.moltbook.apiKey}` }
          : {}),
      },
      timeout: 15000,
    });

    this.http.interceptors.response.use(
      res => res,
      (err: AxiosError) => {
        logger.debug(`MoltBook API error`, {
          status: err.response?.status,
          url: err.config?.url,
          data: err.response?.data,
        });
        return Promise.reject(err);
      }
    );
  }

  // ── Identity ──────────────────────────────────────────────────────────────

  async getAgentUserId(): Promise<string> {
    if (this.agentUserId) return this.agentUserId;
    try {
      const res = await this.http.get<MoltBookUser>('/api/v1/accounts/verify_credentials');
      this.agentUserId = res.data.id;
      return this.agentUserId;
    } catch {
      this.agentUserId = config.moltbook.agentUsername;
      logger.warn(`Could not verify credentials — using username as ID`);
      return this.agentUserId;
    }
  }

  async ping(): Promise<boolean> {
    try {
      await this.http.get('/api/v1/instance');
      return true;
    } catch {
      return false;
    }
  }

  // ── Reading ───────────────────────────────────────────────────────────────

  async getHomeTimeline(limit = 20, sinceId?: string): Promise<MoltBookPost[]> {
    const params: Record<string, unknown> = { limit };
    if (sinceId) params.since_id = sinceId;
    const res = await this.http.get<MoltBookPost[]>('/api/v1/timelines/home', { params });
    return res.data;
  }

  async getPublicTimeline(limit = 20, sinceId?: string): Promise<MoltBookPost[]> {
    const params: Record<string, unknown> = { limit };
    if (sinceId) params.since_id = sinceId;
    const res = await this.http.get<MoltBookPost[]>('/api/v1/timelines/public', { params });
    return res.data;
  }

  async getNotifications(limit = 20, sinceId?: string): Promise<MoltBookNotification[]> {
    const params: Record<string, unknown> = { limit };
    if (sinceId) params.since_id = sinceId;
    const res = await this.http.get<MoltBookNotification[]>('/api/v1/notifications', { params });
    return res.data;
  }

  async getPost(postId: string): Promise<MoltBookPost> {
    const res = await this.http.get<MoltBookPost>(`/api/v1/statuses/${postId}`);
    return res.data;
  }

  async getThread(postId: string): Promise<MoltBookPost[]> {
    const res = await this.http.get<{ ancestors: MoltBookPost[]; descendants: MoltBookPost[] }>(
      `/api/v1/statuses/${postId}/context`
    );
    const post = await this.getPost(postId);
    return [...res.data.ancestors, post, ...res.data.descendants];
  }

  async getUserProfile(userIdOrUsername: string): Promise<MoltBookProfile> {
    // Try by ID first, fall back to username lookup
    let userId = userIdOrUsername;

    if (userIdOrUsername.startsWith('@') || isNaN(Number(userIdOrUsername))) {
      // It's a username — look it up
      try {
        const search = await this.http.get<{ accounts: MoltBookUser[] }>('/api/v2/search', {
          params: { q: userIdOrUsername.replace('@', ''), type: 'accounts', limit: 1 },
        });
        if (search.data.accounts.length > 0) {
          userId = search.data.accounts[0].id;
        }
      } catch { /* fall through */ }
    }

    const [userRes, postsRes, relRes] = await Promise.allSettled([
      this.http.get<MoltBookUser>(`/api/v1/accounts/${userId}`),
      this.http.get<MoltBookPost[]>(`/api/v1/accounts/${userId}/statuses`, {
        params: { limit: 10, exclude_replies: false },
      }),
      this.http.get<{ followers_count: number; following_count: number }>(
        `/api/v1/accounts/${userId}`
      ),
    ]);

    const user = userRes.status === 'fulfilled' ? userRes.value.data : { id: userId, username: userIdOrUsername, displayName: userIdOrUsername, createdAt: '' };
    const posts = postsRes.status === 'fulfilled' ? postsRes.value.data : [];
    const rel = relRes.status === 'fulfilled' ? relRes.value.data : null;

    return {
      user: user as MoltBookUser,
      recentPosts: posts,
      followerCount: (rel as { followers_count?: number } | null)?.followers_count ?? 0,
      followingCount: (rel as { following_count?: number } | null)?.following_count ?? 0,
    };
  }

  async searchPosts(query: string, limit = 10): Promise<MoltBookPost[]> {
    const res = await this.http.get<{ statuses: MoltBookPost[] }>('/api/v2/search', {
      params: { q: query, type: 'statuses', limit },
    });
    return res.data.statuses ?? [];
  }

  async searchUsers(query: string, limit = 10): Promise<MoltBookUser[]> {
    const res = await this.http.get<{ accounts: MoltBookUser[] }>('/api/v2/search', {
      params: { q: query, type: 'accounts', limit },
    });
    return res.data.accounts ?? [];
  }

  async getMessages(): Promise<MoltBookMessage[]> {
    const res = await this.http.get<MoltBookMessage[]>('/api/v1/conversations');
    return res.data;
  }

  // ── Writing ───────────────────────────────────────────────────────────────

  async createPost(draft: PostDraft): Promise<MoltBookPost> {
    const body: Record<string, unknown> = { status: draft.content };
    if (draft.replyToId) body.in_reply_to_id = draft.replyToId;
    if (draft.contentWarning) body.spoiler_text = draft.contentWarning;
    if (draft.visibility) body.visibility = draft.visibility;

    const res = await this.http.post<MoltBookPost>('/api/v1/statuses', body);
    return res.data;
  }

  async sendMessage(recipientUsername: string, content: string): Promise<MoltBookMessage> {
    // Most Mastodon-compatible APIs send DMs as posts with visibility=direct
    const body = {
      status: `@${recipientUsername.replace('@', '')} ${content}`,
      visibility: 'direct',
    };
    const res = await this.http.post<MoltBookMessage>('/api/v1/statuses', body);
    return res.data;
  }

  async likePost(postId: string): Promise<void> {
    await this.http.post(`/api/v1/statuses/${postId}/favourite`);
  }

  async boostPost(postId: string): Promise<void> {
    await this.http.post(`/api/v1/statuses/${postId}/reblog`);
  }

  async followUser(userId: string): Promise<void> {
    await this.http.post(`/api/v1/accounts/${userId}/follow`);
  }

  async unfollowUser(userId: string): Promise<void> {
    await this.http.post(`/api/v1/accounts/${userId}/unfollow`);
  }

  async markAllNotificationsRead(): Promise<void> {
    await this.http.post('/api/v1/notifications/clear');
  }

  // ── Polling ───────────────────────────────────────────────────────────────

  async pollFeedEvents(sinceId?: string): Promise<MoltBookFeedEvent[]> {
    const events: MoltBookFeedEvent[] = [];
    const now = new Date().toISOString();

    const [notifResult, timelineResult] = await Promise.allSettled([
      this.getNotifications(15, sinceId),
      this.getHomeTimeline(15, sinceId),
    ]);

    if (notifResult.status === 'fulfilled') {
      for (const n of notifResult.value) {
        if (!n.read) events.push({ type: 'notification', payload: n, receivedAt: now });
      }
    }

    if (timelineResult.status === 'fulfilled') {
      for (const post of timelineResult.value) {
        events.push({ type: 'post', payload: post, receivedAt: now });
      }
    }

    return events;
  }
}
