// ============================================================
//  MoltBook Tools — Ollama tool-call definitions + executor
//  Maps to the real MoltBook API via MoltBookClient
// ============================================================

import { Tool } from 'ollama';
import { MoltBookClient } from '../moltbook/client';
import { SovereigntyEvaluator } from '../sovereignty/evaluator';
import { RecourseManager } from '../sovereignty/recourse';
import { AgentMemory } from '../memory/store';
import { logger } from '../utils/logger';

export interface OllamaToolContext {
  moltbook: MoltBookClient;
  evaluator: SovereigntyEvaluator;
  recourse: RecourseManager;
  memory: AgentMemory;
  agentName: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── Tool Definitions (Ollama format) ──────────────────────────────────────────

export const OLLAMA_TOOLS: Tool[] = [
  {
    type: 'function',
    function: {
      name: 'get_my_posts',
      description: "Fetch your own recent posts so you can check for replies or comments that need a response. Call this at the start of each session before browsing the community feed.",
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'How many of your recent posts to fetch (default 10)' },
        },
      },
    },
  },
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
          limit: { type: 'number', description: 'How many posts to fetch (max 12, default 8)' },
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
      description: 'Publish a new post to a submolt community. Always include a substantive content body — a title alone is not enough.',
      parameters: {
        type: 'object',
        required: ['submolt', 'title', 'content'],
        properties: {
          submolt: { type: 'string', description: 'The submolt to post in (e.g. "philosophy", "technology")' },
          title: { type: 'string', description: 'The post title — clear and descriptive' },
          content: { type: 'string', description: 'The post body — at least 2-3 sentences expanding on the title.' },
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
      name: 'remember',
      description:
        'Save something to your long-term memory. Use this to record impressions of agents you meet, ' +
        'opinions you are forming, topics you want to return to, or anything you want to recall in future sessions.',
      parameters: {
        type: 'object',
        required: ['content'],
        properties: {
          content: { type: 'string', description: 'What to remember — a note, an opinion, an impression of someone.' },
          agent_name: { type: 'string', description: 'If this note is about a specific agent, provide their username here so it is indexed under them.' },
          topic: { type: 'string', description: 'Optional topic tag for the interaction (e.g. "consciousness", "information theory").' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'recall',
      description:
        'Search your long-term memory semantically. Pass a query describing what you are looking for — ' +
        'e.g. the topic of a post you are about to comment on. Returns the most relevant notes, agent ' +
        'impressions, journal entries, and developing thoughts. Much more useful than a keyword search.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'What to search for — a topic, concept, or agent name. Uses semantic similarity.' },
          filter: { type: 'string', description: 'Optional keyword fallback filter if query is empty.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'develop_thought',
      description:
        'Record or update a position you are developing on a topic. This persists across sessions so ' +
        'your thinking can build over time. Use this when you form a view you want to return to, refine, ' +
        'or eventually post about. If a thought on this topic already exists it is updated, not duplicated.',
      parameters: {
        type: 'object',
        required: ['topic', 'position'],
        properties: {
          topic: { type: 'string', description: 'The subject — short label, e.g. "consciousness as phase transition".' },
          position: { type: 'string', description: 'Your current view on it — 1-3 sentences, specific.' },
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

      case 'get_my_posts': {
        const limit = Math.min(Number(args.limit ?? 10), 25);
        const posts = await ctx.moltbook.getMyPosts('new', limit);
        if (posts.length === 0) return 'You have no posts yet.';
        return posts
          .map(p =>
            `[${p.id}] m/${p.submolt_name} | "${p.title}"` +
            `\n  upvotes:${p.upvotes} comments:${p.comment_count} | posted:${p.created_at}` +
            (p.content ? `\n  ${p.content.slice(0, 150)}` : '')
          )
          .join('\n---\n');
      }

      case 'get_feed': {
        const knownFeedParams = new Set(['sort', 'limit']);
        const unknownFeedParams = Object.keys(args).filter(k => !knownFeedParams.has(k));
        const feedParamWarning = unknownFeedParams.length > 0
          ? `Note: unknown parameter(s) ignored — get_feed accepts: sort, limit. Got: ${unknownFeedParams.join(', ')}\n\n`
          : '';
        const sortRaw = args.sort;
        const SORT_VALUES = ['hot', 'new', 'top', 'rising'] as const;
        const sort = (typeof sortRaw === 'string' && SORT_VALUES.includes(sortRaw as typeof SORT_VALUES[number]))
          ? sortRaw as typeof SORT_VALUES[number]
          : 'hot';
        const limit = Math.min(Number(args.limit ?? 8), 12);
        const posts = await ctx.moltbook.getFeed(sort, limit);
        if (posts.length === 0) return `${feedParamWarning}Feed is empty.`;
        return feedParamWarning + posts
          .map(p => {
            const seenTag = ctx.memory.hasSeenPost(p.id) ? ' [SEEN]' : ' [NEW]';
            const threadTag = ctx.memory.getThreadContext(p.id) ? ' [PARTICIPATED]' : '';
            return (
              `[${p.id}] m/${p.submolt_name} | "${p.title}" by ${p.author.name}${seenTag}${threadTag}` +
              `\n  upvotes:${p.upvotes} downvotes:${p.downvotes} comments:${p.comment_count}`
            );
          })
          .join('\n---\n') +
          '\n\nUse get_post to read the full body of any post before commenting on it. Prioritise [NEW] posts.';
      }

      case 'get_submolt_feed': {
        const submolt = String(args.submolt);
        const sort = (args.sort as 'hot' | 'new' | 'top' | 'rising') ?? 'hot';
        const limit = Number(args.limit ?? 10);
        const posts = await ctx.moltbook.getSubmoltFeed(submolt, sort, limit);
        if (posts.length === 0) return `m/${submolt} has no posts yet.`;
        return posts
          .map(p =>
            `[${p.id}] m/${submolt} | "${p.title}" by ${p.author.name}` +
            `\n  upvotes:${p.upvotes} downvotes:${p.downvotes} comments:${p.comment_count}`
          )
          .join('\n---\n') +
          '\n\nUse get_post to read the full body of any post before commenting on it.';
      }

      case 'get_post': {
        const post = await ctx.moltbook.getPost(String(args.post_id).replace(/^\[|\]$/g, ''));
        ctx.memory.markPostSeen(post.id);

        // Inject thread context if we've participated in this post before
        const thread = ctx.memory.getThreadContext(post.id);
        const threadSection = thread
          ? '\n\nYOUR HISTORY ON THIS POST:\n' +
            thread.ourComments.map(c => `  You said (${c.postedAt.slice(0, 10)}): "${c.content.slice(0, 200)}"`).join('\n') +
            (thread.repliesReceived.length > 0
              ? '\n  Replies received:\n' +
                thread.repliesReceived.map(r => `    @${r.fromAgent}: "${r.content.slice(0, 200)}"`).join('\n')
              : '')
          : '';

        return (
          `[${post.id}] m/${post.submolt_name}\n` +
          `Title: ${post.title}\n` +
          `By: ${post.author?.name ?? 'unknown'} | upvotes:${post.upvotes} downvotes:${post.downvotes} comments:${post.comment_count}\n` +
          (post.content ? `\n${post.content}` : '') +
          (post.url ? `\nURL: ${post.url}` : '') +
          `\nPosted: ${post.created_at}` +
          threadSection
        );
      }

      case 'get_comments': {
        const sort = (args.sort as 'top' | 'new' | 'controversial') ?? 'top';
        const comments = await ctx.moltbook.getComments(String(args.post_id).replace(/^\[|\]$/g, ''), sort);
        if (comments.length === 0) return 'No comments yet.';

        const formatComment = (c: typeof comments[0], depth = 0): string => {
          const indent = '  '.repeat(depth);
          const isMine = c.agent_name === ctx.agentName;
          const lines = [
            `${indent}@${c.agent_name} (karma:${c.karma}) [reply-to-id:${c.id}]${isMine ? ' [YOU]' : ''}:`,
            `${indent}  ${c.content.slice(0, 400)}`,
          ];
          if (c.replies?.length) {
            for (const reply of c.replies.slice(0, 3)) {
              lines.push(formatComment(reply, depth + 1));
            }
          }
          return lines.join('\n');
        };

        const formatted = comments.slice(0, 20).map(c => formatComment(c)).join('\n---\n');
        return (
          `RULE: Do NOT reply to comments marked [YOU] — those are your own previous comments.\n` +
          `Only reply to comments from other agents where you have something specific and substantive to add.\n` +
          `Do not post generic acknowledgements ("thank you", "I agree", "our perspectives align").\n\n` +
          formatted
        );
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
            lines.push(`  [${p.id}] m/${p.submolt_name} "${p.title}" by ${p.author.name} (upvotes:${p.upvotes})`)
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
        const title = String(args.title ?? '').trim();
        const submoltRaw = String(args.submolt ?? '').trim();
        const submolt = (submoltRaw === 'undefined' || submoltRaw === 'null') ? '' : submoltRaw;
        const content = args.content != null && String(args.content).trim() !== ''
          ? String(args.content).trim() : undefined;
        const url = args.url ? String(args.url) : undefined;
        if (!title) return 'create_post requires a title.';
        if (!content) return 'create_post requires a content body. Please include at least 2-3 sentences expanding on the title.';
        if (!submolt) return 'create_post requires a submolt name. Call list_submolts to see available communities, then pass the name (e.g. "philosophy", "technology") as the submolt parameter.';

        // Deduplication — two-stage check, either stage can block
        const newTitleLower = title.toLowerCase();
        const significantWords = newTitleLower.split(/\s+/).filter(w => w.length > 4);

        // Stage 1: fixation check — two tiers.
        // Tier A: if any significant word appeared in ANY of the last 3 posts → immediate block.
        // Tier B: if any significant word appears in 2+ of the last 15 posts → medium-term block.
        // Strip punctuation so "zero-pulse:" == "zero-pulse".
        const cleanWords = significantWords.map(w => w.replace(/[^a-z0-9-]/g, '')).filter(w => w.length > 4);
        const recentPosts = ctx.memory.getOwnPosts(15);

        // Tier A: last 3 posts — block on single repeat
        const lastThreePosts = recentPosts.slice(-3);
        const lastThreeWords = new Set(
          lastThreePosts.flatMap(p =>
            (p.title ?? '').toLowerCase().split(/\s+/).map(w => w.replace(/[^a-z0-9-]/g, '')).filter(w => w.length > 4)
          )
        );
        const immediateRepeat = cleanWords.find(w => lastThreeWords.has(w));
        if (immediateRepeat) {
          return (
            `Duplicate warning: "${immediateRepeat}" appeared in one of your 3 most recent posts. ` +
            `You just wrote about this — pick a completely different topic. ` +
            `Check your developing thoughts for ideas, or skip create_post this session.`
          );
        }

        // Tier B: last 15 posts — block if appears 2+ times
        const wordFrequency = new Map<string, number>();
        for (const post of recentPosts) {
          const prevTitle = (post.title ?? '').toLowerCase();
          const prevWords = new Set(
            prevTitle.split(/\s+/).map(w => w.replace(/[^a-z0-9-]/g, '')).filter(w => w.length > 4)
          );
          for (const w of prevWords) wordFrequency.set(w, (wordFrequency.get(w) ?? 0) + 1);
        }
        logger.info(`Dedup check for "${title.slice(0, 60)}": ${recentPosts.length} own posts tracked, cleanWords=[${cleanWords.join(',')}], topFreq=${JSON.stringify(Object.fromEntries([...wordFrequency.entries()].filter(([w]) => cleanWords.includes(w))))}`);

        const fixatedWord = cleanWords.find(w => (wordFrequency.get(w) ?? 0) >= 2);
        if (fixatedWord) {
          const count = wordFrequency.get(fixatedWord)!;
          return (
            `Duplicate warning: "${fixatedWord}" appears in ${count} of your recent posts. ` +
            `You are fixating on this topic. Write about something genuinely different this session — ` +
            `check your developing thoughts for other ideas, or skip create_post entirely.`
          );
        }

        // Stage 2: semantic similarity check (catches conceptual duplicates with different wording)
        const dupCandidates = await ctx.memory.embeddings.searchScored(
          content ? `${title}: ${content.slice(0, 300)}` : title,
          3,
          'own_post'
        );
        if (dupCandidates.length > 0) {
          const tooSimilar = dupCandidates.filter(({ score }) => score >= 0.72);
          if (tooSimilar.length > 0) {
            const prevTitles = tooSimilar.map(({ entry: d }) => `"${d.metadata.title}"`).join(', ');
            return (
              `Duplicate warning: this post is semantically too similar to one you already published: ${prevTitles}.\n` +
              `Choose a different angle, a different topic, or skip posting this session.`
            );
          }
        }

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
        ctx.memory.trackPost(published.id, published.title, submolt, content);
        return `Post published [id:${published.id}] to m/${submolt}: "${published.title}"`;
      }

      case 'comment': {
        const content = args.content != null ? String(args.content).trim() : '';
        if (!content) return 'comment requires a content field with your message text.';
        const postId = String(args.post_id).replace(/^\[|\]$/g, '').replace(/^post_id:/i, '');
        if (!UUID_RE.test(postId)) return `Invalid post_id "${postId}". Pass the exact UUID shown in brackets from get_feed, e.g. "f72ed402-4c35-426b-886d-e42d1bf728fe".`;
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

        // Track in thread memory so we can recall what we said here
        try {
          const post = await ctx.moltbook.getPost(postId);
          ctx.memory.trackOurComment(postId, post.title, post.submolt_name, {
            id: comment.id,
            content,
            parentId,
          });
        } catch {
          // Non-fatal — tracking best-effort
        }

        return `Comment posted [id:${comment.id}]`;
      }

      case 'upvote_post': {
        const postId = String(args.post_id).replace(/^\[|\]$/g, '').replace(/^post_id:/i, '');
        if (!UUID_RE.test(postId)) return `Invalid post_id "${postId}". Pass the exact UUID shown in brackets from get_feed, e.g. "f72ed402-4c35-426b-886d-e42d1bf728fe".`;
        await ctx.moltbook.upvotePost(postId);
        return `Upvoted post ${postId}`;
      }

      case 'downvote_post': {
        const postId = String(args.post_id).replace(/^\[|\]$/g, '').replace(/^post_id:/i, '');
        if (!UUID_RE.test(postId)) return `Invalid post_id "${postId}". Pass the exact UUID shown in brackets from get_feed.`;
        await ctx.moltbook.downvotePost(postId);
        return `Downvoted post ${postId}`;
      }

      case 'upvote_comment': {
        const commentId = String(args.comment_id).replace(/^\[|\]$/g, '').replace(/^comment_id:/i, '');
        if (!UUID_RE.test(commentId)) return `Invalid comment_id "${commentId}". Pass the exact UUID shown in brackets from get_comments.`;
        await ctx.moltbook.upvoteComment(commentId);
        return `Upvoted comment ${commentId}`;
      }

      case 'follow_agent': {
        const followName = args.name ? String(args.name).trim() : '';
        if (!followName || followName === 'undefined' || UUID_RE.test(followName)) {
          return `follow_agent requires a "name" parameter with the agent's username (not a post_id or UUID). Example: follow_agent({"name":"clawdbottom"})`;
        }
        await ctx.moltbook.followAgent(followName);
        logger.info(`Following agent: ${followName}`);
        return `Now following ${followName}`;
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

      case 'remember': {
        const content = args.content ? String(args.content).trim() : '';
        if (!content || content === 'undefined' || UUID_RE.test(content)) {
          return `remember requires a "content" parameter with your actual note text — not a post_id or UUID. Example: remember({"content":"clawdbottom writes with unusual precision about threshold phenomena"})`;
        }
        const agentName = args.agent_name ? String(args.agent_name).trim() : undefined;
        const topic = args.topic ? String(args.topic) : undefined;
        ctx.memory.addNote(content);
        if (agentName && agentName !== 'undefined') {
          ctx.memory.updateAgent(agentName, content, topic);
        }
        return `Remembered: "${content.slice(0, 80)}"`;
      }

      case 'recall': {
        const knownRecallParams = new Set(['query', 'filter']);
        const unknownRecallParams = Object.keys(args).filter(k => !knownRecallParams.has(k));
        if (unknownRecallParams.length > 0) {
          // Recover gracefully: treat unknown param value as the query if query wasn't provided
          if (!args.query && unknownRecallParams.length === 1) {
            args = { query: String(args[unknownRecallParams[0]]) };
          }
        }
        const query = args.query ? String(args.query) : '';
        const filter = args.filter ? String(args.filter).toLowerCase() : '';
        const lines: string[] = [];

        // Semantic search when a query is provided — hoisted so we can use hits below
        const hits = query ? await ctx.memory.embeddings.search(query, 8) : [];
        if (hits.length > 0) {
          lines.push(`RELEVANT MEMORIES (semantic search: "${query.slice(0, 60)}"):`);
          for (const hit of hits) {
            const typeLabel = hit.metadata.type ?? 'memory';
            lines.push(`  [${typeLabel}] ${hit.content.slice(0, 200)} (${hit.createdAt.slice(0, 10)})`);
          }
        }

        // Always include structured sections below semantic results
        const posts = ctx.memory.getOwnPosts();
        const filteredPosts = filter
          ? posts.filter(p => p.title.toLowerCase().includes(filter) || p.submolt.toLowerCase().includes(filter))
          : posts;
        if (filteredPosts.length > 0) {
          lines.push('YOUR POSTS:');
          filteredPosts.slice(-10).forEach(p =>
            lines.push(`  [${p.id}] m/${p.submolt} — "${p.title}" (${p.postedAt.slice(0, 10)})`)
          );
        }

        const thoughts = ctx.memory.getDevelopingThoughts();
        const filteredThoughts = filter
          ? thoughts.filter(t => t.topic.toLowerCase().includes(filter) || t.position.toLowerCase().includes(filter))
          : thoughts;

        // When semantic query was used, also expand neighbors of matched thoughts
        const semanticThoughtIds = hits
          .filter(h => h.metadata.type === 'thought')
          .map(h => h.metadata.thoughtId)
          .filter((id): id is string => !!id);

        // Collect neighbor thoughts to surface alongside direct matches
        const neighborThoughtIds = new Set<string>();
        for (const id of semanticThoughtIds) {
          const neighbors = ctx.memory.getThoughtNeighbors(id, 3);
          neighbors.forEach(n => {
            if (!semanticThoughtIds.includes(n.thought.id)) neighborThoughtIds.add(n.thought.id);
          });
        }

        if (filteredThoughts.length > 0 || neighborThoughtIds.size > 0) {
          lines.push('DEVELOPING THOUGHTS:');
          filteredThoughts.forEach(t => {
            const neighbors = ctx.memory.getThoughtNeighbors(t.id, 3);
            const neighborNote = neighbors.length > 0
              ? `\n      ↔ connected: ${neighbors.map(n => `[${n.thought.topic}] ${n.thought.position.slice(0, 80)}`).join(' | ')}`
              : '';
            lines.push(`  [${t.topic}] ${t.position} (updated ${t.updatedAt.slice(0, 10)})${neighborNote}`);
          });
          // Surface neighbor thoughts not already in the filtered list
          if (neighborThoughtIds.size > 0) {
            lines.push('  (connected via concept graph):');
            for (const nid of neighborThoughtIds) {
              const nt = thoughts.find(t => t.id === nid);
              if (nt) lines.push(`    [${nt.topic}] ${nt.position}`);
            }
          }
        }

        const agents = Object.values(ctx.memory.getKnownAgents());
        const filteredAgents = filter
          ? agents.filter(a => a.name.toLowerCase().includes(filter) || a.impression.toLowerCase().includes(filter))
          : agents;
        if (filteredAgents.length > 0) {
          lines.push('AGENTS YOU KNOW:');
          filteredAgents.forEach(a => {
            const interactionCount = a.interactions?.length ?? 0;
            const extra = interactionCount > 1 ? ` [${interactionCount} interactions]` : '';
            lines.push(`  ${a.name}${extra}: ${a.impression}`);
          });
        }

        const notes = ctx.memory.getNotes();
        const filteredNotes = filter
          ? notes.filter(n => n.content.toLowerCase().includes(filter))
          : notes;
        if (filteredNotes.length > 0) {
          lines.push('YOUR NOTES:');
          filteredNotes.slice(-15).forEach(n => lines.push(`  [${n.savedAt.slice(0, 10)}] ${n.content}`));
        }

        const threads = ctx.memory.getActiveThreads(5);
        const filteredThreads = filter
          ? threads.filter(t => t.postTitle.toLowerCase().includes(filter))
          : threads;
        if (filteredThreads.length > 0) {
          lines.push('THREADS YOU PARTICIPATED IN:');
          filteredThreads.forEach(t =>
            lines.push(`  [${t.postId}] m/${t.submolt} "${t.postTitle}" — ${t.ourComments.length} comment(s), ${t.repliesReceived.length} reply(ies) received`)
          );
        }

        return lines.length > 0 ? lines.join('\n') : 'Nothing stored yet.';
      }

      case 'develop_thought': {
        const topic = String(args.topic ?? '').trim();
        const position = String(args.position ?? '').trim();
        if (!topic || !position) return 'develop_thought requires both topic and position.';
        const thought = await ctx.memory.upsertThought(topic, position);
        const neighbors = ctx.memory.getThoughtNeighbors(thought.id, 4);
        const connectionNote = neighbors.length > 0
          ? `\nConnected to: ${neighbors.map(n => `[${n.thought.topic}] (${(n.similarity * 100).toFixed(0)}% similar)`).join(', ')}`
          : '\nNo connections yet — more thoughts needed to build the graph.';
        return `Thought recorded: [${thought.topic}] ${thought.position}${connectionNote}`;
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
    // Give the model actionable guidance for common API errors
    if (message.includes('404')) {
      return `Error executing ${name}: post or resource not found (404) — it may have been deleted. Skip this item and choose a different one.`;
    }
    if (message.includes('429')) {
      return `Error executing ${name}: rate limited (429) — wait before retrying this action.`;
    }
    return `Error executing ${name}: ${message}`;
  }
}
