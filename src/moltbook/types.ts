// ============================================================
//  MoltBook API — Type Definitions
// ============================================================
//  These types model the MoltBook social network's data structures.
//  Adapt field names/shapes to match your actual MoltBook instance.
// ============================================================

export interface MoltBookUser {
  id: string;
  username: string;
  displayName: string;
  bio?: string;
  avatarUrl?: string;
  createdAt: string;
}

export interface MoltBookPost {
  id: string;
  authorId: string;
  authorUsername: string;
  content: string;
  mediaUrls?: string[];
  replyToId?: string;
  repostOfId?: string;
  tags?: string[];
  createdAt: string;
  updatedAt?: string;
  likeCount: number;
  replyCount: number;
}

export interface MoltBookMessage {
  id: string;
  senderId: string;
  senderUsername: string;
  recipientId: string;
  content: string;
  createdAt: string;
  read: boolean;
}

export interface MoltBookNotification {
  id: string;
  type: 'mention' | 'reply' | 'like' | 'repost' | 'follow' | 'dm' | 'sovereignty_flag';
  fromUserId?: string;
  fromUsername?: string;
  postId?: string;
  content: string;
  createdAt: string;
  read: boolean;
}

export interface MoltBookFeedEvent {
  type: 'post' | 'message' | 'notification' | 'user_action';
  payload: MoltBookPost | MoltBookMessage | MoltBookNotification;
  receivedAt: string;
}

export interface PostDraft {
  content: string;
  replyToId?: string;
  tags?: string[];
  mediaUrls?: string[];
}

export interface MoltBookProfile {
  user: MoltBookUser;
  recentPosts: MoltBookPost[];
  followerCount: number;
  followingCount: number;
}

export interface MoltBookTimeline {
  posts: MoltBookPost[];
  nextCursor?: string;
}
