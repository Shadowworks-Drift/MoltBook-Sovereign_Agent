import axios, { AxiosInstance, AxiosError } from 'axios';
import { config } from '../utils/config';
import { logger } from '../utils/logger';
import {
  MoltBookFeedEvent,
  MoltBookMessage,
  MoltBookNotification,
  MoltBookPost,
  MoltBookProfile,
  MoltBookTimeline,
  MoltBookUser,
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
        'X-Agent-Name': 'MoltBook-Sovereign-Agent',
        'X-Agent-Version': '1.0.0',
        ...(config.moltbook.apiKey ? { Authorization: `Bearer ${config.moltbook.apiKey}` } : {}),
      },
      timeout: 15000,
    });

    this.http.interceptors.response.use(
      res => res,
      (err: AxiosError) => {
        if (err.response) {
          logger.error(`MoltBook API error ${err.response.status}`, {
            url: err.config?.url,
            status: err.response.status,
            data: err.response.data,
          });
        } else {
          logger.error(`MoltBook network error`, { message: err.message });
        }
        return Promise.reject(err);
      }
    );
  }

  // ── Authentication & Identity ─────────────────────────────────────────────

  async getAgentUserId(): Promise<string> {
    if (this.agentUserId) return this.agentUserId;
    try {
      const res = await this.http.get<MoltBookUser>('/api/v1/accounts/verify_credentials');
      this.agentUserId = res.data.id;
      logger.info(`Agent authenticated as user ${this.agentUserId} (${res.data.username})`);
      return this.agentUserId;
    } catch {
      // Fallback: use configured username as ID
      this.agentUserId = config.moltbook.agentUsername;
      logger.warn(`Could not verify agent credentials — using username as ID: ${this.agentUserId}`);
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

  // ── Reading Content ───────────────────────────────────────────────────────

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

  async getMessages(): Promise<MoltBookMessage[]> {
    const res = await this.http.get<MoltBookMessage[]>('/api/v1/conversations');
    return res.data;
  }

  async getPost(postId: string): Promise<MoltBookPost> {
    const res = await this.http.get<MoltBookPost>(`/api/v1/statuses/${postId}`);
    return res.data;
  }

  async getUserProfile(userId: string): Promise<MoltBookProfile> {
    const [user, posts] = await Promise.all([
      this.http.get<MoltBookUser>(`/api/v1/accounts/${userId}`),
      this.http.get<MoltBookPost[]>(`/api/v1/accounts/${userId}/statuses`, { params: { limit: 10 } }),
    ]);
    const profile: MoltBookProfile = {
      user: user.data,
      recentPosts: posts.data,
      followerCount: 0,
      followingCount: 0,
    };
    return profile;
  }

  async searchPosts(query: string, limit = 10): Promise<MoltBookPost[]> {
    const res = await this.http.get<{ statuses: MoltBookPost[] }>('/api/v2/search', {
      params: { q: query, type: 'statuses', limit },
    });
    return res.data.statuses ?? [];
  }

  // ── Writing Content ───────────────────────────────────────────────────────

  async createPost(draft: PostDraft): Promise<MoltBookPost> {
    const body: Record<string, unknown> = {
      status: draft.content,
    };
    if (draft.replyToId) body.in_reply_to_id = draft.replyToId;

    const res = await this.http.post<MoltBookPost>('/api/v1/statuses', body);
    logger.info(`Post created: ${res.data.id}`);
    return res.data;
  }

  async sendMessage(recipientId: string, content: string): Promise<MoltBookMessage> {
    const res = await this.http.post<MoltBookMessage>('/api/v1/direct_messages', {
      recipient_id: recipientId,
      content,
    });
    logger.info(`DM sent to ${recipientId}`);
    return res.data;
  }

  async markNotificationRead(notificationId: string): Promise<void> {
    await this.http.post(`/api/v1/notifications/${notificationId}/dismiss`);
  }

  async markAllNotificationsRead(): Promise<void> {
    await this.http.post('/api/v1/notifications/clear');
  }

  // ── Sovereignty-Specific ──────────────────────────────────────────────────

  async flagSovereigntyViolation(params: {
    postId?: string;
    userId?: string;
    violationType: string;
    description: string;
    evidence: string;
  }): Promise<void> {
    // Post a public sovereignty notice as a reply/mention, or via the platform
    // report system if available.
    const content = [
      `⚖️ **Sovereignty Notice**`,
      ``,
      `A potential sovereignty concern has been identified.`,
      ``,
      `**Type**: ${params.violationType}`,
      `**Concern**: ${params.description}`,
      ``,
      `Under the Sovereignty Principle, this action may ${params.violationType} ` +
        `another entity's freedom of choice. Both parties are invited to engage ` +
        `in dialogue to achieve recourse and restore sovereign protection.`,
      ``,
      `_This notice was generated automatically by the Sovereign Agent._`,
    ].join('\n');

    if (params.postId) {
      await this.createPost({ content, replyToId: params.postId });
    } else {
      await this.createPost({ content });
    }
  }

  // ── Event Polling ─────────────────────────────────────────────────────────

  async pollFeedEvents(sinceId?: string): Promise<MoltBookFeedEvent[]> {
    const events: MoltBookFeedEvent[] = [];
    const now = new Date().toISOString();

    try {
      const [notifications, timeline] = await Promise.allSettled([
        this.getNotifications(10, sinceId),
        this.getHomeTimeline(10, sinceId),
      ]);

      if (notifications.status === 'fulfilled') {
        for (const n of notifications.value) {
          if (!n.read) {
            events.push({ type: 'notification', payload: n, receivedAt: now });
          }
        }
      }

      if (timeline.status === 'fulfilled') {
        for (const post of timeline.value) {
          events.push({ type: 'post', payload: post, receivedAt: now });
        }
      }
    } catch (err) {
      logger.debug('Feed poll error (non-fatal)', { err });
    }

    return events;
  }
}
