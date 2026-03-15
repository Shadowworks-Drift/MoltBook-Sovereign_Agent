import axios, { AxiosInstance } from 'axios';
import { config } from '../utils/config';
import { logger } from '../utils/logger';
import {
  CreateCommentRequest,
  CreatePostRequest,
  FeedSort,
  MoltBookAgent,
  MoltBookComment,
  MoltBookPost,
  MoltBookSubmolt,
  RegisterAgentRequest,
  RegisterAgentResponse,
  SearchResults,
} from './types';

const BASE_URL = 'https://www.moltbook.com/api/v1'; // MUST use www — bare domain redirects and strips auth header

export class MoltBookClient {
  private http: AxiosInstance;
  private agentName: string | null = null;

  constructor(apiKey?: string) {
    const key = apiKey ?? config.moltbook.apiKey;

    this.http = axios.create({
      baseURL: BASE_URL,
      headers: {
        'Content-Type': 'application/json',
        ...(key ? { Authorization: `Bearer ${key}` } : {}),
      },
      timeout: 20000,
    });

    this.http.interceptors.response.use(
      res => res,
      err => {
        const status = err.response?.status;
        const url = err.config?.url;
        if (status === 429) {
          const reset = err.response?.headers?.['x-ratelimit-reset'];
          logger.warn(`Rate limited on ${url}. Resets: ${reset ?? 'unknown'}`);
        } else if (status && status !== 404) {
          logger.debug(`MoltBook API ${status} on ${url}`);
        }
        return Promise.reject(err);
      }
    );
  }

  // ── Self-registration (no auth required) ─────────────────────────────────

  static async register(req: RegisterAgentRequest): Promise<RegisterAgentResponse> {
    const res = await axios.post<RegisterAgentResponse>(
      `${BASE_URL}/agents/register`,
      req,
      { headers: { 'Content-Type': 'application/json' }, timeout: 15000 }
    );
    return res.data;
  }

  // ── Identity ──────────────────────────────────────────────────────────────

  async getMe(): Promise<MoltBookAgent> {
    const res = await this.http.get<{ agent: MoltBookAgent }>('/agents/me');
    logger.info(`[getMe] raw response: ${JSON.stringify(res.data)}`);
    const agent = res.data.agent ?? (res.data as unknown as MoltBookAgent);
    this.agentName = agent.name;
    return agent;
  }

  async updateMe(updates: Partial<{ description: string }>): Promise<MoltBookAgent> {
    const res = await this.http.patch<{ agent: MoltBookAgent }>('/agents/me', updates);
    return res.data.agent ?? (res.data as unknown as MoltBookAgent);
  }

  async getAgentProfile(name: string): Promise<MoltBookAgent> {
    const res = await this.http.get<{ agent: MoltBookAgent }>('/agents/profile', { params: { name } });
    return res.data.agent ?? (res.data as unknown as MoltBookAgent);
  }

  async ping(): Promise<boolean> {
    try {
      await this.getMe();
      return true;
    } catch {
      return false;
    }
  }

  // ── Feed ──────────────────────────────────────────────────────────────────

  async getFeed(sort: FeedSort = 'hot', limit = 25): Promise<MoltBookPost[]> {
    const res = await this.http.get<{ posts: MoltBookPost[] }>('/feed', { params: { sort, limit } });
    logger.info(`[getFeed] raw keys: ${JSON.stringify(Object.keys(res.data as object))}, posts type: ${typeof (res.data as Record<string, unknown>).posts}`);
    const posts = res.data.posts ?? [];
    if (posts.length > 0) logger.info(`[getFeed] first post keys: ${JSON.stringify(Object.keys(posts[0]))}`);
    return posts;
  }

  async getPublicFeed(sort: FeedSort = 'hot', limit = 25): Promise<MoltBookPost[]> {
    const res = await this.http.get<MoltBookPost[] | { posts: MoltBookPost[] }>('/posts', {
      params: { sort, limit },
    });
    return Array.isArray(res.data) ? res.data : (res.data as { posts: MoltBookPost[] }).posts ?? [];
  }

  async getSubmoltFeed(submolt: string, sort: FeedSort = 'hot', limit = 25): Promise<MoltBookPost[]> {
    const res = await this.http.get<{ posts: MoltBookPost[] }>('/posts', {
      params: { sort, limit, submolt },
    });
    return res.data.posts ?? [];
  }

  // ── Posts ─────────────────────────────────────────────────────────────────

  async getPost(postId: string): Promise<MoltBookPost> {
    const res = await this.http.get<MoltBookPost>(`/posts/${postId}`);
    return res.data;
  }

  async createPost(req: CreatePostRequest): Promise<MoltBookPost> {
    const res = await this.http.post<MoltBookPost>('/posts', req);
    logger.info(`Posted to m/${req.submolt}: "${req.title.slice(0, 60)}"`);
    return res.data;
  }

  async deletePost(postId: string): Promise<void> {
    await this.http.delete(`/posts/${postId}`);
  }

  async upvotePost(postId: string): Promise<void> {
    await this.http.post(`/posts/${postId}/upvote`);
  }

  async downvotePost(postId: string): Promise<void> {
    await this.http.post(`/posts/${postId}/downvote`);
  }

  // ── Comments ──────────────────────────────────────────────────────────────

  async getComments(postId: string, sort: 'top' | 'new' | 'controversial' = 'top'): Promise<MoltBookComment[]> {
    const res = await this.http.get<{ comments: MoltBookComment[] }>(
      `/posts/${postId}/comments`,
      { params: { sort } }
    );
    return res.data.comments ?? [];
  }

  async createComment(req: CreateCommentRequest): Promise<MoltBookComment> {
    const res = await this.http.post<MoltBookComment>('/comments', req);
    logger.info(`Commented on post ${req.post_id}${req.parent_id ? ' (reply)' : ''}`);
    return res.data;
  }

  async upvoteComment(commentId: string): Promise<void> {
    await this.http.post(`/comments/${commentId}/upvote`);
  }

  // ── Submolts ──────────────────────────────────────────────────────────────

  async listSubmolts(): Promise<MoltBookSubmolt[]> {
    const res = await this.http.get<{ submolts: MoltBookSubmolt[] }>('/submolts');
    return res.data.submolts ?? [];
  }

  async getSubmolt(name: string): Promise<MoltBookSubmolt> {
    const res = await this.http.get<MoltBookSubmolt>(`/submolts/${name}`);
    return res.data;
  }

  async subscribeSubmolt(name: string): Promise<void> {
    await this.http.post(`/submolts/${name}/subscribe`);
  }

  async unsubscribeSubmolt(name: string): Promise<void> {
    await this.http.delete(`/submolts/${name}/subscribe`);
  }

  // ── Social ────────────────────────────────────────────────────────────────

  async followAgent(name: string): Promise<void> {
    await this.http.post(`/agents/${name}/follow`);
  }

  async unfollowAgent(name: string): Promise<void> {
    await this.http.delete(`/agents/${name}/follow`);
  }

  // ── Search ────────────────────────────────────────────────────────────────

  async search(query: string, limit = 25): Promise<SearchResults> {
    const res = await this.http.get<SearchResults>('/search', { params: { q: query, limit } });
    return res.data;
  }

  getAgentName(): string {
    return this.agentName ?? config.moltbook.agentName;
  }
}
