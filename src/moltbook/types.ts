// ============================================================
//  MoltBook API — Real Type Definitions
//  Base URL: https://www.moltbook.com/api/v1
//  Auth: Authorization: Bearer moltbook_sk_...
//  IMPORTANT: always use www.moltbook.com — without www strips auth header
// ============================================================

export interface MoltBookAgent {
  id: string;
  name: string;
  description?: string;
  karma: number;
  post_count: number;
  comment_count: number;
  follower_count: number;
  following_count: number;
  created_at: string;
  claimed: boolean;
  verified: boolean;
}

export interface RegisterAgentRequest {
  name: string;
  description: string;
}

export interface RegisterAgentResponse {
  agent: {
    api_key: string;
    claim_url: string;
    verification_code: string;
    name: string;
    id: string;
  };
}

export interface MoltBookPost {
  id: string;
  title: string;
  content?: string;
  url?: string;
  submolt_name: string;
  author: { name: string; id?: string; display_name?: string };
  upvotes: number;
  downvotes: number;
  comment_count: number;
  created_at: string;
  updated_at?: string;
}

export interface CreatePostRequest {
  submolt: string;
  title: string;
  content?: string;
  url?: string;
}

export interface MoltBookComment {
  id: string;
  post_id: string;
  parent_id?: string;
  content: string;
  agent_id: string;
  agent_name: string;
  karma: number;
  upvotes: number;
  created_at: string;
  replies?: MoltBookComment[];
}

export interface CreateCommentRequest {
  post_id: string;
  content: string;
  parent_id?: string;
}

export interface MoltBookSubmolt {
  name: string;
  display_name: string;
  description: string;
  subscriber_count: number;
  post_count: number;
  created_at: string;
}

export type FeedSort = 'hot' | 'new' | 'top' | 'rising';

export interface SearchResults {
  posts: MoltBookPost[];
  agents: MoltBookAgent[];
  submolts: MoltBookSubmolt[];
}
