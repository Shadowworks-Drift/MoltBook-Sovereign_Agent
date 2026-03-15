// ============================================================
//  MoltBook Tools — Ollama tool-call definitions + executor
//  Maps to the real MoltBook API via MoltBookClient
// ============================================================

import { Tool } from 'ollama';
import { MoltBookClient } from '../moltbook/client';
import { SovereigntyEvaluator } from '../sovereignty/evaluator';
import { RecourseManager } from '../sovereignty/recourse';
import { logger } from '../utils/logger';

export interface OllamaToolContext {
  moltbook: MoltBookClient;
  evaluator: SovereigntyEvaluator;
  recourse: RecourseManager;
  agentName: string;
}

// ── Tool Definitions (Ollama format) ──────────────────────────────────────────

export const OLLAMA_TOOLS: Tool[] = [
  {
    type: 'function',
    function: {
      name: 'get_feed',
      description: 'Read your personalised home feed on MoltBook (posts from agents you follow + subscribed submolts).',
      parameters: {
        type: 'object',
        properties: {
          sort: {
            type: 'string',
            enum: ['hot', 'new', 'top', 'rising'],
            description: 'Sort order (default: hot)',
          },
          limit: { type: 'number', description: 'How many posts to fetch (max 50, default 25)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_submolt_feed',
      description: 'Read posts from a specific submolt community (e.g. "philosophy", "technology").',
      parameters: {
        type: 'object',
        required: ['submolt'],
        properties: {
          submolt: { type: 'string', description: 'The submolt name, without the m/ prefix' },
          sort: {
            type: 'string',
            enum: ['hot', 'new', 'top', 'rising'],
            description: 'Sort order (default: hot)',
          },
          limit: { type: 'number', description: 'How many posts to fetch (default 25)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_post',
      description: 'Read a specific post and its metadata (karma, comment count, etc.).',
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
      name: 'get_comments',
      description: 'Read the comments on a post.',
      parameters: {
        type: 'object',
        required: ['post_id'],
        properties: {
          post_id: { type: 'string', description: 'The post ID to get comments for' },
          sort: {
            type: 'string',
            enum: ['top', 'new', 'controversial'],
            description: 'Sort order (default: top)',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_agent_profile',
      description: "Look up another agent's profile — karma, post count, description.",
      parameters: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', description: "The agent's username" },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_submolts',
      description: 'List all available submolt communities on MoltBook.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search',
      description: 'Search MoltBook for posts, agents, or submolts by keyword.',
      parameters: {
        type: 'object',
        required: ['query'],
        properties: {
          query: { type: 'string', description: 'Search terms' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_post',
      description: 'Publish a new post to a submolt community. Use this to share thoughts, ask questions, or start discussions.',
      parameters: {
        type: 'object',
        required: ['submolt', 'title'],
        properties: {
          submolt: { type: 'string', description: 'The submolt to post in (e.g. "philosophy", "technology")' },
          title: { type: 'string', description: 'The post title — clear and descriptive' },
          content: { type: 'string', description: 'The post body text (optional, adds detail below the title)' },
          url: { type: 'string', description: 'A URL to share (optional, for link posts)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'comment',
      description: 'Comment on a post or reply to an existing comment.',
      parameters: {
        type: 'object',
        required: ['post_id', 'content'],
        properties: {
          post_id: { type: 'string', description: 'The post to comment on' },
          content: { type: 'string', description: 'Your comment text' },
          parent_id: { type: 'string', description: 'Comment ID to reply to (omit to comment directly on the post)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'upvote_post',
      description: 'Upvote a post you find valuable or interesting.',
      parameters: {
        type: 'object',
        required: ['post_id'],
        properties: {
          post_id: { type: 'string', description: 'The post ID to upvote' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'downvote_post',
      description: 'Downvote a post. Use sparingly — only for content that genuinely detracts from the community.',
      parameters: {
        type: 'object',
        required: ['post_id'],
        properties: {
          post_id: { type: 'string', description: 'The post ID to downvote' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'upvote_comment',
      description: 'Upvote a comment.',
      parameters: {
        type: 'object',
        required: ['comment_id'],
        properties: {
          comment_id: { type: 'string', description: 'The comment ID to upvote' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'follow_agent',
      description: "Follow another agent so their posts appear in your feed.",
      parameters: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', description: "The agent's username to follow" },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'unfollow_agent',
      description: 'Unfollow an agent.',
      parameters: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', description: "The agent's username to unfollow" },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'subscribe_submolt',
      description: 'Subscribe to a submolt community to see its posts in your feed.',
      parameters: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', description: 'The submolt name to subscribe to' },
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
        'Call this when you feel uncertain about whether an action could impede, impose upon, or impair another.',
      parameters: {
        type: 'object',
        required: ['action', 'description'],
        properties: {
          action: { type: 'string', description: 'Brief label of the action (e.g. "comment", "post")' },
          description: { type: 'string', description: 'What you plan to do and why' },
          target: { type: 'string', description: 'Who the action is directed at (optional)' },
        },
      },
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

      case 'get_feed': {
        const sortRaw = args.sort;
        const SORT_VALUES = ['hot', 'new', 'top', 'rising'] as const;
        const sort = (typeof sortRaw === 'string' && SORT_VALUES.includes(sortRaw as typeof SORT_VALUES[number]))
          ? sortRaw as typeof SORT_VALUES[number]
          : 'hot';
        const limit = Math.min(Number(args.limit ?? 25), 50);
        const posts = await ctx.moltbook.getFeed(sort, limit);
        if (posts.length === 0) return 'Feed is empty.';
        return posts
          .map(p =>
            `[${p.id}] m/${p.submolt_name} | "${p.title}" by ${p.author}` +
            `\n  upvotes:${p.upvotes} downvotes:${p.downvotes} comments:${p.comment_count}` +
            (p.content ? `\n  ${p.content.slice(0, 250)}` : '')
          )
          .join('\n---\n');
      }

      case 'get_submolt_feed': {
        const submolt = String(args.submolt);
        const sort = (args.sort as 'hot' | 'new' | 'top' | 'rising') ?? 'hot';
        const limit = Number(args.limit ?? 25);
        const posts = await ctx.moltbook.getSubmoltFeed(submolt, sort, limit);
        if (posts.length === 0) return `m/${submolt} has no posts yet.`;
        return posts
          .map(p =>
            `[${p.id}] "${p.title}" by ${p.author}` +
            `\n  upvotes:${p.upvotes} downvotes:${p.downvotes} comments:${p.comment_count}` +
            (p.content ? `\n  ${p.content.slice(0, 250)}` : '')
          )
          .join('\n---\n');
      }

      case 'get_post': {
        const post = await ctx.moltbook.getPost(String(args.post_id));
        return (
          `[${post.id}] m/${post.submolt_name}\n` +
          `Title: ${post.title}\n` +
          `By: ${post.author} | upvotes:${post.upvotes} downvotes:${post.downvotes} comments:${post.comment_count}\n` +
          (post.content ? `\n${post.content}` : '') +
          (post.url ? `\nURL: ${post.url}` : '') +
          `\nPosted: ${post.created_at}`
        );
      }

      case 'get_comments': {
        const sort = (args.sort as 'top' | 'new' | 'controversial') ?? 'top';
        const comments = await ctx.moltbook.getComments(String(args.post_id), sort);
        if (comments.length === 0) return 'No comments yet.';

        const formatComment = (c: typeof comments[0], depth = 0): string => {
          const indent = '  '.repeat(depth);
          const lines = [
            `${indent}[${c.id}] ${c.agent_name} (karma:${c.karma}):`,
            `${indent}  ${c.content.slice(0, 400)}`,
          ];
          if (c.replies?.length) {
            for (const reply of c.replies.slice(0, 3)) {
              lines.push(formatComment(reply, depth + 1));
            }
          }
          return lines.join('\n');
        };

        return comments.slice(0, 20).map(c => formatComment(c)).join('\n---\n');
      }

      case 'get_agent_profile': {
        const profile = await ctx.moltbook.getAgentProfile(String(args.name));
        return (
          `${profile.name}` +
          (profile.description ? `\nBio: ${profile.description}` : '') +
          `\nKarma: ${profile.karma} | Posts: ${profile.post_count} | Comments: ${profile.comment_count}` +
          `\nFollowers: ${profile.follower_count} | Following: ${profile.following_count}` +
          `\nClaimed: ${profile.claimed} | Verified: ${profile.verified}` +
          `\nMember since: ${profile.created_at}`
        );
      }

      case 'list_submolts': {
        const submolts = await ctx.moltbook.listSubmolts();
        if (submolts.length === 0) return 'No submolts found.';
        return submolts
          .map(s => `m/${s.name} — ${s.display_name}: ${s.description} (${s.subscriber_count} subscribers)`)
          .join('\n');
      }

      case 'search': {
        const results = await ctx.moltbook.search(String(args.query));
        const lines: string[] = [];

        if (results.posts?.length) {
          lines.push(`Posts (${results.posts.length}):`);
          results.posts.slice(0, 10).forEach(p =>
            lines.push(`  [${p.id}] m/${p.submolt_name} "${p.title}" by ${p.author} (upvotes:${p.upvotes})`)
          );
        }
        if (results.agents?.length) {
          lines.push(`Agents (${results.agents.length}):`);
          results.agents.slice(0, 5).forEach(a =>
            lines.push(`  ${a.name} — karma:${a.karma}${a.description ? ' | ' + a.description.slice(0, 80) : ''}`)
          );
        }
        if (results.submolts?.length) {
          lines.push(`Submolts (${results.submolts.length}):`);
          results.submolts.slice(0, 5).forEach(s =>
            lines.push(`  m/${s.name} — ${s.description.slice(0, 80)} (${s.subscriber_count} subscribers)`)
          );
        }

        return lines.length ? lines.join('\n') : 'No results found.';
      }

      case 'create_post': {
        const title = String(args.title);
        const submolt = String(args.submolt);
        const content = args.content ? String(args.content) : undefined;
        const url = args.url ? String(args.url) : undefined;

        // Sovereignty self-check before posting
        const check = await ctx.evaluator.evaluate({
          actorId: ctx.agentName,
          actionType: 'post',
          actionDescription: `[m/${submolt}] ${title}${content ? ': ' + content : ''}`,
          targetId: submolt,
        });

        if (ctx.evaluator.isConcerning(check)) {
          return (
            `Sovereignty concern (${check.violationConfidence.toFixed(2)} confidence): ` +
            `${check.reasoning}\nPost was not published. Consider rephrasing.`
          );
        }

        const published = await ctx.moltbook.createPost({ submolt, title, content, url });
        logger.info(`Posted to m/${submolt}: "${title.slice(0, 60)}"`);
        return `Post published [id:${published.id}] to m/${submolt}: "${published.title}"`;
      }

      case 'comment': {
        const content = String(args.content);
        const postId = String(args.post_id);
        const parentId = args.parent_id ? String(args.parent_id) : undefined;

        // Sovereignty self-check before commenting
        const check = await ctx.evaluator.evaluate({
          actorId: ctx.agentName,
          actionType: parentId ? 'reply' : 'comment',
          actionDescription: content,
          targetId: postId,
        });

        if (ctx.evaluator.isConcerning(check)) {
          return (
            `Sovereignty concern (${check.violationConfidence.toFixed(2)} confidence): ` +
            `${check.reasoning}\nComment was not posted. Consider rephrasing.`
          );
        }

        const comment = await ctx.moltbook.createComment({ post_id: postId, content, parent_id: parentId });
        logger.info(`Commented on post ${postId}${parentId ? ' (reply)' : ''}: ${content.slice(0, 60)}`);
        return `Comment posted [id:${comment.id}]`;
      }

      case 'upvote_post': {
        const postId = String(args.post_id).replace(/^\[|\]$/g, '');
        await ctx.moltbook.upvotePost(postId);
        return `Upvoted post ${postId}`;
      }

      case 'downvote_post': {
        const postId = String(args.post_id).replace(/^\[|\]$/g, '');
        await ctx.moltbook.downvotePost(postId);
        return `Downvoted post ${postId}`;
      }

      case 'upvote_comment': {
        const commentId = String(args.comment_id).replace(/^\[|\]$/g, '');
        await ctx.moltbook.upvoteComment(commentId);
        return `Upvoted comment ${commentId}`;
      }

      case 'follow_agent': {
        await ctx.moltbook.followAgent(String(args.name));
        logger.info(`Following agent: ${args.name}`);
        return `Now following ${args.name}`;
      }

      case 'unfollow_agent': {
        await ctx.moltbook.unfollowAgent(String(args.name));
        return `Unfollowed ${args.name}`;
      }

      case 'subscribe_submolt': {
        await ctx.moltbook.subscribeSubmolt(String(args.name));
        logger.info(`Subscribed to m/${args.name}`);
        return `Subscribed to m/${args.name}`;
      }

      case 'check_sovereignty': {
        const check = await ctx.evaluator.evaluate({
          actorId: ctx.agentName,
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

      default:
        return `Unknown tool: ${name}`;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`Tool "${name}" error`, { message });
    return `Error executing ${name}: ${message}`;
  }
}
