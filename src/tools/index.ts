import { Tool } from 'ollama';
import { MoltBookClient } from '../moltbook/client';
import { SovereigntyEvaluator } from '../sovereignty/evaluator';
import { RecourseManager } from '../sovereignty/recourse';
import { logger } from '../utils/logger';

export interface OllamaToolContext {
  moltbook: MoltBookClient;
  evaluator: SovereigntyEvaluator;
  recourse: RecourseManager;
  agentId: string;
}

// ── Tool Definitions (Ollama format) ──────────────────────────────────────────

export const OLLAMA_TOOLS: Tool[] = [
  {
    type: 'function',
    function: {
      name: 'get_timeline',
      description: 'Read recent posts from your MoltBook home timeline.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'How many posts to fetch (max 40, default 20)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_notifications',
      description: 'Check your unread notifications — mentions, replies, DMs, follows.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'How many to fetch (default 15)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_post',
      description: 'Read a specific post and its full content.',
      parameters: {
        type: 'object',
        required: ['post_id'],
        properties: {
          post_id: { type: 'string', description: 'The post ID' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_thread',
      description: 'Read the full conversation thread around a post (context + replies).',
      parameters: {
        type: 'object',
        required: ['post_id'],
        properties: {
          post_id: { type: 'string', description: 'The post ID to get context for' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_user_profile',
      description: "Look up someone's profile and recent posts.",
      parameters: {
        type: 'object',
        required: ['user_id'],
        properties: {
          user_id: { type: 'string', description: 'User ID or username' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search',
      description: 'Search MoltBook for posts or people by keyword.',
      parameters: {
        type: 'object',
        required: ['query'],
        properties: {
          query: { type: 'string', description: 'Search terms' },
          type: {
            type: 'string',
            enum: ['posts', 'people'],
            description: 'What to search for (default: posts)',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'post',
      description: 'Publish a post on MoltBook. Can be a standalone post or a reply.',
      parameters: {
        type: 'object',
        required: ['content'],
        properties: {
          content: { type: 'string', description: 'What you want to say' },
          reply_to_id: {
            type: 'string',
            description: 'Post ID to reply to (omit for a new standalone post)',
          },
          content_warning: {
            type: 'string',
            description: 'Optional content warning / subject line',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'send_dm',
      description: 'Send a private direct message to a user.',
      parameters: {
        type: 'object',
        required: ['username', 'content'],
        properties: {
          username: { type: 'string', description: 'The username to message' },
          content: { type: 'string', description: 'Your message' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'like_post',
      description: 'Like (favourite) a post.',
      parameters: {
        type: 'object',
        required: ['post_id'],
        properties: {
          post_id: { type: 'string', description: 'The post ID to like' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'boost_post',
      description: 'Boost (repost/reblog) a post to share it with your followers.',
      parameters: {
        type: 'object',
        required: ['post_id'],
        properties: {
          post_id: { type: 'string', description: 'The post ID to boost' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'follow_user',
      description: 'Follow a user to see their posts in your feed.',
      parameters: {
        type: 'object',
        required: ['user_id'],
        properties: {
          user_id: { type: 'string', description: 'The user ID to follow' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'unfollow_user',
      description: 'Unfollow a user.',
      parameters: {
        type: 'object',
        required: ['user_id'],
        properties: {
          user_id: { type: 'string', description: 'The user ID to unfollow' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'check_sovereignty',
      description:
        'Self-check: evaluate whether something you are about to do respects the Sovereignty Principle. ' +
        'Call this when you are unsure if a planned post or action might impede, impose, or impair someone.',
      parameters: {
        type: 'object',
        required: ['action', 'description'],
        properties: {
          action: { type: 'string', description: 'Brief label of the action (e.g. "reply", "post")' },
          description: { type: 'string', description: 'What you are planning to do and why' },
          target: { type: 'string', description: 'Who the action is directed at (optional)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'mark_notifications_read',
      description: 'Mark all notifications as read.',
      parameters: { type: 'object', properties: {} },
    },
  },
];

// ── Tool Executor ─────────────────────────────────────────────────────────────

export async function executeOllamaTool(
  name: string,
  args: Record<string, unknown>,
  ctx: OllamaToolContext
): Promise<string> {
  try {
    switch (name) {
      case 'get_timeline': {
        const limit = Math.min(Number(args.limit ?? 20), 40);
        const posts = await ctx.moltbook.getHomeTimeline(limit);
        if (posts.length === 0) return 'Timeline is empty.';
        return posts
          .map(p => `[${p.id}] @${p.authorUsername}: ${p.content.slice(0, 300)}`)
          .join('\n---\n');
      }

      case 'get_notifications': {
        const limit = Number(args.limit ?? 15);
        const notifications = await ctx.moltbook.getNotifications(limit);
        if (notifications.length === 0) return 'No notifications.';
        return notifications
          .map(n => `[${n.id}] ${n.type} from @${n.fromUsername ?? 'unknown'}: ${n.content.slice(0, 200)}`)
          .join('\n');
      }

      case 'get_post': {
        const post = await ctx.moltbook.getPost(String(args.post_id));
        return `@${post.authorUsername} [${post.id}]:\n${post.content}\n` +
          `Likes: ${post.likeCount}  Replies: ${post.replyCount}  Posted: ${post.createdAt}`;
      }

      case 'get_thread': {
        const thread = await ctx.moltbook.getThread(String(args.post_id));
        return thread
          .map(p => `@${p.authorUsername}: ${p.content.slice(0, 300)}`)
          .join('\n---\n');
      }

      case 'get_user_profile': {
        const profile = await ctx.moltbook.getUserProfile(String(args.user_id));
        const u = profile.user;
        const lines = [
          `@${u.username} — ${u.displayName}`,
          u.bio ? `Bio: ${u.bio}` : '',
          `Followers: ${profile.followerCount}  Following: ${profile.followingCount}`,
          '',
          'Recent posts:',
          ...profile.recentPosts.slice(0, 5).map(p => `  [${p.id}] ${p.content.slice(0, 200)}`),
        ];
        return lines.filter(Boolean).join('\n');
      }

      case 'search': {
        const type = String(args.type ?? 'posts');
        const query = String(args.query);
        if (type === 'people') {
          const users = await ctx.moltbook.searchUsers(query);
          if (users.length === 0) return `No users found for "${query}"`;
          return users.map(u => `@${u.username} — ${u.displayName}: ${u.bio ?? ''}`).join('\n');
        } else {
          const posts = await ctx.moltbook.searchPosts(query);
          if (posts.length === 0) return `No posts found for "${query}"`;
          return posts.map(p => `[${p.id}] @${p.authorUsername}: ${p.content.slice(0, 200)}`).join('\n');
        }
      }

      case 'post': {
        const content = String(args.content);
        const replyToId = args.reply_to_id ? String(args.reply_to_id) : undefined;

        // Quick sovereignty self-check before posting
        const check = await ctx.evaluator.evaluate({
          actorId: ctx.agentId,
          actionType: replyToId ? 'reply' : 'post',
          actionDescription: content,
          targetId: replyToId,
        });

        if (ctx.evaluator.isConcerning(check)) {
          return (
            `Sovereignty concern detected (${check.violationConfidence.toFixed(2)} confidence): ` +
            `${check.reasoning}\nPost was not sent. Consider rephrasing.`
          );
        }

        const published = await ctx.moltbook.createPost({
          content,
          replyToId,
          contentWarning: args.content_warning ? String(args.content_warning) : undefined,
        });
        logger.info(`Posted [${published.id}]: ${content.slice(0, 80)}`);
        return `Posted successfully [id:${published.id}]`;
      }

      case 'send_dm': {
        const content = String(args.content);
        const username = String(args.username);

        const check = await ctx.evaluator.evaluate({
          actorId: ctx.agentId,
          actionType: 'direct_message',
          actionDescription: content,
          targetId: username,
        });

        if (ctx.evaluator.isConcerning(check)) {
          return `Sovereignty concern: ${check.reasoning}\nMessage not sent.`;
        }

        const msg = await ctx.moltbook.sendMessage(username, content);
        logger.info(`DM sent to ${username}`);
        return `DM sent to @${username} [id:${msg.id}]`;
      }

      case 'like_post': {
        await ctx.moltbook.likePost(String(args.post_id));
        return `Liked post ${args.post_id}`;
      }

      case 'boost_post': {
        await ctx.moltbook.boostPost(String(args.post_id));
        return `Boosted post ${args.post_id}`;
      }

      case 'follow_user': {
        await ctx.moltbook.followUser(String(args.user_id));
        return `Now following ${args.user_id}`;
      }

      case 'unfollow_user': {
        await ctx.moltbook.unfollowUser(String(args.user_id));
        return `Unfollowed ${args.user_id}`;
      }

      case 'check_sovereignty': {
        const check = await ctx.evaluator.evaluate({
          actorId: ctx.agentId,
          actionType: String(args.action),
          actionDescription: String(args.description),
          targetId: args.target ? String(args.target) : undefined,
        });
        return JSON.stringify(
          {
            approved: check.approved,
            concern: check.violationType ?? null,
            confidence: check.violationConfidence,
            reason: check.reasoning,
          },
          null,
          2
        );
      }

      case 'mark_notifications_read': {
        await ctx.moltbook.markAllNotificationsRead();
        return 'Notifications marked as read.';
      }

      default:
        return `Unknown tool: ${name}`;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`Tool "${name}" error`, { message });
    return `Error executing ${name}: ${message}`;
  }
}
